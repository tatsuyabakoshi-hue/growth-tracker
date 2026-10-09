/* eslint-disable @typescript-eslint/no-explicit-any */
// AIプロバイダの抽象化。AI_PROVIDER で切替できる。
//   anthropic | gemini | groq | openrouter | openai
// 未指定なら、設定済みのキーから自動選択する。
// モデルは AI_MODEL で上書き可能。

export type AiMessage = { role: "user" | "assistant"; content: string };

function providerName(): string {
  if (process.env.AI_PROVIDER) return process.env.AI_PROVIDER.toLowerCase();
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.GROQ_API_KEY) return "groq";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "anthropic";
}

/** AIが呼べる状態か（該当プロバイダのキーがあるか）。 */
export function isAiEnabled(): boolean {
  switch (providerName()) {
    case "gemini":
      return !!process.env.GEMINI_API_KEY;
    case "groq":
      return !!process.env.GROQ_API_KEY;
    case "openrouter":
      return !!process.env.OPENROUTER_API_KEY;
    case "openai":
      return !!(process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL);
    default:
      return !!process.env.ANTHROPIC_API_KEY;
  }
}

async function geminiComplete(system: string | undefined, messages: AiMessage[], maxTokens: number): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const model = process.env.AI_MODEL || "gemini-flash-latest";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(system ? { system_instruction: { parts: [{ text: system }] } } : {}),
      contents,
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`);
  const data: any = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map((p: any) => p?.text || "").join("").trim();
}

async function openaiCompatibleComplete(
  baseURL: string,
  apiKey: string,
  defaultModel: string,
  system: string | undefined,
  messages: AiMessage[],
  maxTokens: number
): Promise<string> {
  const model = process.env.AI_MODEL || defaultModel;
  const res = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        ...(system ? [{ role: "system", content: system }] : []),
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      max_tokens: maxTokens,
      temperature: 0.7,
    }),
  });
  if (!res.ok) throw new Error(`Chat error ${res.status}: ${await res.text()}`);
  const data: any = await res.json();
  return (data?.choices?.[0]?.message?.content || "").trim();
}

async function anthropicComplete(system: string | undefined, messages: AiMessage[], maxTokens: number): Promise<string> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = process.env.AI_MODEL || "claude-sonnet-4-5-20250929";
  const msg = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });
  return msg.content.map((b: any) => (b.type === "text" ? b.text : "")).join("\n").trim();
}

/** プロバイダを問わずテキスト生成する。 */
export async function aiComplete(params: {
  system?: string;
  messages: AiMessage[];
  maxTokens?: number;
}): Promise<string> {
  const { system, messages, maxTokens = 1024 } = params;
  switch (providerName()) {
    case "gemini":
      return geminiComplete(system, messages, maxTokens);
    case "groq":
      return openaiCompatibleComplete(
        "https://api.groq.com/openai/v1",
        process.env.GROQ_API_KEY || "",
        "llama-3.3-70b-versatile",
        system,
        messages,
        maxTokens
      );
    case "openrouter":
      return openaiCompatibleComplete(
        "https://openrouter.ai/api/v1",
        process.env.OPENROUTER_API_KEY || "",
        "meta-llama/llama-3.3-70b-instruct:free",
        system,
        messages,
        maxTokens
      );
    case "openai":
      return openaiCompatibleComplete(
        process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
        process.env.OPENAI_API_KEY || "",
        "gpt-4o-mini",
        system,
        messages,
        maxTokens
      );
    default:
      return anthropicComplete(system, messages, maxTokens);
  }
}

/** 単発生成（要約など）。キー未設定ならnull。エラー時もnull。 */
export async function generateText(system: string, user: string, maxTokens = 400): Promise<string | null> {
  if (!isAiEnabled()) return null;
  try {
    return await aiComplete({ system, messages: [{ role: "user", content: user }], maxTokens });
  } catch (err) {
    console.error("[generateText failed]", err);
    return null;
  }
}
