import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { archivePage, syncToNotionSafely } from "@/lib/notion";

type RouteParams = { params: Promise<{ id: string; logId: string }> };

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { id, logId } = await params;
  const sql = getDb();

  const deleted = await sql`
    DELETE FROM action_logs WHERE id = ${logId} AND member_id = ${id} RETURNING id, notion_page_id
  `;

  if (deleted.length === 0) {
    return NextResponse.json({ error: "見つかりません" }, { status: 404 });
  }

  const notionPageId = deleted[0].notion_page_id as string | null;
  if (notionPageId && process.env.NOTION_API_KEY) {
    await syncToNotionSafely("archivePage(log)", () => archivePage(notionPageId));
  }

  return NextResponse.json({ ok: true });
}
