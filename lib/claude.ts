import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

export function getClaude(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set");
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

// Anthropic Consoleで利用可能なモデル名に変わっている場合は
// 環境変数 CLAUDE_MODEL を設定して上書きしてください。
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-5-20250929";

export function extractText(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n")
    .trim();
}

/** 単発のテキスト生成（要約など）。ANTHROPIC_API_KEY未設定ならnullを返す。 */
export async function generateText(
  system: string,
  user: string,
  maxTokens = 400
): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const client = getClaude();
    const message = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    });
    return extractText(message.content);
  } catch (err) {
    console.error("[generateText failed]", err);
    return null;
  }
}
