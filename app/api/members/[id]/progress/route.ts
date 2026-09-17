import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

type RouteParams = { params: Promise<{ id: string }> };

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function startOfWeek(dateStr: string): string {
  // ISO(月曜始まり)の週の開始日を返す
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMonday);
  return d.toISOString().slice(0, 10);
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const sql = getDb();

  const logDateRows = (await sql`
    SELECT DISTINCT log_date FROM action_logs WHERE member_id = ${id}
  `) as { log_date: string }[];
  const dateSet = new Set(logDateRows.map((r) => r.log_date));

  // ストリーク計算: 今日ログがまだ無い場合は昨日を起点にする(1日の猶予)
  let cursor = todayStr();
  if (!dateSet.has(cursor)) {
    cursor = addDays(cursor, -1);
  }
  let streak = 0;
  while (dateSet.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }

  const goalCountRows = (await sql`
    SELECT status, COUNT(*)::int AS count FROM growth_goals
    WHERE member_id = ${id}
    GROUP BY status
  `) as { status: string; count: number }[];
  let goalsOpen = 0;
  let goalsResolved = 0;
  for (const row of goalCountRows) {
    if (row.status === "resolved") goalsResolved = row.count;
    else goalsOpen += row.count;
  }

  // 直近8週分の実践ログ件数(月曜始まり)。データが無い週は0で埋める。
  const weeklyRows = (await sql`
    SELECT date_trunc('week', log_date::date)::date AS week_start, COUNT(*)::int AS count
    FROM action_logs
    WHERE member_id = ${id} AND log_date::date >= (CURRENT_DATE - INTERVAL '8 weeks')
    GROUP BY week_start
    ORDER BY week_start ASC
  `) as { week_start: string; count: number }[];
  const weeklyMap = new Map(weeklyRows.map((r) => [r.week_start, r.count]));

  const currentWeekStart = startOfWeek(todayStr());
  const weeklyCounts: { week_start: string; count: number }[] = [];
  for (let i = 7; i >= 0; i--) {
    const d = new Date(`${currentWeekStart}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i * 7);
    const weekStart = d.toISOString().slice(0, 10);
    weeklyCounts.push({ week_start: weekStart, count: weeklyMap.get(weekStart) ?? 0 });
  }

  return NextResponse.json({
    streak,
    goals_open: goalsOpen,
    goals_resolved: goalsResolved,
    weekly_counts: weeklyCounts,
  });
}
