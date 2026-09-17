import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyPassword, verifyPlainSecret } from "@/lib/password";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const password = typeof body?.password === "string" ? body.password : "";

  const sql = getDb();
  const rows = await sql`SELECT password_hash FROM members WHERE id = ${id}`;

  if (rows.length === 0) {
    return NextResponse.json({ error: "メンバーが見つかりません" }, { status: 404 });
  }

  const isMaster = verifyPlainSecret(password, process.env.MASTER_PASSWORD);
  const isOwner = verifyPassword(password, rows[0].password_hash as string);
  if (!isMaster && !isOwner) {
    return NextResponse.json({ error: "パスワードが違います" }, { status: 401 });
  }

  // 本人パスワードで開いた場合は"self"、マスターパスワードで開いた場合は"admin"。
  // isOwnerを優先するのは、本人が万一マスターパスワードと同じ文字列を設定していた場合に
  // 本人視点(self)が使われるようにするため。
  const role: "self" | "admin" = isOwner ? "self" : "admin";

  return NextResponse.json({ ok: true, role });
}
