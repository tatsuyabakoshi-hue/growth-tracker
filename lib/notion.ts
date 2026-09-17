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

const MAX_RICH_TEXT_CHUNK = 1900;
const MAX_RICH_TEXT_BLOCKS = 90; // Notion API上限(100)に余裕を持たせる

// Notionのrich_textは1要素あたり2000文字までのため、長文は分割して複数要素にする。
function toRichText(text: string) {
  const source = text || "";
  const chunks: string[] = [];
  for (let i = 0; i < source.length; i += MAX_RICH_TEXT_CHUNK) {
    chunks.push(source.slice(i, i + MAX_RICH_TEXT_CHUNK));
  }
  if (chunks.length === 0) chunks.push("");
  return chunks.slice(0, MAX_RICH_TEXT_BLOCKS).map((chunk) => ({ text: { content: chunk } }));
}

function toTitle(text: string) {
  return [{ text: { content: (text || "").slice(0, 200) } }];
}

function toIsoDate(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

type UpsertResult = { pageId: string };

async function upsertPage(
  databaseId: string,
  existingPageId: string | null | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  properties: Record<string, any>
): Promise<UpsertResult> {
  const notion = getNotionClient();

  if (existingPageId) {
    const page = await notion.pages.update({ page_id: existingPageId, properties });
    return { pageId: page.id };
  }

  const page = await notion.pages.create({
    parent: { database_id: databaseId },
    properties,
  });
  return { pageId: page.id };
}

export async function upsertGoalPage(params: {
  pageId?: string | null;
  memberName: string;
  content: string;
  status: "open" | "resolved";
  createdAt: number;
}): Promise<UpsertResult> {
  const databaseId = process.env.NOTION_GOALS_DB_ID;
  if (!databaseId) throw new Error("NOTION_GOALS_DB_ID is not set");

  return upsertPage(databaseId, params.pageId, {
    内容: { title: toTitle(params.content) },
    氏名: { rich_text: toRichText(params.memberName) },
    ステータス: { select: { name: params.status === "resolved" ? "解決済み" : "未解決" } },
    作成日: { date: { start: toIsoDate(params.createdAt) } },
  });
}

export async function upsertLogPage(params: {
  pageId?: string | null;
  memberName: string;
  content: string;
  logDate: string;
  createdAt: number;
}): Promise<UpsertResult> {
  const databaseId = process.env.NOTION_LOGS_DB_ID;
  if (!databaseId) throw new Error("NOTION_LOGS_DB_ID is not set");

  return upsertPage(databaseId, params.pageId, {
    内容: { title: toTitle(params.content) },
    氏名: { rich_text: toRichText(params.memberName) },
    日付: { date: { start: params.logDate } },
    詳細: { rich_text: toRichText(params.content) },
  });
}

export async function upsertSuggestionPage(params: {
  pageId?: string | null;
  memberName: string;
  content: string;
  createdAt: number;
}): Promise<UpsertResult> {
  const databaseId = process.env.NOTION_SUGGESTIONS_DB_ID;
  if (!databaseId) throw new Error("NOTION_SUGGESTIONS_DB_ID is not set");

  const title = `${params.memberName}への提案 (${new Date(params.createdAt).toLocaleString("ja-JP")})`;

  return upsertPage(databaseId, params.pageId, {
    タイトル: { title: toTitle(title) },
    氏名: { rich_text: toRichText(params.memberName) },
    提案内容: { rich_text: toRichText(params.content) },
    作成日時: { date: { start: toIsoDate(params.createdAt) } },
  });
}

export async function archivePage(pageId: string): Promise<void> {
  const notion = getNotionClient();
  await notion.pages.update({ page_id: pageId, archived: true });
}

// Notion同期は「あれば嬉しいミラー」であり、失敗してもメイン処理(Postgresへの保存)は
// 止めない。呼び出し側でこのヘルパーを使い、エラーはログに出すだけにする。
export async function syncToNotionSafely<T>(
  label: string,
  task: () => Promise<T>
): Promise<T | null> {
  try {
    return await task();
  } catch (err) {
    console.error(`[notion sync failed] ${label}:`, err);
    return null;
  }
}
