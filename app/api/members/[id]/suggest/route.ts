import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getClaude, extractText, CLAUDE_MODEL } from "@/lib/claude";
import { CS_GROWTH_GUIDELINES } from "@/lib/cs-guidelines";
import { syncToNotionSafely, upsertSuggestionPage } from "@/lib/notion";

type RouteParams = { params: Promise<{ id: string }> };
type GoalRow = { content: string; created_at: number };
type LogRow = { log_date: string; content: string };

export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const sql = getDb();

  const memberRows = await sql`SELECT name FROM members WHERE id = ${id}`;
  if (memberRows.length === 0) {
    return NextResponse.json({ error: "メンバーが見つかりません" }, { status: 404 });
  }

  const goals = (await sql`
    SELECT content, created_at FROM growth_goals
    WHERE member_id = ${id}
    ORDER BY created_at ASC
  `) as GoalRow[];

  const logs = (await sql`
    SELECT log_date, content FROM action_logs
    WHERE member_id = ${id}
    ORDER BY log_date ASC, created_at ASC
  `) as LogRow[];

  if (goals.length === 0 && logs.length === 0) {
    return NextResponse.json(
      { error: "悩み事・実践ログがまだありません" },
      { status: 400 }
    );
  }

  const goalsText =
    goals.length > 0
      ? goals.map((g, i) => `${i + 1}. ${g.content}`).join("\n")
      : "(まだ記載なし)";

  const logsText =
    logs.length > 0
      ? logs.map((l) => `- [${l.log_date}] ${l.content}`).join("\n")
      : "(まだ記載なし)";

  try {
    const client = getClaude();
    const message = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      system: CS_GROWTH_GUIDELINES,
      messages: [
        {
          role: "user",
          content: `メンバー「${memberRows[0].name}」の記録です。\n\n【悩み事・成長したいこと】\n${goalsText}\n\n【試したこと・実践したこと・効果（日付順）】\n${logsText}\n\nこの内容を踏まえて、次に取るべき具体的なアクションを提案してください。`,
        },
      ],
    });

    const suggestion = extractText(message.content);
    const suggestionId = randomUUID();
    const createdAt = Date.now();

    await sql`
      INSERT INTO suggestions (id, member_id, content, created_at)
      VALUES (${suggestionId}, ${id}, ${suggestion}, ${createdAt})
    `;

    if (process.env.NOTION_API_KEY && process.env.NOTION_SUGGESTIONS_DB_ID) {
      const result = await syncToNotionSafely("upsertSuggestionPage(create)", () =>
        upsertSuggestionPage({
          memberName: memberRows[0].name as string,
          content: suggestion,
          createdAt,
        })
      );
      if (result) {
        await sql`UPDATE suggestions SET notion_page_id = ${result.pageId} WHERE id = ${suggestionId}`;
      }
    }

    return NextResponse.json({ id: suggestionId, content: suggestion, created_at: createdAt });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Claude APIでの提案生成に失敗しました。ANTHROPIC_API_KEYを確認してください。" },
      { status: 502 }
    );
  }
}
