import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { syncToNotionSafely, upsertLogPage } from "@/lib/notion";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const sql = getDb();
  const logs = await sql`
    SELECT id, log_date, content, related_goal_id, created_at FROM action_logs
    WHERE member_id = ${id}
    ORDER BY log_date DESC, created_at DESC
  `;
  return NextResponse.json({ logs });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  const logDate = typeof body?.log_date === "string" && body.log_date ? body.log_date : "";
  const relatedGoalId = typeof body?.related_goal_id === "string" && body.related_goal_id ? body.related_goal_id : null;

  if (!content) {
    return NextResponse.json({ error: "contentは必須です" }, { status: 400 });
  }
  if (!logDate) {
    return NextResponse.json({ error: "log_dateは必須です" }, { status: 400 });
  }

  const sql = getDb();

  const memberRows = await sql`SELECT name FROM members WHERE id = ${id}`;
  if (memberRows.length === 0) {
    return NextResponse.json({ error: "メンバーが見つかりません" }, { status: 404 });
  }

  const logId = randomUUID();
  const createdAt = Date.now();

  await sql`
    INSERT INTO action_logs (id, member_id, log_date, content, created_at, related_goal_id)
    VALUES (${logId}, ${id}, ${logDate}, ${content}, ${createdAt}, ${relatedGoalId})
  `;

  if (process.env.NOTION_API_KEY && process.env.NOTION_LOGS_DB_ID) {
    const result = await syncToNotionSafely("upsertLogPage(create)", () =>
      upsertLogPage({
        memberName: memberRows[0].name as string,
        content,
        logDate,
        createdAt,
      })
    );
    if (result) {
      await sql`UPDATE action_logs SET notion_page_id = ${result.pageId} WHERE id = ${logId}`;
    }
  }

  return NextResponse.json({
    id: logId,
    log_date: logDate,
    content,
    related_goal_id: relatedGoalId,
    created_at: createdAt,
  });
}
