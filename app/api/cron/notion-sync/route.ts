import { NextRequest, NextResponse } from "next/server";
import { drainNotionJobs } from "@/lib/sync";
import { isSheetsEnabled, pushSnapshotToSheets } from "@/lib/sheets";

// 外部ミラーの後追い同期。
// - Notion: 未処理ジョブのドレイン（after()で即時反映できなかった分を拾う）
// - Googleスプレッドシート: 全件スナップショットを再送（取りこぼしのリカバリ）
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const notion = await drainNotionJobs(50);

  let sheets: Record<string, unknown> = { ok: false, skipped: true };
  if (isSheetsEnabled()) {
    try {
      sheets = (await pushSnapshotToSheets()) as unknown as Record<string, unknown>;
    } catch (err) {
      console.error("[sheets cron sync failed]", err);
      sheets = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  return NextResponse.json({ notion, sheets });
}
