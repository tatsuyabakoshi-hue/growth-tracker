import { NextRequest, NextResponse } from "next/server";
import { drainNotionJobs } from "@/lib/sync";

// Notion同期キューのドレイン（後追い同期）。after()で即時反映できなかった分を拾う。
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await drainNotionJobs(50);
  return NextResponse.json(result);
}
