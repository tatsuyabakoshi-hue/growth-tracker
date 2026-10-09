# 成長トラッカー

CSチームメンバーの悩み事・実践ログを蓄積し、Claude APIが次のアクションを提案する4ペインツールです。
本人が自走して成長を実感できるように、進捗の可視化・AI提案の履歴化と対話・メールリマインド・Notion連携を備えています。

## 画面構成（4ペイン＋進捗バー）

- 進捗バー: 継続日数（ストリーク）、解決済み/未解決の悩み事の件数、直近8週の実践ログ件数のグラフ
- 1. 氏名一覧（新規追加・削除）
- 2. 悩み事・成長したいこと（追加・削除・解決済みにする・管理者への共有ON/OFF）
- 3. 試したこと・実践したこと・その効果（日付付きで追加・削除、関連する悩み事を任意で紐付け）
- 4. AIによる次回アクション提案（履歴を保持し、それぞれの提案に追加で質問できるチャット付き）

## 認証について

- **共通パスワード**（`APP_PASSWORD`）: ツール全体への入口。ログインしないと氏名一覧すら見えない。
- **個人パスワード**: 氏名ごとに設定。自分の悩み事・実践ログ・提案（ペイン2〜4）を開くときに必要。
- **マスターパスワード**（`MASTER_PASSWORD`）: 管理者用。個人パスワードの代わりにこれを入力すれば、誰のペイン2〜4も開ける。

個人パスワード・マスターパスワードは、共通パスワードでログイン済みであることを前提にした簡易的な閲覧ロックです。暗号的に厳密なアクセス制御ではないため、より強固な保護が必要な場合は別途検討してください。

### プライバシー（管理者への共有設定）

各「悩み事・成長したいこと」には「管理者に共有する」チェックがあります。OFFにすると、マスターパスワードで開いた閲覧者からはその項目の内容が見えなくなり、「非公開の項目」としてのみ表示されます（本人が自分のパスワードで開いた場合は常に全項目が見えます）。AI提案の生成では、このチェックの有無に関わらず本人の全記録が使われます（提案はあくまで本人の成長支援のためのものです）。

## AI提案のプロンプトについて

`lib/cs-guidelines.ts` にCSチーム視点のプロンプトを定義しています。ここを編集すれば、次の提案生成（再デプロイ後）に反映されます。

## AIプロバイダについて

`AI_PROVIDER` で切り替えられます（未指定なら設定済みキーから自動選択）。モデルは `AI_MODEL` で上書きできます。

| AI_PROVIDER | 必要な環境変数 | 既定モデル | 無料枠 |
|---|---|---|---|
| `gemini` | `GEMINI_API_KEY` | `gemini-flash-latest` | あり（Google AI Studio） |
| `groq` | `GROQ_API_KEY` | `llama-3.3-70b-versatile` | あり |
| `openrouter` | `OPENROUTER_API_KEY` | `meta-llama/llama-3.3-70b-instruct:free` | あり（`:free`） |
| `openai` | `OPENAI_API_KEY`（＋任意で`OPENAI_BASE_URL`） | `gpt-4o-mini` | 有料 |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-5-20250929` | 有料 |

例（無料のGeminiに切替）:

```bash
vercel env add AI_PROVIDER production   # gemini と入力
vercel env add GEMINI_API_KEY production # 取得したキー
vercel --prod
```

`GEMINI_API_KEY` は https://aistudio.google.com/apikey で無料発行できます。

## セットアップ

```bash
npm install
vercel link
```

Vercelダッシュボードの「Storage」からNeon Postgresを追加し、以下の環境変数を設定してください（`.env.example`参照）。

- `DATABASE_URL`（Neonから自動設定）
- AIプロバイダのキー（いずれか1つ。無料枠あり: 下記「AIプロバイダ」参照）
- `APP_PASSWORD`
- `MASTER_PASSWORD`（任意。設定すると管理者用マスターパスワードとして使えます）

```bash
vercel env pull .env.local --environment=production
npm run db:migrate
vercel --prod
```

## ローカル開発

```bash
npm run dev
```

## Notion連携（任意）

悩み・目標／実践ログ／提案（＋メンバー）を、閲覧・整理しやすいNotionのデータベースに自動で同期できます。Postgresが常に正のデータで、Notionは管理・俯瞰用のミラーです（同期に失敗してもアプリの動作は止まりません）。

同期は**非同期（後追い）**です。書き込みは即レスポンスし、応答後に `after()` で反映、取りこぼしはCron（`/api/cron/notion-sync`）がリトライします。体感速度には影響しません。

### 自動作成（推奨）

`NOTION_API_KEY` と `NOTION_PARENT_PAGE_ID`（DBを作る親ページのID。ページURL末尾の32文字）を `.env.local` に設定して、次を実行すると、4DB＋リレーション＋ロールアップを自動作成し、設定すべきDB IDを表示します。

```bash
npm run setup:notion
```

表示された `NOTION_*_DB_ID` を環境変数に設定してください。うまくいかない場合は下記の手順で手動作成してください。

1. https://www.notion.so/my-integrations でIntegrationを作成し、シークレットキーを取得 → `NOTION_API_KEY`
2. Notion上に以下の**4つのデータベース**を作成し、各Integrationに接続（共有）する。プロパティ名は下表どおりに（型を合わせる）
3. 各データベースのDB IDを取得し、環境変数に設定

### メンバーDB
| プロパティ | 型 |
|---|---|
| 名前 | タイトル |
| メール | メール |
| リマインド | チェックボックス |
| 作成日 | 日付 |

任意のロールアップ: 実践ログDBのリレーション経由で「実践ログ数(count)」「平均手応え(average)」を追加。

### 悩み・目標DB
| プロパティ | 型 | 選択肢 |
|---|---|---|
| 内容 | タイトル | |
| 区分 | セレクト | 悩み / 目標 |
| ステータス | セレクト | 未解決 / 解決済 |
| カテゴリ | セレクト | 対応品質 / スピード / 課題発見 |
| 期限 | 日付 | |
| 達成基準 | テキスト | |
| 作成日 | 日付 | |
| 解決日 | 日付 | |
| 要約 | テキスト | |
| メンバー | リレーション | メンバーDB |
| 実践ログ | リレーション | 実践ログDB |

### 実践ログDB
| プロパティ | 型 | 選択肢 |
|---|---|---|
| やったこと | タイトル | |
| カテゴリ | セレクト | 対応品質 / スピード / 課題発見 |
| 手応え | 数値 | |
| 効果 | テキスト | |
| 場面・相手 | テキスト | |
| 日付 | 日付 | |
| 作成日時 | 日付 | |
| メンバー | リレーション | メンバーDB |
| 悩み・目標 | リレーション | 悩み・目標DB |

### 提案DB
| プロパティ | 型 | 参照先 |
|---|---|---|
| タイトル | タイトル | |
| 提案内容 | テキスト | |
| 根拠 | テキスト | |
| 作成日時 | 日付 | |
| メンバー | リレーション | メンバーDB |
| 参照ログ | リレーション | 実践ログDB |

### 環境変数
- `NOTION_API_KEY`
- `NOTION_MEMBERS_DB_ID` / `NOTION_GOALS_DB_ID` / `NOTION_LOGS_DB_ID` / `NOTION_SUGGESTIONS_DB_ID`

未設定の場合、Notion同期はスキップされ、Postgresのみで通常通り動作します。

## メールリマインド（任意）

実践ログが数日（初期値3日）途絶えているメンバーに、毎日自動でリマインドメールを送信できます。

1. https://resend.com でアカウントを作成し、APIキーを取得 → `RESEND_API_KEY`
2. 送信元ドメインを検証し、`EMAIL_FROM` に設定（例: `growth-tracker@example.com`）
3. `CRON_SECRET` に任意の秘密文字列を設定（Vercel Cronからの呼び出しを認可するため）
4. [vercel.json](./vercel.json) の `crons` 設定により、`/api/cron/reminders` が毎日 UTC 1:00（JST 10:00）に自動実行される
5. アプリ内の各メンバーの「✉ 通知設定」からメールアドレスを登録し、リマインドON/OFFを設定する

リマインドのしきい値（何日ログが無ければ送るか）は [app/api/cron/reminders/route.ts](./app/api/cron/reminders/route.ts) の `REMINDER_THRESHOLD_DAYS` で変更できます。

未設定（`RESEND_API_KEY`または`EMAIL_FROM`が無い）の場合、cronは何もせずエラーを返すのみでアプリの他機能には影響しません。

## 週次レポート（任意）

毎週月曜 09:00（JST）に、`/api/cron/weekly-report` が次を配信します。

- **本人宛**: 今週の実践ログ件数・カテゴリ別内訳・平均手応え・今週解決した悩み/目標・AIからのひとこと
- **管理者宛**: 全メンバー分をまとめた週次レポート（`ADMIN_EMAIL`に送信）

必要な環境変数:

- `RESEND_API_KEY` / `EMAIL_FROM`（リマインドと共通）
- `ADMIN_EMAIL`（管理者宛レポートの送信先。未設定なら管理者宛はスキップ）
- `CRON_SECRET`（Cron呼び出しの認可。未設定なら認可スキップ）
