import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getClaude, extractText, CLAUDE_MODEL } from "@/lib/claude";
import { CS_GROWTH_GUIDELINES } from "@/lib/cs-guidelines";
import { enqueueNotionJob } from "@/lib/sync";

type RouteParams = { params: Promise<{ id: string }> };
type GoalRow = {
  id: string;
  content: string;
  kind: string;
  category: string | null;
  status: string;
  target_date: string | null;
  success_criteria: string | null;
  resolved_summary: string | null;
  created_at: number;
};
type LogRow = {
  id: string;
  log_date: string;
  content: string;
  category: string | null;
  confidence: number | null;
  effect: string | null;
  context: string | null;
};

const RECENT_LOG_LIMIT = 20;

export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const sql = getDb();

  const memberRows = await sql`SELECT name FROM members WHERE id = ${id}`;
  if (memberRows.length === 0) {
    return NextResponse.json({ error: "メンバーが見つかりません" }, { status: 404 });
  }

  const goals = (await sql`
    SELECT id, content, kind, category, status, target_date, success_criteria, resolved_summary, created_at
    FROM growth_goals
    WHERE member_id = ${id}
    ORDER BY created_at ASC
  `) as GoalRow[];

  const recentLogs = (await sql`
    SELECT id, log_date, content, category, confidence, effect, context
    FROM action_logs
    WHERE member_id = ${id}
    ORDER BY log_date DESC, created_at DESC
    LIMIT ${RECENT_LOG_LIMIT}
  `) as LogRow[];
  const logs = [...recentLogs].reverse();

  if (goals.length === 0 && logs.length === 0) {
    return NextResponse.json({ error: "悩み事・実践ログがまだありません" }, { status: 400 });
  }

  // 未解決の悩み/目標は全文、解決済みは要約に圧縮して渡す。
  const openGoals = goals.filter((g) => g.status !== "resolved");
  const resolvedGoals = goals.filter((g) => g.status === "resolved");

  const goalsText =
    goals.length > 0
      ? [
          ...openGoals.map(
            (g) =>
              `[未解決/${g.kind === "goal" ? "目標" : "悩み"}${g.category ? "/" + g.category : ""}${
                g.target_date ? "/期限" + g.target_date : ""
              }] ${g.content}${g.success_criteria ? `（達成基準: ${g.success_criteria}）` : ""}`
          ),
          ...resolvedGoals.map(
            (g) => `[解決済/${g.kind === "goal" ? "目標" : "悩み"}] ${g.resolved_summary || g.content}`
          ),
        ].join("\n")
      : "(まだ記載なし)";

  const logsText =
    logs.length > 0
      ? logs
          .map(
            (l) =>
              `- [${l.log_date}]${l.category ? `（${l.category}）` : ""}${
                l.confidence ? `手応え${l.confidence}` : ""
              } ${l.content}${l.effect ? `／効果: ${l.effect}` : ""}${l.context ? `／場面: ${l.context}` : ""}`
          )
          .join("\n")
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
          content: `メンバー「${memberRows[0].name}」の記録です。\n\n【悩み事・成長したいこと】\n${goalsText}\n\n【試したこと・実践したこと・効果（直近${logs.length}件・日付順）】\n${logsText}\n\nこの内容を踏まえて、次に取るべき具体的なアクションを提案してください。\n\n最後に、あなたの提案が参照した実践ログを「## 参照した記録」という見出しで列挙してください。各行は必ず「- [日付] 内容 (ID: ログID)」の形式にし、ログIDは上記の各記録に付いているIDを使ってください。`,
        },
      ],
    });

    const suggestion = extractText(message.content);
    const suggestionId = randomUUID();
    const createdAt = Date.now();

    // 参照したログIDを抽出して根拠として保存する。
    const referencedLogIds = Array.from(
      new Set(
        (suggestion.match(/ID:\s*([0-9a-fA-F-]{36})/g) || []).map((m) =>
          m.replace(/ID:\s*/, "").trim()
        )
      )
    ).filter((logId) => logs.some((l) => l.id === logId));

    const resolvedSummarySection = (suggestion.match(/##\s*参照した記録[\s\S]*$/)?.[0] || "").trim();

    const evidence = {
      logIds: referencedLogIds.length > 0 ? referencedLogIds : logs.map((l) => l.id),
      goalIds: openGoals.map((g) => g.id),
      text: resolvedSummarySection,
    };

    await sql`
      INSERT INTO suggestions (id, member_id, content, created_at, evidence)
      VALUES (${suggestionId}, ${id}, ${suggestion}, ${createdAt}, ${JSON.stringify(evidence)}::jsonb)
    `;

    await enqueueNotionJob("suggestion", suggestionId, "upsert");

    return NextResponse.json({ id: suggestionId, content: suggestion, created_at: createdAt });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Claude APIでの提案生成に失敗しました。ANTHROPIC_API_KEYを確認してください。" },
      { status: 502 }
    );
  }
}
