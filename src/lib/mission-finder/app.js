// 記事に埋め込むミッション・ファインダー本体。
// Markdown に `::mission-finder` と書くと <section class="mission-finder"> になり、
// PostLayout のスクリプトがこのモジュールを読み込んで mountMissionFinder を呼ぶ。

import '../../styles/mission-finder.css';
import { STEPS, PHASES, indexOfStep } from './flow.js';
import { computeScores } from './scoring.js';
import { templateGenerator } from './generator/template.js';
import { createAiGenerator, httpTransport } from './generator/ai.js';
import { printHtml, resultHtml, resultText } from './result.js';
import { esc, html, hash } from './text.js';
import { load, save, clear } from './store.js';
import { COMMUNITY_URL, visitorId } from '../community';

const MISSION_URL = COMMUNITY_URL.replace(/neulog-community$/, 'neulog-mission');

const SAMPLE = {
  likes: ['ギター', '料理', '散歩'],
  dislikes: ['満員電車', '理不尽な上下関係', '食べ物を捨てること'],
};
const LIKE_PH = ['例：ギター', '例：料理', '例：散歩'];
const DISLIKE_PH = ['例：満員電車', '例：理不尽な上下関係', '例：食べ物を捨てること'];
const Q_STEPS = STEPS.filter((s) => s.kind === 'choice' || s.kind === 'free');
const AUTO_ADVANCE_MS = 320;
const LOADING_DELAY_MS = 250;

// 開発中だけ URL のパラメータで動きを切り替えられる
//   ?mission-ai=mock / mock-limit / off   AIの代わりに偽物を使う・上限を再現する・AIなし
//   ?mission-ai=local                      手元で動かしているAIの関数（localhost:8000）につなぐ
//   ?mission-debug                         結果画面にスコアと回答データを出す
const LOCAL_MISSION_URL = 'http://localhost:8000';
function devParams() {
  if (!import.meta.env.DEV) return { ai: null, debug: false };
  const params = new URLSearchParams(location.search);
  return { ai: params.get('mission-ai'), debug: params.has('mission-debug') };
}

async function chooseGenerator(devAi) {
  if (devAi === 'off') return templateGenerator;
  let transport;
  if (import.meta.env.DEV && (devAi === 'mock' || devAi === 'mock-limit')) {
    const { mockTransport } = await import('./generator/mock.js');
    transport = mockTransport({ limit: devAi === 'mock-limit' });
  } else {
    const endpoint = import.meta.env.DEV && devAi === 'local' ? LOCAL_MISSION_URL : MISSION_URL;
    transport = httpTransport(endpoint, visitorId);
  }
  const ai = createAiGenerator(transport);
  return (await ai.status()) === 'offline' ? templateGenerator : ai;
}

export async function mountMissionFinder(root) {
  if (root.dataset.enhanced === 'true') return;
  root.dataset.enhanced = 'true';
  root.innerHTML = `
    <div class="mf" tabindex="-1">
      <div class="mf__head">
        <span class="mf__kicker">MISSION FINDER</span>
        <span class="mf__mode" hidden></span>
      </div>
      <div class="mf__progress" hidden>
        <div class="mf__progress-text"><span data-ref="phase"></span><span data-ref="count"></span></div>
        <div class="mf__progress-track"><i data-ref="fill"></i></div>
      </div>
      <div class="mf__screen" aria-live="polite"></div>
    </div>`;

  const panel = root.querySelector('.mf');
  const screen = root.querySelector('.mf__screen');
  const dev = devParams();
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let generator = templateGenerator;
  let state = restore();
  let current = null;
  let renderToken = 0;
  let noticeShown = false;

  function freshState() {
    return { v: 1, stepIndex: 0, likes: ['', '', ''], dislikes: ['', '', ''], answers: {} };
  }

  function restore() {
    const s = load();
    if (!s) return freshState();
    s.stepIndex = Math.max(0, Math.min(s.stepIndex || 0, STEPS.length - 1));
    return s;
  }

  const persist = () => save(state);
  const currentStep = () => STEPS[state.stepIndex];

  // --- 描画 -----------------------------------------------------------------

  function renderMode() {
    const el = panel.querySelector('.mf__mode');
    const mode = generator.name === 'ai' ? generator.mode : 'template';
    el.hidden = mode === 'template';
    el.textContent = mode === 'ai' ? 'AIつき' : '定型の選択肢で進行中';
    el.classList.toggle('is-ai', mode === 'ai');
  }

  function limitNotice() {
    if (generator.name !== 'ai' || generator.mode !== 'limited' || noticeShown) return '';
    noticeShown = true;
    return '<p class="mf-notice">今日はAIの利用上限に達したので、ここからは定型の選択肢で続けます。</p>';
  }

  function showLoadingLater(message) {
    return setTimeout(() => {
      screen.innerHTML = `<div class="mf-loading" role="status"><span class="mf-spinner" aria-hidden="true"></span>${esc(message)}</div>`;
    }, LOADING_DELAY_MS);
  }

  async function render() {
    const token = ++renderToken;
    const step = currentStep();
    current = null;
    renderProgress(step);

    if (step.kind === 'intro') return renderIntro();
    if (step.kind === 'input') return renderInput();

    const ctx = { state, step, scores: computeScores(state, state.stepIndex) };

    if (step.kind === 'result') {
      const copy = await generator.resultCopy(ctx);
      if (token !== renderToken) return;
      current = { step, ctx, copy };
      screen.innerHTML = resultHtml(ctx, copy, { debug: dev.debug });
      return;
    }

    const isSlot = step.phase === 'A' || step.phase === 'B';
    const timer = showLoadingLater(isSlot && generator.name === 'ai' && generator.mode === 'ai'
      ? 'あなたの言葉に合わせて、選択肢を書いています…'
      : '準備しています…');
    const q = await generator.question(step, ctx);
    clearTimeout(timer);
    if (token !== renderToken) return;
    q.sig = signature(q);
    current = { step, q };
    persist(); // AIの文言を保存しておく
    renderMode();

    if (step.kind === 'choice') {
      // 前の答えを変えたせいで問いや選択肢が変わっていたら、答え直してもらう
      const a = state.answers[step.id];
      if (a && a.sig !== q.sig) {
        delete state.answers[step.id];
        persist();
      }
      renderChoice(step, q);
    } else {
      renderFree(step, q);
    }
  }

  function signature(q) {
    const opts = (q.options || []).map((o) => [o.id, o.label, o.desc || '']);
    return String(hash(JSON.stringify([q.title, q.context || '', opts])));
  }

  function renderProgress(step) {
    const el = panel.querySelector('.mf__progress');
    const qi = Q_STEPS.indexOf(step);
    if (qi < 0) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.querySelector('[data-ref="phase"]').textContent = step.kind === 'free' ? `自由記述 ${step.n} / 3` : PHASES[step.phase].label;
    el.querySelector('[data-ref="count"]').textContent = `${String(qi + 1).padStart(2, '0')} / ${Q_STEPS.length}`;
    el.querySelector('[data-ref="fill"]').style.width = `${(qi / Q_STEPS.length) * 100}%`;
  }

  function navHtml(canNext, nextLabel = '次へ') {
    return `
      <div class="mf-nav">
        <button type="button" class="mf-btn" data-act="back">戻る</button>
        <button type="button" class="mf-btn mf-btn--primary" data-act="next" ${canNext ? '' : 'disabled'}>${esc(nextLabel)}</button>
      </div>`;
  }

  function setNextEnabled(enabled, label) {
    const b = screen.querySelector('[data-act="next"]');
    if (!b) return;
    b.disabled = !enabled;
    if (label) b.textContent = label;
  }

  function renderIntro() {
    const hasAnswers = Object.keys(state.answers).length > 0 || [...state.likes, ...state.dislikes].some(Boolean);
    screen.innerHTML = `
      <div class="mf-intro">
        <p class="mf-title">「好き」と「嫌い」から、あなたのミッションを見つける</p>
        <p class="mf-lead">好きなこと3つと嫌いなこと3つを書いて、質問に答えていくと、あなたを動かしている気持ちと、ミッションの下書きが見えてきます。</p>
        <ol class="mf-steps">
          <li><b>01</b><strong>書く</strong><span>好きなこと3つ、嫌いなこと3つ</span></li>
          <li><b>02</b><strong>選ぶ</strong><span>25の質問に、選択肢で答える</span></li>
          <li><b>03</b><strong>書く</strong><span>途中で3回、自分の言葉で書く</span></li>
          <li><b>04</b><strong>受け取る</strong><span>ミッションの下書きと、その根拠</span></li>
        </ol>
        <p class="mf-note">所要時間は10〜15分です。答えはこの端末の中にだけ保存されます。自由記述はAIが読み取ることがあります。</p>
        <div class="mf-intro__actions">
          <button type="button" class="mf-btn mf-btn--primary mf-btn--wide" data-act="next">はじめる</button>
          ${hasAnswers ? '<button type="button" class="mf-btn mf-btn--text" data-act="restart">回答を消して最初から</button>' : ''}
        </div>
      </div>`;
  }

  const inputReady = () => [...state.likes, ...state.dislikes].every((v) => v.trim());

  function renderInput() {
    const fields = (kind, placeholders, label) => state[kind].map((v, i) => `
      <label class="mf-field">
        <span class="mf-field__no" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>
        <input type="text" data-kind="${kind}" data-index="${i}" value="${esc(v)}" maxlength="30"
          placeholder="${esc(placeholders[i])}" aria-label="${label}${i + 1}" autocomplete="off">
      </label>`).join('');
    screen.innerHTML = `
      <div class="mf-q">
        <p class="mf-title">好きなことと嫌いなことを、3つずつ</p>
        <p class="mf-sub">もの・行動・場面、なんでもかまいません。思いついた順で大丈夫です。</p>
        <fieldset class="mf-fields">
          <legend>好きなこと</legend>
          ${fields('likes', LIKE_PH, '好きなこと')}
        </fieldset>
        <fieldset class="mf-fields">
          <legend>嫌いなこと・困っていること</legend>
          ${fields('dislikes', DISLIKE_PH, '嫌いなこと')}
        </fieldset>
        <p class="mf-note">嫌いなことに特定の人が浮かんだら、その人の「ふるまい」や「状況」として書いてみてください。</p>
        ${import.meta.env.DEV ? '<button type="button" class="mf-btn mf-btn--text" data-act="sample">サンプルを入れる（開発中のみ）</button>' : ''}
      </div>
      ${navHtml(inputReady(), '質問へ進む')}`;
  }

  function optionHtml(o, i, selected, max) {
    return `
      <button type="button" class="mf-option${o.none ? ' is-none' : ''}" data-opt="${esc(o.id)}" aria-pressed="${selected}">
        <b>${String(i + 1).padStart(2, '0')}</b>
        <span class="mf-option__body"><span class="mf-option__label">${html(o.label)}</span>${o.desc ? `<span class="mf-option__desc">${html(o.desc)}</span>` : ''}</span>
        <span class="mf-option__mark ${max > 1 ? 'is-multi' : 'is-single'}" aria-hidden="true"></span>
      </button>`;
  }

  function renderChoice(step, q) {
    const picks = new Set(state.answers[step.id]?.picks || []);
    const prev = STEPS[state.stepIndex - 1];
    const intro = prev && prev.phase !== step.phase ? PHASES[step.phase].intro : '';
    screen.innerHTML = `
      <div class="mf-q">
        ${limitNotice()}
        ${intro ? `<p class="mf-phase">${esc(intro)}</p>` : ''}
        <p class="mf-title">${html(q.title)}</p>
        ${q.sub ? `<p class="mf-sub">${html(q.sub)}</p>` : ''}
        ${q.context ? `<p class="mf-context">${html(q.context)}</p>` : ''}
        <div class="mf-options${q.layout === 'grid' ? ' is-grid' : ''}" role="group" aria-label="選択肢">
          ${q.options.map((o, i) => optionHtml(o, i, picks.has(o.id), q.max)).join('')}
        </div>
      </div>
      ${navHtml(picks.size > 0)}`;
  }

  function renderFree(step, q) {
    let a = state.answers[step.id];
    // 自由記述3：E3で選んだ下書きが変わったら、下書きを入れ直す
    if (q.draft !== undefined && (!a || a.draft !== q.draft)) {
      a = state.answers[step.id] = { text: q.draft, draft: q.draft, hits: [], skipped: false };
      persist();
    }
    const text = a?.text || '';
    const about = a?.about || q.about?.suggested;
    screen.innerHTML = `
      <div class="mf-q">
        ${limitNotice()}
        <p class="mf-title">${html(q.title)}</p>
        ${q.sub ? `<p class="mf-sub">${html(q.sub)}</p>` : ''}
        ${q.about ? `
          <p class="mf-note">${html(q.about.hint)}</p>
          <div class="mf-chips" role="group" aria-label="どの項目について書くか">
            ${q.about.options.map((o) => `<button type="button" class="mf-chip" data-about="${o.id}" aria-pressed="${o.id === about}">${esc(o.label)}</button>`).join('')}
          </div>` : ''}
        <textarea class="mf-textarea" rows="6" maxlength="600" placeholder="${esc(q.placeholder || '')}" aria-label="自由記述">${esc(text)}</textarea>
        <div class="mf-free-meta">
          <span data-ref="free-count">${[...text].length} / 600</span>
          ${q.skippable ? '<button type="button" class="mf-btn mf-btn--text" data-act="skip">スキップする</button>' : ''}
        </div>
      </div>
      ${navHtml(text.trim().length > 0 || Boolean(a?.skipped))}`;
    if (q.about && !a?.about) updateFree({ about });
  }

  // 深刻な内容が書かれていそうなときは、先へ進む前に相談先を出す
  function renderSafety() {
    screen.innerHTML = `
      <div class="mf-q mf-safety">
        <p class="mf-title">少しだけ、立ち止まらせてください</p>
        <p>書いてくれた内容から、いま、とてもつらい状況にいるのかもしれないと感じました。このツールは、ここで止めても大丈夫です。</p>
        <p>ひとりで抱えずに、話を聞いてくれる窓口を頼ってください。</p>
        <ul class="mf-safety__list">
          <li>よりそいホットライン（24時間・無料）<a href="tel:0120279338">0120-279-338</a></li>
          <li>厚生労働省「<a href="https://www.mhlw.go.jp/mamorouyokokoro/" target="_blank" rel="noopener">まもろうよ こころ</a>」（電話・SNSの相談窓口の一覧）</li>
        </ul>
        <div class="mf-nav">
          <button type="button" class="mf-btn" data-act="stay">書き直す</button>
          <button type="button" class="mf-btn mf-btn--primary" data-act="continue">質問を続ける</button>
        </div>
      </div>`;
  }

  // --- 回答 -------------------------------------------------------------------

  function setChoice(step, q, picks) {
    if (!picks.length) {
      delete state.answers[step.id];
      persist();
      return;
    }
    const offered = {};
    q.options.forEach((o) => {
      if (!o.none) (o.codes || []).forEach((c) => { offered[c] = (offered[c] || 0) + 1; });
    });
    state.answers[step.id] = {
      sig: q.sig,
      picks,
      qtext: q.title,
      weight: q.weight || 0,
      offered,
      item: q.item || null,
      chosen: picks.map((id) => {
        const o = q.options.find((x) => x.id === id);
        return { id, label: o.label.replace(/[⟦⟧]/g, ''), codes: o.codes || [], none: Boolean(o.none), ...(o.tags || {}) };
      }),
    };
    persist();
  }

  function pick(id) {
    if (!current?.q) return;
    const { step, q } = current;
    const opt = q.options.find((o) => o.id === id);
    if (!opt) return;
    let picks = [...(state.answers[step.id]?.picks || [])];
    if (q.max === 1) {
      picks = [id];
    } else if (picks.includes(id)) {
      picks = picks.filter((p) => p !== id);
    } else if (opt.none) {
      picks = [id];
    } else {
      picks = picks.filter((p) => !q.options.find((o) => o.id === p)?.none);
      picks.push(id);
      if (picks.length > q.max) picks.shift();
    }
    setChoice(step, q, picks);
    screen.querySelectorAll('.mf-option').forEach((b) => b.setAttribute('aria-pressed', String(picks.includes(b.dataset.opt))));
    setNextEnabled(picks.length > 0);
    if (q.max === 1) {
      const token = renderToken;
      setTimeout(() => { if (token === renderToken) next(); }, AUTO_ADVANCE_MS);
    }
  }

  function updateFree(patch) {
    const step = currentStep();
    const prev = state.answers[step.id] || { text: '', hits: [], skipped: false };
    // 文章を書き始めたらスキップ扱いを解除する（どの項目について書くかを選ぶだけなら、そのまま）
    state.answers[step.id] = { ...prev, ...patch, skipped: 'text' in patch ? false : prev.skipped };
    persist();
  }

  // --- 移動 -------------------------------------------------------------------

  function canProceed(step) {
    switch (step.kind) {
      case 'intro': return true;
      case 'input': return inputReady();
      case 'choice': return Boolean(state.answers[step.id]?.picks?.length);
      case 'free': {
        const a = state.answers[step.id];
        return Boolean(a && (a.text?.trim() || a.skipped));
      }
      default: return false;
    }
  }

  // パネルの上端が画面の外に出ていたら、パネルの頭まで戻す（ページの先頭には飛ばさない）
  function bringIntoView() {
    const top = panel.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight * 0.5) {
      panel.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
    }
    panel.focus({ preventScroll: true });
  }

  async function go(index) {
    state.stepIndex = Math.max(0, Math.min(index, STEPS.length - 1));
    persist();
    bringIntoView();
    await render();
  }

  async function next() {
    const step = currentStep();
    if (step.kind === 'input') {
      state.likes = state.likes.map((v) => v.trim());
      state.dislikes = state.dislikes.map((v) => v.trim());
      if (inputReady()) generator.prepare?.(state);
    }
    if (step.kind === 'free') {
      const a = state.answers[step.id];
      // 同じ文章をもう一度送らない（戻って進み直しただけで、AIの利用回数を使わないように）
      if (a?.text?.trim() && step.scored !== false && a.analyzedText !== a.text) {
        setNextEnabled(false, generator.name === 'ai' && generator.mode === 'ai' ? 'あなたの文章を読んでいます…' : '次へ');
        const token = renderToken;
        const result = await generator.analyzeFreeText(a.text, { state, step, q: current?.q });
        if (token !== renderToken) return;
        Object.assign(a, result, { skipped: false, analyzedText: a.text });
        persist();
        if (a.safety === 'concern' && !a.safetyShown) {
          a.safetyShown = true;
          persist();
          renderSafety();
          return;
        }
      }
    }
    if (!canProceed(step)) return;
    await go(state.stepIndex + 1);
  }

  function back() {
    if (state.stepIndex > 0) go(state.stepIndex - 1);
  }

  function skip() {
    const step = currentStep();
    state.answers[step.id] = { ...(state.answers[step.id] || {}), text: '', hits: [], inferences: [], analyzedText: undefined, skipped: true };
    persist();
    go(state.stepIndex + 1);
  }

  function restart() {
    if (!window.confirm('回答をすべて消して、最初からやり直しますか？')) return;
    clear();
    state = freshState();
    noticeShown = false;
    go(0);
  }

  function fillSample() {
    state.likes = [...SAMPLE.likes];
    state.dislikes = [...SAMPLE.dislikes];
    persist();
    renderInput();
  }

  function toast(message) {
    const el = document.createElement('div');
    el.className = 'mf-toast';
    el.setAttribute('role', 'status');
    el.textContent = message;
    panel.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  async function copyResult() {
    if (!current?.copy) return;
    try {
      await navigator.clipboard.writeText(resultText(current.ctx, current.copy, `${location.origin}${location.pathname}`));
      toast('結果をコピーしました');
    } catch {
      toast('コピーできませんでした。文章を選択してコピーしてください');
    }
  }

  // 2つ目のミッションは下書き。結果画面で自分の言葉に書き換えられる（下書きが変わったら書き換えは使わない）
  function toggleMission2Edit() {
    const area = screen.querySelector('.mf-m2-edit');
    if (!area) return;
    area.hidden = !area.hidden;
    if (!area.hidden) area.focus();
  }

  function updateMission2(value) {
    const m2 = current?.copy?.missions?.[1];
    if (!m2) return;
    const text = value.trim();
    state.mission2Edit = { base: m2.base, text: value };
    m2.text = text || m2.base;
    m2.edited = Boolean(text);
    persist();
    screen.querySelector('[data-ref="mission2"]').textContent = m2.text;
    screen.querySelector('[data-ref="chain-mission2"]').textContent = m2.text;
    screen.querySelector('[data-ref="mission2-state"]').textContent = m2.edited ? '・自分の言葉に書き換え済み' : '・下書き';
  }

  // PDF：結果をA4の紙面にしてページに重ね、ブラウザの印刷（「PDFとして保存」）を開く。
  // 日本語フォントを埋め込む必要がなく、iPhone でも「共有 → PDF」で保存できる。
  function printResult() {
    if (!current?.copy) return;
    document.querySelector('.mf-print-root')?.remove();
    const sheet = document.createElement('div');
    sheet.className = 'mf-print-root';
    sheet.setAttribute('aria-hidden', 'true');
    sheet.innerHTML = printHtml(current.ctx, current.copy, {
      pageUrl: `${location.origin}${location.pathname}`,
      date: new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }),
    });
    document.body.appendChild(sheet);
    document.body.classList.add('mf-printing');
    window.addEventListener('afterprint', () => {
      document.body.classList.remove('mf-printing');
      sheet.remove();
    }, { once: true });
    toast('印刷の画面で「PDFとして保存」を選んでください');
    setTimeout(() => window.print(), 60);
  }

  const ACTIONS = {
    pdf: printResult,
    'edit-m2': toggleMission2Edit,
    next,
    back,
    skip,
    restart,
    sample: fillSample,
    copy: copyResult,
    edit: () => go(indexOfStep('FT3')),
    continue: () => go(state.stepIndex + 1),
    stay: () => render(),
  };

  root.addEventListener('click', (e) => {
    const opt = e.target.closest('[data-opt]');
    if (opt) return pick(opt.dataset.opt);
    const chip = e.target.closest('[data-about]');
    if (chip) {
      updateFree({ about: chip.dataset.about });
      screen.querySelectorAll('.mf-chip').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act) ACTIONS[act]?.();
  });

  root.addEventListener('input', (e) => {
    const t = e.target;
    if (t.matches('input[data-kind]')) {
      state[t.dataset.kind][Number(t.dataset.index)] = t.value;
      persist();
      setNextEnabled(inputReady());
    } else if (t.matches('.mf-m2-edit')) {
      updateMission2(t.value);
    } else if (t.matches('.mf-textarea')) {
      updateFree({ text: t.value });
      screen.querySelector('[data-ref="free-count"]').textContent = `${[...t.value].length} / 600`;
      setNextEnabled(canProceed(currentStep()));
    }
  });

  // キー操作はパネルの中にフォーカスがあるときだけ（記事の他の部分の操作を邪魔しない）
  root.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return; // 日本語入力の変換確定で進まないように
    const t = e.target;
    if (t.tagName === 'TEXTAREA') {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        next();
      }
      return;
    }
    if (t.tagName === 'INPUT') {
      if (e.key === 'Enter') {
        e.preventDefault();
        next();
      }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^[1-9]$/.test(e.key) && current?.q?.options) {
      const o = current.q.options[Number(e.key) - 1];
      if (o) {
        e.preventDefault();
        pick(o.id);
      }
    }
  });

  screen.innerHTML = '<div class="mf-loading" role="status"><span class="mf-spinner" aria-hidden="true"></span>準備しています…</div>';
  generator = await chooseGenerator(dev.ai);
  renderMode();
  await render();
}
