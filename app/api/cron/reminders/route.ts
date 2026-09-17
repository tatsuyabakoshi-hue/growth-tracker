import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { sendReminderEmail } from "@/lib/email";

// 何日ログが無ければリマインドを送るか(初期値)。必要に応じて調整してください。
const REMINDER_THRESHOLD_DAYS = 3;

type MemberRow = {
  id: string;
  name: string;
  email: string | null;
  last_log_date: string | null;
};

function daysSince(dateStr: string): number {
  const last = new Date(`${dateStr}T00:00:00Z`).getTime();
  const now = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`).getTime();
  return Math.floor((now - last) / (1000 * 60 * 60 * 24));
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
  const members = (await sql`
    SELECT
      m.id,
      m.name,
      m.email,
      MAX(a.log_date) AS last_log_date
    FROM members m
    LEFT JOIN action_logs a ON a.member_id = m.id
    WHERE m.reminder_enabled = true AND m.email IS NOT NULL
    GROUP BY m.id, m.name, m.email
  `) as MemberRow[];

  const results: { member_id: string; sent: boolean; reason?: string }[] = [];

  for (const member of members) {
    if (!member.email) {
      results.push({ member_id: member.id, sent: false, reason: "no_email" });
      continue;
    }

    const daysSinceLastLog = member.last_log_date ? daysSince(member.last_log_date) : null;
    const shouldRemind = daysSinceLastLog === null || daysSinceLastLog >= REMINDER_THRESHOLD_DAYS;

    if (!shouldRemind) {
      results.push({ member_id: member.id, sent: false, reason: "not_due" });
      continue;
    }

    try {
      await sendReminderEmail({
        to: member.email,
        memberName: member.name,
        daysSinceLastLog,
      });
      results.push({ member_id: member.id, sent: true });
    } catch (err) {
      console.error(`[reminder email failed] member=${member.id}:`, err);
      results.push({ member_id: member.id, sent: false, reason: "send_failed" });
    }
  }

  return NextResponse.json({ checked: members.length, results });
}
