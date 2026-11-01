// テンプレート版の生成器（AIなし）。AI版が使えないとき・失敗したときの受け皿にもなる。
//
// 生成器は次の3つを持つ（AI版も同じ形）。どれも Promise を返す。
//   question(step, ctx)          → 質問オブジェクト（選択肢の文言・問いの文面）
//   analyzeFreeText(text, ctx)   → { hits, inferences, safety, source, weight }  自由記述の読み取り
//   resultCopy(ctx)              → 結果画面の文章（作れそうなもの・次の問いなど）
//
// 選択肢は「スロット方式」：動機コードの枠を固定し、各枠の文言だけをつくる。
// AI版はこの文言を、本人の好き・嫌いに合わせて言い換える。

import { CODES, CODE_INFO, DIRECTIONS, ROLES, DISTANCES } from '../codes.js';
import { indexOfStep } from '../flow.js';
import { computeScores, motivesByItem } from '../scoring.js';
import { mark, seededShuffle, truncate } from '../text.js';

const none = (label = 'どれも違う／わからない', tags = {}) => ({ id: 'none', label, none: true, tags });

// AI版が言い換える質問と、その種類
export const SLOT_TYPES = {
  likeAttraction: 'attraction',
  likeMoment: 'moment',
  dislikeWhat: 'what',
  dislikeInverse: 'inverse',
};

// --- A・B：スロットの定義 -------------------------------------------------

const LIKE_ATTRACTION = {
  K3e: { codes: ['K3'], label: 'その時間そのものが心地いい', tags: { sub: 'enjoy' } },
  K3x: { codes: ['K3'], label: '奥深さや仕組みを知っていくのが楽しい', tags: { sub: 'explore' } },
  K4: { label: 'それ自体に、代わりのきかない良さがある' },
  K5: { label: '自分の腕や工夫が活きる' },
  K6: { label: '誰かとつながるきっかけになる' },
  K7: { label: '人に認められる手応えがある' },
  K1: { label: '誰かを楽にしたり、喜ばせたりできる' },
};
const LIKE_ATTRACTION_ORDER = ['K3e', 'K3x', 'K4', 'K5', 'K6', 'K7', 'K1'];

const LIKE_MOMENT = {
  K1: { label: '誰かが、ほっとした顔をしたとき', tags: { target: 'close' } },
  K6: { label: '誰かと一緒に楽しめたとき', tags: { target: 'community' } },
  K7: { label: '「すごいね」と言われたとき', tags: { target: 'self' } },
  K3e: { codes: ['K3'], label: '夢中になって、時間を忘れているとき', tags: { target: 'self', sub: 'enjoy' } },
  K3x: { codes: ['K3'], label: '新しい発見や「なるほど」があったとき', tags: { target: 'culture', sub: 'explore' } },
  K4: { label: 'その良さを、しみじみ味わえたとき', tags: { target: 'culture' } },
  K5: { label: '自分なりのやり方が、うまくいったとき', tags: { target: 'self' } },
};
const LIKE_MOMENT_ORDER = ['K1', 'K6', 'K7', 'K3e', 'K3x', 'K4', 'K5'];

const DISLIKE_WHAT = {
  K7: { label: '損をしたり、軽く見られたりする' },
  K5: { label: '自分で選べない、自由がない' },
  K6: { label: '人と人の関係が、ギスギスする' },
  K1: { label: '心や体が、すり減っていく' },
  K2: { label: '筋が通っていない、おかしい' },
  K4: { label: '大切なものが、雑に扱われる' },
};
const DISLIKE_WHAT_ORDER = ['K7', 'K5', 'K6', 'K1', 'K2', 'K4'];

const DISLIKE_INVERSE = {
  K4: { label: '大切なものが、大切に扱われる', tags: { direction: 'protect' } },
  K6: { label: '人と人が、気持ちよく関われる', tags: { direction: 'amplify' } },
  K7: { label: 'がんばりや価値が、ちゃんと報われる', tags: { direction: 'amplify' } },
  K1: { label: 'しんどい思いをする人が、いなくなる', tags: { direction: 'relieve' } },
  K2: { label: '筋の通った、フェアな形になる', tags: { direction: 'relieve' } },
  K5: { label: '一人ひとりが、自分で選べるようになる', tags: { direction: 'expand' } },
};
const DISLIKE_INVERSE_ORDER = ['K4', 'K6', 'K7', 'K1', 'K2', 'K5'];

// 1問に5枠だけ出し、3項目でローテーションして各コードの出る回数をそろえる
function rotate(order, qIndex, show = 5) {
  const drop = order.length - show;
  const start = (qIndex * drop) % order.length;
  const dropped = new Set(Array.from({ length: drop }, (_, k) => (start + k) % order.length));
  return order.filter((_, i) => !dropped.has(i));
}

function slotQuestion(step, defs, order, { title, sub, max, kind, items }) {
  const options = rotate(order, step.item).map((key) => ({
    id: key,
    label: defs[key].label,
    codes: defs[key].codes || [key],
    tags: defs[key].tags || {},
  }));
  return {
    title,
    sub,
    max,
    weight: 1,
    item: { kind, index: step.item },
    options: [...seededShuffle(options, `${step.id}:${items[step.item]}`), none()],
  };
}

// --- 回答の読み出し -------------------------------------------------------

function pickedTag(state, stepId, key) {
  const o = state.answers[stepId]?.chosen?.[0];
  return o && !o.none ? o[key] : undefined;
}

// A・Bで選んだ数が多い項目ほど「反応が強い」とみなす（上位の動機を含むと +1）
function itemIntensity(state, kind, topCode) {
  const list = kind === 'like' ? state.likes : state.dislikes;
  const score = list.map(() => 0);
  Object.values(state.answers).forEach((a) => {
    if (!a.item || a.item.kind !== kind) return;
    a.chosen.forEach((o) => {
      if (o.none) return;
      score[a.item.index] += 1;
      if (topCode && o.codes.includes(topCode)) score[a.item.index] += 1;
    });
  });
  return score;
}

const argmax = (arr) => arr.reduce((best, v, i) => (v > arr[best] ? i : best), 0);

function topItem(state, kind, topCode) {
  return argmax(itemIntensity(state, kind, topCode));
}

// 指定した動機コードを選んだ回数がいちばん多い項目
function itemFor(state, kind, codes) {
  const list = kind === 'like' ? state.likes : state.dislikes;
  const score = list.map(() => 0);
  Object.values(state.answers).forEach((a) => {
    if (!a.item || a.item.kind !== kind) return;
    a.chosen.forEach((o) => { if (o.codes?.some((c) => codes.includes(c))) score[a.item.index] += 1; });
  });
  return list[argmax(score)];
}

const likeFor = (state, codes) => itemFor(state, 'like', codes);
const dislikeFor = (state, codes) => itemFor(state, 'dislike', codes);
const hasSignal = (scores) => CODES.some((c) => scores.normalized[c] > 0);

// --- C：見極めの質問バンク --------------------------------------------------
// 研究レポートの境界検査（K1/K2、K3/K4/K5、K4/K6、K6/K7 など）を、反実仮想の2択にしたもの。

const BOUNDARY_BANK = [
  { id: 'K1K2', priority: true, build: () => ({
    title: '誰も困っていなくても、筋が通らないことは正したい？',
    options: { K2: '正したい。おかしいものはおかしい', K1: '困る人がいないなら、そこまでは気にならない' },
  }) },
  { id: 'K3K4', priority: true, build: (s) => {
    const L = mark(likeFor(s, ['K3', 'K4']));
    return {
      title: 'どっちのほうが、つらい？',
      options: { K4: `${L}そのものが、世の中から消えてしまう`, K3: `自分が${L}をする時間が、なくなってしまう` },
    };
  } },
  { id: 'K3K5', priority: true, build: (s) => ({
    title: `上達も成果もまったくなくても、${mark(likeFor(s, ['K3', 'K5']))}を続けたい？`,
    options: { K3: '続けたい。やること自体が好き', K5: '伸びていく手応えがないと、物足りない' },
  }) },
  { id: 'K4K6', priority: true, build: (s) => ({
    title: `自分が関われなくても、${mark(likeFor(s, ['K4', 'K6']))}が世の中に続いていくなら？`,
    options: { K4: 'それで十分うれしい', K6: '自分や仲間が関われないなら、さみしい' },
  }) },
  { id: 'K6K7', priority: true, build: () => ({
    title: 'どっちのほうが、うれしい？',
    options: { K6: '安心していられる居場所がある', K7: 'みんなから一目置かれる' },
  }) },
  { id: 'K5K7', build: () => ({
    title: 'どっちのほうが、燃える？',
    options: { K5: '昨日の自分を超えること', K7: '誰かに勝つこと、認められること' },
  }) },
  { id: 'K1K7', build: () => ({
    title: '誰にも知られずに、誰かを助けられるとしたら？',
    options: { K1: 'それで十分、満足できる', K7: '少しは知ってほしい。手応えがほしい' },
  }) },
  { id: 'K2K6', build: () => ({
    title: '仲のいい人が、おかしなことをしていたら？',
    options: { K2: '関係がこじれても、はっきり伝える', K6: '関係を壊さない伝え方を、まず考える' },
  }) },
  { id: 'K1K4', build: (s) => ({
    title: `${mark(dislikeFor(s, ['K1', 'K4']))}について、より気になるのは？`,
    options: { K1: 'そこで、しんどい思いをしている人がいること', K4: '大切なものが、損なわれていくこと' },
  }) },
  { id: 'K3K6', build: (s) => ({
    title: `${mark(likeFor(s, ['K3', 'K6']))}は、どっちが楽しい？`,
    options: { K3: 'ひとりで、とことん', K6: '誰かと一緒に' },
  }) },
  { id: 'K5K6', build: () => ({
    title: '何かをつくるなら、どっちが好き？',
    options: { K5: '自分の思うように、ひとりで形にする', K6: 'みんなで相談しながら、一緒に形にする' },
  }) },
].map((p) => ({ ...p, codes: [p.id.slice(0, 2), p.id.slice(2)] }));

// A・B・自由記述1までのスコアで、上位の動機どうし・差が小さいペアを優先して5つ選ぶ
function planBoundary(state) {
  const s = computeScores(state, indexOfStep('C1'));
  const n = s.normalized;
  const top = new Set(s.ranking.slice(0, 4));
  const scored = BOUNDARY_BANK.map((p, i) => {
    const [x, y] = p.codes;
    let v = n[x] + n[y] - Math.abs(n[x] - n[y]);
    if (top.has(x) && top.has(y)) v += 1;
    if (p.priority) v += 0.15;
    return { p, v, i };
  }).sort((a, b) => b.v - a.v || a.i - b.i);

  const picked = [];
  const use = {};
  for (const { p } of scored) {
    if (picked.length === 5) break;
    if (p.codes.some((c) => (use[c] || 0) >= 3)) continue;
    picked.push(p);
    p.codes.forEach((c) => { use[c] = (use[c] || 0) + 1; });
  }
  for (const { p } of scored) {
    if (picked.length === 5) break;
    if (!picked.includes(p)) picked.push(p);
  }
  return picked;
}

const REG_OPTIONS = [
  { id: 'INT', label: 'やっていて、楽しい・面白いから', tags: { regulation: 'INT' } },
  { id: 'ID', label: '大事なことだと、自分で納得しているから', tags: { regulation: 'ID' } },
  { id: 'INJ', label: 'やらないと、罪悪感や焦りがあるから', tags: { regulation: 'INJ' } },
  { id: 'EXT', label: '誰かに期待されている・言われているから', tags: { regulation: 'EXT' } },
];

// --- D・E：相手とミッション ---------------------------------------------------

const T_PERSONA = {
  self: { label: '自分自身', persona: '自分自身' },
  close: { label: '身近な家族や友だち', persona: '身近な家族や友だち' },
  community: { label: '仲間や、地域の人たち', persona: '仲間や地域の人たち' },
  society: { label: 'これからの世代', persona: 'これからの世代' },
};

function topTarget(targets) {
  const keys = Object.keys(T_PERSONA);
  return keys.reduce((best, k) => ((targets[k] || 0) > (targets[best] || 0) ? k : best), 'society');
}

// 届けたい相手（D1）の時点のスコアで、いちばん反応が強かった好き・嫌いを選ぶ。
// ミッション案（E2・E3）でも同じ基準を使い、D1の選択肢とずれないようにする。
function anchorItems(state) {
  const top = computeScores(state, indexOfStep('D1')).ranking[0];
  return { D: state.dislikes[topItem(state, 'dislike', top)], L: state.likes[topItem(state, 'like', top)] };
}

const dislikePersona = (state) => `${anchorItems(state).D}にモヤモヤしている人`;
const PAST_PERSONA = '昔の自分と同じところでつまずいている人';

// ミッションは、ブログ記事の定義「誰のために、どんな価値を生み出し続けるか」に合わせて
// 「{誰}が、{どんな状態}…こと」の形にそろえる。手段（何をつくるか）は入れない。
const STATE_PHRASE = {
  K1: 'しんどさを一人で抱えこまずにいられる',
  K2: '理不尽に振り回されず、フェアに扱われる',
  K3: '夢中になれる時間を、心ゆくまで味わえる',
  K4: '大切なものを、大切にし続けられる',
  K5: '自分のやり方で、やりたいことを形にできる',
  K6: '安心して人とつながれる',
  K7: '自分のがんばりを、正当に認めてもらえる',
};

function buildMission({ code, persona, direction, wrapper }) {
  const S = STATE_PHRASE[code];
  const P = persona ? `${persona}が、` : '誰もが、';
  if (wrapper === 'place') return `${P}${S}場所をつくること`;
  if (wrapper === 'world') return `${P}${S}世界をつくること`;
  if (wrapper === 'soft') return `${P}${S}ような毎日を、少しずつ増やすこと`;
  if (direction === 'relieve') return `${P}もう一度、${S}ようにすること`;
  if (direction === 'amplify') return `${P}${S}瞬間を、もっと増やすこと`;
  if (direction === 'protect') return `${P}これからも${S}ように、守り続けること`;
  return `${P}${S}ようにすること`;
}

const SCOPE = { work: '今の職場から', side: '週末の活動から', hobby: '身近なところから', future: '小さく試しながら' };

function refineMission(meta, mode, state) {
  if (mode === 'concrete') {
    const scope = SCOPE[pickedTag(state, 'D4', 'distance')] || '身近なところから';
    return `まずは${scope}、${buildMission({ ...meta, persona: meta.persona || dislikePersona(state) })}`;
  }
  if (mode === 'bigger') return buildMission({ ...meta, persona: '世の中のすべての人', wrapper: 'world' });
  if (mode === 'softer') return buildMission({ ...meta, wrapper: 'soft' });
  return buildMission(meta);
}

function primaryCode(state, scores) {
  return pickedTag(state, 'E1', 'primary') || scores.ranking[0];
}

function missionMetas(state, scores) {
  const primary = primaryCode(state, scores);
  const others = scores.ranking.filter((c) => c !== primary);
  const persona = pickedTag(state, 'D1', 'persona') ?? null;
  const direction = pickedTag(state, 'D2', 'direction') ?? null;
  const alt = state.answers.D1?.chosen?.[0]?.id === 'p_dislike' ? PAST_PERSONA : dislikePersona(state);
  return [
    { code: primary, persona, direction },
    { code: others[0], persona, direction },
    { code: primary, persona: alt, direction },
    { code: others[1], persona, direction, wrapper: 'place' },
  ];
}

function evidenceHint(list) {
  const free = list.find((e) => e.kind === 'free');
  if (free) return `あなたの言葉：「${truncate(free.quote, 28)}」`;
  const c = list.find((e) => e.kind === 'choice');
  return c ? `選んだ答え：「${truncate(c.a, 28)}」` : 'まだ根拠が少ない気持ちです';
}

const WHY_PROMPTS = {
  K1: '「苦しさを減らしたい」気持ちが強く出ています。誰かのしんどさが、なぜあなたにとって見過ごせないのでしょう？',
  K2: '「おかしいことを正したい」気持ちが強く出ています。筋の通らないことが、なぜあなたにとって見過ごせないのでしょう？',
  K3: '「味わいたい・知りたい」気持ちが強く出ています。何に、なぜそこまで惹かれるのだと思いますか？',
  K4: '「大切なものに応えたい」気持ちが強く出ています。それはあなたにとって、なぜかけがえがないのでしょう？',
  K5: '「自分の力で形にしたい」気持ちが強く出ています。なぜ「自分の手で」であることが大事なのでしょう？',
  K6: '「つながっていたい」気持ちが強く出ています。誰と、どんな関係でいたいのでしょう？ それはなぜ？',
  K7: '「手応えや評価がほしい」気持ちが強く出ています。誰に、どんなふうに認められたいのでしょう？ それはなぜ？',
};

// --- 質問ビルダー ------------------------------------------------------------

const BUILDERS = {
  likeAttraction: (step, { state }) => slotQuestion(step, LIKE_ATTRACTION, LIKE_ATTRACTION_ORDER, {
    title: `${mark(state.likes[step.item])}の、どこに惹かれる？`,
    sub: '2つまで選べます',
    max: 2,
    kind: 'like',
    items: state.likes,
  }),

  likeMoment: (step, { state }) => slotQuestion(step, LIKE_MOMENT, LIKE_MOMENT_ORDER, {
    title: `${mark(state.likes[step.item])}で、いちばん満たされるのはどんな瞬間？`,
    sub: 'いちばん近いものを1つ',
    max: 1,
    kind: 'like',
    items: state.likes,
  }),

  dislikeWhat: (step, { state }) => slotQuestion(step, DISLIKE_WHAT, DISLIKE_WHAT_ORDER, {
    title: `${mark(state.dislikes[step.item])}の、何がいちばんイヤ？`,
    sub: '2つまで選べます',
    max: 2,
    kind: 'dislike',
    items: state.dislikes,
  }),

  dislikeInverse: (step, { state }) => slotQuestion(step, DISLIKE_INVERSE, DISLIKE_INVERSE_ORDER, {
    title: `${mark(state.dislikes[step.item])}がなくなったら、代わりにどうなってほしい？`,
    sub: 'いちばん近いものを1つ',
    max: 1,
    kind: 'dislike',
    items: state.dislikes,
  }),

  ftEpisode: (step, { state, scores }) => {
    const top = hasSignal(scores) ? scores.ranking[0] : null;
    const li = itemIntensity(state, 'like', top);
    const di = itemIntensity(state, 'dislike', top);
    // 同点なら「嫌い」を優先して提案する（感情が動いた場面を思い出しやすいため）
    const candidates = [
      ...state.dislikes.map((label, i) => ({ id: `d${i}`, label, v: di[i] })),
      ...state.likes.map((label, i) => ({ id: `l${i}`, label, v: li[i] })),
    ];
    const best = candidates.reduce((b, c) => (c.v > b.v ? c : b), candidates[0]);
    return {
      title: '6つのうち、いちばん心が動いた「具体的な場面」をひとつ教えてください',
      sub: 'いつ・どこで・何があった？ そのとき、どう感じた？',
      about: {
        hint: `答えを見ると、${mark(best.label)}への反応がいちばん強そうです。ほかの項目でもかまいません。`,
        suggested: best.id,
        options: [
          ...state.likes.map((label, i) => ({ id: `l${i}`, label })),
          ...state.dislikes.map((label, i) => ({ id: `d${i}`, label })),
          { id: 'other', label: 'それ以外' },
        ],
      },
      placeholder: '例：入社1年目のとき、同期が理不尽に怒られているのを見て、何も言えなかった。',
      skippable: true,
    };
  },

  boundary: (step, { state }) => {
    const pair = planBoundary(state)[step.index];
    const b = pair.build(state);
    const opts = pair.codes.map((c) => ({ id: c, label: b.options[c], codes: [c], tags: {} }));
    return {
      title: b.title,
      sub: '直感で、近いほうを1つ',
      max: 1,
      weight: 1.5,
      options: [...seededShuffle(opts, `${step.id}:${pair.id}`), none('どちらとも言えない', { ambiguous: pair.codes })],
    };
  },

  regulation: (step, { scores }) => {
    const top = scores.ranking[0];
    const title = hasSignal(scores)
      ? `「${CODE_INFO[top].name}」という気持ちが、強く出ています。その気持ちは、どこから来ていると思う？`
      : 'ここまでの答えに出てきた気持ちは、どこから来ていると思う？';
    return {
      title,
      sub: '2つまで選べます',
      max: 2,
      weight: 0,
      options: [...seededShuffle(REG_OPTIONS, `${step.id}:${top}`), none('正直、まだよくわからない', { regulation: 'UNK' })],
    };
  },

  persona: (step, { state, scores }) => {
    const { D, L } = anchorItems(state);
    const t = topTarget(scores.targets);
    return {
      title: '誰のためのミッションにしたい？',
      sub: 'いちばん届けたい相手を1つ',
      max: 1,
      weight: 0,
      options: [
        { id: 'p_dislike', label: `${mark(D)}に、モヤモヤしている人`, tags: { target: 'society', persona: `${D}にモヤモヤしている人` } },
        { id: 'p_past', label: '昔の自分と同じところで、つまずいている人', tags: { target: 'close', persona: PAST_PERSONA } },
        { id: 'p_like', label: `${mark(L)}の良さを、まだ知らない人`, tags: { target: 'community', persona: `${L}の良さをまだ知らない人` } },
        { id: `p_${t}`, label: T_PERSONA[t].label, tags: { target: t, persona: T_PERSONA[t].persona } },
        none('まだ決めない', { persona: null }),
      ],
    };
  },

  direction: () => ({
    title: 'あなたのミッションは、どの方向に近い？',
    sub: 'いちばん近いものを1つ',
    max: 1,
    weight: 0,
    options: [
      ...Object.entries(DIRECTIONS).map(([id, d]) => ({
        id,
        label: d.label,
        desc: `${d.name}（例：${d.example}）`,
        tags: { direction: id },
      })),
      none('まだわからない'),
    ],
  }),

  roles: () => ({
    title: '好きな関わり方、得意な関わり方は？',
    sub: '2つまで選べます',
    max: 2,
    weight: 0,
    layout: 'grid',
    options: [
      ...Object.entries(ROLES).map(([id, label]) => ({ id, label, tags: { role: id } })),
      none('どれも違う'),
    ],
  }),

  distance: () => ({
    title: 'どのくらいの距離で関わりたい？',
    max: 1,
    weight: 0,
    options: [
      ...Object.entries(DISTANCES).map(([id, label]) => ({ id, label, tags: { distance: id } })),
      none('まだわからない'),
    ],
  }),

  // 根拠の自由記述が少ない上位の動機を狙って問う
  ftWhy: (step, { scores }) => {
    const top2 = scores.ranking.slice(0, 2);
    const freeCount = (c) => scores.evidence[c].filter((e) => e.kind === 'free').length;
    const target = freeCount(top2[1]) < freeCount(top2[0]) ? top2[1] : top2[0];
    return {
      title: hasSignal(scores)
        ? WHY_PROMPTS[target]
        : 'あなたが「好き」「嫌い」と感じるものの奥には、どんな気持ちがあると思いますか？',
      sub: 'きっかけになった出来事や、思い浮かぶ人がいれば、それも。',
      placeholder: '例：小さいころ、〇〇なことがあって…',
      skippable: true,
    };
  },

  primary: (step, { scores }) => {
    const top = scores.ranking.slice(0, 4);
    const opts = top.map((c) => ({ id: c, label: CODE_INFO[c].name, desc: evidenceHint(scores.evidence[c]), tags: { primary: c } }));
    return {
      title: 'あなたを動かしているもので、いちばん根っこにあるのは？',
      sub: 'ここまでの答えで強く出た気持ちです。順番は、あなたが決めてください',
      max: 1,
      weight: 0,
      options: [...seededShuffle(opts, `${step.id}:${top.join()}`), none('どれもしっくりこない')],
    };
  },

  missionCandidates: (step, { state, scores }) => {
    const seen = new Set();
    const opts = [];
    missionMetas(state, scores).forEach((meta) => {
      const text = buildMission(meta);
      if (seen.has(text)) return;
      seen.add(text);
      opts.push({ id: `c${opts.length + 1}`, label: text, tags: { meta } });
    });
    return {
      title: 'ミッションの候補です。いちばんしっくりくるのは？',
      sub: '「誰のために、どんな価値を生み出すか」の形にしています。言い回しは、このあと直せます',
      max: 1,
      weight: 0,
      options: [...opts, none('どれも違う（自分で書く）')],
    };
  },

  missionRefine: (step, { state, scores }) => {
    const e2 = state.answers.E2?.chosen?.[0];
    const fromScratch = !e2 || e2.none;
    const base = fromScratch ? missionMetas(state, scores)[0] : e2.meta;
    const baseText = buildMission(base);
    const modes = [
      { id: 'keep', label: 'このままでいい' },
      { id: 'concrete', label: 'もっと具体的に' },
      { id: 'bigger', label: 'もっと大きく' },
      { id: 'softer', label: 'もっとやわらかく' },
    ];
    const options = modes.map((m) => {
      const draft = refineMission(base, m.id, state);
      return { id: m.id, label: m.label, desc: m.id === 'keep' ? undefined : draft, tags: { refine: m.id, draft } };
    });
    if (fromScratch) options.push({ id: 'blank', label: 'ゼロから自分で書く', tags: { refine: 'blank', draft: '' } });
    return {
      title: fromScratch ? 'いちばん近い案をもとにするなら、どう直す？' : '選んだ案を、どう直す？',
      context: baseText,
      max: 1,
      weight: 0,
      options,
    };
  },

  ftOwnWords: (step, { state }) => ({
    title: '最後に、自分の言葉で一文に書き直してください',
    sub: '下書きは自由に書き換えてかまいません。声に出して読んで、しっくりくるまで。',
    draft: state.answers.E3?.chosen?.[0]?.draft ?? '',
    placeholder: '例：ものづくりの楽しさを伝播すること',
    skippable: false,
  }),
};

// --- 自由記述の簡易判定（AIが使えないときの受け皿） ------------------------------------

const KEYWORDS = {
  K1: ['つらい', '辛い', 'しんどい', '苦し', '痛', '疲れ', '困っ', '助け', '楽にし', 'ほっと', '寂し', 'さみし', '孤独', '不安'],
  K2: ['おかしい', '不公平', '理不尽', 'ずるい', '許せない', '正し', '筋が', '平等', '公平', '責任', '間違って', 'フェア'],
  K3: ['楽しい', 'たのしい', '面白', 'おもしろ', '夢中', '知りたい', '不思議', '発見', 'ワクワク', 'わくわく', '気持ちいい', '心地'],
  K4: ['大切', 'もったいない', '守りたい', 'かけがえ', '美し', '残したい', '受け継', '愛'],
  K5: ['自分で', '自分の力', '自分らしく', '成長', '上達', 'できるように', '表現', '形にし', '挑戦', '自由'],
  K6: ['仲間', '一緒', 'いっしょ', 'つながり', 'つながる', '繋が', '居場所', '友達', '友だち', '家族', 'みんなで'],
  K7: ['認め', '評価', '褒め', 'ほめ', '勝ち', '勝つ', '負け', '悔し', 'お金', '稼', '有名', '見返', 'すごい'],
};

// 深刻な状況が書かれていないかの最低限の確認（AI版でも念のため重ねて使う）
const SAFETY_WORDS = ['死にたい', '消えたい', '自殺', '自傷', 'リスカ', '殺したい', '殴られ', '虐待', '暴力を受け'];

export function safetyCheck(text) {
  return SAFETY_WORDS.some((w) => String(text).includes(w)) ? 'concern' : 'none';
}

function analyzeFreeTextSync(text) {
  const sentences = String(text).split(/[。！？!?\n]+/).map((s) => s.trim()).filter(Boolean);
  const hits = [];
  CODES.forEach((code) => {
    const sentence = sentences.find((s) => KEYWORDS[code].some((k) => s.includes(k)));
    if (sentence) hits.push({ code, quote: truncate(sentence, 60) });
  });
  return { hits, inferences: [], safety: safetyCheck(text), source: 'template', weight: 1 };
}

// --- 結果画面の文章 ------------------------------------------------------------

const ROLE_MEANS = {
  make: (p) => `${p}のための、小さな道具や場を1つ作ってみる`,
  teach: (p) => `自分が知っていることを、${p}に向けて1回話す・書く`,
  connect: () => '同じ思いを持つ人どうしを、1組つないでみる',
  research: (p) => `${p}に3人会って、困りごとを聞いてみる`,
  support: () => '身近な1人の「しんどさ」を、具体的に手伝ってみる',
  change: () => 'おかしいと思うことを1つ、言葉にして発信する',
  system: () => '自分がやっている工夫を、誰でも使える手順にまとめる',
  express: () => 'この思いを、作品や文章にして1つ出してみる',
};
const CODE_ROLE = { K1: 'support', K2: 'change', K3: 'express', K4: 'teach', K5: 'make', K6: 'connect', K7: 'system' };

const FIRST_STEP = {
  work: '今の仕事のなかで、このミッションに近い作業を1つ見つけて、いつもより丁寧にやってみる',
  side: '今週末の2時間を、上のどれか1つにあててみる',
  hobby: '関心の近いコミュニティやイベントを1つ探して、のぞいてみる',
  future: 'まずは小さく試して、誰か1人から反応をもらう',
  none: '書いたミッションを、信頼できる人1人に話してみる',
};

// ブログ記事の「問い一覧」に合わせ、方向性ごとに次に立てる問いを1つ返す
const NEXT_QUESTION = {
  relieve: 'どうすれば、同じように困っている人を一人でも救えますか？',
  amplify: 'どうすれば、その楽しさを、もっと多くの人に広げられますか？',
  expand: '何があれば、もっと多くの人が「できる」「選べる」ようになりますか？',
  protect: 'どうすれば、それを次の人に手渡せますか？',
  none: 'このミッションに近づく、いちばん小さな一歩は何ですか？',
};

function resultCopySync({ state, scores }) {
  const chosenPrimary = pickedTag(state, 'E1', 'primary');
  const primary = chosenPrimary || scores.ranking[0];
  const order = [primary, ...scores.ranking.filter((c) => c !== primary)];
  const persona = pickedTag(state, 'D1', 'persona') || '届けたい相手';
  const direction = pickedTag(state, 'D2', 'direction');

  const roles = (state.answers.D3?.chosen || []).filter((o) => !o.none).map((o) => o.role);
  for (const c of order) {
    if (roles.length >= 3) break;
    if (!roles.includes(CODE_ROLE[c])) roles.push(CODE_ROLE[c]);
  }
  const means = roles.slice(0, 3).map((r) => ROLE_MEANS[r](persona));
  const firstStep = FIRST_STEP[pickedTag(state, 'D4', 'distance')] || FIRST_STEP.none;

  const r = scores.regulations;
  const autonomous = r.INT || r.ID;
  const pressured = r.INJ || r.EXT;
  let regulationNote;
  if (pressured) {
    regulationNote = `${autonomous ? '楽しさや納得に加えて、' : ''}「やらなきゃ」「期待されているから」という気持ちも混ざっているようです。それ自体は悪いことではありません。ただ、楽しさや納得から来る気持ちのほうが長く続きやすいと言われています。このミッションのどこに「自分で選んだ」感覚があるか、確かめてみてください。`;
  } else if (autonomous) {
    regulationNote = '楽しさや納得から来ている気持ちが中心のようです。こうした気持ちは、長く続きやすいと言われています。';
  } else {
    regulationNote = 'どこから来ている気持ちなのかは、まだはっきりしません。動きながら確かめていけば大丈夫です。';
  }

  const unknowns = [];
  if (scores.unknown > 0) unknowns.push(`「どれも違う／わからない」を選んだ質問が${scores.unknown}問ありました。そのテーマは、まだ言葉になっていないのかもしれません。`);
  if (scores.ambiguous.length > 2) {
    unknowns.push(`見極めの質問で「どちらとも言えない」が${scores.ambiguous.length}問ありました。似た気持ちどうしの区別は、まだついていません。`);
  } else {
    scores.ambiguous.forEach(([a, b]) => unknowns.push(`「${CODE_INFO[a].name}」と「${CODE_INFO[b].name}」のどちらが強いかは、まだ見分けられていません。`));
  }
  if (!chosenPrimary) unknowns.push('いちばん根っこの気持ちは、まだ選ばれていません。いまはスコアの順に並べています。');
  if (!pickedTag(state, 'D1', 'persona')) unknowns.push('誰のためのミッションかは、まだ決まっていません。');
  if (!direction) unknowns.push('ミッションの方向性は、まだ決まっていません。');
  if (['FT1', 'FT2'].some((id) => state.answers[id]?.skipped)) unknowns.push('スキップした自由記述があります。あなた自身の言葉による根拠が少なめです。');
  if (!unknowns.length) unknowns.push('大きな未確定はありません。ただし、これは今日のあなたの答えです。時間をおいて、またやってみてください。');

  // 6項目に共通していた気持ち：いちばん多くの項目に出ていたもの（同数なら根っこ→スコアの順）
  const items = motivesByItem(state);
  const coverage = (c) => items.filter((item) => item.codes.includes(c)).length;
  const threadCode = [...order].sort((x, y) => coverage(y) - coverage(x))[0];
  const thread = coverage(threadCode) >= 2 ? { code: threadCode, count: coverage(threadCode) } : null;

  // ミッションは2つまで。1つ目は本人が書いた文。
  // 2つ目は「6つに共通していた気持ち」から下書きをつくる（1つ目と同じなら、次に強い気持ちから）。結果画面で書き換えられる。
  const e2 = state.answers.E2?.chosen?.[0];
  const firstCode = (e2 && !e2.none && e2.meta?.code) || primary;
  const fromThread = Boolean(thread) && thread.code !== firstCode;
  const secondCode = fromThread ? thread.code : order.find((c) => c !== firstCode);
  const firstText = (state.answers.FT3?.text || '').trim();
  const missions = [{ code: firstCode, text: firstText || 'ミッションはまだ書かれていません' }];
  if ((hasSignal(scores) || chosenPrimary) && scores.normalized[secondCode] > 0) {
    const base = buildMission({ code: secondCode, persona: pickedTag(state, 'D1', 'persona') ?? null, direction });
    const edit = state.mission2Edit?.base === base && state.mission2Edit.text.trim() ? state.mission2Edit.text.trim() : '';
    missions.push({ code: secondCode, text: edit || base, base, editable: true, edited: Boolean(edit), fromThread });
  }
  // 「動機の組み合わせ」は、2つのミッションのもとになった気持ちにそろえる
  const blendCodes = missions.length > 1 ? missions.map((m) => m.code) : order.slice(0, 2);

  return {
    order,
    missions,
    items,
    thread,
    primaryChosen: Boolean(chosenPrimary),
    blendCodes,
    blend: hasSignal(scores) || chosenPrimary ? blendCodes.map((c) => CODE_INFO[c].verb).join(' × ') : 'まだ見えていません',
    direction: direction ? DIRECTIONS[direction] : null,
    means,
    firstStep,
    nextQuestion: NEXT_QUESTION[direction] || NEXT_QUESTION.none,
    regulationNote,
    unknowns,
  };
}

export const templateGenerator = {
  name: 'template',
  question: async (step, ctx) => BUILDERS[step.gen](step, ctx),
  analyzeFreeText: async (text) => analyzeFreeTextSync(text),
  resultCopy: async (ctx) => resultCopySync(ctx),
};
