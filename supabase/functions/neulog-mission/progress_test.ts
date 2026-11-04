// deno test supabase/functions/neulog-mission/progress_test.ts
import { PROGRESS_STEPS, readProgressRequest, type RunRow, summarizeFunnel } from "./progress.ts";
import { STEPS } from "../../../src/lib/mission-finder/flow.js";

function assertEquals(actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}\n  actual ${a}`);
}

const RUN = "3f1c2b9e-8d7a-4c6b-9e5f-1a2b3c4d5e6f";
const hash = (n: number) => String(n).padStart(64, "0");
const row = (visitor: number, step: string, extra: Partial<RunRow> = {}): RunRow => ({
  visitor_hash: hash(visitor),
  furthest_step: step,
  furthest_index: PROGRESS_STEPS.indexOf(step as typeof PROGRESS_STEPS[number]),
  ai: false,
  saved_pdf: false,
  copied: false,
  started_at: "2026-11-04T03:00:00.000Z",
  ...extra,
});

Deno.test("進み具合の問いの並びは、画面の流れ（flow.js）と同じ", () => {
  assertEquals([...PROGRESS_STEPS], STEPS.map((s: { id: string }) => s.id).filter((id: string) => id !== "intro"));
});

Deno.test("進み具合は、決まった問いと run の形だけ受け取る", () => {
  assertEquals(readProgressRequest({ run: RUN.toUpperCase(), step: "B3", ai: true }), { run: RUN, step: "B3", index: 12, ai: true, event: null });
  assertEquals(readProgressRequest({ run: RUN, step: "result", event: "pdf" })?.event, "pdf");
  assertEquals(readProgressRequest({ run: RUN, step: "intro" }), null);
  assertEquals(readProgressRequest({ run: RUN, step: "Z9" }), null);
  assertEquals(readProgressRequest({ run: "not-a-uuid", step: "A1" }), null);
  assertEquals(readProgressRequest({ run: RUN, step: "A1", event: "share" }), null);
  assertEquals(readProgressRequest(null), null);
});

Deno.test("集計は、その問いまで進んだ回数と人数を数える", () => {
  const rows = [
    row(1, "A3"),
    row(1, "result", { saved_pdf: true, ai: true }), // 同じ人の2回目。人数はいちばん先まで進んだ回で数える
    row(2, "input"),
    row(3, "FT2", { copied: true }),
  ];
  const funnel = summarizeFunnel(rows, Date.parse("2026-11-04T12:00:00.000Z"));
  const at = (id: string) => funnel.steps.find((s) => s.id === id)!;
  assertEquals([funnel.runs, funnel.people], [4, 3]);
  assertEquals([at("input").runs, at("input").people], [4, 3]);
  assertEquals([at("A3").runs, at("A3").people], [3, 2]);
  assertEquals([at("B1").runs, at("B1").people], [2, 2]);
  assertEquals([at("C1").runs, at("C1").people], [1, 1]);
  assertEquals(funnel.finished, { runs: 1, people: 1 });
  assertEquals(funnel.pdf, { runs: 1, people: 1 });
  assertEquals(funnel.copy, { runs: 1, people: 1 });
  assertEquals(funnel.aiRuns, 1);
  assertEquals(funnel.last7People, 3);
  assertEquals(funnel.daily.at(-1), { date: "2026-11-04", started: 3, finished: 1 });
  assertEquals(at("A1").label, "好き：惹かれるところ");
});

Deno.test("記録がなくても集計は壊れない", () => {
  const funnel = summarizeFunnel([]);
  assertEquals([funnel.runs, funnel.people, funnel.startedAt, funnel.steps.length], [0, 0, null, PROGRESS_STEPS.length]);
});
