// リクエストの読み取りと、AIの出力の検査。外部に依存しない純粋な関数だけを置く（validate_test.ts でテストする）。

export const SLOT_IDS = ["K1", "K2", "K3e", "K3x", "K4", "K5", "K6", "K7"];
export const CODES = ["K1", "K2", "K3", "K4", "K5", "K6", "K7"];
const QUESTION_TYPES = ["attraction", "moment", "what", "inverse"];
// 選択肢に出てほしくない言葉（コード名・心理学用語）
const FORBIDDEN = ["自己実現", "承認欲求", "正義感", "内発", "外発", "動機", "スロット", ...CODES];
export const MAX_LABEL = 28;

export type Slot = { slot: string; template: string };
export type OptionsQuestion = { id: string; type: string; question: string; slots: Slot[] };
export type OptionsRequest = { item: string; kind: "like" | "dislike"; questions: OptionsQuestion[] };
export type AnalyzeRequest = { question: string; text: string; likes: string[]; dislikes: string[] };
export type CodeHit = { code: string; quote: string; basis: "testimony" | "inference" };
export type Analysis = { codes: CodeHit[]; safety: "none" | "concern" };

// ミッション候補と結果の読み解きに渡す、本人の材料
export type ItemAnswers = { item: string; kind: "like" | "dislike"; picks: string[] };
export type Material = {
  likes: string[];
  dislikes: string[];
  answers: ItemAnswers[];
  episode: { about: string; text: string };
  why: { text: string };
  persona: string;
  direction: string;
  roles: string[];
  distance: string;
};
export type MissionsRequest = Material & { codes: string[] };
export type Variants = { concrete: string | null; bigger: string | null; softer: string | null };
export type Candidate = { code: string; text: string; basis: string; variants: Variants };
export type ReflectRequest = Material & { missions: { code: string; text: string }[] };
export type Reflection = { reading: string; quotes: string[]; ideas: string[]; firstStep: string; question: string };

export const MAX_MISSION = 48;

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const length = (value: string) => [...value].length;
const squash = (value: string) => value.replace(/\s+/g, "");

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && length(trimmed) <= max ? trimmed : null;
}

function readSlots(value: unknown, min: number, max: number): Slot[] | null {
  if (!Array.isArray(value) || value.length < min || value.length > max) return null;
  const slots: Slot[] = [];
  for (const raw of value) {
    if (!isObj(raw)) return null;
    const slot = typeof raw.slot === "string" && SLOT_IDS.includes(raw.slot) ? raw.slot : null;
    const template = text(raw.template, 40);
    if (!slot || !template || slots.some((s) => s.slot === slot)) return null;
    slots.push({ slot, template });
  }
  return slots;
}

// スロットごとに1つ。長すぎ・用語入り・ほかのスロットと同じ文は捨てる（足りない分は画面側でテンプレ文言を使う）
function pickSlotLabels(slots: Slot[], options: unknown): Record<string, string> {
  const list = Array.isArray(options) ? options.filter(isObj) : [];
  const labels: Record<string, string> = {};
  const used = new Set<string>();
  for (const s of slots) {
    const label = cleanLabel(list.find((o) => o.slot === s.slot)?.label);
    if (label && !used.has(label)) {
      labels[s.slot] = label;
      used.add(label);
    }
  }
  return labels;
}

export function readOptionsRequest(body: unknown): OptionsRequest | null {
  if (!isObj(body)) return null;
  const item = text(body.item, 30);
  const kind = body.kind === "like" || body.kind === "dislike" ? body.kind : null;
  if (!item || !kind || !Array.isArray(body.questions) || body.questions.length < 1 || body.questions.length > 2) return null;

  const questions: OptionsQuestion[] = [];
  for (const raw of body.questions) {
    if (!isObj(raw)) return null;
    const id = typeof raw.id === "string" && /^[AB][1-6]$/.test(raw.id) ? raw.id : null;
    const type = typeof raw.type === "string" && QUESTION_TYPES.includes(raw.type) ? raw.type : null;
    const question = text(raw.question, 120);
    if (!id || !type || !question) return null;
    const slots = readSlots(raw.slots, 1, SLOT_IDS.length);
    if (!slots) return null;
    questions.push({ id, type, question, slots });
  }
  return { item, kind, questions };
}

export function cleanLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const label = value.replace(/\s+/g, " ").trim().replace(/[。．.]+$/, "");
  if (!label || length(label) > MAX_LABEL || /[<>]/.test(label)) return null;
  if (FORBIDDEN.some((word) => label.includes(word))) return null;
  return label;
}

// 頼んだスロットのうち、きちんと書けているものだけ返す。足りないスロットは画面側でテンプレ文言を使う。
export function pickLabels(request: OptionsRequest, output: unknown): Record<string, Record<string, string>> {
  const list = isObj(output) && Array.isArray(output.questions) ? output.questions.filter(isObj) : [];
  const result: Record<string, Record<string, string>> = {};
  for (const q of request.questions) {
    result[q.id] = pickSlotLabels(q.slots, list.find((x) => x.id === q.id)?.options);
  }
  return result;
}

export function readAnalyzeRequest(body: unknown): AnalyzeRequest | null {
  if (!isObj(body)) return null;
  const freeText = text(body.text, 600);
  if (!freeText) return null;
  const question = typeof body.question === "string" ? body.question.trim().slice(0, 200) : "";
  const items = (value: unknown) => (Array.isArray(value) ? value : [])
    .map((v) => text(v, 30))
    .filter((v): v is string => Boolean(v))
    .slice(0, 3);
  return { question, text: freeText, likes: items(body.likes), dislikes: items(body.dislikes) };
}

// 引用が本人の文章に実在するものだけを残す（言い換えや作り話の引用を落とす）
export function pickAnalysis(sourceText: string, output: unknown): Analysis {
  const raw = isObj(output) && Array.isArray(output.codes) ? output.codes.filter(isObj) : [];
  const seen = new Set<string>();
  const codes: CodeHit[] = [];
  for (const c of raw) {
    const code = typeof c.code === "string" && CODES.includes(c.code) ? c.code : null;
    const basis = c.basis === "testimony" || c.basis === "inference" ? c.basis : null;
    const quote = typeof c.quote === "string" ? c.quote.trim() : "";
    if (!code || !basis || seen.has(code)) continue;
    if (!quote || length(quote) > 80 || !squash(sourceText).includes(squash(quote))) continue;
    seen.add(code);
    codes.push({ code, quote, basis });
  }
  const safety = isObj(output) && output.safety === "concern" ? "concern" : "none";
  return { codes, safety };
}

// --- ミッション候補・結果の読み解き ---------------------------------------------

// 文として出すものの検査。長すぎ・タグ入り・用語入りは捨てる。keepPeriod なら文末の句点を残す
export function cleanSentence(value: unknown, max: number, keepPeriod = false): string | null {
  if (typeof value !== "string") return null;
  let sentence = value.replace(/\s+/g, " ").trim();
  if (!keepPeriod) sentence = sentence.replace(/[。．.]+$/, "");
  if (!sentence || length(sentence) > max || /[<>]/.test(sentence)) return null;
  if (FORBIDDEN.some((word) => sentence.includes(word))) return null;
  return sentence;
}

// ミッションは「〜こと」で終わる一文（ブログ記事の例「ものづくりの楽しさを伝播すること」と同じ形）
export function cleanMission(value: unknown): string | null {
  const mission = cleanSentence(value, MAX_MISSION);
  return mission && mission.endsWith("こと") ? mission : null;
}

const strings = (value: unknown, max: number, count: number) => (Array.isArray(value) ? value : [])
  .map((v) => text(v, max))
  .filter((v): v is string => Boolean(v))
  .slice(0, count);
const optional = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

function readMaterial(body: Obj): Material | null {
  const likes = strings(body.likes, 30, 3);
  const dislikes = strings(body.dislikes, 30, 3);
  if (!likes.length || !dislikes.length) return null;
  const answers = (Array.isArray(body.answers) ? body.answers : []).filter(isObj).slice(0, 6)
    .map((a): ItemAnswers => ({ item: optional(a.item, 30), kind: a.kind === "dislike" ? "dislike" : "like", picks: strings(a.picks, 40, 12) }))
    .filter((a) => a.item);
  const episode = isObj(body.episode) ? body.episode : {};
  const why = isObj(body.why) ? body.why : {};
  return {
    likes,
    dislikes,
    answers,
    episode: { about: optional(episode.about, 30), text: optional(episode.text, 600) },
    why: { text: optional(why.text, 600) },
    persona: optional(body.persona, 60),
    direction: optional(body.direction, 80),
    roles: strings(body.roles, 20, 3),
    distance: optional(body.distance, 20),
  };
}

// 引用の照合に使う、本人が書いた文字だけ（選択肢の文言はAIが書いたものもあるので含めない）
function ownWords(material: Material, extra: string[] = []) {
  return squash([...material.likes, ...material.dislikes, material.episode.about, material.episode.text, material.why.text, ...extra].join("\n"));
}

function quoteFrom(source: string, value: unknown, max = 40): string {
  const quote = typeof value === "string" ? value.trim().replace(/^「|」$/g, "") : "";
  return quote && length(quote) <= max && source.includes(squash(quote)) ? quote : "";
}

export function readMissionsRequest(body: unknown): MissionsRequest | null {
  if (!isObj(body)) return null;
  const material = readMaterial(body);
  if (!material || !Array.isArray(body.codes)) return null;
  const codes = [...new Set(body.codes.filter((c): c is string => typeof c === "string" && CODES.includes(c)))].slice(0, 5);
  return codes.length ? { ...material, codes } : null;
}

// 頼んだ気持ちごとに1つ。「こと」で終わらない・長すぎる・同じ文の候補は捨てる（足りない分は画面側でテンプレ文を使う）
export function pickMissions(request: MissionsRequest, output: unknown): { candidates: Candidate[] } {
  const list = isObj(output) && Array.isArray(output.candidates) ? output.candidates.filter(isObj) : [];
  const source = ownWords(request);
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const code of request.codes) {
    const found = list.find((c) => c.code === code);
    const mission = found ? cleanMission(found.text) : null;
    if (!found || !mission || seen.has(mission)) continue;
    seen.add(mission);
    const v = isObj(found.variants) ? found.variants : {};
    candidates.push({
      code,
      text: mission,
      basis: quoteFrom(source, found.basis),
      variants: { concrete: cleanMission(v.concrete), bigger: cleanMission(v.bigger), softer: cleanMission(v.softer) },
    });
  }
  return { candidates };
}

export function readReflectRequest(body: unknown): ReflectRequest | null {
  if (!isObj(body)) return null;
  const material = readMaterial(body);
  if (!material || !Array.isArray(body.missions)) return null;
  const missions = body.missions.filter(isObj).slice(0, 2)
    .map((m) => ({ code: typeof m.code === "string" && CODES.includes(m.code) ? m.code : "", text: text(m.text, 200) || "" }))
    .filter((m) => m.code && m.text);
  return missions.length ? { ...material, missions } : null;
}

export function pickReflection(request: ReflectRequest, output: unknown): Reflection {
  const o = isObj(output) ? output : {};
  const source = ownWords(request, request.missions.map((m) => m.text));
  const list = (value: unknown) => (Array.isArray(value) ? value : []);
  const quotes = [...new Set(list(o.quotes).map((q) => quoteFrom(source, q)).filter(Boolean))].slice(0, 3);
  const ideas = [...new Set(list(o.ideas).map((i) => cleanSentence(i, 50)).filter((i): i is string => Boolean(i)))].slice(0, 3);
  return {
    reading: cleanSentence(o.reading, 200, true) || "",
    quotes,
    ideas,
    firstStep: cleanSentence(o.firstStep, 80) || "",
    question: cleanSentence(o.question, 60, true) || "",
  };
}

// --- 掘る問いの計画（型の順番と文言）・その場で書く問い ------------------------------------

export const PROBE_TYPES = ["why", "value", "loss", "exception", "spread", "origin", "boundary", "who", "reaction", "power"];
export type QA = { question: string; answer: string };
export type MenuItem = { type: string; purpose: string; live: boolean; fixed: boolean; question: string; slots: Slot[] };
export type PlanRequest = {
  side: "like" | "dislike";
  item: string;
  other: string;
  answers: QA[];
  episode: string;
  focus: string[];
  count: number;
  menu: MenuItem[];
};
export type PlannedProbe = { type: string; reason: string; title: string; labels: Record<string, string> };
export type Plan = { probes: PlannedProbe[]; freeQuestion: string };
export type AskRequest = { kind: "value" | "bridge"; side: string; item: string; other: string; context: QA[]; title: string; slots: Slot[] };
export type Asked = { title: string; labels: Record<string, string> };

function readQAs(value: unknown, max: number): QA[] {
  return (Array.isArray(value) ? value : []).filter(isObj).slice(0, max)
    .map((qa) => ({ question: optional(qa.question, 120), answer: optional(qa.answer, 120) }))
    .filter((qa) => qa.question && qa.answer);
}

// 問いは「？」で終わる一文
function cleanQuestion(value: unknown, max = 70): string | null {
  const question = cleanSentence(value, max, true);
  return question && /[？?]$/.test(question) ? question : null;
}

export function readPlanRequest(body: unknown): PlanRequest | null {
  if (!isObj(body)) return null;
  const side = body.side === "like" || body.side === "dislike" ? body.side : null;
  const item = text(body.item, 30);
  const count = typeof body.count === "number" && Number.isInteger(body.count) && body.count >= 1 && body.count <= 8 ? body.count : null;
  if (!side || !item || !count || !Array.isArray(body.menu) || body.menu.length < 1 || body.menu.length > 12) return null;
  const menu: MenuItem[] = [];
  for (const raw of body.menu) {
    if (!isObj(raw)) return null;
    const type = typeof raw.type === "string" && PROBE_TYPES.includes(raw.type) ? raw.type : null;
    const purpose = text(raw.purpose, 120);
    const live = raw.live === true;
    const fixed = raw.fixed === true;
    const slots = live || fixed ? [] : readSlots(raw.slots, 2, SLOT_IDS.length);
    if (!type || !purpose || !slots || menu.some((m) => m.type === type)) return null;
    menu.push({ type, purpose, live, fixed, question: optional(raw.question, 120), slots });
  }
  return {
    side,
    item,
    other: optional(body.other, 30),
    answers: readQAs(body.answers, 12),
    episode: optional(body.episode, 600),
    focus: strings(body.focus, 20, 7),
    count,
    menu,
  };
}

// メニューにある型だけ。文言は、AIが書いてよい型（live でも fixed でもないもの）だけ残す。
// 順番の決まり（「なぜ」を入れる、見極めは2回まで など）は画面側でそろえる
export function pickPlan(request: PlanRequest, output: unknown): Plan {
  const list = isObj(output) && Array.isArray(output.probes) ? output.probes.filter(isObj) : [];
  const probes: PlannedProbe[] = [];
  for (const p of list) {
    const m = request.menu.find((x) => x.type === p.type);
    if (!m) continue;
    const writable = !m.live && !m.fixed;
    probes.push({
      type: m.type,
      reason: cleanSentence(p.reason, 60) || "",
      title: writable ? cleanQuestion(p.title) || "" : "",
      labels: writable ? pickSlotLabels(m.slots, p.options) : {},
    });
    if (probes.length === request.count) break;
  }
  const freeQuestion = isObj(output) ? cleanSentence(output.freeQuestion, 90, true) || "" : "";
  return { probes, freeQuestion };
}

export function readAskRequest(body: unknown): AskRequest | null {
  if (!isObj(body)) return null;
  const kind = body.kind === "value" || body.kind === "bridge" ? body.kind : null;
  const item = text(body.item, 30);
  const title = text(body.title, 120);
  const context = readQAs(body.context, 12);
  const slots = readSlots(body.slots, 2, 8);
  if (!kind || !item || !title || !context.length || !slots) return null;
  return { kind, side: optional(body.side, 10), item, other: optional(body.other, 30), context, title, slots };
}

export function pickAsk(request: AskRequest, output: unknown): Asked {
  const o = isObj(output) ? output : {};
  return { title: cleanQuestion(o.title) || "", labels: pickSlotLabels(request.slots, o.options) };
}
