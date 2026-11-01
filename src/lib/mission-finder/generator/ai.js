// AI版の生成器。テンプレート版と同じ形（question / analyzeFreeText / resultCopy）を持つ。
//
// - 選択肢の言い換え：質問の骨組み（スロットと動機コード）はテンプレート版のまま、
//   文言だけを AI に書かせる。好き・嫌い1項目ごとに、その2問ぶんをまとめて頼む。
// - 自由記述の分析：本人の文章からの引用つきで動機を読み取らせる。
//   本人が言っていること（testimony）だけをスコアに入れ、推測（inference）は表示だけにする。
// - 失敗・時間切れ・1日の上限に達したときは、その場でテンプレート版に切り替える。
//
// APIキーはブラウザに置かない。通信先は Supabase Edge Function（neulog-mission）。

import { CODES } from '../codes.js';
import { STEPS } from '../flow.js';
import { plain } from '../text.js';
import { templateGenerator, SLOT_TYPES, safetyCheck } from './template.js';

const OPTIONS_TIMEOUT_MS = 20_000;
const ANALYZE_TIMEOUT_MS = 30_000;
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

export function createAiGenerator(transport) {
  // 'ai'：使える / 'limited'：今日の上限に達した / 'offline'：使えない
  let mode = 'ai';
  const pending = new Map();

  const noteFailure = (error) => {
    if (error?.status === 429) mode = 'limited';
  };

  const itemOf = (state, kind, index) => (kind === 'like' ? state.likes : state.dislikes)[index];
  const stepsOf = (kind, index) => STEPS.filter(
    (s) => SLOT_TYPES[s.gen] && s.item === index && s.phase === (kind === 'like' ? 'A' : 'B'),
  );

  // 好き・嫌い1項目の2問ぶんを、まとめて言い換えてもらう
  function fetchItem(state, kind, index) {
    const item = itemOf(state, kind, index);
    const key = `${kind}:${index}:${item}`;
    if (pending.has(key)) return pending.get(key);
    const request = (async () => {
      if (mode !== 'ai') return null;
      const questions = await Promise.all(stepsOf(kind, index).map(async (step) => {
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

    // 好き・嫌いを入力し終えたところで、6項目ぶんを先に頼んでおく
    prepare(state) {
      if (mode !== 'ai') return;
      ['like', 'dislike'].forEach((kind) => [0, 1, 2].forEach((index) => fetchItem(state, kind, index)));
    },

    async question(step, ctx) {
      const q = await templateGenerator.question(step, ctx);
      if (!SLOT_TYPES[step.gen]) return q;

      const kind = step.phase === 'A' ? 'like' : 'dislike';
      const item = itemOf(ctx.state, kind, step.item);
      const cache = (ctx.state.ai ||= { options: {} }).options;
      let entry = cache[step.id];
      // 一度決めた文言は保存して使い回す（あとから文言が変わると、答えが無効になってしまうため）
      if (!entry || entry.item !== item) {
        const fetched = await withTimeout(fetchItem(ctx.state, kind, step.item), OPTIONS_TIMEOUT_MS).catch(() => null);
        entry = cache[step.id] = { item, labels: fetched?.[step.id] || null };
      }
      if (entry.labels) {
        q.options = q.options.map((o) => (entry.labels[o.id] ? { ...o, label: entry.labels[o.id] } : o));
        q.source = 'ai';
      }
      return q;
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

    resultCopy: (ctx) => templateGenerator.resultCopy(ctx),
  };
}
