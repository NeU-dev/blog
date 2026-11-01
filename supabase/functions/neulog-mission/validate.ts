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

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const length = (value: string) => [...value].length;
const squash = (value: string) => value.replace(/\s+/g, "");

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && length(trimmed) <= max ? trimmed : null;
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
    if (!id || !type || !question || !Array.isArray(raw.slots) || raw.slots.length < 1 || raw.slots.length > SLOT_IDS.length) return null;
    const slots: Slot[] = [];
    for (const rawSlot of raw.slots) {
      if (!isObj(rawSlot)) return null;
      const slot = typeof rawSlot.slot === "string" && SLOT_IDS.includes(rawSlot.slot) ? rawSlot.slot : null;
      const template = text(rawSlot.template, 40);
      if (!slot || !template || slots.some((s) => s.slot === slot)) return null;
      slots.push({ slot, template });
    }
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
    const found = list.find((x) => x.id === q.id);
    const options = found && Array.isArray(found.options) ? found.options.filter(isObj) : [];
    const labels: Record<string, string> = {};
    const used = new Set<string>();
    for (const s of q.slots) {
      const label = cleanLabel(options.find((o) => o.slot === s.slot)?.label);
      if (label && !used.has(label)) {
        labels[s.slot] = label;
        used.add(label);
      }
    }
    result[q.id] = labels;
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
