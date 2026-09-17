import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const sql = getDb();

  const updates: { email?: string | null; reminder_enabled?: boolean } = {};
  if (body?.email === null || typeof body?.email === "string") {
    updates.email = typeof body.email === "string" ? body.email.trim() || null : null;
  }
  if (typeof body?.reminder_enabled === "boolean") {
    updates.reminder_enabled = body.reminder_enabled;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "更新する項目がありません" }, { status: 400 });
  }

  const rows = await sql`
    UPDATE members
    SET
      email = CASE WHEN ${"email" in updates} THEN ${updates.email ?? null} ELSE email END,
      reminder_enabled = COALESCE(${updates.reminder_enabled ?? null}, reminder_enabled)
    WHERE id = ${id}
    RETURNING id, name, email, reminder_enabled, created_at
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: "メンバーが見つかりません" }, { status: 404 });
  }

  return NextResponse.json(rows[0]);
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const sql = getDb();

  const deleted = await sql`DELETE FROM members WHERE id = ${id} RETURNING id`;

  if (deleted.length === 0) {
    return NextResponse.json({ error: "メンバーが見つかりません" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
