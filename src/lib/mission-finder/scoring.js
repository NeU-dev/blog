// 集計はAIを使わず、ここで決定的に計算する（同じ答えなら必ず同じ結果）。
//
// - 選択式：選んだ選択肢のコードに +weight（2つ選んだら各 0.7 倍）
// - 見極め2択：weight 1.5（区別する力が強いので重め）
// - 自由記述：本人の言葉からの引用が付いたものだけ +weight（AIの読み取りは 2、キーワード判定は 1）
//   AIが「推測」とした読み取りは根拠として表示するだけで、スコアには入れない
// - 各コードは「選択肢として出た量」で割ってそろえる（出た回数が多いコードが有利にならないように）

import { CODES } from './codes.js';
import { STEPS } from './flow.js';

const SMOOTHING = 1;
const FREE_WEIGHT = 1;

const zeros = () => Object.fromEntries(CODES.map((c) => [c, 0]));
const inc = (obj, key) => { obj[key] = (obj[key] || 0) + 1; };

export function computeScores(state, uptoIndex = STEPS.length) {
  const raw = zeros();
  const offered = zeros();
  const evidence = Object.fromEntries(CODES.map((c) => [c, []]));
  const targets = {};
  const directions = {};
  const regulations = {};
  const ambiguous = [];
  let unknown = 0;

  STEPS.slice(0, uptoIndex).forEach((step) => {
    const a = state.answers[step.id];
    if (!a) return;

    if (step.kind === 'choice') {
      const weight = a.weight || 0;
      Object.entries(a.offered || {}).forEach(([c, n]) => { offered[c] += n * weight; });
      const share = a.chosen.length > 1 ? 0.7 : 1;
      a.chosen.forEach((o) => {
        if (o.none) {
          if (o.ambiguous) ambiguous.push(o.ambiguous);
          else if (weight > 0) unknown += 1;
        }
        (o.codes || []).forEach((c) => {
          raw[c] += weight * share;
          evidence[c].push({ kind: 'choice', q: a.qtext, a: o.label });
        });
        if (o.target) inc(targets, o.target);
        if (o.direction) inc(directions, o.direction);
        if (o.regulation) inc(regulations, o.regulation);
      });
    }

    if (step.kind === 'free' && step.scored !== false && !a.skipped && a.text?.trim()) {
      const weight = a.weight ?? FREE_WEIGHT;
      CODES.forEach((c) => { offered[c] += weight; });
      (a.hits || []).forEach((h) => {
        raw[h.code] += weight;
        evidence[h.code].push({ kind: 'free', quote: h.quote, source: a.source || 'template' });
      });
      (a.inferences || []).forEach((h) => {
        evidence[h.code].push({ kind: 'inference', quote: h.quote });
      });
    }
  });

  const normalized = Object.fromEntries(CODES.map((c) => [c, raw[c] / (offered[c] + SMOOTHING)]));
  const ranking = [...CODES].sort(
    (x, y) => normalized[y] - normalized[x] || raw[y] - raw[x] || CODES.indexOf(x) - CODES.indexOf(y),
  );

  return { raw, offered, normalized, ranking, evidence, targets, directions, regulations, unknown, ambiguous };
}
