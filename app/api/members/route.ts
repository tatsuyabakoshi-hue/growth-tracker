import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { hashPassword } from "@/lib/password";

export async function GET() {
  const sql = getDb();
  const members = await sql`
    SELECT id, name, email, reminder_enabled, created_at FROM members ORDER BY created_at ASC
  `;
  return NextResponse.json({ members });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const email = typeof body?.email === "string" && body.email.trim() ? body.email.trim() : null;

  if (!name) {
    return NextResponse.json({ error: "nameは必須です" }, { status: 400 });
  }
  if (!password || password.length < 4) {
    return NextResponse.json(
      { error: "パスワードは4文字以上で設定してください" },
      { status: 400 }
    );
  }

  const sql = getDb();
  const id = randomUUID();
  const createdAt = Date.now();
  const passwordHash = hashPassword(password);

  await sql`
    INSERT INTO members (id, name, password_hash, created_at, email, reminder_enabled)
    VALUES (${id}, ${name}, ${passwordHash}, ${createdAt}, ${email}, true)
  `;

  return NextResponse.json({ id, name, email, reminder_enabled: true, created_at: createdAt });
}
