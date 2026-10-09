import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { enqueueNotionJob } from "@/lib/sync";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const sql = getDb();
  const logs = await sql`
    SELECT id, log_date, content, category, confidence, effect, context, related_goal_id, created_at
    FROM action_logs
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
  const relatedGoalId =
    typeof body?.related_goal_id === "string" && body.related_goal_id ? body.related_goal_id : null;
  const category = typeof body?.category === "string" && body.category.trim() ? body.category.trim() : null;
  const effect = typeof body?.effect === "string" && body.effect.trim() ? body.effect.trim() : null;
  const context = typeof body?.context === "string" && body.context.trim() ? body.context.trim() : null;
  const confidence =
    typeof body?.confidence === "number" && body.confidence >= 1 && body.confidence <= 5
      ? Math.round(body.confidence)
      : null;

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
    INSERT INTO action_logs
      (id, member_id, log_date, content, created_at, related_goal_id, category, confidence, effect, context)
    VALUES
      (${logId}, ${id}, ${logDate}, ${content}, ${createdAt}, ${relatedGoalId}, ${category}, ${confidence}, ${effect}, ${context})
  `;

  await enqueueNotionJob("log", logId, "upsert");

  return NextResponse.json({
    id: logId,
    log_date: logDate,
    content,
    category,
    confidence,
    effect,
    context,
    related_goal_id: relatedGoalId,
    created_at: createdAt,
  });
}
