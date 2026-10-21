import { getDb } from "@/lib/db";

const CS_CATEGORIES = ["対応品質", "スピード", "課題発見"];

export type AdminMember = {
  id: string;
  name: string;
  email: string | null;
  streak: number;
  logs_total: number;
  logs_week: number;
  logs_30: number;
  avg_confidence: number | null;
  last_log_date: string | null;
  goals_open: number;
  goals_resolved: number;
  overdue: number;
  categories: Record<string, { count: number; avg: number | null }>;
};

export type AdminOverview = {
  members: AdminMember[];
  totals: { members: number; logs_week: number; active_week: number; goals_open: number; overdue: number };
  generated_at: number;
};

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoStr(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** ログのある日付集合から、今日（無ければ昨日）を起点に連続日数を数える。 */
function calcStreak(dateSet: Set<string>): number {
  let cursor = todayStr();
  if (!dateSet.has(cursor)) cursor = addDays(cursor, -1);
  let streak = 0;
  while (dateSet.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

type MemberAgg = {
  id: string;
  name: string;
  email: string | null;
  logs_total: number;
  logs_week: number;
  logs_30: number;
  avg_confidence: number | string | null;
  last_log_date: string | null;
  goals_open: number;
  goals_resolved: number;
  overdue: number;
};

/** 管理者向けの全メンバー俯瞰データを組み立てる（直近30日基準）。 */
export async function getAdminOverview(): Promise<AdminOverview> {
  const sql = getDb();
  const start7 = daysAgoStr(6);
  const start30 = daysAgoStr(29);
  const today = todayStr();

  const members = (await sql`
    SELECT
      m.id,
      m.name,
      m.email,
      (SELECT COUNT(*)::int FROM action_logs l WHERE l.member_id = m.id) AS logs_total,
      (SELECT COUNT(*)::int FROM action_logs l WHERE l.member_id = m.id AND l.log_date >= ${start7}) AS logs_week,
      (SELECT COUNT(*)::int FROM action_logs l WHERE l.member_id = m.id AND l.log_date >= ${start30}) AS logs_30,
      (SELECT AVG(l.confidence) FROM action_logs l
        WHERE l.member_id = m.id AND l.confidence IS NOT NULL AND l.log_date >= ${start30}) AS avg_confidence,
      (SELECT MAX(l.log_date) FROM action_logs l WHERE l.member_id = m.id) AS last_log_date,
      (SELECT COUNT(*)::int FROM growth_goals g WHERE g.member_id = m.id AND g.status <> 'resolved') AS goals_open,
      (SELECT COUNT(*)::int FROM growth_goals g WHERE g.member_id = m.id AND g.status = 'resolved') AS goals_resolved,
      (SELECT COUNT(*)::int FROM growth_goals g
        WHERE g.member_id = m.id AND g.status <> 'resolved'
          AND g.target_date IS NOT NULL AND g.target_date < ${today}) AS overdue
    FROM members m
    ORDER BY m.created_at ASC
  `) as MemberAgg[];

  const catRows = (await sql`
    SELECT member_id, category, COUNT(*)::int AS count, AVG(confidence) AS avg
    FROM action_logs
    WHERE log_date >= ${start30} AND category IS NOT NULL
    GROUP BY member_id, category
  `) as { member_id: string; category: string; count: number; avg: number | string | null }[];

  const dateRows = (await sql`
    SELECT DISTINCT member_id, log_date FROM action_logs
  `) as { member_id: string; log_date: string }[];

  const datesByMember = new Map<string, Set<string>>();
  for (const r of dateRows) {
    if (!datesByMember.has(r.member_id)) datesByMember.set(r.member_id, new Set());
    datesByMember.get(r.member_id)!.add(r.log_date);
  }

  const catByMember = new Map<string, Record<string, { count: number; avg: number | null }>>();
  for (const m of members) {
    catByMember.set(
      m.id,
      Object.fromEntries(CS_CATEGORIES.map((c) => [c, { count: 0, avg: null }]))
    );
  }
  for (const r of catRows) {
    const bag = catByMember.get(r.member_id);
    if (bag && CS_CATEGORIES.includes(r.category)) {
      bag[r.category] = { count: r.count, avg: r.avg !== null ? Number(r.avg) : null };
    }
  }

  const result: AdminMember[] = members.map((m) => ({
    id: m.id,
    name: m.name,
    email: m.email,
    streak: calcStreak(datesByMember.get(m.id) || new Set()),
    logs_total: m.logs_total,
    logs_week: m.logs_week,
    logs_30: m.logs_30,
    avg_confidence: m.avg_confidence !== null ? Number(m.avg_confidence) : null,
    last_log_date: m.last_log_date,
    goals_open: m.goals_open,
    goals_resolved: m.goals_resolved,
    overdue: m.overdue,
    categories: catByMember.get(m.id) || {},
  }));

  const totals = {
    members: result.length,
    logs_week: result.reduce((s, m) => s + m.logs_week, 0),
    active_week: result.filter((m) => m.logs_week > 0).length,
    goals_open: result.reduce((s, m) => s + m.goals_open, 0),
    overdue: result.reduce((s, m) => s + m.overdue, 0),
  };

  return { members: result, totals, generated_at: Date.now() };
}
