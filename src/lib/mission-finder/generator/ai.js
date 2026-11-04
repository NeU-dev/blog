// AI版の生成器。テンプレート版と同じ形（question / analyzeFreeText / resultCopy）を持つ。
//
// - 全員に聞く問い（A1・A2・B1・B2）：スロットと動機コードはテンプレート版のまま、選択肢の文言だけを書かせる。
// - 掘る問いの計画：好き・嫌いそれぞれ、最初の問いの答えを見て、どの型（なぜ・失ったら・例外…）を
//   どの順で聞くかを AI に選ばせ、問いと選択肢の文も書かせる。型ごとに測る気持ちの枠は決まっているので、
//   集計はテンプレート版と同じ。続く自由記述の問いも、このとき一緒に書かせる。
// - その場で書く問い：「もう一段なぜ（value）」と「好きと嫌いをつなぐ問い（C1）」は、直前の答えを受けて書かせる。
// - 自由記述の分析：本人の文章からの引用つきで動機を読み取らせる。
//   本人が言っていること（testimony）だけをスコアに入れ、推測（inference）は表示だけにする。
// - ミッション候補：本人の答えと自由記述から、気持ちごとに候補と言い直し案を書かせる。
//   どの気持ちの候補をつくるか（集計）は決定的に決め、AIは文だけを書く。
// - 結果の読み解き：書き上げたミッションと本人の言葉のつながり、作れそうなもの、最初の一歩、次の問い。
// - 失敗・時間切れ・1日の上限に達したときは、その場でテンプレート版に切り替える。
//
// APIキーはブラウザに置かない。通信先は Supabase Edge Function（neulog-mission）。

import { CODE_INFO, CODES, DIRECTIONS, DISTANCES, ROLES } from '../codes.js';
import { STEPS, PROBE_COUNT, indexOfStep } from '../flow.js';
import { computeScores } from '../scoring.js';
import { hash, plain } from '../text.js';
import {
  templateGenerator, SLOT_TYPES, PROBES, safetyCheck, candidatePool, repairTypes, probeMenu, liveAskRequest, bridgeAskRequest,
} from './template.js';

const OPTIONS_TIMEOUT_MS = 20_000;
const PLAN_TIMEOUT_MS = 30_000;
const ASK_TIMEOUT_MS = 20_000;
const ANALYZE_TIMEOUT_MS = 30_000;
const MISSIONS_TIMEOUT_MS = 40_000;
const REFLECT_TIMEOUT_MS = 30_000;
const STATUS_TIMEOUT_MS = 5_000;

export function httpTransport(endpoint, visitorId) {
  return async (action, body) => {
    const response = await fetch(`${endpoint}?action=${action}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'x-neulog-visitor': visitorId() },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `http_${response.status}`);
      error.status = response.status;
      throw error;
    }
    return data;
  };
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); }),
  ]).finally(() => clearTimeout(timer));
}

const squash = (s) => String(s).replace(/\s+/g, '');
const keyOf = (request) => String(hash(JSON.stringify(request)));
const labelsOf = (state, id) => (state.answers[id]?.chosen || []).filter((o) => !o.none).map((o) => o.label).join('、');
const freeText = (state, id) => {
  const a = state.answers[id];
  return a && !a.skipped && a.text?.trim() ? a.text.trim().slice(0, 600) : '';
};

// AIが「」で引いた本人の項目を、画面で強調できる形（⟦⟧）にする
const markItems = (text, state) => [...state.likes, ...state.dislikes]
  .reduce((t, item) => t.split(`「${item}」`).join(`⟦${item}⟧`), text);
const markWording = (wording, state) => (wording ? { title: wording.title ? markItems(wording.title, state) : '', labels: wording.labels || {} } : null);

// ミッション候補・読み解きに渡す、本人の材料（好き・嫌い・選んだ答え・自由記述・相手や関わり方）
function material(state) {
  const picks = (kind) => Object.values(state.answers)
    .filter((a) => a.item?.kind === kind)
    .flatMap((a) => a.chosen.filter((o) => !o.none).map((o) => o.label))
    .slice(0, 12);
  const tag = (id, key) => state.answers[id]?.chosen?.find((o) => !o.none)?.[key];
  const direction = tag('D2', 'direction');
  return {
    likes: state.likes,
    dislikes: state.dislikes,
    answers: [
      { item: state.likes[0], kind: 'like', picks: picks('like') },
      { item: state.dislikes[0], kind: 'dislike', picks: picks('dislike') },
    ],
    episode: { about: state.likes[0], text: freeText(state, 'FT1') },
    why: { text: freeText(state, 'FT2') },
    persona: tag('D1', 'persona') || '',
    direction: direction ? `${DIRECTIONS[direction].name}（${DIRECTIONS[direction].label}）` : '',
    roles: (state.answers.D3?.chosen || []).filter((o) => !o.none).map((o) => ROLES[o.role]),
    distance: DISTANCES[tag('D4', 'distance')] || '',
  };
}

// 掘る問いの計画の材料。好きは A2、嫌いは B2 より前の答えだけを使う（A2・B2 に答えても計画が変わらないように）
function planRequest(state, side) {
  const idx = indexOfStep(side === 'like' ? 'A2' : 'B2');
  const scores = computeScores(state, idx);
  const answers = STEPS.slice(0, idx)
    .filter((s) => s.kind === 'choice' && state.answers[s.id])
    .map((s) => ({ question: plain(state.answers[s.id].qtext), answer: labelsOf(state, s.id) }))
    .filter((qa) => qa.answer)
    .slice(-12);
  return {
    side,
    item: side === 'like' ? state.likes[0] : state.dislikes[0],
    other: side === 'like' ? state.dislikes[0] : state.likes[0],
    answers,
    episode: side === 'dislike' ? freeText(state, 'FT1') : '',
    focus: scores.ranking.slice(0, 4).map((c) => CODE_INFO[c].name),
    count: PROBE_COUNT[side],
    menu: probeMenu(state, side),
  };
}

export function createAiGenerator(transport) {
  // 'ai'：使える / 'limited'：今日の上限に達した / 'offline'：使えない
  let mode = 'ai';
  const pending = new Map();

  const noteFailure = (error) => {
    if (error?.status === 429) mode = 'limited';
  };

  // 同じ材料なら頼み直さない（保存した結果を使う）。材料が変わったら頼み直す
  function cached(state, name, request, action, pick = (data) => data) {
    const key = keyOf(request);
    const store = (state.ai ||= { options: {} });
    if (store[name]?.key === key) return Promise.resolve(store[name].data);
    if (mode !== 'ai') return Promise.resolve(null);
    const id = `${name}:${key}`;
    if (!pending.has(id)) {
      pending.set(id, transport(action, request).then((data) => {
        const picked = pick(data);
        store[name] = { key, data: picked };
        return picked;
      }).catch((error) => {
        noteFailure(error);
        pending.delete(id);
        return null;
      }));
    }
    return pending.get(id);
  }

  const fetchPlan = (state, side) => cached(state, `plan:${side}`, planRequest(state, side), 'plan');

  // 掘る問いの型の並び。一度出したら固定する（あとから計画が届いても、出した問いが変わらないように）。
  // 計画の材料（A2・B2 より前の答え）が変わったときだけ、決め直す
  async function probeTypes(state, side) {
    const store = (state.ai ||= { options: {} });
    const key = keyOf(planRequest(state, side));
    const locked = store[`types:${side}`];
    if (locked?.key === key) return locked;
    const plan = await withTimeout(fetchPlan(state, side), PLAN_TIMEOUT_MS).catch(() => null);
    const next = { key, types: repairTypes(plan?.probes?.map((p) => p.type), side), fromAi: Boolean(plan) };
    store[`types:${side}`] = next;
    return next;
  }

  function fetchLive(state, side) {
    const request = liveAskRequest(state, side);
    return request.context.length ? cached(state, `ask:value:${side}`, request, 'ask') : Promise.resolve(null);
  }

  function fetchBridge(state) {
    const request = bridgeAskRequest(state, computeScores(state, indexOfStep('C1')));
    return request.context.length ? cached(state, 'ask:bridge', request, 'ask') : Promise.resolve(null);
  }

  // ミッション候補：E1（根っこを選ぶ問い）を出した時点で先に頼んでおき、E2・E3・結果で使う
  function fetchMissions(state) {
    const scores = computeScores(state, indexOfStep('E1'));
    const request = { ...material(state), codes: candidatePool(state, scores) };
    return cached(state, 'missions', request, 'missions', (data) => (data.candidates || [])
      .filter((c) => CODES.includes(c.code) && typeof c.text === 'string' && c.text.trim())
      // 根拠が項目名そのもの（「ゲーム」など）なら、気持ちの名前だけ見せれば十分なので出さない
      .map((c) => ({
        code: c.code,
        text: c.text,
        basis: [...state.likes, ...state.dislikes].includes(c.basis) ? '' : c.basis || '',
        variants: c.variants || {},
        source: 'ai',
      })));
  }

  function fetchReflection(state, copy) {
    // 2つ目のミッションは下書き（base）で頼む。結果画面での書き換えのたびに頼み直さないように
    const missions = copy.missions.map((m) => ({ code: m.code, text: m.base || m.text }));
    return cached(state, 'reflect', { ...material(state), missions }, 'reflect');
  }

  const itemOf = (state, kind) => (kind === 'like' ? state.likes : state.dislikes)[0];
  const stepsOf = (kind) => STEPS.filter((s) => SLOT_TYPES[s.gen] && s.phase === (kind === 'like' ? 'A' : 'B'));

  // 全員に聞く2問ぶんの選択肢を、まとめて言い換えてもらう
  function fetchItem(state, kind) {
    const item = itemOf(state, kind);
    const key = `${kind}:${item}`;
    if (pending.has(key)) return pending.get(key);
    const request = (async () => {
      if (mode !== 'ai') return null;
      const questions = await Promise.all(stepsOf(kind).map(async (step) => {
        const q = await templateGenerator.question(step, { state, step, scores: null });
        return {
          id: step.id,
          type: SLOT_TYPES[step.gen],
          question: plain(q.title),
          slots: q.options.filter((o) => !o.none).map((o) => ({ slot: o.id, template: o.label })),
        };
      }));
      const data = await transport('options', { item, kind, questions });
      return data.questions || null;
    })().catch((error) => {
      noteFailure(error);
      pending.delete(key);
      return null;
    });
    pending.set(key, request);
    return request;
  }

  async function slotQuestion(step, ctx) {
    const q = await templateGenerator.question(step, ctx);
    const kind = step.phase === 'A' ? 'like' : 'dislike';
    const item = itemOf(ctx.state, kind);
    const cache = (ctx.state.ai ||= { options: {} }).options;
    let entry = cache[step.id];
    // 一度決めた文言は保存して使い回す（あとから文言が変わると、答えが無効になってしまうため）
    if (!entry || entry.item !== item) {
      const fetched = await withTimeout(fetchItem(ctx.state, kind), OPTIONS_TIMEOUT_MS).catch(() => null);
      entry = cache[step.id] = { item, labels: fetched?.[step.id] || null };
    }
    if (entry.labels) {
      q.options = q.options.map((o) => (entry.labels[o.id] ? { ...o, label: entry.labels[o.id] } : o));
      q.source = 'ai';
    }
    return q;
  }

  async function probeQuestion(step, ctx) {
    const { state } = ctx;
    const { types, fromAi } = await probeTypes(state, step.side);
    const type = types[step.index];
    let wording = null;
    let reason = '';
    if (PROBES[step.side][type]?.live) {
      wording = await withTimeout(fetchLive(state, step.side), ASK_TIMEOUT_MS).catch(() => null);
    } else if (fromAi) {
      const plan = await fetchPlan(state, step.side);
      const planned = plan?.probes?.find((p) => p.type === type);
      wording = planned || null;
      reason = planned?.reason || '';
    }
    const q = await templateGenerator.question(step, { ...ctx, types, wording: markWording(wording, state) });
    if (fromAi || wording) q.source = 'ai';
    if (reason) q.reason = reason;
    return q;
  }

  return {
    name: 'ai',
    get mode() { return mode; },

    async status() {
      try {
        const data = await withTimeout(transport('status'), STATUS_TIMEOUT_MS);
        mode = data.ai ? 'ai' : 'offline';
      } catch {
        mode = 'offline';
      }
      return mode;
    },

    // 好き・嫌いを入力し終えたところで、全員に聞く問いの選択肢を先に頼んでおく
    prepare(state) {
      if (mode !== 'ai') return;
      fetchItem(state, 'like');
      fetchItem(state, 'dislike');
    },

    async question(step, ctx) {
      const { state } = ctx;
      // 待ち時間を減らすため、次に要るものを先に頼んでおく
      if (step.id === 'A2') fetchPlan(state, 'like');
      if (step.id === 'B2') fetchPlan(state, 'dislike');
      if (step.id === 'FT2') fetchBridge(state);
      if (step.gen === 'primary') fetchMissions(state);

      if (SLOT_TYPES[step.gen]) return slotQuestion(step, ctx);
      if (step.gen === 'probe') return probeQuestion(step, ctx);

      if (step.gen === 'ftLike' || step.gen === 'ftDislike') {
        const side = step.gen === 'ftLike' ? 'like' : 'dislike';
        const plan = await withTimeout(fetchPlan(state, side), PLAN_TIMEOUT_MS).catch(() => null);
        return templateGenerator.question(step, { ...ctx, freeQuestion: plan?.freeQuestion ? markItems(plan.freeQuestion, state) : '' });
      }

      if (step.gen === 'bridge') {
        const wording = await withTimeout(fetchBridge(state), ASK_TIMEOUT_MS).catch(() => null);
        const q = await templateGenerator.question(step, { ...ctx, wording: markWording(wording, state) });
        if (wording) q.source = 'ai';
        return q;
      }

      if (step.gen === 'missionCandidates' || step.gen === 'missionRefine') {
        const aiCandidates = await withTimeout(fetchMissions(state), MISSIONS_TIMEOUT_MS).catch(() => null);
        const q = await templateGenerator.question(step, { ...ctx, aiCandidates });
        if (aiCandidates?.length) q.source = 'ai';
        return q;
      }

      return templateGenerator.question(step, ctx);
    },

    async analyzeFreeText(text, ctx) {
      if (mode !== 'ai') return templateGenerator.analyzeFreeText(text, ctx);
      try {
        const data = await withTimeout(transport('analyze', {
          question: plain(ctx.q?.title || ''),
          text,
          likes: ctx.state.likes,
          dislikes: ctx.state.dislikes,
        }), ANALYZE_TIMEOUT_MS);
        // 引用が本人の文章に本当にあるものだけ残す（サーバー側でも確認済み。念のため二重に）
        const seen = new Set();
        const codes = (data.codes || []).filter((c) => {
          const ok = CODES.includes(c.code) && typeof c.quote === 'string' && c.quote.trim()
            && squash(text).includes(squash(c.quote)) && !seen.has(c.code);
          if (ok) seen.add(c.code);
          return ok;
        });
        const pick = (basis) => codes.filter((c) => c.basis === basis).map(({ code, quote }) => ({ code, quote }));
        return {
          hits: pick('testimony'),
          inferences: pick('inference'),
          safety: data.safety === 'concern' || safetyCheck(text) === 'concern' ? 'concern' : 'none',
          source: 'ai',
          weight: 2,
        };
      } catch (error) {
        noteFailure(error);
        return templateGenerator.analyzeFreeText(text, ctx);
      }
    },

    // 結果：2つ目のミッションはAIの候補から。読み解き・作れそうなもの・最初の一歩・次の問いはAIが書く
    async resultCopy(ctx) {
      const aiCandidates = await withTimeout(fetchMissions(ctx.state), MISSIONS_TIMEOUT_MS).catch(() => null);
      const copy = await templateGenerator.resultCopy({ ...ctx, aiCandidates });
      const r = await withTimeout(fetchReflection(ctx.state, copy), REFLECT_TIMEOUT_MS).catch(() => null);
      if (r) {
        if (r.reading) copy.reading = r.reading;
        if (r.quotes?.length) copy.quotes = r.quotes;
        if (r.ideas?.length) copy.means = r.ideas;
        if (r.firstStep) copy.firstStep = r.firstStep;
        if (r.question) copy.nextQuestion = r.question;
      }
      return copy;
    },
  };
}
