// 動機コード（研究レポートの K1〜K7）と、一緒に記録する属性の定義。
// 画面に出すときは name / verb を使い、コード名そのものは読者に見せない。

export const CODES = ['K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7'];

export const CODE_INFO = {
  K1: { name: '苦しさを減らしたい', verb: 'いたわる', desc: '誰かのしんどさや不便を、軽くしたい' },
  K2: { name: 'おかしいことを正したい', verb: '正す', desc: '筋の通らないことを、正しい形にしたい' },
  K3: { name: '味わいたい・知りたい', verb: '味わう', desc: 'やること・知ること自体に惹かれる' },
  K4: { name: '大切なものに応えたい', verb: '大切にする', desc: 'かけがえのないものを、大事にしたい' },
  K5: { name: '自分の力で形にしたい', verb: '形にする', desc: '自分で選び、腕を磨き、表現したい' },
  K6: { name: 'つながっていたい', verb: 'つなぐ', desc: '誰かとの関係や居場所を、大事にしたい' },
  K7: { name: '手応えや評価がほしい', verb: 'つかみ取る', desc: '認められること・成果・影響力がほしい' },
};

// T：関心対象
export const TARGETS = {
  self: '自分自身',
  close: '身近な人',
  community: '仲間・地域',
  society: '社会・これからの世代',
  culture: '文化・自然・知識',
};

// D：方向。ブログ記事の「ミッションの方向性」の表にそろえる。
export const DIRECTIONS = {
  relieve: { label: '困っていること・つらいことを減らしたい', name: '苦痛の解消', example: '孤独を減らす' },
  amplify: { label: '楽しい・うれしいと感じる機会を増やしたい', name: '喜びの増幅', example: '音楽の楽しさを広げる' },
  expand: { label: 'できること・選べることを増やしたい', name: '可能性の拡張', example: '誰もが創作に挑戦できるようにする' },
  protect: { label: '大切なものを守り、残したい', name: '価値の保護', example: '自然や文化を次世代に残す' },
};

// R：調整様式（自己決定理論）
export const REGULATIONS = {
  INT: '楽しさから',
  ID: '納得から',
  INJ: '罪悪感や焦りから',
  EXT: '期待や指示から',
  UNK: 'まだわからない',
};

// 手段の好み（動機とは別に記録する）
export const ROLES = {
  make: 'つくる',
  teach: '伝える・教える',
  connect: 'つなぐ',
  research: '調べる',
  support: '支える・ケアする',
  change: '声をあげて変える',
  system: '仕組みにする',
  express: '表現する',
};

export const DISTANCES = {
  work: '今の仕事の中で',
  side: '副業・週末に',
  hobby: '趣味・ボランティアで',
  future: 'いずれ本業に',
};
