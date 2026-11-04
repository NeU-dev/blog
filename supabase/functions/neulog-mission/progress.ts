// ミッション・ファインダーの進み具合（何人が、どの問いまで進んだか）。
// 答えの中身は受け取らない。1回の利用（run）ごとに、いちばん先まで進んだ問いと、PDF保存・コピーをしたかだけを残す。

// flow.js の STEPS と同じ順番（最初の説明画面は数えない）。progress_test.ts で照らし合わせる
export const PROGRESS_STEPS = [
  "input",
  "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "FT1",
  "B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "FT2",
  "C1", "C2",
  "D1", "D2", "D3", "D4",
  "E1", "E2", "E3", "FT3",
  "result",
] as const;
export type ProgressStep = typeof PROGRESS_STEPS[number];

// ダッシュボードに出す名前
const STEP_LABELS: Record<ProgressStep, string> = {
  input: "好き・嫌いを書く",
  A1: "好き：惹かれるところ", A2: "好き：満たされる瞬間",
  A3: "好き：掘る問い1", A4: "好き：掘る問い2", A5: "好き：掘る問い3", A6: "好き：掘る問い4", A7: "好き：掘る問い5",
  A8: "好き：続けている理由", FT1: "自由記述1（好きの場面）",
  B1: "嫌い：何がイヤか", B2: "嫌い：代わりにほしい状態",
  B3: "嫌い：掘る問い1", B4: "嫌い：掘る問い2", B5: "嫌い：掘る問い3", B6: "嫌い：掘る問い4", B7: "嫌い：掘る問い5", B8: "嫌い：掘る問い6",
  FT2: "自由記述2（嫌いの場面）",
  C1: "つなぐ問い", C2: "最後の見極め",
  D1: "相手", D2: "方向性", D3: "関わり方", D4: "距離",
  E1: "根っこの気持ち", E2: "ミッション候補", E3: "言い直し", FT3: "自由記述3（自分の言葉で）",
  result: "結果",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENTS = ["pdf", "copy"] as const;

export type ProgressRequest = { run: string; step: ProgressStep; index: number; ai: boolean; event: typeof EVENTS[number] | null };

export function readProgressRequest(body: unknown): ProgressRequest | null {
  if (!body || typeof body !== "object") return null;
  const { run, step, ai, event } = body as Record<string, unknown>;
  if (typeof run !== "string" || !UUID.test(run)) return null;
  const index = PROGRESS_STEPS.indexOf(step as ProgressStep);
  if (index < 0) return null;
  if (event != null && !EVENTS.includes(event as typeof EVENTS[number])) return null;
  return { run: run.toLowerCase(), step: step as ProgressStep, index, ai: ai === true, event: (event ?? null) as ProgressRequest["event"] };
}

export type RunRow = {
  visitor_hash: string;
  furthest_step: string;
  furthest_index: number;
  ai: boolean;
  saved_pdf: boolean;
  copied: boolean;
  started_at: string;
};

const JST_MS = 9 * 60 * 60 * 1000;
const jstDate = (time: number) => new Date(time + JST_MS).toISOString().slice(0, 10);

// 問いごとに「そこまで進んだ回数・人数」を数える。人数は同じ人の何回分かのうち、いちばん先まで進んだ回で数える
export function summarizeFunnel(rows: RunRow[], now = Date.now()) {
  const last = PROGRESS_STEPS.length - 1;
  const furthestOf = (row: RunRow) => {
    const index = PROGRESS_STEPS.indexOf(row.furthest_step as ProgressStep);
    return Math.min(last, Math.max(0, index >= 0 ? index : row.furthest_index));
  };
  const runsAt = new Array(PROGRESS_STEPS.length).fill(0);
  const people = new Map<string, { furthest: number; pdf: boolean; copy: boolean; recent: boolean }>();
  const week = now - 7 * 24 * 60 * 60 * 1000;
  let pdfRuns = 0, copyRuns = 0, aiRuns = 0;
  for (const row of rows) {
    const furthest = furthestOf(row);
    for (let i = 0; i <= furthest; i++) runsAt[i]++;
    if (row.saved_pdf) pdfRuns++;
    if (row.copied) copyRuns++;
    if (row.ai) aiRuns++;
    const person = people.get(row.visitor_hash) || { furthest: 0, pdf: false, copy: false, recent: false };
    person.furthest = Math.max(person.furthest, furthest);
    person.pdf ||= row.saved_pdf;
    person.copy ||= row.copied;
    person.recent ||= new Date(row.started_at).getTime() >= week;
    people.set(row.visitor_hash, person);
  }
  const peopleAt = new Array(PROGRESS_STEPS.length).fill(0);
  for (const person of people.values()) for (let i = 0; i <= person.furthest; i++) peopleAt[i]++;
  const everyone = [...people.values()];

  // 直近14日の、始めた人数と結果まで進んだ人数（日本時間の日付）
  const days = Array.from({ length: 14 }, (_, i) => jstDate(now - (13 - i) * 24 * 60 * 60 * 1000));
  const daily = days.map((date) => {
    const started = new Set<string>(), finished = new Set<string>();
    for (const row of rows) {
      if (jstDate(new Date(row.started_at).getTime()) !== date) continue;
      started.add(row.visitor_hash);
      if (furthestOf(row) === last) finished.add(row.visitor_hash);
    }
    return { date, started: started.size, finished: finished.size };
  });

  return {
    generatedAt: new Date(now).toISOString(),
    startedAt: rows.length ? rows.reduce((min, row) => row.started_at < min ? row.started_at : min, rows[0].started_at) : null,
    runs: rows.length,
    people: people.size,
    last7People: everyone.filter((p) => p.recent).length,
    steps: PROGRESS_STEPS.map((id, i) => ({ id, label: STEP_LABELS[id], runs: runsAt[i], people: peopleAt[i] })),
    finished: { runs: runsAt[last], people: peopleAt[last] },
    pdf: { runs: pdfRuns, people: everyone.filter((p) => p.pdf).length },
    copy: { runs: copyRuns, people: everyone.filter((p) => p.copy).length },
    aiRuns,
    daily,
  };
}
