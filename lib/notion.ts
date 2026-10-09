import { Client } from "@notionhq/client";

let client: Client | null = null;

function getNotionClient(): Client {
  if (!client) {
    const apiKey = process.env.NOTION_API_KEY;
    if (!apiKey) {
      throw new Error("NOTION_API_KEY is not set");
    }
    client = new Client({ auth: apiKey });
  }
  return client;
}

export type NotionEntityType = "member" | "goal" | "log" | "suggestion";

/** Notion同期が有効か（APIキーと必要なDB IDが揃っているか）。 */
export function isNotionEnabled(): boolean {
  return Boolean(
    process.env.NOTION_API_KEY &&
      process.env.NOTION_MEMBERS_DB_ID &&
      process.env.NOTION_GOALS_DB_ID &&
      process.env.NOTION_LOGS_DB_ID &&
      process.env.NOTION_SUGGESTIONS_DB_ID
  );
}

const MAX_RICH_TEXT_CHUNK = 1900;
const MAX_RICH_TEXT_BLOCKS = 90; // Notion API上限(100)に余裕を持たせる

// Notionのrich_textは1要素あたり2000文字までのため、長文は分割して複数要素にする。
function toRichText(text: string | null | undefined) {
  const source = text || "";
  const chunks: string[] = [];
  for (let i = 0; i < source.length; i += MAX_RICH_TEXT_CHUNK) {
    chunks.push(source.slice(i, i + MAX_RICH_TEXT_CHUNK));
  }
  if (chunks.length === 0) chunks.push("");
  return chunks.slice(0, MAX_RICH_TEXT_BLOCKS).map((chunk) => ({ text: { content: chunk } }));
}

function toTitle(text: string | null | undefined) {
  return [{ text: { content: (text || "").slice(0, 200) } }];
}

function toIso(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Props = Record<string, any>;

async function createPage(databaseId: string, properties: Props): Promise<string> {
  const notion = getNotionClient();
  const page = await notion.pages.create({ parent: { database_id: databaseId }, properties });
  return page.id;
}

async function updatePage(pageId: string, properties: Props): Promise<string> {
  const notion = getNotionClient();
  const page = await notion.pages.update({ page_id: pageId, properties });
  return page.id;
}

/** 既存ページがあれば更新、なければ作成する。 */
async function upsertPage(databaseId: string, existingPageId: string | null | undefined, properties: Props): Promise<string> {
  if (existingPageId) {
    return updatePage(existingPageId, properties);
  }
  return createPage(databaseId, properties);
}

export async function archivePage(pageId: string): Promise<void> {
  const notion = getNotionClient();
  await notion.pages.update({ page_id: pageId, archived: true });
}

function dbId(envKey: string): string {
  const id = process.env[envKey];
  if (!id) throw new Error(`${envKey} is not set`);
  return id;
}

export async function upsertMemberPage(params: {
  pageId?: string | null;
  name: string;
  email: string | null;
  reminderEnabled: boolean;
  createdAt: number;
}): Promise<string> {
  return upsertPage(dbId("NOTION_MEMBERS_DB_ID"), params.pageId, {
    名前: { title: toTitle(params.name) },
    メール: { email: params.email || null },
    リマインド: { checkbox: params.reminderEnabled },
    作成日: { date: { start: toIso(params.createdAt) } },
  });
}

export async function upsertGoalPage(params: {
  pageId?: string | null;
  memberPageId?: string | null;
  content: string;
  kind: "worry" | "goal";
  category: string | null;
  status: "open" | "resolved";
  targetDate: string | null;
  successCriteria: string | null;
  resolvedSummary: string | null;
  createdAt: number;
  resolvedAt: number | null;
  relatedLogPageIds?: string[];
}): Promise<string> {
  const properties: Props = {
    内容: { title: toTitle(params.content) },
    区分: { select: { name: params.kind === "goal" ? "目標" : "悩み" } },
    ステータス: { select: { name: params.status === "resolved" ? "解決済" : "未解決" } },
    カテゴリ: { select: params.category ? { name: params.category } : null },
    期限: { date: params.targetDate ? { start: params.targetDate } : null },
    達成基準: { rich_text: toRichText(params.successCriteria) },
    作成日: { date: { start: toIso(params.createdAt) } },
    解決日: { date: params.resolvedAt ? { start: toIso(params.resolvedAt) } : null },
    要約: { rich_text: toRichText(params.resolvedSummary) },
  };
  if (params.memberPageId) {
    properties.メンバー = { relation: [{ id: params.memberPageId }] };
  }
  if (params.relatedLogPageIds) {
    properties.実践ログ = { relation: params.relatedLogPageIds.map((id) => ({ id })) };
  }
  return upsertPage(dbId("NOTION_GOALS_DB_ID"), params.pageId, properties);
}

export async function upsertLogPage(params: {
  pageId?: string | null;
  memberPageId?: string | null;
  relatedGoalPageId?: string | null;
  content: string;
  category: string | null;
  confidence: number | null;
  effect: string | null;
  context: string | null;
  logDate: string;
  createdAt: number;
}): Promise<string> {
  const properties: Props = {
    やったこと: { title: toTitle(params.content) },
    カテゴリ: { select: params.category ? { name: params.category } : null },
    手応え: { number: params.confidence ?? null },
    効果: { rich_text: toRichText(params.effect) },
    "場面・相手": { rich_text: toRichText(params.context) },
    日付: { date: { start: params.logDate } },
    作成日時: { date: { start: toIso(params.createdAt) } },
  };
  if (params.memberPageId) {
    properties.メンバー = { relation: [{ id: params.memberPageId }] };
  }
  if (params.relatedGoalPageId) {
    properties["悩み・目標"] = { relation: [{ id: params.relatedGoalPageId }] };
  }
  return upsertPage(dbId("NOTION_LOGS_DB_ID"), params.pageId, properties);
}

export async function upsertSuggestionPage(params: {
  pageId?: string | null;
  memberPageId?: string | null;
  memberName: string;
  content: string;
  evidenceText: string;
  evidenceLogPageIds?: string[];
  createdAt: number;
}): Promise<string> {
  const title = `${params.memberName}への提案 (${new Date(params.createdAt).toLocaleString("ja-JP")})`;
  const properties: Props = {
    タイトル: { title: toTitle(title) },
    提案内容: { rich_text: toRichText(params.content) },
    根拠: { rich_text: toRichText(params.evidenceText) },
    作成日時: { date: { start: toIso(params.createdAt) } },
  };
  if (params.memberPageId) {
    properties.メンバー = { relation: [{ id: params.memberPageId }] };
  }
  if (params.evidenceLogPageIds) {
    properties.参照ログ = { relation: params.evidenceLogPageIds.map((id) => ({ id })) };
  }
  return upsertPage(dbId("NOTION_SUGGESTIONS_DB_ID"), params.pageId, properties);
}
