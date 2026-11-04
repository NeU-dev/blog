// 質問の骨組み。順番・問数・何を測るかはここで固定し、生成器（テンプレ版／AI版）は中身の文言をつくる。
// 好きなこと1つ・嫌いなこと1つを深く掘る。選択25問＋自由記述3回。
//
// 「掘る」の問い（gen: 'probe'）は、型（なぜ・失ったら・例外…）を AI が選ぶ枠。
// 型ごとに測る気持ちの枠（スロット）は決まっているので、どの型が選ばれても集計は同じやり方でできる。
// AI が使えないときは、決まった順番の型を使う（generator/template.js の DEFAULT_ORDER）。

export const PHASES = {
  A: { label: '好きを掘る', intro: 'まずは「好き」から。どこに惹かれていて、本当は何を大事にしているのかを、何段か掘っていきます。' },
  B: { label: '嫌いを掘る', intro: '次は「嫌い」。何がイヤで、何が損なわれていると感じるのかを掘っていきます。' },
  C: { label: 'つなぐ', intro: 'ここからは、好きと嫌いの答えを見比べます。' },
  D: { label: '相手・方向性・関わり方', intro: '誰のために、どんな方向で、どう関わりたいかを選びます。' },
  E: { label: 'ミッション選び', intro: 'ここまでの答えから、ミッションの下書きをつくります。' },
  W: { label: '自由記述' },
};

// 掘る問いの数（好き5・嫌い6）
export const PROBE_COUNT = { like: 5, dislike: 6 };

const steps = [
  { id: 'intro', kind: 'intro' },
  { id: 'input', kind: 'input' },
];

// A：好き。「惹かれる点」「満たされる瞬間」は全員に聞き、そのあと5問を掘る。最後に、続けている理由
steps.push(
  { id: 'A1', kind: 'choice', phase: 'A', gen: 'likeAttraction', item: 0 },
  { id: 'A2', kind: 'choice', phase: 'A', gen: 'likeMoment', item: 0 },
);
for (let i = 0; i < PROBE_COUNT.like; i++) steps.push({ id: `A${i + 3}`, kind: 'choice', phase: 'A', gen: 'probe', side: 'like', index: i });
steps.push({ id: 'A8', kind: 'choice', phase: 'A', gen: 'regulation' });
steps.push({ id: 'FT1', kind: 'free', phase: 'W', gen: 'ftLike', n: 1 });

// B：嫌い。「何がイヤか」「代わりにどうなってほしいか」は全員に聞き、そのあと6問を掘る
steps.push(
  { id: 'B1', kind: 'choice', phase: 'B', gen: 'dislikeWhat', item: 0 },
  { id: 'B2', kind: 'choice', phase: 'B', gen: 'dislikeInverse', item: 0 },
);
for (let i = 0; i < PROBE_COUNT.dislike; i++) steps.push({ id: `B${i + 3}`, kind: 'choice', phase: 'B', gen: 'probe', side: 'dislike', index: i });
steps.push({ id: 'FT2', kind: 'free', phase: 'W', gen: 'ftDislike', n: 2 });

// C：好きと嫌いをつなぐ問いと、最後の見極め（点数が近い2つの気持ちを見分ける）
steps.push(
  { id: 'C1', kind: 'choice', phase: 'C', gen: 'bridge' },
  { id: 'C2', kind: 'choice', phase: 'C', gen: 'finalBoundary' },
);

steps.push(
  { id: 'D1', kind: 'choice', phase: 'D', gen: 'persona' },
  { id: 'D2', kind: 'choice', phase: 'D', gen: 'direction' },
  { id: 'D3', kind: 'choice', phase: 'D', gen: 'roles' },
  { id: 'D4', kind: 'choice', phase: 'D', gen: 'distance' },
);

steps.push(
  { id: 'E1', kind: 'choice', phase: 'E', gen: 'primary' },
  { id: 'E2', kind: 'choice', phase: 'E', gen: 'missionCandidates' },
  { id: 'E3', kind: 'choice', phase: 'E', gen: 'missionRefine' },
);

// 自由記述3はミッション文そのものなので、動機の根拠としては数えない（循環になるため）
steps.push({ id: 'FT3', kind: 'free', phase: 'W', gen: 'ftOwnWords', n: 3, scored: false });
steps.push({ id: 'result', kind: 'result' });

export const STEPS = steps;

export function indexOfStep(id) {
  return STEPS.findIndex((s) => s.id === id);
}
