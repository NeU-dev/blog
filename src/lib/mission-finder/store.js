// 回答はこの端末の localStorage にだけ保存する。使えない環境でも動くように、失敗は握りつぶす。

const KEY = 'neulog-mission-finder:v1';

export function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    // v2 から好き・嫌いは1つずつ。3つずつだった頃（v1）の回答は読み込まない
    return s && s.v === 2 ? s : null;
  } catch {
    return null;
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // 保存できなくても、その場の回答は続けられる
  }
}

export function clear() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // 同上
  }
}
