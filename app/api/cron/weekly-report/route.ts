import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { generateText } from "@/lib/claude";
import { sendEmail } from "@/lib/email";

const CS_CATEGORIES = ["対応品質", "スピード", "課題発見"];

type MemberRow = { id: string; name: string; email: string | null };
type LogRow = { content: string; category: string | null; confidence: number | null; effect: string | null };

function daysAgoStr(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    return NextResponse.json(
      { error: "RESEND_API_KEYまたはEMAIL_FROMが設定されていません" },
      { status: 500 }
    );
  }

  const sql = getDb();
  const startDate = daysAgoStr(6);
  const startMs = Date.parse(`${startDate}T00:00:00Z`);

  const members = (await sql`
    SELECT id, name, email FROM members ORDER BY created_at ASC
  `) as MemberRow[];

  const results: { member_id: string; sent: boolean; reason?: string }[] = [];
  const adminParts: string[] = [];

  for (const m of members) {
    const logs = (await sql`
      SELECT content, category, confidence, effect FROM action_logs
      WHERE member_id = ${m.id} AND log_date >= ${startDate}
      ORDER BY log_date ASC
    `) as LogRow[];

    const resolvedRows = (await sql`
      SELECT COUNT(*)::int AS count FROM growth_goals
      WHERE member_id = ${m.id} AND status = 'resolved' AND resolved_at >= ${startMs}
    `) as { count: number }[];
    const resolvedCount = resolvedRows[0]?.count ?? 0;

    const byCategory = CS_CATEGORIES.map((cat) => logs.filter((l) => l.category === cat).length);
    const withScore = logs.filter((l) => typeof l.confidence === "number");
    const avgConfidence =
      withScore.length > 0
        ? withScore.reduce((s, l) => s + (l.confidence as number), 0) / withScore.length
        : null;

    const logsText =
      logs.length > 0
        ? logs
            .map(
              (l) =>
                `- ${l.category ? `[${l.category}]` : ""}${l.confidence ? `手応え${l.confidence}` : ""} ${l.content}${
                  l.effect ? `／効果: ${l.effect}` : ""
                }`
            )
            .join("\n")
        : "(今週の記録なし)";

    const summary = await generateText(
      "あなたはCSチームの成長コーチです。励ましつつ、事実に基づいて簡潔に振り返りを述べてください。",
      `CSメンバー「${m.name}」の今週の記録です。\n実践ログ: ${logs.length}件（対応品質${byCategory[0]} / スピード${byCategory[1]} / 課題発見${byCategory[2]}）\n平均手応え: ${avgConfidence ? avgConfidence.toFixed(1) : "未記録"}\n今週解決した悩み/目標: ${resolvedCount}件\n\n【今週の実践ログ】\n${logsText}\n\nこの内容を3〜4文で前向きに振り返り、来週の一歩を1つ提案してください。`,
      500
    );

    const bodyParts = [
      `${m.name}さんの今週の振り返り`,
      "",
      `実践ログ: ${logs.length}件（対応品質${byCategory[0]} / スピード${byCategory[1]} / 課題発見${byCategory[2]}）`,
      `平均手応え: ${avgConfidence ? avgConfidence.toFixed(1) : "未記録"}`,
      `今週解決した悩み/目標: ${resolvedCount}件`,
      "",
      "▼ AIからのひとこと",
      summary || "(AI要約は未設定です)",
    ];
    const body = bodyParts.join("\n");

    adminParts.push(
      `■ ${m.name}\n  ログ${logs.length}件 / 解決${resolvedCount}件 / 平均手応え${
        avgConfidence ? avgConfidence.toFixed(1) : "-"
      }\n  ${summary || ""}`
    );

    if (!m.email) {
      results.push({ member_id: m.id, sent: false, reason: "no_email" });
      continue;
    }

    try {
      await sendEmail({
        to: m.email,
        subject: "【成長トラッカー】今週の振り返り",
        text: body,
      });
      results.push({ member_id: m.id, sent: true });
    } catch (err) {
      console.error(`[weekly report failed] member=${m.id}:`, err);
      results.push({ member_id: m.id, sent: false, reason: "send_failed" });
    }
  }

  // 管理者宛: 全メンバーの振り返りをまとめて送る。
  let adminSent = false;
  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail) {
    try {
      await sendEmail({
        to: adminEmail,
        subject: "【成長トラッカー】週次レポート（全メンバー）",
        text: `全メンバーの今週の振り返りです。\n\n${adminParts.join("\n\n")}`,
      });
      adminSent = true;
    } catch (err) {
      console.error("[weekly report admin failed]", err);
    }
  }

  return NextResponse.json({ checked: members.length, results, adminSent });
}
