import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getClaude, extractText, CLAUDE_MODEL } from "@/lib/claude";
import { CS_GROWTH_GUIDELINES } from "@/lib/cs-guidelines";

type RouteParams = { params: Promise<{ id: string; suggestionId: string }> };
type GoalRow = { content: string };
type LogRow = { log_date: string; content: string };
type MessageRow = { role: "user" | "assistant"; content: string };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { suggestionId } = await params;
  const sql = getDb();
  const messages = await sql`
    SELECT id, role, content, created_at FROM suggestion_messages
    WHERE suggestion_id = ${suggestionId}
    ORDER BY created_at ASC
  `;
  return NextResponse.json({ messages });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id, suggestionId } = await params;
  const body = await request.json().catch(() => ({}));
  const userMessage = typeof body?.content === "string" ? body.content.trim() : "";

  if (!userMessage) {
    return NextResponse.json({ error: "contentは必須です" }, { status: 400 });
  }

  const sql = getDb();

  const memberRows = await sql`SELECT name FROM members WHERE id = ${id}`;
  const suggestionRows = await sql`
    SELECT id, content FROM suggestions WHERE id = ${suggestionId} AND member_id = ${id}
  `;
  if (memberRows.length === 0 || suggestionRows.length === 0) {
    return NextResponse.json({ error: "見つかりません" }, { status: 404 });
  }

  const goals = (await sql`
    SELECT content FROM growth_goals WHERE member_id = ${id} ORDER BY created_at ASC
  `) as GoalRow[];
  const logs = (await sql`
    SELECT log_date, content FROM action_logs WHERE member_id = ${id} ORDER BY log_date ASC, created_at ASC
  `) as LogRow[];
  const priorMessages = (await sql`
    SELECT role, content FROM suggestion_messages
    WHERE suggestion_id = ${suggestionId}
    ORDER BY created_at ASC
  `) as MessageRow[];

  const goalsText = goals.length > 0 ? goals.map((g, i) => `${i + 1}. ${g.content}`).join("\n") : "(まだ記載なし)";
  const logsText =
    logs.length > 0 ? logs.map((l) => `- [${l.log_date}] ${l.content}`).join("\n") : "(まだ記載なし)";

  const contextMessage = `メンバー「${memberRows[0].name}」の記録です。\n\n【悩み事・成長したいこと】\n${goalsText}\n\n【試したこと・実践したこと・効果（日付順）】\n${logsText}\n\n以下は、あなたがこれまでの記録を踏まえて行った提案です。この内容について、メンバー本人から追加の質問が来ます。提案の意図を踏まえて、具体的かつ簡潔に答えてください。\n\n【あなたが行った提案】\n${suggestionRows[0].content}`;

  const conversation = [
    { role: "user" as const, content: contextMessage },
    { role: "assistant" as const, content: "承知しました。追加のご質問があればお答えします。" },
    ...priorMessages.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: userMessage },
  ];

  try {
    const client = getClaude();
    const message = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system: CS_GROWTH_GUIDELINES,
      messages: conversation,
    });

    const assistantReply = extractText(message.content);
    const now = Date.now();

    await sql`
      INSERT INTO suggestion_messages (id, suggestion_id, role, content, created_at)
      VALUES (${randomUUID()}, ${suggestionId}, 'user', ${userMessage}, ${now})
    `;
    const assistantMessageId = randomUUID();
    const assistantCreatedAt = now + 1;
    await sql`
      INSERT INTO suggestion_messages (id, suggestion_id, role, content, created_at)
      VALUES (${assistantMessageId}, ${suggestionId}, 'assistant', ${assistantReply}, ${assistantCreatedAt})
    `;

    return NextResponse.json({
      id: assistantMessageId,
      role: "assistant",
      content: assistantReply,
      created_at: assistantCreatedAt,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Claude APIでの応答生成に失敗しました。" },
      { status: 502 }
    );
  }
}
