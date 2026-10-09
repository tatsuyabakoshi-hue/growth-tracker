import { config } from "dotenv";

config({ path: ".env.local" });

import { Client } from "@notionhq/client";

/* eslint-disable @typescript-eslint/no-explicit-any */

const CATEGORIES = ["対応品質", "スピード", "課題発見"];

function dsId(db: any): string {
  const id = db?.data_sources?.[0]?.id;
  if (!id) throw new Error("data source の取得に失敗しました（SDK/APIバージョンをご確認ください）");
  return id;
}

async function main() {
  const apiKey = process.env.NOTION_API_KEY;
  const parentPageId = process.env.NOTION_PARENT_PAGE_ID;
  if (!apiKey) throw new Error("NOTION_API_KEY が設定されていません");
  if (!parentPageId) {
    throw new Error(
      "NOTION_PARENT_PAGE_ID が設定されていません（DBを作る親ページのID。ページURL末尾の32文字）"
    );
  }

  const notion = new Client({ auth: apiKey });
  const parent = { type: "page_id" as const, page_id: parentPageId };

  console.log("メンバーDBを作成中...");
  const membersDb = await (notion.databases.create as any)({
    parent,
    title: [{ text: { content: "メンバー" } }],
    initial_data_source: {
      properties: {
        名前: { title: {} },
        メール: { email: {} },
        リマインド: { checkbox: {} },
        作成日: { date: {} },
      },
    },
  });
  const membersDs = dsId(membersDb);

  console.log("悩み・目標DBを作成中...");
  const goalsDb = await (notion.databases.create as any)({
    parent,
    title: [{ text: { content: "悩み・目標" } }],
    initial_data_source: {
      properties: {
        内容: { title: {} },
        区分: { select: { options: [{ name: "悩み" }, { name: "目標" }] } },
        ステータス: { select: { options: [{ name: "未解決" }, { name: "解決済" }] } },
        カテゴリ: { select: { options: CATEGORIES.map((name) => ({ name })) } },
        期限: { date: {} },
        達成基準: { rich_text: {} },
        作成日: { date: {} },
        解決日: { date: {} },
        要約: { rich_text: {} },
        メンバー: {
          relation: {
            data_source_id: membersDs,
            type: "dual_property",
            dual_property: { synced_property_name: "目標" },
          },
        },
      },
    },
  });
  const goalsDs = dsId(goalsDb);

  console.log("実践ログDBを作成中...");
  const logsDb = await (notion.databases.create as any)({
    parent,
    title: [{ text: { content: "実践ログ" } }],
    initial_data_source: {
      properties: {
        やったこと: { title: {} },
        カテゴリ: { select: { options: CATEGORIES.map((name) => ({ name })) } },
        手応え: { number: {} },
        効果: { rich_text: {} },
        "場面・相手": { rich_text: {} },
        日付: { date: {} },
        作成日時: { date: {} },
        メンバー: {
          relation: {
            data_source_id: membersDs,
            type: "dual_property",
            dual_property: { synced_property_name: "実践ログ" },
          },
        },
      },
    },
  });
  const logsDs = dsId(logsDb);

  console.log("提案DBを作成中...");
  const suggestionsDb = await (notion.databases.create as any)({
    parent,
    title: [{ text: { content: "提案" } }],
    initial_data_source: {
      properties: {
        タイトル: { title: {} },
        提案内容: { rich_text: {} },
        根拠: { rich_text: {} },
        作成日時: { date: {} },
        メンバー: {
          relation: {
            data_source_id: membersDs,
            type: "dual_property",
            dual_property: { synced_property_name: "提案" },
          },
        },
      },
    },
  });
  const suggestionsDs = dsId(suggestionsDb);

  console.log("リレーションを接続中...");
  await (notion.dataSources.update as any)({
    data_source_id: goalsDs,
    properties: {
      実践ログ: {
        relation: { data_source_id: logsDs, type: "single_property", single_property: {} },
      },
    },
  });
  await (notion.dataSources.update as any)({
    data_source_id: logsDs,
    properties: {
      "悩み・目標": {
        relation: { data_source_id: goalsDs, type: "single_property", single_property: {} },
      },
    },
  });
  await (notion.dataSources.update as any)({
    data_source_id: suggestionsDs,
    properties: {
      参照ログ: {
        relation: { data_source_id: logsDs, type: "single_property", single_property: {} },
      },
    },
  });

  console.log("メンバー側にロールアップを追加中...");
  await (notion.dataSources.update as any)({
    data_source_id: membersDs,
    properties: {
      実践ログ数: {
        rollup: {
          relation_property_name: "実践ログ",
          rollup_property_name: "やったこと",
          function: "count",
        },
      },
      平均手応え: {
        rollup: {
          relation_property_name: "実践ログ",
          rollup_property_name: "手応え",
          function: "average",
        },
      },
    },
  });

  const dbIds = {
    members: membersDb.id,
    goals: goalsDb.id,
    logs: logsDb.id,
    suggestions: suggestionsDb.id,
  };

  console.log("\n完了しました。以下の環境変数を設定してください（Vercel / .env.local）:\n");
  console.log(`NOTION_MEMBERS_DB_ID=${dbIds.members}`);
  console.log(`NOTION_GOALS_DB_ID=${dbIds.goals}`);
  console.log(`NOTION_LOGS_DB_ID=${dbIds.logs}`);
  console.log(`NOTION_SUGGESTIONS_DB_ID=${dbIds.suggestions}`);
  console.log(
    "\n親ページにIntegrationを接続しておけば、作成された子DBも同期対象になります。うまくいかない場合はREADMEの手動セットアップを参照してください。"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
