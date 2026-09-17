import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { archivePage, syncToNotionSafely, upsertGoalPage } from "@/lib/notion";

type RouteParams = { params: Promise<{ id: string; goalId: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id, goalId } = await params;
  const body = await request.json().catch(() => ({}));
  const sql = getDb();

  const existingRows = await sql`
    SELECT g.id, g.content, g.status, g.notion_page_id, m.name AS member_name
    FROM growth_goals g
    JOIN members m ON m.id = g.member_id
    WHERE g.id = ${goalId} AND g.member_id = ${id}
  `;
  if (existingRows.length === 0) {
    return NextResponse.json({ error: "見つかりません" }, { status: 404 });
  }
  const existing = existingRows[0];

  const updates: { status?: "open" | "resolved"; visible_to_admin?: boolean } = {};

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

  const rows = await sql`
    UPDATE growth_goals
    SET
      status = ${nextStatus},
      resolved_at = ${resolvedAt},
      visible_to_admin = COALESCE(${updates.visible_to_admin ?? null}, visible_to_admin)
    WHERE id = ${goalId} AND member_id = ${id}
    RETURNING id, content, status, resolved_at, visible_to_admin, created_at, notion_page_id
  `;

  const updated = rows[0];

  if (process.env.NOTION_API_KEY && process.env.NOTION_GOALS_DB_ID) {
    const result = await syncToNotionSafely("upsertGoalPage(update)", () =>
      upsertGoalPage({
        pageId: updated.notion_page_id as string | null,
        memberName: existing.member_name as string,
        content: updated.content as string,
        status: updated.status as "open" | "resolved",
        createdAt: updated.created_at as number,
      })
    );
    if (result && result.pageId !== updated.notion_page_id) {
      await sql`UPDATE growth_goals SET notion_page_id = ${result.pageId} WHERE id = ${goalId}`;
    }
  }

  return NextResponse.json({
    id: updated.id,
    content: updated.content,
    status: updated.status,
    resolved_at: updated.resolved_at,
    visible_to_admin: updated.visible_to_admin,
    created_at: updated.created_at,
  });
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
  if (notionPageId && process.env.NOTION_API_KEY) {
    await syncToNotionSafely("archivePage(goal)", () => archivePage(notionPageId));
  }

  return NextResponse.json({ ok: true });
}
