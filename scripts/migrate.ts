import { config } from "dotenv";

config({ path: ".env.local" });

import { randomUUID } from "crypto";
import { getDb } from "../lib/db";

async function main() {
  const sql = getDb();

  await sql`
    CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `;
  await sql`
    ALTER TABLE members
      ADD COLUMN IF NOT EXISTS email TEXT,
      ADD COLUMN IF NOT EXISTS reminder_enabled BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS notion_page_id TEXT
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS growth_goals (
      id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `;
  await sql`
    ALTER TABLE growth_goals
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open',
      ADD COLUMN IF NOT EXISTS resolved_at BIGINT,
      ADD COLUMN IF NOT EXISTS visible_to_admin BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS notion_page_id TEXT
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_goals_member ON growth_goals (member_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS action_logs (
      id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      log_date TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `;
  await sql`
    ALTER TABLE action_logs
      ADD COLUMN IF NOT EXISTS related_goal_id TEXT REFERENCES growth_goals(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS notion_page_id TEXT
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_logs_member ON action_logs (member_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS suggestions (
      id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      notion_page_id TEXT
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_suggestions_member ON suggestions (member_id, created_at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS suggestion_messages (
      id TEXT PRIMARY KEY,
      suggestion_id TEXT NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_messages_suggestion ON suggestion_messages (suggestion_id, created_at ASC)`;

  // v2: 目標/悩みの構造化（kind=worry|goal、期限・達成基準・解決時の要約）
  await sql`
    ALTER TABLE growth_goals
      ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'worry',
      ADD COLUMN IF NOT EXISTS category TEXT,
      ADD COLUMN IF NOT EXISTS target_date TEXT,
      ADD COLUMN IF NOT EXISTS success_criteria TEXT,
      ADD COLUMN IF NOT EXISTS resolved_summary TEXT
  `;

  // v2: 実践ログの構造化（content=やったこと、effect=効果、confidence=手応え1-5、category=CS3軸、context=場面・相手）
  await sql`
    ALTER TABLE action_logs
      ADD COLUMN IF NOT EXISTS category TEXT,
      ADD COLUMN IF NOT EXISTS confidence INT,
      ADD COLUMN IF NOT EXISTS effect TEXT,
      ADD COLUMN IF NOT EXISTS context TEXT
  `;

  // v2: 提案の根拠（参照したログ/目標IDの配列）
  await sql`
    ALTER TABLE suggestions
      ADD COLUMN IF NOT EXISTS evidence JSONB
  `;

  // v2: Notion同期キュー（非同期・後追い同期）
  await sql`
    CREATE TABLE IF NOT EXISTS notion_sync_jobs (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      op TEXT NOT NULL,
      payload JSONB,
      attempts INT NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at BIGINT NOT NULL,
      processed_at BIGINT
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_notion_jobs_queue ON notion_sync_jobs (processed_at, created_at)`;

  // 旧member_insights（提案を1件だけ上書き保存していたテーブル）が残っている場合は
  // suggestionsへ1回だけ移行してから削除する。
  const oldInsightsExists = await sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'member_insights'
    ) AS exists
  `;
  if (oldInsightsExists[0]?.exists) {
    const oldInsights = (await sql`
      SELECT member_id, suggestion, updated_at FROM member_insights WHERE suggestion IS NOT NULL
    `) as { member_id: string; suggestion: string; updated_at: number }[];

    for (const row of oldInsights) {
      await sql`
        INSERT INTO suggestions (id, member_id, content, created_at)
        VALUES (${randomUUID()}, ${row.member_id}, ${row.suggestion}, ${row.updated_at})
      `;
    }
    await sql`DROP TABLE member_insights`;
    console.log(`member_insightsから${oldInsights.length}件をsuggestionsへ移行し、旧テーブルを削除しました。`);
  }

  console.log("Migration complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
