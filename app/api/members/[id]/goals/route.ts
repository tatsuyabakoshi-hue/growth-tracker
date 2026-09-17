import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { syncToNotionSafely, upsertGoalPage } from "@/lib/notion";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const viewer = request.nextUrl.searchParams.get("viewer");
  const sql = getDb();
  const rows = await sql`
    SELECT id, content, status, resolved_at, visible_to_admin, created_at FROM growth_goals
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
    INSERT INTO growth_goals (id, member_id, content, created_at, status, visible_to_admin)
    VALUES (${goalId}, ${id}, ${content}, ${createdAt}, 'open', true)
  `;

  if (process.env.NOTION_API_KEY && process.env.NOTION_GOALS_DB_ID) {
    const result = await syncToNotionSafely("upsertGoalPage(create)", () =>
      upsertGoalPage({
        memberName: memberRows[0].name as string,
        content,
        status: "open",
        createdAt,
      })
    );
    if (result) {
      await sql`UPDATE growth_goals SET notion_page_id = ${result.pageId} WHERE id = ${goalId}`;
    }
  }

  return NextResponse.json({
    id: goalId,
    content,
    created_at: createdAt,
    status: "open",
    resolved_at: null,
    visible_to_admin: true,
  });
}
