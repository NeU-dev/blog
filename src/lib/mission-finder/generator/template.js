// テンプレート版の生成器（AIなし）。AI版が使えないとき・失敗したときの受け皿にもなる。
//
// 生成器は次の3つを持つ（AI版も同じ形）。どれも Promise を返す。
//   question(step, ctx)          → 質問オブジェクト（選択肢の文言・問いの文面）
//   analyzeFreeText(text, ctx)   → { hits, inferences, safety, source, weight }  自由記述の読み取り
//   resultCopy(ctx)              → 結果画面の文章（作れそうなもの・次の問いなど）
//
// 選択肢は「スロット方式」：動機コードの枠を固定し、各枠の文言だけをつくる。
// AI版は、文言を本人の答えに合わせて書き換え、「掘る」問いの型の順番も選ぶ（ctx.types / ctx.wording で渡ってくる）。

import { CODES, CODE_INFO, DIRECTIONS, ROLES, DISTANCES } from '../codes.js';
import { STEPS, PROBE_COUNT, indexOfStep } from '../flow.js';
import { computeScores } from '../scoring.js';
import { mark, plain, seededShuffle, truncate } from '../text.js';

const none = (label = 'どれも違う／わからない', tags = {}) => ({ id: 'none', label, none: true, tags });
const quote = (s) => `「${s}」`;
const likeOf = (state) => state.likes[0];
const dislikeOf = (state) => state.dislikes[0];

// AI版が文言を言い換える、全員に聞く問いと、その種類
export const SLOT_TYPES = {
  likeAttraction: 'attraction',
  likeMoment: 'moment',
  dislikeWhat: 'what',
  dislikeInverse: 'inverse',
};

// スロットのIDから、測る気持ちのコードへ（K3e・K3x はどちらも K3。相手のスロットは気持ちを測らない）
function codesOf(id, slot) {
  if (slot.codes) return slot.codes;
  if (id === 'K3e' || id === 'K3x') return ['K3'];
  return CODES.includes(id) ? [id] : [];
}

// --- A・B：全員に聞く問い ---------------------------------------------------

const LIKE_ATTRACTION = {
  K3e: { label: 'その時間そのものが心地いい', tags: { sub: 'enjoy' } },
  K3x: { label: '奥深さや仕組みを知っていくのが楽しい', tags: { sub: 'explore' } },
  K4: { label: 'それ自体に、代わりのきかない良さがある' },
  K5: { label: '自分の腕や工夫が活きる' },
  K6: { label: '誰かとつながるきっかけになる' },
  K7: { label: '人に認められる手応えがある' },
  K1: { label: '誰かを楽にしたり、喜ばせたりできる' },
};

const LIKE_MOMENT = {
  K1: { label: '誰かが、ほっとした顔をしたとき', tags: { target: 'close' } },
  K6: { label: '誰かと一緒に楽しめたとき', tags: { target: 'community' } },
  K7: { label: '「すごいね」と言われたとき', tags: { target: 'self' } },
  K3e: { label: '夢中になって、時間を忘れているとき', tags: { target: 'self', sub: 'enjoy' } },
  K3x: { label: '新しい発見や「なるほど」があったとき', tags: { target: 'culture', sub: 'explore' } },
  K4: { label: 'その良さを、しみじみ味わえたとき', tags: { target: 'culture' } },
  K5: { label: '自分なりのやり方が、うまくいったとき', tags: { target: 'self' } },
};

const DISLIKE_WHAT = {
  K7: { label: '損をしたり、軽く見られたりする' },
  K5: { label: '自分で選べない、自由がない' },
  K6: { label: '人と人の関係が、ギスギスする' },
  K1: { label: '心や体が、すり減っていく' },
  K2: { label: '筋が通っていない、おかしい' },
  K4: { label: '大切なものが、雑に扱われる' },
};

const DISLIKE_INVERSE = {
  K4: { label: '大切なものが、大切に扱われる', tags: { direction: 'protect' } },
  K6: { label: '人と人が、気持ちよく関われる', tags: { direction: 'amplify' } },
  K7: { label: 'がんばりや価値が、ちゃんと報われる', tags: { direction: 'amplify' } },
  K1: { label: 'しんどい思いをする人が、いなくなる', tags: { direction: 'relieve' } },
  K2: { label: '筋の通った、フェアな形になる', tags: { direction: 'relieve' } },
  K5: { label: '一人ひとりが、自分で選べるようになる', tags: { direction: 'expand' } },
};

function slotQuestion(step, defs, { title, sub, max, kind, item }) {
  const options = Object.entries(defs).map(([id, s]) => ({ id, label: s.label, codes: codesOf(id, s), tags: s.tags || {} }));
  return {
    title,
    sub,
    max,
    weight: 1,
    item: { kind, index: 0 },
    options: [...seededShuffle(options, `${step.id}:${item}`), none()],
  };
}

// --- 回答の読み出し -------------------------------------------------------

function pickedTag(state, stepId, key) {
  const o = state.answers[stepId]?.chosen?.[0];
  return o && !o.none ? o[key] : undefined;
}

const labelsOf = (state, id) => (state.answers[id]?.chosen || []).filter((o) => !o.none).map((o) => o.label);
const hasSignal = (scores) => CODES.some((c) => scores.normalized[c] > 0);

// 掘る問いのうち、指定した型で答えたもの（選んだ文言）
function probeAnswer(state, side, type) {
  const step = STEPS.find((s) => s.gen === 'probe' && s.side === side && state.answers[s.id]?.chosen?.[0]?.probe === type);
  return step ? labelsOf(state, step.id) : [];
}

// 好き・嫌いそれぞれの「掘った流れ」と、2つをつなぐ答え（結果画面と、AIへの材料に使う）
export function chainsOf(state) {
  const c1 = state.answers.C1?.chosen?.[0];
  return {
    like: {
      item: likeOf(state),
      links: [
        { label: '惹かれるところ', values: labelsOf(state, 'A1') },
        { label: '満たされる瞬間', values: labelsOf(state, 'A2') },
        { label: 'そこで手に入れているもの', values: probeAnswer(state, 'like', 'why') },
        { label: '大事にしていること', values: probeAnswer(state, 'like', 'value') },
      ],
    },
    dislike: {
      item: dislikeOf(state),
      links: [
        { label: 'イヤなところ', values: labelsOf(state, 'B1') },
        { label: '損なわれているもの', values: probeAnswer(state, 'dislike', 'why') },
        { label: '見過ごせない理由', values: probeAnswer(state, 'dislike', 'value') },
        { label: '代わりにほしい状態', values: labelsOf(state, 'B2') },
      ],
    },
    bridge: c1 && !c1.none && c1.bridge ? { code: c1.bridge, label: c1.label } : null,
  };
}

// --- 見極め（2つの気持ちを見分ける二択） -----------------------------------------
// 研究レポートの境界検査（K1/K2、K3/K4/K5、K4/K6、K6/K7 など）を、反実仮想の2択にしたもの。

const BOUNDARY_BANK = [
  { id: 'K1K2', side: 'dislike', priority: true, build: () => ({
    title: '誰も困っていなくても、筋が通らないことは正したい？',
    options: { K2: '正したい。おかしいものはおかしい', K1: '困る人がいないなら、そこまでは気にならない' },
  }) },
  { id: 'K3K4', side: 'like', priority: true, build: (s) => ({
    title: 'どっちのほうが、つらい？',
    options: { K4: `${mark(likeOf(s))}そのものが、世の中から消えてしまう`, K3: `自分が${mark(likeOf(s))}に使える時間が、なくなってしまう` },
  }) },
  { id: 'K3K5', side: 'like', priority: true, build: (s) => ({
    title: `上達も成果もまったくなくても、${mark(likeOf(s))}を続けたい？`,
    options: { K3: '続けたい。やること自体が好き', K5: '伸びていく手応えがないと、物足りない' },
  }) },
  { id: 'K4K6', side: 'like', priority: true, build: (s) => ({
    title: `自分が関われなくても、${mark(likeOf(s))}が世の中に続いていくなら？`,
    options: { K4: 'それで十分うれしい', K6: '自分や仲間が関われないなら、さみしい' },
  }) },
  { id: 'K6K7', side: 'any', priority: true, build: () => ({
    title: 'どっちのほうが、うれしい？',
    options: { K6: '安心していられる居場所がある', K7: 'みんなから一目置かれる' },
  }) },
  { id: 'K5K7', side: 'any', build: () => ({
    title: 'どっちのほうが、燃える？',
    options: { K5: '昨日の自分を超えること', K7: '誰かに勝つこと、認められること' },
  }) },
  { id: 'K1K7', side: 'any', build: () => ({
    title: '誰にも知られずに、誰かを助けられるとしたら？',
    options: { K1: 'それで十分、満足できる', K7: '少しは知ってほしい。手応えがほしい' },
  }) },
  { id: 'K2K6', side: 'any', build: () => ({
    title: '仲のいい人が、おかしなことをしていたら？',
    options: { K2: '関係がこじれても、はっきり伝える', K6: '関係を壊さない伝え方を、まず考える' },
  }) },
  { id: 'K1K4', side: 'dislike', build: (s) => ({
    title: `${mark(dislikeOf(s))}について、より気になるのは？`,
    options: { K1: 'そこで、しんどい思いをしている人がいること', K4: '大切なものが、損なわれていくこと' },
  }) },
  { id: 'K3K6', side: 'like', build: (s) => ({
    title: `${mark(likeOf(s))}は、どっちが楽しい？`,
    options: { K3: 'ひとりで、とことん', K6: '誰かと一緒に' },
  }) },
  { id: 'K5K6', side: 'any', build: () => ({
    title: '何かをつくるなら、どっちが好き？',
    options: { K5: '自分の思うように、ひとりで形にする', K6: 'みんなで相談しながら、一緒に形にする' },
  }) },
].map((p) => ({ ...p, codes: [p.id.slice(0, 2), p.id.slice(2)] }));

// その時点のスコアで、上位どうし・差が小さいペアを選ぶ（すでに聞いたペアは除く）
function boundaryPair(state, step, side) {
  const idx = indexOfStep(step.id);
  const s = computeScores(state, idx);
  const n = s.normalized;
  const top = new Set(s.ranking.slice(0, 4));
  const used = new Set(STEPS.slice(0, idx).map((st) => state.answers[st.id]?.chosen?.[0]?.pair).filter(Boolean));
  const pool = BOUNDARY_BANK.filter((p) => !used.has(p.id) && (side === 'any' || p.side === 'any' || p.side === side));
  const scored = (pool.length ? pool : BOUNDARY_BANK).map((p, i) => {
    const [x, y] = p.codes;
    let v = n[x] + n[y] - Math.abs(n[x] - n[y]);
    if (top.has(x) && top.has(y)) v += 1;
    if (p.priority) v += 0.15;
    return { p, v, i };
  }).sort((a, b) => b.v - a.v || a.i - b.i);
  return scored[0].p;
}

function boundaryQuestion(step, state, side) {
  const pair = boundaryPair(state, step, side);
  const b = pair.build(state);
  const tags = { pair: pair.id, probe: 'boundary' };
  const opts = pair.codes.map((c) => ({ id: c, label: b.options[c], codes: [c], tags }));
  return {
    title: b.title,
    sub: '直感で、近いほうを1つ',
    max: 1,
    weight: 1.5,
    item: side === 'any' ? null : { kind: side, index: 0 },
    options: [...seededShuffle(opts, `${step.id}:${pair.id}`), none('どちらとも言えない', { ...tags, ambiguous: pair.codes })],
  };
}

// --- 掘る問い（型） -------------------------------------------------------------
// AI版では、AIが型の順番を選び、問いと選択肢の文を本人の答えに合わせて書く。
// live：直前の答えを受けて、その場でAIが書く型（「なぜ」をもう一段掘る value）
// fixed：AIは順番だけ選び、文は決まったものを使う型

const ctxLine = (label, values) => (values.length ? `${label}：${values.join('、')}` : undefined);

export const PROBES = {
  like: {
    why: {
      purpose: '満たされる瞬間に、本当は何を手に入れているのか（一段上の理由）',
      title: () => 'その瞬間、あなたが本当に手に入れているのは？',
      context: (state) => ctxLine('満たされる瞬間', labelsOf(state, 'A2')),
      slots: {
        K3e: { label: '時間を忘れるほどの没頭' },
        K3x: { label: '「わかった」「なるほど」という発見' },
        K4: { label: 'かけがえのないものに、触れている感覚' },
        K5: { label: '自分の力が通じた、という手応え' },
        K6: { label: '誰かと一緒にいる、という安心' },
        K7: { label: '認められた、勝てた、という誇らしさ' },
        K1: { label: '誰かの役に立てた、という実感' },
      },
    },
    value: {
      live: true,
      purpose: '「手に入れているもの」が、なぜうれしいのか（大事にしている価値）。why のあとに置く',
      title: () => 'それが手に入ると、なぜうれしい？',
      context: (state) => ctxLine('手に入れているもの', probeAnswer(state, 'like', 'why')),
      slots: {
        K1: { label: '誰かの役に立てている、と思えるから' },
        K2: { label: '正しいことをしている、と思えるから' },
        K3: { label: '生きている実感が、湧いてくるから' },
        K4: { label: '大切なものが、ここにあると思えるから' },
        K5: { label: '自分を信じられるようになるから' },
        K6: { label: 'ひとりじゃない、と思えるから' },
        K7: { label: '自分の価値を、確かめられるから' },
      },
    },
    loss: {
      purpose: '失ったら何が惜しいかで、本当に大事な部分を確かめる',
      title: (L) => `もし一生${L}ができなくなったら、いちばん惜しいのは？`,
      slots: {
        K3e: { label: '何も考えずに没頭できる時間' },
        K3x: { label: 'まだ知らないことを知っていく楽しみ' },
        K4: { label: 'それ自体の良さに、触れられること' },
        K5: { label: '腕を磨いて、うまくなっていく道のり' },
        K6: { label: 'それを通じた、人とのつながり' },
        K7: { label: '認められたり、勝てたりする場' },
        K1: { label: '誰かを喜ばせられる機会' },
      },
    },
    exception: {
      purpose: 'どんなときは楽しくないか（例外）から、楽しさの条件を確かめる',
      title: (L) => `どんなときの${L}は、楽しくない？`,
      slots: {
        K5: { label: 'やり方を決められて、やらされるとき' },
        K6: { label: '一緒にやる人と、ギスギスしているとき' },
        K7: { label: '誰にも見てもらえず、反応がないとき' },
        K3e: { label: '作業みたいになって、没頭できないとき' },
        K2: { label: 'ズルや不公平がまかり通っているとき' },
        K4: { label: '大事にしてきたものが、雑に扱われるとき' },
        K1: { label: '誰かがつらそうにしているとき' },
      },
    },
    spread: {
      purpose: '人に勧めるなら何を味わってほしいか（自分の外へ向ける価値）',
      title: (L) => `${L}を人に勧めるなら、何を味わってほしい？`,
      slots: {
        K3e: { label: '時間を忘れて夢中になる感じ' },
        K3x: { label: '知るほど面白くなる奥深さ' },
        K6: { label: '人とつながれる楽しさ' },
        K5: { label: '自分でもできた、という手応え' },
        K4: { label: 'それ自体の、代わりのきかない良さ' },
        K1: { label: 'しんどいときの、逃げ場になること' },
        K7: { label: 'うまくなって、認められる喜び' },
      },
    },
    origin: {
      purpose: '好きになったきっかけから、気持ちの出どころを確かめる',
      title: (L) => `${L}を好きになったきっかけに、いちばん近いのは？`,
      slots: {
        K6: { label: '一緒にやる人や、誘ってくれた人がいた' },
        K3e: { label: 'やってみたら、とにかく楽しかった' },
        K3x: { label: '仕組みや奥深さに、引き込まれた' },
        K5: { label: 'できるようになるのが、うれしかった' },
        K7: { label: '褒められたり、勝てたりした' },
        K1: { label: 'つらい時期に、支えになった' },
        K4: { label: 'その世界そのものに、心をつかまれた' },
      },
    },
    boundary: {
      fixed: true,
      purpose: '点数が近い2つの気持ちを、二択で見分ける（2回まで）',
    },
  },
  dislike: {
    why: {
      purpose: 'イヤなことで、何が損なわれていると感じるのか（一段上の理由）',
      title: () => 'それで、何が損なわれていると感じる？',
      context: (state) => ctxLine('イヤなところ', labelsOf(state, 'B1')),
      slots: {
        K1: { label: '心や体の、余裕' },
        K2: { label: '公平さや、筋の通ったやり方' },
        K4: { label: '大切なものや、大事な時間' },
        K5: { label: '自分で選ぶ自由' },
        K6: { label: '人と人との、いい関係' },
        K7: { label: 'がんばりが報われること' },
      },
    },
    value: {
      live: true,
      purpose: '「損なわれているもの」を、なぜ見過ごせないのか（大事にしている価値）。why のあとに置く',
      title: () => 'それが損なわれるのを、なぜ見過ごせない？',
      context: (state) => ctxLine('損なわれているもの', probeAnswer(state, 'dislike', 'why')),
      slots: {
        K1: { label: 'しんどい思いをする人を、放っておけないから' },
        K2: { label: 'おかしいことは、おかしいと思うから' },
        K4: { label: '一度失ったら、取り戻せないものだから' },
        K5: { label: '自分のことは、自分で決めたいから' },
        K6: { label: '人とのつながりが、何より大事だから' },
        K7: { label: 'がんばった人が、報われてほしいから' },
      },
    },
    who: {
      fixed: true,
      weight: 0,
      purpose: 'いちばん困っているのは誰か（届けたい相手の手がかり）',
      title: (D) => `${D}で、いちばん困っているのは誰だと思う？`,
      slots: {
        self: { label: '自分自身', tags: { target: 'self' } },
        close: { label: '身近な家族や友だち', tags: { target: 'close' } },
        community: { label: '同じ場にいる、仲間や人たち', tags: { target: 'community' } },
        society: { label: '社会全体や、これからの世代', tags: { target: 'society' } },
      },
    },
    exception: {
      purpose: 'どんな条件なら許せるか（例外）から、本当にイヤな理由を確かめる',
      title: (D) => `どんな条件なら、${D}を許せる？`,
      noneLabel: 'どんな条件でも許せない／わからない',
      slots: {
        K2: { label: 'ちゃんとした理由があるなら' },
        K1: { label: '誰もつらい思いをしないなら' },
        K5: { label: '自分で選んだことなら' },
        K4: { label: '大切なものが守られるなら' },
        K6: { label: 'みんなが納得しているなら' },
        K7: { label: 'がんばった分が報われるなら' },
      },
    },
    reaction: {
      purpose: 'その場面で自分がどう動きがちか（気持ちと、関わり方の手がかり）',
      title: (D) => `${D}の場面で、あなたはどうしがち？`,
      noneLabel: 'とくに何もせず、がまんする',
      slots: {
        K2: { label: '「おかしい」と声に出す' },
        K5: { label: '自分なりに工夫して、うまくかわす' },
        K6: { label: '誰かと話して、気持ちを分かち合う' },
        K1: { label: '困っている人がいれば、手を貸す' },
        K4: { label: '大切なものだけは、守ろうとする' },
        K7: { label: '結果を出して、見返そうとする' },
      },
    },
    power: {
      purpose: '変えられる力があったら何から変えるか（向かいたい方向の手がかり）',
      title: (D) => `もし${D}を変えられる力があったら、まず何を変える？`,
      slots: {
        K2: { label: 'ルールや仕組みそのもの' },
        K1: { label: 'しんどい人が休める余白' },
        K5: { label: '一人ひとりが選べる自由' },
        K6: { label: '人と人の関わり方' },
        K4: { label: '大切なものを守る決まり' },
        K7: { label: 'がんばりがきちんと評価される仕組み' },
      },
    },
    boundary: {
      fixed: true,
      purpose: '点数が近い2つの気持ちを、二択で見分ける（2回まで）',
    },
  },
};

// AIが使えないとき・AIの計画が足りないときの順番
export const DEFAULT_ORDER = {
  like: ['why', 'value', 'loss', 'boundary', 'spread', 'exception', 'origin'],
  dislike: ['why', 'value', 'who', 'exception', 'boundary', 'power', 'reaction'],
};

// AIが選んだ順番を、決まりに合わせて直す。
// 「なぜ」は必ず入れる。「もう一段なぜ（value）」は「なぜ（why）」のあと。見極めは2回まで、ほかは1回まで。
export function repairTypes(types, side) {
  const count = PROBE_COUNT[side];
  const out = [];
  const used = {};
  const ok = (t) => Boolean(PROBES[side][t])
    && (used[t] || 0) < (t === 'boundary' ? 2 : 1)
    && (t !== 'value' || out.includes('why'));
  const add = (t) => { out.push(t); used[t] = (used[t] || 0) + 1; };
  if (!(types || []).includes('why')) add('why');
  for (const t of types || []) if (out.length < count && ok(t)) add(t);
  for (const t of [...DEFAULT_ORDER[side], 'boundary']) if (out.length < count && ok(t)) add(t);
  return out.slice(0, count);
}

// 選択肢は6つまで。多いときは、その時点で点数がいちばん低い気持ちの枠を外す
function limitSlots(ids, defs, scores, max = 6) {
  if (ids.length <= max) return ids;
  const strength = (id) => Math.max(0, ...codesOf(id, defs[id]).map((c) => scores.normalized[c]));
  const keep = new Set([...ids].sort((a, b) => strength(b) - strength(a) || ids.indexOf(a) - ids.indexOf(b)).slice(0, max));
  return ids.filter((id) => keep.has(id));
}

function probeQuestion(step, { state, scores, types, wording }) {
  const side = step.side;
  const type = repairTypes(types, side)[step.index];
  if (type === 'boundary') return boundaryQuestion(step, state, side);
  const def = PROBES[side][type];
  const item = side === 'like' ? likeOf(state) : dislikeOf(state);
  const ids = limitSlots(Object.keys(def.slots), def.slots, scores);
  const options = ids.map((id) => ({
    id,
    label: (!def.fixed && wording?.labels?.[id]) || def.slots[id].label,
    codes: codesOf(id, def.slots[id]),
    tags: { ...(def.slots[id].tags || {}), probe: type },
  }));
  return {
    title: (!def.fixed && wording?.title) || def.title(mark(item)),
    sub: 'いちばん近いものを1つ',
    context: def.context?.(state),
    max: 1,
    weight: def.weight ?? 1,
    item: { kind: side, index: 0 },
    probe: type,
    options: [...seededShuffle(options, `${step.id}:${type}:${item}`), none(def.noneLabel, { probe: type })],
  };
}

// AIに型を選んでもらうときに渡すメニュー
export function probeMenu(state, side) {
  const item = side === 'like' ? likeOf(state) : dislikeOf(state);
  return Object.entries(PROBES[side]).map(([type, def]) => ({
    type,
    purpose: def.purpose,
    live: Boolean(def.live),
    fixed: Boolean(def.fixed),
    question: def.title ? plain(def.title(mark(item))) : '',
    slots: def.fixed || def.live ? [] : Object.entries(def.slots).map(([slot, s]) => ({ slot, template: s.label })),
  }));
}

// その場でAIに書いてもらう問い（value）の材料：何を受けて聞くか
export function liveAskRequest(state, side) {
  const def = PROBES[side].value;
  const first = side === 'like' ? 'A2' : 'B1';
  const why = STEPS.find((s) => s.gen === 'probe' && s.side === side && state.answers[s.id]?.chosen?.[0]?.probe === 'why');
  const qa = (id) => (state.answers[id] ? [{ question: plain(state.answers[id].qtext), answer: labelsOf(state, id).join('、') }] : []);
  return {
    kind: 'value',
    side,
    item: side === 'like' ? likeOf(state) : dislikeOf(state),
    other: side === 'like' ? dislikeOf(state) : likeOf(state),
    context: [...qa(first), ...(why ? qa(why.id) : [])].filter((c) => c.answer),
    title: def.title(),
    slots: Object.entries(def.slots).map(([slot, s]) => ({ slot, template: s.label })),
  };
}

// --- C：好きと嫌いをつなぐ問い ------------------------------------------------------

const SHARED = {
  K1: 'しんどさを、ひとりで抱えなくていいこと',
  K2: '筋が通っていて、フェアであること',
  K3: '夢中になれる時間が、ちゃんとあること',
  K4: '大切なものが、大切に扱われること',
  K5: '自分で決めて、自分の力を出せること',
  K6: '人と安心してつながれること',
  K7: 'がんばりが、ちゃんと報われること',
};

const bridgeCodes = (scores) => scores.ranking.slice(0, 5);

function bridgeContext(state) {
  const { like, dislike } = chainsOf(state);
  const pick = (links, i, j) => (links[i].values.length ? links[i].values : links[j].values).join('、');
  return `好き：${pick(like.links, 2, 1)}　／　嫌い：${pick(dislike.links, 1, 0)}`;
}

export function bridgeAskRequest(state, scores) {
  const { like, dislike } = chainsOf(state);
  const links = (chain, side) => chain.links.filter((l) => l.values.length)
    .map((l) => ({ question: `${side}「${chain.item}」の${l.label}`, answer: l.values.join('、') }));
  return {
    kind: 'bridge',
    side: 'both',
    item: like.item,
    other: dislike.item,
    context: [...links(like, '好き'), ...links(dislike, '嫌い')],
    title: plain(`${mark(like.item)}で満たされるものと、${mark(dislike.item)}で損なわれるもの。2つに共通しているのは？`),
    slots: bridgeCodes(scores).map((c) => ({ slot: c, template: SHARED[c] })),
  };
}

// --- D・E：相手とミッション ---------------------------------------------------

const REG_OPTIONS = [
  { id: 'INT', label: 'やっていて、楽しい・面白いから', tags: { regulation: 'INT' } },
  { id: 'ID', label: '大事なことだと、自分で納得しているから', tags: { regulation: 'ID' } },
  { id: 'INJ', label: 'やらないと、落ち着かない・焦るから', tags: { regulation: 'INJ' } },
  { id: 'EXT', label: 'まわりに期待されている・言われているから', tags: { regulation: 'EXT' } },
];

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

const PAST_PERSONA = '昔の自分と同じところでつまずいている人';

function primaryCode(state, scores) {
  return pickedTag(state, 'E1', 'primary') || scores.ranking[0];
}

// --- ミッション候補 ---------------------------------------------------------------
// AI版では、本人の好き・嫌い・自由記述から AI が候補と言い直し案を書く（generator/ai.js）。
// ここのテンプレ文は、AIが使えないときの受け皿。本人の項目を「」で引いて、その人の分野が入るようにする。
// ブログ記事の例（「ものづくりの楽しさを伝播すること」）にならい、「〜こと」で終わる短い一文にする。

const MISSION_TEMPLATE = {
  K1: (d) => `${d ? `${quote(d)}のような` : ''}しんどさを、一人で抱えこまなくていいようにすること`,
  K2: (d) => `${d ? `${quote(d)}のような` : ''}筋の通らないことを、少しずつ正していくこと`,
  K3: (l) => `${l ? `${quote(l)}のように` : ''}夢中になれる時間を、味わい、分かち合うこと`,
  K4: (l) => `${l ? quote(l) : '大切なもの'}の良さを、守り、次の人に手渡すこと`,
  K5: (l) => `${l ? `${quote(l)}のように、` : ''}自分で決めて形にする楽しさを広げること`,
  K6: (l) => `${l ? `${quote(l)}をきっかけに、` : ''}人と人が安心してつながれるようにすること`,
  K7: (l) => `${l ? `${quote(l)}で` : ''}がんばった人が、正当に認められるようにすること`,
};

// その気持ちが出ていた項目（苦しさ・おかしさは「嫌い」から、ほかは「好き」から）。出ていなければ null
function anchorFor(state, code) {
  const kind = code === 'K1' || code === 'K2' ? 'dislike' : 'like';
  const found = Object.values(state.answers).some((a) => a.item?.kind === kind && a.chosen.some((o) => o.codes?.includes(code)));
  return found ? (kind === 'like' ? likeOf(state) : dislikeOf(state)) : null;
}

export function templateCandidate(state, code) {
  const text = MISSION_TEMPLATE[code](anchorFor(state, code));
  const persona = pickedTag(state, 'D1', 'persona');
  return {
    code,
    text,
    basis: '',
    variants: {
      concrete: persona ? `${persona}のために、${text}` : `まずは身近なところから、${text}`,
      bigger: `社会全体で、${text}`,
      softer: `自分のペースで、${text}`,
    },
    source: 'template',
  };
}

const bridgeCode = (state) => chainsOf(state).bridge?.code;

// AIに候補を頼む気持ち：上位4つと、好きと嫌いをつなぐ気持ち（E1でどれを根っこに選んでも候補がそろうように）
export function candidatePool(state, scores) {
  return [...new Set([...scores.ranking.slice(0, 4), bridgeCode(state)].filter(Boolean))];
}

// E2 に出す候補：根っこ → 好きと嫌いをつなぐ気持ち → スコア順で4つ。AIの候補が無い気持ちはテンプレ文
export function missionCandidateList(state, scores, aiCandidates) {
  const primary = primaryCode(state, scores);
  const codes = [...new Set([primary, bridgeCode(state), ...scores.ranking].filter(Boolean))]
    .filter((c, i) => i === 0 || scores.normalized[c] > 0)
    .slice(0, 4);
  return codes.map((code) => aiCandidates?.find((c) => c.code === code) || templateCandidate(state, code));
}

const candidateDesc = (c) => `「${CODE_INFO[c.code].name}」から${c.basis ? `　／　あなたの言葉「${truncate(c.basis, 30)}」` : ''}`;

function evidenceHint(list) {
  const free = list.find((e) => e.kind === 'free');
  if (free) return `あなたの言葉：「${truncate(free.quote, 28)}」`;
  const c = list.find((e) => e.kind === 'choice');
  return c ? `選んだ答え：「${truncate(c.a, 28)}」` : 'まだ根拠が少ない気持ちです';
}

// --- 質問ビルダー ------------------------------------------------------------

const BUILDERS = {
  likeAttraction: (step, { state }) => slotQuestion(step, LIKE_ATTRACTION, {
    title: `${mark(likeOf(state))}の、どこに惹かれる？`,
    sub: '2つまで選べます',
    max: 2,
    kind: 'like',
    item: likeOf(state),
  }),

  likeMoment: (step, { state }) => slotQuestion(step, LIKE_MOMENT, {
    title: `${mark(likeOf(state))}で、いちばん満たされるのはどんな瞬間？`,
    sub: 'いちばん近いものを1つ',
    max: 1,
    kind: 'like',
    item: likeOf(state),
  }),

  dislikeWhat: (step, { state }) => slotQuestion(step, DISLIKE_WHAT, {
    title: `${mark(dislikeOf(state))}の、何がいちばんイヤ？`,
    sub: '2つまで選べます',
    max: 2,
    kind: 'dislike',
    item: dislikeOf(state),
  }),

  dislikeInverse: (step, { state }) => slotQuestion(step, DISLIKE_INVERSE, {
    title: `${mark(dislikeOf(state))}がなくなったら、代わりにどうなってほしい？`,
    sub: 'いちばん近いものを1つ',
    max: 1,
    kind: 'dislike',
    item: dislikeOf(state),
  }),

  probe: (step, ctx) => probeQuestion(step, ctx),

  // 動かされ方（自己決定理論の調整様式）は、気持ちそのものではなく「行動を続けている理由」で聞く。
  // 結果の「動かされ方のメモ」に使う（スコアには入れない）
  regulation: (step, { state }) => ({
    title: `${mark(likeOf(state))}を続けているのは、なぜ？`,
    sub: '近いものを2つまで',
    max: 2,
    weight: 0,
    options: [...seededShuffle(REG_OPTIONS, `${step.id}:${likeOf(state)}`), none('正直、よくわからない', { regulation: 'UNK' })],
  }),

  // 自由記述の問いは、AI版では掘った答えに合わせてAIが書く（ctx.freeQuestion）
  ftLike: (step, { state, freeQuestion }) => ({
    title: freeQuestion || `${mark(likeOf(state))}で、忘れられない場面をひとつ教えてください`,
    sub: 'いつ・どこで・誰と・何があった？ そのとき、どう感じた？',
    placeholder: '例：初めて人前で弾いたとき、手が震えたけど、最後に拍手をもらえて泣きそうになった。',
    skippable: true,
  }),

  ftDislike: (step, { state, freeQuestion }) => ({
    title: freeQuestion || `${mark(dislikeOf(state))}で、いちばん許せなかった場面をひとつ教えてください`,
    sub: 'いつ・どこで・何があった？ そのとき、どう感じた？',
    placeholder: '例：後輩が理不尽に怒られているのに、自分も含めて誰も何も言えなかった。',
    skippable: true,
  }),

  bridge: (step, { state, scores, wording }) => {
    const options = bridgeCodes(scores).map((c) => ({
      id: c,
      label: wording?.labels?.[c] || SHARED[c],
      codes: [c],
      tags: { bridge: c },
    }));
    return {
      title: wording?.title || `${mark(likeOf(state))}で満たされるものと、${mark(dislikeOf(state))}で損なわれるもの。2つに共通しているのは？`,
      sub: 'いちばん近いものを1つ',
      context: bridgeContext(state),
      max: 1,
      weight: 1.5,
      options: [...seededShuffle(options, `${step.id}:${options.map((o) => o.id).join()}`), none('つながっていない気がする')],
    };
  },

  finalBoundary: (step, { state }) => boundaryQuestion(step, state, 'any'),

  persona: (step, { state, scores }) => {
    const D = dislikeOf(state);
    const L = likeOf(state);
    const t = topTarget(scores.targets);
    return {
      title: '誰のためのミッションにしたい？',
      sub: 'いちばん届けたい相手を1つ',
      max: 1,
      weight: 0,
      options: [
        { id: 'p_dislike', label: `${mark(D)}に、自分と同じようにモヤモヤしている人`, tags: { target: 'society', persona: `${quote(D)}に、自分と同じようにモヤモヤしている人` } },
        { id: 'p_past', label: '昔の自分と同じところで、つまずいている人', tags: { target: 'close', persona: PAST_PERSONA } },
        { id: 'p_like', label: `${mark(L)}の良さを、まだ知らない人`, tags: { target: 'community', persona: `${quote(L)}の良さを、まだ知らない人` } },
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

  missionCandidates: (step, { state, scores, aiCandidates }) => {
    const list = missionCandidateList(state, scores, aiCandidates);
    const fromAi = list.some((c) => c.source === 'ai');
    return {
      title: 'ミッションの候補です。いちばんしっくりくるのは？',
      sub: fromAi
        ? 'あなたの答えと、書いてくれた言葉からつくった下書きです。言い回しは、このあと直せます'
        : 'ここまでの答えからつくった下書きです。言い回しは、このあと直せます',
      max: 1,
      weight: 0,
      options: [
        ...list.map((c, i) => ({ id: `c${i + 1}`, label: c.text, desc: candidateDesc(c), tags: { meta: c } })),
        none('どれも違う（自分で書く）'),
      ],
    };
  },

  // 言い直し案は、AI版ならAIが候補と一緒に書いたもの、テンプレ版なら決まった言い回し
  missionRefine: (step, { state, scores, aiCandidates }) => {
    const e2 = state.answers.E2?.chosen?.[0];
    const fromScratch = !e2 || e2.none || !e2.meta?.text;
    const base = fromScratch ? missionCandidateList(state, scores, aiCandidates)[0] : e2.meta;
    const v = base.variants || {};
    const modes = [
      { id: 'keep', label: 'このままでいい', draft: base.text },
      { id: 'concrete', label: 'もっと具体的に', draft: v.concrete },
      { id: 'bigger', label: 'もっと大きく', draft: v.bigger },
      { id: 'softer', label: 'もっとやわらかく', draft: v.softer },
    ].filter((m) => m.draft);
    const options = modes.map((m) => ({
      id: m.id,
      label: m.label,
      desc: m.id === 'keep' ? undefined : m.draft,
      tags: { refine: m.id, draft: m.draft },
    }));
    if (fromScratch) options.push({ id: 'blank', label: 'ゼロから自分で書く', tags: { refine: 'blank', draft: '' } });
    return {
      title: fromScratch ? 'いちばん近い案をもとにするなら、どう直す？' : '選んだ案を、どう直す？',
      context: base.text,
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

function resultCopySync({ state, scores, aiCandidates }) {
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
  const regItem = quote(likeOf(state));
  let regulationNote;
  if (pressured) {
    regulationNote = `${regItem}を続ける理由には、${autonomous ? '楽しさや納得に加えて、' : ''}「やらなきゃ」「期待されているから」という気持ちも混ざっているようです。それ自体は悪いことではありません。ただ、楽しさや納得から来る行動のほうが長く続きやすいと言われています。ミッションのどこに「自分で選んだ」感覚があるか、確かめてみてください。`;
  } else if (autonomous) {
    regulationNote = `${regItem}は、楽しさや納得から続けているようです。こうした行動は長く続きやすいと言われています。ミッションにも、この感覚を残しておくと続けやすくなります。`;
  } else {
    regulationNote = `${regItem}を続けている理由は、まだはっきりしません。動きながら確かめていけば大丈夫です。`;
  }

  const chains = chainsOf(state);
  const { bridge } = chains;

  const unknowns = [];
  if (scores.unknown > 0) unknowns.push(`「どれも違う／わからない」を選んだ質問が${scores.unknown}問ありました。そのテーマは、まだ言葉になっていないのかもしれません。`);
  if (scores.ambiguous.length > 2) {
    unknowns.push(`見極めの質問で「どちらとも言えない」が${scores.ambiguous.length}問ありました。似た気持ちどうしの区別は、まだついていません。`);
  } else {
    scores.ambiguous.forEach(([a, b]) => unknowns.push(`「${CODE_INFO[a].name}」と「${CODE_INFO[b].name}」のどちらが強いかは、まだ見分けられていません。`));
  }
  if (!bridge) unknowns.push('好きと嫌いをつなぐものは、まだはっきりしません。');
  if (!chosenPrimary) unknowns.push('いちばん根っこの気持ちは、まだ選ばれていません。いまはスコアの順に並べています。');
  if (!pickedTag(state, 'D1', 'persona')) unknowns.push('誰のためのミッションかは、まだ決まっていません。');
  if (!direction) unknowns.push('ミッションの方向性は、まだ決まっていません。');
  if (['FT1', 'FT2'].some((id) => state.answers[id]?.skipped)) unknowns.push('スキップした自由記述があります。あなた自身の言葉による根拠が少なめです。');
  if (!unknowns.length) unknowns.push('大きな未確定はありません。ただし、これは今日のあなたの答えです。時間をおいて、またやってみてください。');

  // ミッションは2つまで。1つ目は本人が書いた文。
  // 2つ目は「好きと嫌いをつなぐ気持ち」の候補を下書きにする（1つ目と同じなら、次に強い気持ちから）。結果画面で書き換えられる。
  const e2 = state.answers.E2?.chosen?.[0];
  const firstCode = (e2 && !e2.none && e2.meta?.code) || primary;
  const fromBridge = Boolean(bridge) && bridge.code !== firstCode;
  const secondCode = fromBridge ? bridge.code : order.find((c) => c !== firstCode);
  const firstText = (state.answers.FT3?.text || '').trim();
  const missions = [{ code: firstCode, text: firstText || 'ミッションはまだ書かれていません' }];
  if ((hasSignal(scores) || chosenPrimary) && scores.normalized[secondCode] > 0) {
    const base = (aiCandidates?.find((c) => c.code === secondCode) || templateCandidate(state, secondCode)).text;
    const edit = state.mission2Edit?.base === base && state.mission2Edit.text.trim() ? state.mission2Edit.text.trim() : '';
    missions.push({ code: secondCode, text: edit || base, base, editable: true, edited: Boolean(edit), fromBridge });
  }
  // 「動機の組み合わせ」は、2つのミッションのもとになった気持ちにそろえる
  const blendCodes = missions.length > 1 ? missions.map((m) => m.code) : order.slice(0, 2);

  return {
    order,
    missions,
    chains,
    bridge,
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
