import { NextResponse } from "next/server";
import { currentAiProvider, isAiEnabled } from "@/lib/ai";

/** 現在有効なAIプロバイダ・モデルを返す（診断用。表示専用で秘密情報は含めない）。 */
export async function GET() {
  return NextResponse.json({
    provider: currentAiProvider(),
    model: process.env.AI_MODEL || null,
    base_url: process.env.OPENAI_BASE_URL || null,
    enabled: isAiEnabled(),
  });
}
