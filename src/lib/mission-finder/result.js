// 結果画面と、PDF（印刷）用のA4レイアウト。
// 数値（バーの長さ）は scoring.js、文章は生成器の resultCopy から受け取る。

import { CODE_INFO, ROLES, DISTANCES } from './codes.js';
import { esc, html, plain, truncate } from './text.js';

const chosen = (state, id) => (state.answers[id]?.chosen || []).filter((o) => !o.none);
const codeVar = (c) => `var(--mf-${c.toLowerCase()})`;
const KIND_LABEL = { like: '好き', dislike: '嫌い' };

export function missionOf(state) {
  return (state.answers.FT3?.text || '').trim();
}

function aboutLabel(state, about) {
  if (!about || about === 'other') return '';
  const list = about[0] === 'l' ? state.likes : state.dislikes;
  return list[Number(about.slice(1))] || '';
}

// 原体験・動機・ミッション・手段の4段（画面とPDFで共通の中身）
function chainParts(state, copy) {
  const ft1 = state.answers.FT1;
  const about = aboutLabel(state, ft1?.about);
  const roles = chosen(state, 'D3').map((o) => ROLES[o.role]);
  const dist = chosen(state, 'D4')[0];
  return {
    about,
    episode: ft1?.text?.trim() ? truncate(ft1.text, 90) : '',
    motives: copy.blendCodes.map((c) => CODE_INFO[c].name).join('、'),
    means: roles.length ? `${roles.join('・')}${dist ? `（${DISTANCES[dist.distance]}）` : ''}` : 'まだ決めていません',
  };
}

function threadSentence(copy) {
  return copy.thread
    ? `6つのうち${copy.thread.count}つに「${CODE_INFO[copy.thread.code].name}」が出ていました。`
    : '6つに共通する気持ちは、まだはっきりしません。';
}

// ミッションに使った気持ちは強調して見せる
function keyCodes(copy) {
  return new Set(copy.missions.map((m) => m.code));
}

function missionSource(m) {
  return m.fromThread ? `6つに共通していた「${CODE_INFO[m.code].name}」から` : `「${CODE_INFO[m.code].name}」から`;
}

function evidenceItem(e) {
  if (e.kind === 'free') {
    const src = e.source === 'ai' ? 'あなたの言葉（自由記述）' : '自由記述（キーワードで簡易判定）';
    return `<li><span class="mf-ev__quote">「${esc(e.quote)}」</span><span class="mf-ev__src">${src}</span></li>`;
  }
  if (e.kind === 'inference') {
    return `<li class="is-inference"><span class="mf-ev__quote">「${esc(e.quote)}」</span><span class="mf-ev__src">推測（スコアには入れていません）</span></li>`;
  }
  return `<li><span class="mf-ev__src">${html(e.q)}</span><span class="mf-ev__answer">${esc(e.a)}</span></li>`;
}

// 本人の言葉 → 選んだ答え の順に3件まで。推測があれば、最後に1件だけ添える。
function evidenceList(list) {
  const stated = [...list.filter((e) => e.kind === 'free'), ...list.filter((e) => e.kind === 'choice')].slice(0, 3);
  const inference = list.find((e) => e.kind === 'inference');
  const shown = inference ? [...stated, inference] : stated;
  if (!shown.length) return '<li class="is-empty">根拠になる答えは、まだありません</li>';
  return shown.map(evidenceItem).join('');
}

// --- 結果画面 ----------------------------------------------------------------

function missionsHtml(copy) {
  return copy.missions.map((m, i) => `
    <div class="mf-mission-item${i > 0 ? ' is-second' : ''}">
      <span class="mf-mission-no">${String(i + 1).padStart(2, '0')}</span>
      <div>
        <p class="mf-mission${i > 0 ? ' mf-mission--second' : ''}"><span${i > 0 ? ' data-ref="mission2"' : ''}>${esc(m.text)}</span></p>
        <p class="mf-mission-from">${esc(missionSource(m))}${m.editable ? `<span data-ref="mission2-state">${m.edited ? '・自分の言葉に書き換え済み' : '・下書き'}</span>` : ''}</p>
        ${m.editable ? `
          <button type="button" class="mf-btn mf-btn--text" data-act="edit-m2">自分の言葉に書き換える</button>
          <textarea class="mf-textarea mf-m2-edit" rows="3" maxlength="200" aria-label="2つ目のミッションを書き換える" hidden>${esc(m.text)}</textarea>` : ''}
      </div>
    </div>`).join('');
}

function itemsHtml(copy) {
  const keys = keyCodes(copy);
  return copy.items.map((item) => `
    <li>
      <span class="mf-items__kind">${KIND_LABEL[item.kind]}</span>
      <span class="mf-items__name">${esc(item.label)}</span>
      <span class="mf-items__codes">${item.codes.length
        ? item.codes.map((c) => `<span class="mf-code${keys.has(c) ? ' is-key' : ''}" style="--c: ${codeVar(c)}">${esc(CODE_INFO[c].name)}</span>`).join('')
        : '<span class="mf-items__none">まだ言葉になっていない</span>'}</span>
    </li>`).join('');
}

export function resultHtml({ state, scores }, copy, { debug = false } = {}) {
  const chain = chainParts(state, copy);
  const episode = chain.episode
    ? `${chain.about ? `${html(`⟦${chain.about}⟧`)}について。` : ''}${esc(chain.episode)}`
    : 'まだ書かれていません';

  const max = Math.max(...copy.order.map((c) => scores.normalized[c]), 0.0001);
  const bars = copy.order.map((c, i) => `
    <div class="mf-bar">
      <span class="mf-bar__name">${esc(CODE_INFO[c].name)}${i === 0 ? `<small>${copy.primaryChosen ? 'あなたが選んだ根っこ' : 'スコアがいちばん高い気持ち'}</small>` : ''}</span>
      <span class="mf-bar__track"><span class="mf-bar__fill" style="--w:${Math.round((scores.normalized[c] / max) * 100)}%; --c: ${codeVar(c)}"></span></span>
    </div>`).join('');

  const evidence = copy.order.slice(0, 3).map((c) => `
    <div class="mf-ev">
      <p class="mf-ev__title"><span class="mf-dot" style="--c: ${codeVar(c)}"></span>${esc(CODE_INFO[c].name)}</p>
      <ul>${evidenceList(scores.evidence[c])}</ul>
    </div>`).join('');

  const dev = debug ? `
    <details class="mf-dev">
      <summary>開発用：スコアと回答データ</summary>
      <pre>${esc(JSON.stringify({
        scores: {
          ranking: scores.ranking,
          normalized: Object.fromEntries(Object.entries(scores.normalized).map(([k, v]) => [k, Math.round(v * 1000) / 1000])),
          raw: scores.raw,
          offered: scores.offered,
          targets: scores.targets,
          directions: scores.directions,
          regulations: scores.regulations,
          unknown: scores.unknown,
          ambiguous: scores.ambiguous,
        },
        likes: state.likes,
        dislikes: state.dislikes,
        answers: state.answers,
      }, null, 2))}</pre>
    </details>` : '';

  return `
  <div class="mf-result">
    <p class="mf-result__lead">あなたのミッション（下書き）</p>
    <div class="mf-missions">${missionsHtml(copy)}</div>
    <p class="mf-blend">動機の組み合わせは <strong>${esc(copy.blend)}</strong>${copy.direction ? `、方向性は <strong>${esc(copy.direction.name)}</strong>` : ''}</p>

    <section class="mf-block">
      <h3 class="mf-h">6つに共通していたこと</h3>
      <p class="mf-thread">${esc(threadSentence(copy))}</p>
      <ul class="mf-items">${itemsHtml(copy)}</ul>
      <p class="mf-note">色が濃い気持ちが、ミッションのもとになっています。</p>
    </section>

    <section class="mf-block">
      <h3 class="mf-h">原体験から手段まで</h3>
      <ol class="mf-chain">
        <li><span class="mf-chain__label">原体験</span><p>${episode}</p></li>
        <li><span class="mf-chain__label">動機</span><p>${esc(chain.motives)}</p></li>
        <li><span class="mf-chain__label">ミッション</span>${copy.missions.map((m, i) => `<p${i > 0 ? ' data-ref="chain-mission2"' : ''}>${esc(m.text)}</p>`).join('')}</li>
        <li><span class="mf-chain__label">手段</span><p>${esc(chain.means)}</p></li>
      </ol>
    </section>

    <section class="mf-block">
      <h3 class="mf-h">動機のブレンド</h3>
      <p class="mf-note">${copy.primaryChosen ? 'いちばん上は、あなたが「根っこ」として選んだ気持ちです。2番目以降はスコアの順です。' : 'スコアの順に並べています。'}</p>
      <div class="mf-bars">${bars}</div>
      <div class="mf-evs">${evidence}</div>
    </section>

    <section class="mf-block">
      <h3 class="mf-h">ここから作れそうなもの</h3>
      <ul class="mf-means">${copy.means.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
      <p class="mf-subhead">今週できる最初の一歩</p>
      <p class="mf-callout">${esc(copy.firstStep)}</p>
    </section>

    <section class="mf-block">
      <h3 class="mf-h">次に立てる問い</h3>
      <p class="mf-question">${esc(copy.nextQuestion)}</p>
      <p class="mf-note">楽しいと感じた瞬間や、嫌だと感じた瞬間に、この問いを思い出してみてください。</p>
    </section>

    <section class="mf-block">
      <h3 class="mf-h">動かされ方のメモ</h3>
      <p>${esc(copy.regulationNote)}</p>
    </section>

    <section class="mf-block">
      <h3 class="mf-h">まだわからないこと</h3>
      <ul class="mf-unknowns">${copy.unknowns.map((u) => `<li>${esc(u)}</li>`).join('')}</ul>
    </section>

    <p class="mf-disclaimer">これは診断ではなく、考えるための鏡です。動機の分け方は研究用の仮説で、まだ検証されていません。</p>

    <div class="mf-actions">
      <button type="button" class="mf-btn mf-btn--primary" data-act="pdf">PDFで保存</button>
      <button type="button" class="mf-btn" data-act="copy">結果をコピー</button>
      <button type="button" class="mf-btn" data-act="edit">ミッションを書き直す</button>
      <button type="button" class="mf-btn mf-btn--text" data-act="restart">最初からやり直す</button>
    </div>
    ${dev}
  </div>`;
}

// --- PDF（印刷）用 ------------------------------------------------------------
// 記事ページの上に重ねて印刷し、ブラウザの「PDFとして保存」で書き出す。明るい紙の配色にする。

export function printHtml({ state, scores }, copy, { pageUrl = '', date = '' } = {}) {
  const chain = chainParts(state, copy);
  const keys = keyCodes(copy);
  const max = Math.max(...copy.order.map((c) => scores.normalized[c]), 0.0001);

  const missions = copy.missions.map((m, i) => `
    <li>
      <b>${String(i + 1).padStart(2, '0')}</b>
      <div>
        <p class="mfp-mission${i > 0 ? ' is-second' : ''}">${esc(m.text)}</p>
        <p class="mfp-from">${esc(missionSource(m))}${m.editable && !m.edited ? '（下書き）' : ''}</p>
      </div>
    </li>`).join('');

  const items = copy.items.map((item) => `
    <tr>
      <th><span>${KIND_LABEL[item.kind]}</span>${esc(item.label)}</th>
      <td>${item.codes.length
        ? item.codes.map((c) => `<span class="mfp-code${keys.has(c) ? ' is-key' : ''}" style="--c: ${codeVar(c)}">${esc(CODE_INFO[c].name)}</span>`).join('')
        : '<span class="mfp-muted">まだ言葉になっていない</span>'}</td>
    </tr>`).join('');

  const bars = copy.order.map((c) => `
    <div class="mfp-bar">
      <span>${esc(CODE_INFO[c].name)}</span>
      <i><u style="width:${Math.round((scores.normalized[c] / max) * 100)}%; --c: ${codeVar(c)}"></u></i>
    </div>`).join('');

  return `
  <div class="mfp">
    <div class="mfp-head"><span>NeULOG ミッション・ファインダー</span><span>${esc(date)}</span></div>
    <p class="mfp-lead">あなたのミッション（下書き）</p>
    <ol class="mfp-missions">${missions}</ol>
    <p class="mfp-meta">動機の組み合わせ：${esc(copy.blend)}${copy.direction ? `　／　方向性：${esc(copy.direction.name)}` : ''}</p>

    <section class="mfp-sec">
      <h2>6つに共通していたこと</h2>
      <p class="mfp-strong">${esc(threadSentence(copy))}</p>
      <table class="mfp-items"><tbody>${items}</tbody></table>
    </section>

    <section class="mfp-sec">
      <h2>原体験から手段まで</h2>
      <dl class="mfp-chain">
        <dt>原体験</dt><dd>${chain.episode ? `${chain.about ? `「${esc(chain.about)}」について。` : ''}${esc(chain.episode)}` : 'まだ書かれていません'}</dd>
        <dt>動機</dt><dd>${esc(chain.motives)}</dd>
        <dt>ミッション</dt><dd>${copy.missions.map((m) => esc(m.text)).join('<br>')}</dd>
        <dt>手段</dt><dd>${esc(chain.means)}</dd>
      </dl>
    </section>

    <section class="mfp-sec">
      <h2>動機のブレンド</h2>
      <div class="mfp-bars">${bars}</div>
    </section>

    <section class="mfp-sec">
      <h2>ここから作れそうなもの</h2>
      <ul class="mfp-list">${copy.means.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
      <p class="mfp-callout">今週できる最初の一歩：${esc(copy.firstStep)}</p>
    </section>

    <section class="mfp-sec">
      <h2>次に立てる問い</h2>
      <p class="mfp-strong">${esc(copy.nextQuestion)}</p>
    </section>

    <section class="mfp-sec">
      <h2>動かされ方のメモ</h2>
      <p>${esc(copy.regulationNote)}</p>
    </section>

    <section class="mfp-sec">
      <h2>まだわからないこと</h2>
      <ul class="mfp-list">${copy.unknowns.map((u) => `<li>${esc(u)}</li>`).join('')}</ul>
    </section>

    <p class="mfp-foot">これは診断ではなく、考えるための鏡です。動機の分け方は研究用の仮説で、まだ検証されていません。${pageUrl ? `<br>${esc(pageUrl)}` : ''}</p>
  </div>`;
}

// --- コピー用のテキスト ---------------------------------------------------------

export function resultText(ctx, copy, pageUrl) {
  return [
    '私のミッション（下書き）',
    ...copy.missions.map((m, i) => `${i + 1}. ${m.text}`),
    '',
    `動機の組み合わせ：${copy.blend}`,
    ...(copy.direction ? [`方向性：${copy.direction.name}`] : []),
    `6つに共通していたこと：${threadSentence(copy)}`,
    '',
    'ここから作れそうなもの',
    ...copy.means.map((m) => `・${m}`),
    '',
    `次に立てる問い：${plain(copy.nextQuestion)}`,
    ...(pageUrl ? ['', pageUrl] : []),
  ].join('\n');
}
