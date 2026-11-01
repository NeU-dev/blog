// 質問の骨組み。順番・問数・何を測るかはここで固定し、生成器（テンプレ版／AI版）は中身の文言だけをつくる。
// 選択25問＋自由記述3回。

export const PHASES = {
  A: { label: '好きの深掘り', intro: 'まずは「好き」から。どこに惹かれているのかを見ていきます。' },
  B: { label: '嫌いの深掘り', intro: '次は「嫌い」。何がイヤなのか、代わりにどうなってほしいのかを見ていきます。' },
  C: { label: '見極め', intro: 'ここからは、似ている気持ちを見分ける質問です。深く考えずに、直感で選んでください。' },
  D: { label: '相手・方向性・関わり方', intro: '誰のために、どんな方向で、どう関わりたいかを選びます。' },
  E: { label: 'ミッション選び', intro: 'ここまでの答えから、ミッションの下書きをつくります。' },
  W: { label: '自由記述' },
};

const steps = [
  { id: 'intro', kind: 'intro' },
  { id: 'input', kind: 'input' },
];

// A：好き1つにつき「惹かれる点」「満たされる瞬間」の2問（同じ項目を続けて聞く）
[0, 1, 2].forEach((i) => {
  steps.push({ id: `A${i * 2 + 1}`, kind: 'choice', phase: 'A', gen: 'likeAttraction', item: i });
  steps.push({ id: `A${i * 2 + 2}`, kind: 'choice', phase: 'A', gen: 'likeMoment', item: i });
});

// B：嫌い1つにつき「何がイヤか」「代わりにどうなってほしいか」の2問
[0, 1, 2].forEach((i) => {
  steps.push({ id: `B${i * 2 + 1}`, kind: 'choice', phase: 'B', gen: 'dislikeWhat', item: i });
  steps.push({ id: `B${i * 2 + 2}`, kind: 'choice', phase: 'B', gen: 'dislikeInverse', item: i });
});

steps.push({ id: 'FT1', kind: 'free', phase: 'W', gen: 'ftEpisode', n: 1 });

// C：紛らわしい動機のペアを見分ける5問＋動かされ方（R）1問
[0, 1, 2, 3, 4].forEach((i) => {
  steps.push({ id: `C${i + 1}`, kind: 'choice', phase: 'C', gen: 'boundary', index: i });
});
steps.push({ id: 'C6', kind: 'choice', phase: 'C', gen: 'regulation' });

steps.push(
  { id: 'D1', kind: 'choice', phase: 'D', gen: 'persona' },
  { id: 'D2', kind: 'choice', phase: 'D', gen: 'direction' },
  { id: 'D3', kind: 'choice', phase: 'D', gen: 'roles' },
  { id: 'D4', kind: 'choice', phase: 'D', gen: 'distance' },
);

steps.push({ id: 'FT2', kind: 'free', phase: 'W', gen: 'ftWhy', n: 2 });

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
