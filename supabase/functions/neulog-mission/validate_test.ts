// deno test supabase/functions/neulog-mission/validate_test.ts
import { cleanLabel, pickAnalysis, pickLabels, readAnalyzeRequest, readOptionsRequest } from "./validate.ts";

function assertEquals(actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}\n  actual ${a}`);
}

const optionsBody = {
  item: "ギター",
  kind: "like",
  questions: [
    { id: "A1", type: "attraction", question: "「ギター」の、どこに惹かれる？", slots: [{ slot: "K3e", template: "その時間そのものが心地いい" }, { slot: "K6", template: "誰かとつながるきっかけになる" }] },
  ],
};

Deno.test("選択肢のリクエスト：正しい形なら読み取れる", () => {
  const request = readOptionsRequest(optionsBody);
  assertEquals(request?.questions[0].slots.map((s) => s.slot), ["K3e", "K6"]);
});

Deno.test("選択肢のリクエスト：知らないスロットや長すぎる項目は断る", () => {
  assertEquals(readOptionsRequest({ ...optionsBody, item: "あ".repeat(31) }), null);
  assertEquals(readOptionsRequest({ ...optionsBody, questions: [{ ...optionsBody.questions[0], slots: [{ slot: "K9", template: "x" }] }] }), null);
  assertEquals(readOptionsRequest({ ...optionsBody, questions: [{ ...optionsBody.questions[0], id: "Z1" }] }), null);
});

Deno.test("選択肢の文言：句点を落とし、長すぎ・用語入りは捨てる", () => {
  assertEquals(cleanLabel("弦が鳴る瞬間が心地いい。"), "弦が鳴る瞬間が心地いい");
  assertEquals(cleanLabel("あ".repeat(29)), null);
  assertEquals(cleanLabel("承認欲求が満たされる"), null);
  assertEquals(cleanLabel("K3の気持ち"), null);
});

Deno.test("選択肢の出力：頼んだスロットだけ、重複なしで返す", () => {
  const request = readOptionsRequest(optionsBody)!;
  const output = {
    questions: [{
      id: "A1",
      options: [
        { slot: "K3e", label: "弦をはじく時間が心地いい" },
        { slot: "K6", label: "弦をはじく時間が心地いい" },
        { slot: "K7", label: "頼んでいないスロット" },
      ],
    }],
  };
  assertEquals(pickLabels(request, output), { A1: { K3e: "弦をはじく時間が心地いい" } });
  assertEquals(pickLabels(request, { nonsense: true }), { A1: {} });
});

Deno.test("分析のリクエスト：本文が空なら断り、好き・嫌いは3つまで", () => {
  assertEquals(readAnalyzeRequest({ text: "   " }), null);
  const request = readAnalyzeRequest({ text: "楽しかった", likes: ["a", "b", "c", "d", 5] });
  assertEquals(request?.likes, ["a", "b", "c"]);
});

Deno.test("分析の出力：本文にない引用・重複・不正なコードは捨てる", () => {
  const text = "同期が理不尽に怒られていて、おかしいと思った。\nみんなで助け合える職場ならよかった。";
  const output = {
    codes: [
      { code: "K2", quote: "おかしいと思った", basis: "testimony" },
      { code: "K2", quote: "理不尽に怒られていて", basis: "testimony" },
      { code: "K6", quote: "みんなで 助け合える職場", basis: "inference" },
      { code: "K1", quote: "本文にない言葉", basis: "testimony" },
      { code: "K9", quote: "おかしい", basis: "testimony" },
    ],
    safety: "none",
  };
  assertEquals(pickAnalysis(text, output), {
    codes: [
      { code: "K2", quote: "おかしいと思った", basis: "testimony" },
      { code: "K6", quote: "みんなで 助け合える職場", basis: "inference" },
    ],
    safety: "none",
  });
  assertEquals(pickAnalysis(text, { codes: "x", safety: "concern" }), { codes: [], safety: "concern" });
});
