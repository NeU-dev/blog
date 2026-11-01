// 文字列まわりの小さな道具。
// 本人の言葉（好き・嫌いの項目）は ⟦…⟧ で囲んで持ち回り、画面では強調、コピー時は「」にする。

export const mark = (s) => `⟦${s}⟧`;

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function html(s) {
  return esc(s).replace(/⟦(.*?)⟧/g, '<mark class="mf-item">$1</mark>');
}

export function plain(s) {
  return String(s ?? '').replace(/⟦(.*?)⟧/g, '「$1」');
}

export function truncate(s, n) {
  const chars = [...String(s ?? '').trim()];
  return chars.length > n ? `${chars.slice(0, n).join('')}…` : chars.join('');
}

export function hash(str) {
  let h = 2166136261;
  for (const ch of String(str)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// 同じ質問なら毎回同じ並びになるシャッフル（戻ったときに順番が変わらないように）
export function seededShuffle(arr, seed) {
  const a = [...arr];
  let s = hash(seed) || 1;
  for (let i = a.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
