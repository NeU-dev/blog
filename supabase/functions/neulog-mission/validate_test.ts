// deno test supabase/functions/neulog-mission/validate_test.ts
import {
  cleanLabel, cleanMission, pickAnalysis, pickAsk, pickLabels, pickMissions, pickPlan, pickReflection,
  readAnalyzeRequest, readAskRequest, readMissionsRequest, readOptionsRequest, readPlanRequest, readReflectRequest,
} from "./validate.ts";

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

const material = {
  likes: ["ゲーム"],
  dislikes: ["Xがやめれない"],
  answers: [{ item: "ゲーム", kind: "like", picks: ["仲間と同じ画面を囲んで盛り上がれたとき"] }],
  episode: { about: "ゲーム", text: "知らない人と協力してボスを倒したとき、すごく楽しかった。" },
  why: { text: "一人で抱えこんでいた時期があったから。" },
  persona: "",
  direction: "",
  roles: ["つくる"],
  distance: "副業・週末に",
};

Deno.test("ミッションの文：「こと」で終わる45文字程度まで", () => {
  assertEquals(cleanMission("ゲームで知らない人どうしが協力できる場をつくること。"), "ゲームで知らない人どうしが協力できる場をつくること");
  assertEquals(cleanMission("ゲームで人をつなぐ"), null);
  assertEquals(cleanMission(`${"あ".repeat(47)}こと`), null);
});

Deno.test("ミッション候補のリクエスト：知らない気持ちは落とし、材料が無ければ断る", () => {
  assertEquals(readMissionsRequest({ ...material, codes: ["K6", "K9", "K6", "K3"] })?.codes, ["K6", "K3"]);
  assertEquals(readMissionsRequest({ ...material, codes: [] }), null);
  assertEquals(readMissionsRequest({ ...material, likes: [], codes: ["K6"] }), null);
});

Deno.test("ミッション候補の出力：頼んだ気持ちだけ・引用は本人の言葉だけ", () => {
  const request = readMissionsRequest({ ...material, codes: ["K6", "K3"] })!;
  const output = {
    candidates: [
      { code: "K6", text: "ゲームで、知らない人どうしが協力できる場をつくること", basis: "知らない人と協力してボスを倒した", variants: { concrete: "週末に、ゲーム好きが協力して遊べる会を開くこと", bigger: "遊び", softer: "一緒に遊べる人を、少しずつ増やすこと" } },
      { code: "K3", text: "ゲームで、知らない人どうしが協力できる場をつくること", basis: "", variants: { concrete: "", bigger: "", softer: "" } },
      { code: "K2", text: "頼んでいない気持ちのこと", basis: "", variants: { concrete: "", bigger: "", softer: "" } },
    ],
  };
  assertEquals(pickMissions(request, output), {
    candidates: [{
      code: "K6",
      text: "ゲームで、知らない人どうしが協力できる場をつくること",
      basis: "知らない人と協力してボスを倒した",
      variants: { concrete: "週末に、ゲーム好きが協力して遊べる会を開くこと", bigger: null, softer: "一緒に遊べる人を、少しずつ増やすこと" },
    }],
  });
  const madeUp = pickMissions(request, { candidates: [{ ...output.candidates[0], basis: "本人が書いていない言葉" }] });
  assertEquals(madeUp.candidates[0].basis, "");
});

Deno.test("結果の読み解き：引用は本人の言葉かミッションから、項目は3つまで", () => {
  const request = readReflectRequest({ ...material, missions: [{ code: "K6", text: "ゲームで人と人をつなぐこと" }, { code: "K9", text: "x" }] })!;
  assertEquals(request.missions.length, 1);
  const reflection = pickReflection(request, {
    reading: "「知らない人と協力」した時間が、いちばん楽しかったようです。",
    quotes: ["知らない人と協力してボスを倒した", "書いていない言葉", "人と人をつなぐ"],
    ideas: ["a", "b", "c", "d", "あ".repeat(51)],
    firstStep: "週末に、ゲーム仲間を1人誘ってみる",
    question: "どうすれば、知らない人どうしが一緒に遊べますか？",
  });
  assertEquals(reflection.quotes, ["知らない人と協力してボスを倒した", "人と人をつなぐ"]);
  assertEquals(reflection.ideas, ["a", "b", "c"]);
  assertEquals(reflection.firstStep, "週末に、ゲーム仲間を1人誘ってみる");
});

const planBody = {
  side: "like",
  item: "ゲーム",
  other: "Xがやめれない",
  answers: [{ question: "「ゲーム」の、どこに惹かれる？", answer: "誰かとつながるきっかけになる" }],
  focus: ["つながっていたい", "味わいたい・知りたい"],
  count: 3,
  menu: [
    { type: "why", purpose: "一段上の理由", live: false, fixed: false, question: "その瞬間、何を手に入れている？", slots: [{ slot: "K6", template: "誰かと一緒にいる安心" }, { slot: "K3e", template: "時間を忘れる没頭" }] },
    { type: "value", purpose: "なぜうれしいか", live: true, fixed: false, question: "", slots: [] },
    { type: "boundary", purpose: "見極め", live: false, fixed: true, question: "", slots: [] },
  ],
};

Deno.test("計画のリクエスト：知らない型や、文言を書く型にスロットが無いものは断る", () => {
  assertEquals(readPlanRequest(planBody)?.menu.map((m) => m.type), ["why", "value", "boundary"]);
  assertEquals(readPlanRequest({ ...planBody, menu: [{ ...planBody.menu[0], type: "hack" }] }), null);
  assertEquals(readPlanRequest({ ...planBody, menu: [{ ...planBody.menu[0], slots: [] }] }), null);
  assertEquals(readPlanRequest({ ...planBody, count: 20 }), null);
});

Deno.test("計画の出力：メニューの型だけ・文言は書いてよい型だけ・問いは「？」で終わるものだけ", () => {
  const request = readPlanRequest(planBody)!;
  const plan = pickPlan(request, {
    probes: [
      { type: "why", reason: "瞬間の中身を確かめる", title: "一緒に遊べたとき、何を手に入れている？", options: [{ slot: "K6", label: "仲間がいる安心" }, { slot: "K9", label: "x" }] },
      { type: "hack", reason: "", title: "", options: [] },
      { type: "value", reason: "価値を聞く", title: "勝手に書いた問い？", options: [{ slot: "K6", label: "x" }] },
      { type: "boundary", reason: "", title: "問いではない文", options: [] },
      { type: "why", reason: "", title: "", options: [] },
    ],
    freeQuestion: "「ゲーム」で、忘れられない場面はどんなとき？",
  });
  assertEquals(plan.probes.map((p) => p.type), ["why", "value", "boundary"]);
  assertEquals(plan.probes[0], { type: "why", reason: "瞬間の中身を確かめる", title: "一緒に遊べたとき、何を手に入れている？", labels: { K6: "仲間がいる安心" } });
  assertEquals(plan.probes[1].title, "");
  assertEquals(plan.freeQuestion, "「ゲーム」で、忘れられない場面はどんなとき？");
});

Deno.test("その場の問い：材料が無ければ断り、頼んだスロットだけ返す", () => {
  const body = { kind: "value", item: "ゲーム", context: [{ question: "何を手に入れている？", answer: "誰かと一緒にいる安心" }], title: "なぜうれしい？", slots: [{ slot: "K6", template: "ひとりじゃないと思える" }, { slot: "K5", template: "自分を信じられる" }] };
  assertEquals(readAskRequest({ ...body, context: [] }), null);
  const request = readAskRequest(body)!;
  assertEquals(pickAsk(request, { title: "「一緒にいる安心」が、なぜうれしい？", options: [{ slot: "K6", label: "ひとりじゃないと思えるから" }, { slot: "K1", label: "x" }] }),
    { title: "「一緒にいる安心」が、なぜうれしい？", labels: { K6: "ひとりじゃないと思えるから" } });
  assertEquals(pickAsk(request, { title: "問いではない", options: [] }).title, "");
});
