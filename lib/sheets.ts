import { after } from "next/server";
import { getDb } from "@/lib/db";

/**
 * Googleスプレッドシート同期（管理・俯瞰用ミラー）。
 *
 * Postgresが常に正のデータで、スプレッドシートは「人が見るための写し」。
 * Notionと同じく、同期に失敗してもアプリの動作は止めない。
 *
 * 方式は「スナップショット同期」: 現在の全データをまとめてPOSTし、
 * 受け側のGoogle Apps ScriptがIDをキーに upsert（不要行は削除）する。
 * これにより、後追いの取りこぼしがあっても次回で必ず一致する。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** スプレッドシート同期が有効か（WebアプリURLが設定されているか）。 */
export function isSheetsEnabled(): boolean {
  return Boolean(process.env.SHEETS_WEBHOOK_URL);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** ミリ秒をJSTの「YYYY-MM-DD HH:mm」に整形する。 */
function fmtDateTime(ms: number | null | undefined): string {
  if (!ms) return "";
  const d = new Date(ms + JST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export type SheetsSyncResult = {
  ok: boolean;
  skipped?: boolean;
  counts?: Record<string, unknown>;
};

/** 現在の全データをスプレッドシートへ同期する（全件スナップショット）。 */
export async function pushSnapshotToSheets(): Promise<SheetsSyncResult> {
  if (!isSheetsEnabled()) return { ok: false, skipped: true };

  const url = process.env.SHEETS_WEBHOOK_URL as string;
  const secret = process.env.SHEETS_WEBHOOK_SECRET || "";
  const sql = getDb();

  const members = (await sql`
    SELECT id, name, email, reminder_enabled, created_at
    FROM members ORDER BY created_at ASC
  `) as {
    id: string;
    name: string;
    email: string | null;
    reminder_enabled: boolean;
    created_at: number;
  }[];

  const goals = (await sql`
    SELECT g.id, g.member_id, m.name AS member_name, g.kind, g.content, g.category, g.status,
           g.target_date, g.success_criteria, g.resolved_summary, g.created_at, g.resolved_at
    FROM growth_goals g JOIN members m ON m.id = g.member_id
    ORDER BY g.created_at ASC
  `) as {
    id: string;
    member_id: string;
    member_name: string;
    kind: string;
    content: string;
    category: string | null;
    status: string;
    target_date: string | null;
    success_criteria: string | null;
    resolved_summary: string | null;
    created_at: number;
    resolved_at: number | null;
  }[];

  const logs = (await sql`
    SELECT l.id, l.member_id, m.name AS member_name, l.log_date, l.content, l.category,
           l.confidence, l.effect, l.context, l.created_at, g.content AS goal_content
    FROM action_logs l
    JOIN members m ON m.id = l.member_id
    LEFT JOIN growth_goals g ON g.id = l.related_goal_id
    ORDER BY l.log_date ASC, l.created_at ASC
  `) as {
    id: string;
    member_id: string;
    member_name: string;
    log_date: string;
    content: string;
    category: string | null;
    confidence: number | null;
    effect: string | null;
    context: string | null;
    created_at: number;
    goal_content: string | null;
  }[];

  const suggestions = (await sql`
    SELECT s.id, s.member_id, m.name AS member_name, s.content, s.evidence, s.created_at
    FROM suggestions s JOIN members m ON m.id = s.member_id
    ORDER BY s.created_at ASC
  `) as {
    id: string;
    member_id: string;
    member_name: string;
    content: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    evidence: any;
    created_at: number;
  }[];

  const payload = {
    secret,
    generatedAt: fmtDateTime(Date.now()),
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email || "",
      reminderEnabled: m.reminder_enabled,
      createdAt: fmtDateTime(m.created_at),
    })),
    goals: goals.map((g) => ({
      id: g.id,
      memberId: g.member_id,
      memberName: g.member_name,
      kind: g.kind,
      content: g.content,
      category: g.category || "",
      status: g.status,
      targetDate: g.target_date || "",
      successCriteria: g.success_criteria || "",
      resolvedSummary: g.resolved_summary || "",
      createdAt: fmtDateTime(g.created_at),
      resolvedAt: fmtDateTime(g.resolved_at),
    })),
    logs: logs.map((l) => ({
      id: l.id,
      memberId: l.member_id,
      memberName: l.member_name,
      logDate: l.log_date,
      content: l.content,
      category: l.category || "",
      confidence: l.confidence ?? "",
      effect: l.effect || "",
      context: l.context || "",
      goalContent: l.goal_content || "",
      createdAt: fmtDateTime(l.created_at),
    })),
    suggestions: suggestions.map((s) => ({
      id: s.id,
      memberId: s.member_id,
      memberName: s.member_name,
      content: s.content,
      evidenceText: (s.evidence && s.evidence.text) || "",
      createdAt: fmtDateTime(s.created_at),
    })),
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`Sheets webhook failed: HTTP ${res.status}`);
  }
  let counts: Record<string, unknown> | undefined;
  try {
    counts = await res.json();
  } catch {
    counts = undefined;
  }
  return { ok: true, counts };
}

/**
 * 書き込み後にスプレッドシート同期を予約する（応答後に実行）。
 * リクエストスコープ外（Cron内など）では何もしない。
 */
export function scheduleSheetsSync(): void {
  if (!isSheetsEnabled()) return;
  try {
    after(async () => {
      try {
        await pushSnapshotToSheets();
      } catch (err) {
        console.error("[sheets sync failed]", err);
      }
    });
  } catch {
    // after()が使えないスコープでは無視（Cronが後追いで拾う）
  }
}
