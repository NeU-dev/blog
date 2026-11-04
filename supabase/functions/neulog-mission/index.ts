// ミッション・ファインダーのAI部分（選択肢の言い換え・掘る問いの組み立て・自由記述の分析・ミッション候補・結果の読み解き）。
// APIキーはここ（Supabase の secret）にだけ置き、ブラウザには出さない。
// 誰でも使えるが、1人あたりとサイト全体の1日の回数に上限をかける。上限を超えたら 429 を返し、
// 画面側はテンプレートの選択肢で続ける。
//
// 必要な secret：ANTHROPIC_API_KEY
// 任意の secret：MISSION_MODEL（既定 claude-haiku-5-5）、MISSION_VISITOR_DAILY_LIMIT（既定 30 回）、
//               MISSION_DAILY_LIMIT（サイト全体、既定 800 回）、MISSION_AI_ENABLED（"false" で停止）
//
// 手元で試すとき（docs/mission-finder.md）は MISSION_LOCAL=1 を付けて deno で直接動かす。
// そのときは Supabase につながず、回数制限もかけない。

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import {
  ANALYZE_SCHEMA, ANALYZE_SYSTEM, analyzeUserMessage, ASK_SCHEMA, ASK_SYSTEM, askUserMessage, MISSIONS_SCHEMA, MISSIONS_SYSTEM,
  missionsUserMessage, OPTIONS_SCHEMA, OPTIONS_SYSTEM, optionsUserMessage, PLAN_SCHEMA, PLAN_SYSTEM, planUserMessage, REFLECT_SCHEMA,
  REFLECT_SYSTEM, reflectUserMessage,
} from "./prompts.ts";
import {
  pickAnalysis, pickAsk, pickLabels, pickMissions, pickPlan, pickReflection, readAnalyzeRequest, readAskRequest, readMissionsRequest,
  readOptionsRequest, readPlanRequest, readReflectRequest,
} from "./validate.ts";

// 短い文章の言い換え・読み取り・下書きなので、速くて安い Haiku で十分。
const MODEL = Deno.env.get("MISSION_MODEL") || "claude-haiku-5-5";
// 安全分類で断られたときに別モデルで自動でやり直す機能。使えるモデルのときだけ有効にする（Haiku には無い）。
const USE_FALLBACK = /^claude-(opus-5|sonnet-5-5|fable-5)/.test(MODEL);
// 1回通すと、選択肢2回＋掘る問いの計画2回＋その場の問い3回＋自由記述2回＋ミッション候補1回＋結果1回で、およそ11回
const VISITOR_DAILY_LIMIT = Number(Deno.env.get("MISSION_VISITOR_DAILY_LIMIT") || 30);
const SITE_DAILY_LIMIT = Number(Deno.env.get("MISSION_DAILY_LIMIT") || 800);
const API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const AI_ENABLED = Boolean(API_KEY) && Deno.env.get("MISSION_AI_ENABLED") !== "false";
const LOCAL = Deno.env.get("MISSION_LOCAL") === "1";
const DAY_MINUTES = 24 * 60;

const headers = {
  "Access-Control-Allow-Headers": "content-type, x-neulog-visitor",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
};
const allowedOrigins = new Set([
  "https://neu-dev.net",
  "http://localhost:4321",
  "http://127.0.0.1:4321",
]);
const supabase = LOCAL ? null : createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anthropic = AI_ENABLED ? new Anthropic({ apiKey: API_KEY }) : null;

class RefusedError extends Error {}

async function sha256(value: string) {
  const data = new TextEncoder().encode(value);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)))
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function visitorSource(req: Request) {
  const visitor = (req.headers.get("x-neulog-visitor") || "").slice(0, 80);
  const forwarded = (req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "").split(",")[0].trim();
  return `${visitor}:${forwarded}:${Deno.env.get("VISITOR_SALT") || "neulog"}`;
}
// neulog-community と同じ、neulog_rate_limits を使った回数制限
async function rateLimit(visitorHash: string, action: string, limit: number, minutes: number) {
  if (!supabase) return true; // 手元モード
  const now = Date.now();
  const { data } = await supabase.from("neulog_rate_limits").select("*").eq("visitor_hash", visitorHash).eq("action", action).maybeSingle();
  if (!data || now - new Date(data.window_started_at).getTime() > minutes * 60_000) {
    await supabase.from("neulog_rate_limits").upsert({ visitor_hash: visitorHash, action, request_count: 1, window_started_at: new Date().toISOString() });
    return true;
  }
  if (data.request_count >= limit) return false;
  await supabase.from("neulog_rate_limits").update({ request_count: data.request_count + 1 }).eq("visitor_hash", visitorHash).eq("action", action);
  return true;
}
async function withinDailyLimits(req: Request) {
  const visitorHash = await sha256(visitorSource(req));
  if (!await rateLimit(visitorHash, "mission_ai", VISITOR_DAILY_LIMIT, DAY_MINUTES)) return false;
  const siteHash = await sha256(`mission-site:${Deno.env.get("VISITOR_SALT") || "neulog"}`);
  return rateLimit(siteHash, "mission_ai_site", SITE_DAILY_LIMIT, DAY_MINUTES);
}

async function askClaude(system: string, user: string, schema: Record<string, unknown>, effort: "low" | "medium") {
  const response = await anthropic!.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    ...(USE_FALLBACK ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    output_config: { effort, format: { type: "json_schema", schema } },
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
  });
  if (response.stop_reason === "refusal") throw new RefusedError("refused");
  if (response.stop_reason === "max_tokens") throw new Error("max_tokens");
  const block = response.content.find(b => b.type === "text");
  if (!block || block.type !== "text") throw new Error("no_text");
  return JSON.parse(block.text) as unknown;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const responseHeaders = {
    ...headers,
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://neu-dev.net",
    "Vary": "Origin",
  };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: responseHeaders });
  if (req.method === "OPTIONS") return new Response("ok", { headers: responseHeaders });

  try {
    const action = new URL(req.url).searchParams.get("action") || "";
    if (req.method === "GET" && action === "status") return json({ ai: AI_ENABLED });
    if (req.method !== "POST") return json({ error: "not_found" }, 404);
    if (!AI_ENABLED) return json({ error: "ai_disabled" }, 503);
    const body = await req.json().catch(() => null);

    if (action === "options") {
      const request = readOptionsRequest(body);
      if (!request) return json({ error: "invalid_request" }, 400);
      if (!await withinDailyLimits(req)) return json({ error: "daily_limit" }, 429);
      const output = await askClaude(OPTIONS_SYSTEM, optionsUserMessage(request), OPTIONS_SCHEMA, "low");
      return json({ questions: pickLabels(request, output) });
    }

    if (action === "analyze") {
      const request = readAnalyzeRequest(body);
      if (!request) return json({ error: "invalid_request" }, 400);
      if (!await withinDailyLimits(req)) return json({ error: "daily_limit" }, 429);
      const output = await askClaude(ANALYZE_SYSTEM, analyzeUserMessage(request), ANALYZE_SCHEMA, "medium");
      return json(pickAnalysis(request.text, output));
    }

    if (action === "plan") {
      const request = readPlanRequest(body);
      if (!request) return json({ error: "invalid_request" }, 400);
      if (!await withinDailyLimits(req)) return json({ error: "daily_limit" }, 429);
      // 答えを待たせないよう軽めに考えさせる（型の選び方は決まりで縛り、崩れた分は画面側で直す）
      const output = await askClaude(PLAN_SYSTEM, planUserMessage(request), PLAN_SCHEMA, "low");
      return json(pickPlan(request, output));
    }

    if (action === "ask") {
      const request = readAskRequest(body);
      if (!request) return json({ error: "invalid_request" }, 400);
      if (!await withinDailyLimits(req)) return json({ error: "daily_limit" }, 429);
      const output = await askClaude(ASK_SYSTEM, askUserMessage(request), ASK_SCHEMA, "low");
      return json(pickAsk(request, output));
    }

    if (action === "missions") {
      const request = readMissionsRequest(body);
      if (!request) return json({ error: "invalid_request" }, 400);
      if (!await withinDailyLimits(req)) return json({ error: "daily_limit" }, 429);
      const output = await askClaude(MISSIONS_SYSTEM, missionsUserMessage(request), MISSIONS_SCHEMA, "medium");
      return json(pickMissions(request, output));
    }

    if (action === "reflect") {
      const request = readReflectRequest(body);
      if (!request) return json({ error: "invalid_request" }, 400);
      if (!await withinDailyLimits(req)) return json({ error: "daily_limit" }, 429);
      const output = await askClaude(REFLECT_SYSTEM, reflectUserMessage(request), REFLECT_SCHEMA, "low");
      return json(pickReflection(request, output));
    }

    return json({ error: "not_found" }, 404);
  } catch (error) {
    if (error instanceof RefusedError) return json({ error: "refused" }, 422);
    if (error instanceof Anthropic.RateLimitError) return json({ error: "busy" }, 503);
    if (error instanceof Anthropic.AuthenticationError) {
      console.error("anthropic_auth_failed");
      return json({ error: "not_configured" }, 503);
    }
    if (error instanceof Anthropic.APIError) {
      console.error("anthropic_api_error", error.status, error.message);
      return json({ error: "ai_unavailable" }, 502);
    }
    console.error(error);
    return json({ error: "temporary_unavailable" }, 500);
  }
});
