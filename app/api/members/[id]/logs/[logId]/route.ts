import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { enqueueNotionJob } from "@/lib/sync";

type RouteParams = { params: Promise<{ id: string; logId: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id, logId } = await params;
  const body = await request.json().catch(() => ({}));
  const sql = getDb();

  const existingRows = await sql`
    SELECT id, notion_page_id FROM action_logs WHERE id = ${logId} AND member_id = ${id}
  `;
  if (existingRows.length === 0) {
    return NextResponse.json({ error: "見つかりません" }, { status: 404 });
  }

  const updates: {
    content?: string;
    log_date?: string;
    category?: string | null;
    confidence?: number | null;
    effect?: string | null;
    context?: string | null;
    related_goal_id?: string | null;
  } = {};

  if (typeof body?.content === "string" && body.content.trim()) updates.content = body.content.trim();
  if (typeof body?.log_date === "string" && body.log_date) updates.log_date = body.log_date;
  if (body?.category === null || typeof body?.category === "string") {
    updates.category = typeof body.category === "string" ? body.category.trim() || null : null;
  }
  if (body?.effect === null || typeof body?.effect === "string") {
    updates.effect = typeof body.effect === "string" ? body.effect.trim() || null : null;
  }
  if (body?.context === null || typeof body?.context === "string") {
    updates.context = typeof body.context === "string" ? body.context.trim() || null : null;
  }
  if (body?.confidence === null) {
    updates.confidence = null;
  } else if (typeof body?.confidence === "number" && body.confidence >= 1 && body.confidence <= 5) {
    updates.confidence = Math.round(body.confidence);
  }
  if (body?.related_goal_id === null || typeof body?.related_goal_id === "string") {
    updates.related_goal_id =
      typeof body.related_goal_id === "string" && body.related_goal_id ? body.related_goal_id : null;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "更新する項目がありません" }, { status: 400 });
  }

  const rows = await sql`
    UPDATE action_logs
    SET
      content = CASE WHEN ${"content" in updates} THEN ${updates.content ?? null} ELSE content END,
      log_date = CASE WHEN ${"log_date" in updates} THEN ${updates.log_date ?? null} ELSE log_date END,
      category = CASE WHEN ${"category" in updates} THEN ${updates.category ?? null} ELSE category END,
      confidence = CASE WHEN ${"confidence" in updates} THEN ${updates.confidence ?? null} ELSE confidence END,
      effect = CASE WHEN ${"effect" in updates} THEN ${updates.effect ?? null} ELSE effect END,
      context = CASE WHEN ${"context" in updates} THEN ${updates.context ?? null} ELSE context END,
      related_goal_id = CASE WHEN ${"related_goal_id" in updates} THEN ${updates.related_goal_id ?? null} ELSE related_goal_id END
    WHERE id = ${logId} AND member_id = ${id}
    RETURNING id, log_date, content, category, confidence, effect, context, related_goal_id, created_at
  `;

  await enqueueNotionJob("log", logId, "upsert");

  return NextResponse.json(rows[0]);
}

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
  if (notionPageId) {
    await enqueueNotionJob("log", logId, "archive", { notionPageId });
  }

  return NextResponse.json({ ok: true });
}
