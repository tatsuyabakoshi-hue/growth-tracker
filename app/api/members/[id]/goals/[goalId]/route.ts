import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { generateText } from "@/lib/claude";
import { enqueueNotionJob } from "@/lib/sync";

type RouteParams = { params: Promise<{ id: string; goalId: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id, goalId } = await params;
  const body = await request.json().catch(() => ({}));
  const sql = getDb();

  const existingRows = await sql`
    SELECT g.id, g.status, g.content, g.notion_page_id
    FROM growth_goals g
    WHERE g.id = ${goalId} AND g.member_id = ${id}
  `;
  if (existingRows.length === 0) {
    return NextResponse.json({ error: "見つかりません" }, { status: 404 });
  }
  const existing = existingRows[0];

  const updates: {
    content?: string;
    kind?: "worry" | "goal";
    category?: string | null;
    target_date?: string | null;
    success_criteria?: string | null;
    resolved_summary?: string | null;
    status?: "open" | "resolved";
    visible_to_admin?: boolean;
  } = {};

  if (typeof body?.content === "string" && body.content.trim()) updates.content = body.content.trim();
  if (body?.kind === "worry" || body?.kind === "goal") updates.kind = body.kind;
  if (body?.category === null || typeof body?.category === "string") {
    updates.category = typeof body.category === "string" ? body.category.trim() || null : null;
  }
  if (body?.target_date === null || typeof body?.target_date === "string") {
    updates.target_date = typeof body.target_date === "string" && body.target_date ? body.target_date : null;
  }
  if (body?.success_criteria === null || typeof body?.success_criteria === "string") {
    updates.success_criteria =
      typeof body.success_criteria === "string" ? body.success_criteria.trim() || null : null;
  }
  if (body?.resolved_summary === null || typeof body?.resolved_summary === "string") {
    updates.resolved_summary =
      typeof body.resolved_summary === "string" ? body.resolved_summary.trim() || null : null;
  }
  if (typeof body?.status === "string") {
    if (body.status !== "open" && body.status !== "resolved") {
      return NextResponse.json({ error: "statusはopenかresolvedのみ指定できます" }, { status: 400 });
    }
    updates.status = body.status;
  }
  if (typeof body?.visible_to_admin === "boolean") {
    updates.visible_to_admin = body.visible_to_admin;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "更新する項目がありません" }, { status: 400 });
  }

  const nextStatus = updates.status ?? (existing.status as "open" | "resolved");
  const resolvedAt = nextStatus === "resolved" ? Date.now() : null;

  // 解決した瞬間に「何が効いたか」をAIで1〜2文に要約して保存する（未指定時のみ）。
  if (nextStatus === "resolved" && existing.status !== "resolved" && !("resolved_summary" in updates)) {
    const logRows = (await sql`
      SELECT log_date, content, effect FROM action_logs
      WHERE related_goal_id = ${goalId}
      ORDER BY log_date ASC
    `) as { log_date: string; content: string; effect: string | null }[];
    const logsText =
      logRows.length > 0
        ? logRows
            .map((l) => `- [${l.log_date}] ${l.content}${l.effect ? `／効果: ${l.effect}` : ""}`)
            .join("\n")
        : "(関連する実践ログなし)";
    const summary = await generateText(
      "あなたは成長記録の要約者です。前置きや見出しは書かず、日本語で簡潔に要約してください。",
      `次の悩み/目標が解決しました。関連する実践ログを踏まえ、「何が効いたか」が分かる1〜2文に要約してください。\n\n【悩み/目標】\n${existing.content}\n\n【実践ログ】\n${logsText}`
    );
    if (summary) updates.resolved_summary = summary.trim();
  }

  const rows = await sql`
    UPDATE growth_goals
    SET
      content = CASE WHEN ${"content" in updates} THEN ${updates.content ?? null} ELSE content END,
      kind = CASE WHEN ${"kind" in updates} THEN ${updates.kind ?? null} ELSE kind END,
      category = CASE WHEN ${"category" in updates} THEN ${updates.category ?? null} ELSE category END,
      target_date = CASE WHEN ${"target_date" in updates} THEN ${updates.target_date ?? null} ELSE target_date END,
      success_criteria = CASE WHEN ${"success_criteria" in updates} THEN ${updates.success_criteria ?? null} ELSE success_criteria END,
      resolved_summary = CASE WHEN ${"resolved_summary" in updates} THEN ${updates.resolved_summary ?? null} ELSE resolved_summary END,
      status = ${nextStatus},
      resolved_at = ${resolvedAt},
      visible_to_admin = COALESCE(${updates.visible_to_admin ?? null}, visible_to_admin)
    WHERE id = ${goalId} AND member_id = ${id}
    RETURNING id, content, kind, category, status, target_date, success_criteria, resolved_summary,
              resolved_at, visible_to_admin, created_at, notion_page_id
  `;

  await enqueueNotionJob("goal", goalId, "upsert");

  return NextResponse.json(rows[0]);
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { id, goalId } = await params;
  const sql = getDb();

  const deleted = await sql`
    DELETE FROM growth_goals WHERE id = ${goalId} AND member_id = ${id} RETURNING id, notion_page_id
  `;

  if (deleted.length === 0) {
    return NextResponse.json({ error: "見つかりません" }, { status: 404 });
  }

  const notionPageId = deleted[0].notion_page_id as string | null;
  if (notionPageId) {
    await enqueueNotionJob("goal", goalId, "archive", { notionPageId });
  }

  return NextResponse.json({ ok: true });
}
