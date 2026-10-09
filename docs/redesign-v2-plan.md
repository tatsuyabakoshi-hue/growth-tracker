# 成長トラッカー リデザイン v2 プラン

## 目的（成功の定義）
本人（CSメンバー）が「自分の成長を実感できる」こと。
そのために、入口（書けない）・実感（伸びが見えない）・AI（受け身・根拠不明）を改善する。

## 全体方針（C: ハイブリッド）
- 正 = Postgres（Neon）
- Notion = 管理・俯瞰の主役（自動蓄積、リレーション＋ロールアップ）
- アプリ = 本人用（パスワードロック）

## 可視性
- メンバー間は不可視（他メンバーの記載は見えない）
- 管理者（マスターパスワード）は全閲覧
- 共有ON/OFFは撤廃（`visible_to_admin` カラムは残し常に共有、UIのチェックボックスを撤去）

## 1. Postgres スキーマ（追加のみ）

### growth_goals に追加
- `kind` TEXT（'worry' | 'goal'）
- `category` TEXT NULL（対応品質 / スピード / 課題発見）
- `target_date` TEXT NULL
- `success_criteria` TEXT NULL
- `resolved_summary` TEXT NULL（解決時にAIが1行要約を保存）

### action_logs に追加
- `category` TEXT NULL（UIでは必須。既存行は null 許容）
- `confidence` INT（1-5、UIでは必須）
- `effect` TEXT NULL
- `context` TEXT NULL（場面・相手）
- `content` = やったこと
- `related_goal_id`（既存の任意紐付けをそのまま使用）

### suggestions に追加
- `evidence` JSONB（参照したログID / 目標IDの配列）

### 新規テーブル
- `notion_sync_jobs`
  - id / entity_type('goal'|'log'|'suggestion') / entity_id / op('upsert'|'archive') / attempts / last_error / created_at / processed_at
  - index: (processed_at, created_at)

### 変更なし
- members / suggestion_messages

## 2. Notion 構成（ゼロから設計）

### メンバーDB
- 名前(title) / メール(email) / リマインド(checkbox) / 作成日(date)
- ロールアップ: ログ数(count) / 平均手応え(average) / 未解決(count) / 解決済(count)

### 悩み・目標DB
- 内容(title) / 区分(select: 悩み,目標) / ステータス(select: 未解決,解決済) /
  カテゴリ(select: 対応品質,スピード,課題発見) / 期限(date) / 達成基準(rich_text) /
  作成日(date) / 解決日(date) / 要約(rich_text)
- リレーション: メンバー / 実践ログ

### 実践ログDB
- やったこと(title) / カテゴリ(select: 3軸) / 手応え(number) / 効果(rich_text) /
  場面・相手(rich_text) / 日付(date) / 作成日時(date)
- リレーション: メンバー / 悩み・目標

### 提案DB
- タイトル(title) / 提案内容(rich_text) / 根拠(rich_text) / 作成日時(date)
- リレーション: メンバー / 参照ログ

## 3. Notion 同期方式
- 非同期・自動で後追い
- 書き込み時: Postgresに確定 → `notion_sync_jobs` に積む → 即レスポンス
- 反映: Vercel Cron が `notion_sync_jobs` をドレイン（失敗は attempts でリトライ）
- リレーションは相手機の `notion_page_id` を使って紐付ける

## 4. AI 提案
- 入力: 直近20件の実践ログ＋未解決の悩み/目標＋解決済の要約
- 生成タイミング: ボタン押下＋週次。保存直後は「効果・気づき」の追記を促すのみ
- 根拠: 参照した記録IDを `evidence` に保存し、提案に引用表示
- 保存直後の促し: 効果・気づきの1行入力を提案

## 5. 入口（成長実感の土台）
- 各入力欄に記入例・テンプレ・問いかけを設置
- 実践ログ: やったこと（必須）／効果（任意・後で追記）／手応え1-5（必須）／
  カテゴリ（単一・必須）／場面・相手（任意・自由記述）
- 目標: 区分（悩み/目標）／内容／期限（任意）／達成基準（任意）／カテゴリ（任意）

## 6. 実感の可視化
- タイムライン: 悩み→実践→効果→解決の物語
- カテゴリ別の変化（件数・平均手応えの推移）

## 7. 編集
- 実践ログと目標を後から編集可能（本文・カテゴリ・手応え・効果・期限 等）
- Notionは上書き同期で整合

## 8. 認証
- 現状維持（`APP_PASSWORD` を Cookie、個人パスワードは PBKDF2）

## 9. 週次レポート
- 毎週月曜 9:00 JST（Vercel Cron + Resend）
- 管理者宛: 全利用者のAI要約＋数値
- 本人宛: 自分のAI要約＋数値

## 10. 実装順序
1. 基盤: DBスキーマ追加 / Notion構成（4DB＋リレーション＋ロールアップ） / `notion_sync_jobs`＋Cron
2. 入口: 記入例・テンプレ、入力項目の追加
3. 実感: タイムライン＋カテゴリ別の変化
4. AI: 記入直後の促し、根拠引用、20件圧縮
5. 週次レポート

## 留意
- 管理者が全部見える前提は、本音を書きにくくする可能性あり（運用でカバー要検討）
- 既存データの `category` / `confidence` は null 許容で追加（旧行保護）
