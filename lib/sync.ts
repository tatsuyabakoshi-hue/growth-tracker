import { randomUUID } from "crypto";
import { after } from "next/server";
import { getDb } from "@/lib/db";
import {
  archivePage,
  isNotionEnabled,
  upsertGoalPage,
  upsertLogPage,
  upsertMemberPage,
  upsertSuggestionPage,
  type NotionEntityType,
} from "@/lib/notion";

type Job = {
  id: string;
  entity_type: NotionEntityType;
  entity_id: string;
  op: "upsert" | "archive";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
  attempts: number;
};

const MAX_ATTEMPTS = 5;
const TYPE_PRIORITY: Record<NotionEntityType, number> = { member: 0, goal: 1, log: 2, suggestion: 3 };

/**
 * Notion同期ジョブをキューに積む（非同期・後追い）。
 * Notionが未設定なら何もしない。
 */
export async function enqueueNotionJob(
  entityType: NotionEntityType,
  entityId: string,
  op: "upsert" | "archive",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: Record<string, any> = {}
): Promise<void> {
  if (!isNotionEnabled()) return;
  const sql = getDb();
  await sql`
    INSERT INTO notion_sync_jobs (id, entity_type, entity_id, op, payload, attempts, created_at)
    VALUES (${randomUUID()}, ${entityType}, ${entityId}, ${op}, ${JSON.stringify(payload)}::jsonb, 0, ${Date.now()})
  `;
  // 応答後に自動でドレイン（速やかに反映）。Cronドレインが失敗分を後追いで拾う。
  try {
    after(async () => {
      try {
        await drainNotionJobs(10);
      } catch {
        // 失敗分はCronまたは次回のenqueueで再処理される
      }
    });
  } catch {
    // リクエストスコープ外（Cron内など）ではafter()が使えないため無視
  }
}

async function processUpsert(job: Job): Promise<void> {
  const sql = getDb();

  if (job.entity_type === "member") {
    const rows = await sql`
      SELECT id, name, email, reminder_enabled, created_at, notion_page_id
      FROM members WHERE id = ${job.entity_id}
    `;
    if (rows.length === 0) return;
    const m = rows[0];
    const pageId = await upsertMemberPage({
      pageId: m.notion_page_id as string | null,
      name: m.name as string,
      email: m.email as string | null,
      reminderEnabled: Boolean(m.reminder_enabled),
      createdAt: m.created_at as number,
    });
    if (pageId !== m.notion_page_id) {
      await sql`UPDATE members SET notion_page_id = ${pageId} WHERE id = ${job.entity_id}`;
    }
    return;
  }

  if (job.entity_type === "goal") {
    const rows = await sql`
      SELECT g.id, g.content, g.kind, g.category, g.status, g.target_date, g.success_criteria,
             g.resolved_summary, g.created_at, g.resolved_at, g.notion_page_id,
             m.notion_page_id AS member_page_id
      FROM growth_goals g JOIN members m ON m.id = g.member_id
      WHERE g.id = ${job.entity_id}
    `;
    if (rows.length === 0) return;
    const g = rows[0];
    const relatedLogs = (await sql`
      SELECT notion_page_id FROM action_logs
      WHERE related_goal_id = ${job.entity_id} AND notion_page_id IS NOT NULL
    `) as { notion_page_id: string }[];
    const pageId = await upsertGoalPage({
      pageId: g.notion_page_id as string | null,
      memberPageId: g.member_page_id as string | null,
      content: g.content as string,
      kind: (g.kind as "worry" | "goal") || "worry",
      category: g.category as string | null,
      status: g.status as "open" | "resolved",
      targetDate: g.target_date as string | null,
      successCriteria: g.success_criteria as string | null,
      resolvedSummary: g.resolved_summary as string | null,
      createdAt: g.created_at as number,
      resolvedAt: g.resolved_at as number | null,
      relatedLogPageIds: relatedLogs.map((r) => r.notion_page_id),
    });
    if (pageId !== g.notion_page_id) {
      await sql`UPDATE growth_goals SET notion_page_id = ${pageId} WHERE id = ${job.entity_id}`;
    }
    return;
  }

  if (job.entity_type === "log") {
    const rows = await sql`
      SELECT l.id, l.content, l.category, l.confidence, l.effect, l.context, l.log_date,
             l.created_at, l.notion_page_id,
             m.notion_page_id AS member_page_id,
             g.notion_page_id AS goal_page_id
      FROM action_logs l
      JOIN members m ON m.id = l.member_id
      LEFT JOIN growth_goals g ON g.id = l.related_goal_id
      WHERE l.id = ${job.entity_id}
    `;
    if (rows.length === 0) return;
    const l = rows[0];
    const pageId = await upsertLogPage({
      pageId: l.notion_page_id as string | null,
      memberPageId: l.member_page_id as string | null,
      relatedGoalPageId: l.goal_page_id as string | null,
      content: l.content as string,
      category: l.category as string | null,
      confidence: l.confidence as number | null,
      effect: l.effect as string | null,
      context: l.context as string | null,
      logDate: l.log_date as string,
      createdAt: l.created_at as number,
    });
    if (pageId !== l.notion_page_id) {
      await sql`UPDATE action_logs SET notion_page_id = ${pageId} WHERE id = ${job.entity_id}`;
    }
    return;
  }

  if (job.entity_type === "suggestion") {
    const rows = await sql`
      SELECT s.id, s.content, s.evidence, s.created_at, s.notion_page_id,
             m.name AS member_name, m.notion_page_id AS member_page_id
      FROM suggestions s JOIN members m ON m.id = s.member_id
      WHERE s.id = ${job.entity_id}
    `;
    if (rows.length === 0) return;
    const s = rows[0];
    const evidence = (s.evidence || {}) as { logIds?: string[]; text?: string };
    const logIds = evidence.logIds || [];
    let evidenceLogPageIds: string[] = [];
    if (logIds.length > 0) {
      const logRows = (await sql`
        SELECT notion_page_id FROM action_logs
        WHERE id = ANY(${logIds}) AND notion_page_id IS NOT NULL
      `) as { notion_page_id: string }[];
      evidenceLogPageIds = logRows.map((r) => r.notion_page_id);
    }
    const pageId = await upsertSuggestionPage({
      pageId: s.notion_page_id as string | null,
      memberPageId: s.member_page_id as string | null,
      memberName: s.member_name as string,
      content: s.content as string,
      evidenceText: evidence.text || "",
      evidenceLogPageIds,
      createdAt: s.created_at as number,
    });
    if (pageId !== s.notion_page_id) {
      await sql`UPDATE suggestions SET notion_page_id = ${pageId} WHERE id = ${job.entity_id}`;
    }
    return;
  }
}

async function processJob(job: Job): Promise<void> {
  if (job.op === "archive") {
    const pageId = job.payload?.notionPageId as string | undefined;
    if (pageId) await archivePage(pageId);
    return;
  }
  await processUpsert(job);
}

/**
 * 未処理のジョブを順に処理する（Vercel Cronから呼ぶ）。
 * member → goal → log → suggestion の順で処理し、リレーションの土台を先に作る。
 */
export async function drainNotionJobs(maxJobs = 30): Promise<{ processed: number; failed: number }> {
  if (!isNotionEnabled()) return { processed: 0, failed: 0 };
  const sql = getDb();

  const jobs = (await sql`
    UPDATE notion_sync_jobs
    SET processed_at = ${Date.now()}
    WHERE id IN (
      SELECT id FROM notion_sync_jobs
      WHERE processed_at IS NULL
      ORDER BY created_at ASC
      LIMIT ${maxJobs}
    )
    RETURNING id, entity_type, entity_id, op, payload, attempts
  `) as Job[];

  jobs.sort((a, b) => (TYPE_PRIORITY[a.entity_type] ?? 9) - (TYPE_PRIORITY[b.entity_type] ?? 9));

  let processed = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      await processJob(job);
      await sql`UPDATE notion_sync_jobs SET last_error = NULL WHERE id = ${job.id}`;
      processed++;
    } catch (err) {
      failed++;
      const attempts = job.attempts + 1;
      const message = err instanceof Error ? err.message : String(err);
      const giveUp = attempts >= MAX_ATTEMPTS;
      await sql`
        UPDATE notion_sync_jobs
        SET attempts = ${attempts},
            last_error = ${message},
            processed_at = ${giveUp ? Date.now() : null}
        WHERE id = ${job.id}
      `;
      console.error(`[notion sync failed] job=${job.id} type=${job.entity_type} attempts=${attempts}:`, message);
    }
  }

  return { processed, failed };
}
