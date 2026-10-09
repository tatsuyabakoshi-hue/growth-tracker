import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { enqueueNotionJob } from "@/lib/sync";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const viewer = request.nextUrl.searchParams.get("viewer");
  const sql = getDb();
  const rows = await sql`
    SELECT id, content, kind, category, status, target_date, success_criteria, resolved_summary,
           resolved_at, visible_to_admin, created_at
    FROM growth_goals
    WHERE member_id = ${id}
    ORDER BY created_at DESC
  `;

  // マスターパスワード(管理者)で開いている場合、本人が「共有しない」に設定した項目は
  // 内容を隠し、非公開項目が存在すること自体だけが分かる形で返す。
  const goals =
    viewer === "admin"
      ? rows.map((g) =>
          g.visible_to_admin
            ? g
            : { ...g, content: null, hidden: true }
        )
      : rows;

  return NextResponse.json({ goals });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  const kind = body?.kind === "goal" ? "goal" : "worry";
  const category = typeof body?.category === "string" && body.category.trim() ? body.category.trim() : null;
  const targetDate = typeof body?.target_date === "string" && body.target_date ? body.target_date : null;
  const successCriteria =
    typeof body?.success_criteria === "string" && body.success_criteria.trim()
      ? body.success_criteria.trim()
      : null;

  if (!content) {
    return NextResponse.json({ error: "contentは必須です" }, { status: 400 });
  }

  const sql = getDb();

  const memberRows = await sql`SELECT name FROM members WHERE id = ${id}`;
  if (memberRows.length === 0) {
    return NextResponse.json({ error: "メンバーが見つかりません" }, { status: 404 });
  }

  const goalId = randomUUID();
  const createdAt = Date.now();

  await sql`
    INSERT INTO growth_goals
      (id, member_id, content, created_at, status, visible_to_admin, kind, category, target_date, success_criteria)
    VALUES
      (${goalId}, ${id}, ${content}, ${createdAt}, 'open', true, ${kind}, ${category}, ${targetDate}, ${successCriteria})
  `;

  await enqueueNotionJob("goal", goalId, "upsert");

  return NextResponse.json({
    id: goalId,
    content,
    kind,
    category,
    target_date: targetDate,
    success_criteria: successCriteria,
    created_at: createdAt,
    status: "open",
    resolved_at: null,
    visible_to_admin: true,
  });
}
