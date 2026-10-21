# Googleスプレッドシート同期のセットアップ

Notionの代わりに、Googleスプレッドシートへ自動でデータを蓄積（ミラー）する手順です。
Postgresが常に正のデータで、スプレッドシートは「人が見るための写し」です。同期に失敗してもアプリの動作は止まりません。

所要 5〜10分。Googleアカウントだけで完結し、特別な権限は不要です。

---

## 1. スプレッドシートを用意する

1. https://sheets.new を開いて新しいスプレッドシートを作成する（名前は例: 「成長トラッカー」）
2. メニューの **拡張機能 → Apps Script** を開く

## 2. Apps Scriptにコードを貼る

エディタの中身を全部消して、下記を貼り付ける。

**`SECRET` の行を、好きな合言葉（ランダムな文字列）に変える**（この値を後でアプリ側にも設定する）。

```javascript
// ===== 設定 =====
// アプリ側の SHEETS_WEBHOOK_SECRET と同じ値にする
const SECRET = 'ここを好きな合言葉に変える（例: gt-9f3a72c1）';

const TABLES = {
  members: {
    sheet: 'メンバー',
    headers: ['ID', '氏名', 'メール', 'リマインド', '作成日'],
    row: (m) => [m.id, m.name, m.email || '', m.reminderEnabled ? 'ON' : 'OFF', m.createdAt || ''],
  },
  goals: {
    sheet: '悩み・目標',
    headers: ['ID', '氏名', '区分', '内容', 'カテゴリ', 'ステータス', '期限', '達成基準', '要約', '作成日', '解決日'],
    row: (g) => [
      g.id,
      g.memberName || '',
      g.kind === 'goal' ? '目標' : '悩み',
      g.content || '',
      g.category || '',
      g.status === 'resolved' ? '解決済' : '未解決',
      g.targetDate || '',
      g.successCriteria || '',
      g.resolvedSummary || '',
      g.createdAt || '',
      g.resolvedAt || '',
    ],
  },
  logs: {
    sheet: '実践ログ',
    headers: ['ID', '氏名', '日付', 'やったこと', 'カテゴリ', '手応え', '効果', '場面・相手', '悩み・目標', '作成日時'],
    row: (l) => [
      l.id,
      l.memberName || '',
      l.logDate || '',
      l.content || '',
      l.category || '',
      l.confidence === '' || l.confidence == null ? '' : l.confidence,
      l.effect || '',
      l.context || '',
      l.goalContent || '',
      l.createdAt || '',
    ],
  },
  suggestions: {
    sheet: 'AI提案',
    headers: ['ID', '氏名', '提案内容', '根拠', '作成日時'],
    row: (s) => [s.id, s.memberName || '', s.content || '', s.evidenceText || '', s.createdAt || ''],
  },
};

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const body = JSON.parse(e.postData.contents);
    if (SECRET && body.secret !== SECRET) {
      return out({ ok: false, error: 'unauthorized' });
    }
    const counts = {};
    for (const key in TABLES) {
      counts[key] = syncTable(TABLES[key], body[key] || []);
    }
    return out({ ok: true, counts: counts, generatedAt: body.generatedAt });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

// IDをキーに upsert する。送られてこなかったIDの行は削除する（完全ミラー）。
function syncTable(conf, rows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(conf.sheet);
  if (!sh) sh = ss.insertSheet(conf.sheet);

  const width = conf.headers.length;
  const header = sh.getRange(1, 1, 1, width).getValues()[0];
  if (header[0] !== conf.headers[0]) {
    sh.getRange(1, 1, 1, width).setValues([conf.headers]);
    sh.setFrozenRows(1);
  }

  const lastRow = sh.getLastRow();
  const existing = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, 1).getValues().map((r) => String(r[0])) : [];
  const idToRow = {};
  existing.forEach((id, i) => {
    if (id) idToRow[id] = i + 2;
  });

  const incoming = {};
  const toUpdate = [];
  const toAppend = [];
  rows.forEach((r) => {
    const values = conf.row(r);
    const id = String(values[0]);
    incoming[id] = true;
    if (idToRow[id]) toUpdate.push({ row: idToRow[id], values: values });
    else toAppend.push(values);
  });

  toUpdate.forEach((u) => sh.getRange(u.row, 1, 1, width).setValues([u.values]));
  if (toAppend.length) {
    sh.getRange(sh.getLastRow() + 1, 1, toAppend.length, width).setValues(toAppend);
  }

  const toDelete = [];
  existing.forEach((id, i) => {
    if (id && !incoming[id]) toDelete.push(i + 2);
  });
  for (let i = toDelete.length - 1; i >= 0; i--) sh.deleteRow(toDelete[i]);

  return { updated: toUpdate.length, appended: toAppend.length, deleted: toDelete.length, total: rows.length };
}

// 動作確認用（エディタから1回実行すると、その場でテスト送信できる）
function testSync() {
  const res = syncTable(TABLES.members, [
    { id: 'test-1', name: 'テスト太郎', email: 'test@example.com', reminderEnabled: true, createdAt: '2026-01-01 00:00' },
  ]);
  Logger.log(res);
}
```

## 3. Webアプリとしてデプロイする

1. 右上 **デプロイ → 新しいデプロイ**
2. 左の歯車（種類の選択）→ **ウェブアプリ** を選ぶ
3. 設定:
   - **次のユーザーとして実行**: 自分
   - **アクセスできるユーザー**: **全員**
4. **デプロイ** → 表示される **ウェブアプリのURL（`.../exec` で終わる）** をコピー

> アクセスは「全員」にしますが、`SECRET` を知らないリクエストは拒否されるため実質保護されます。

## 4. アプリに環境変数を設定する

Vercelの環境変数（Production）に次を追加します。

| 変数 | 値 |
|---|---|
| `SHEETS_WEBHOOK_URL` | 手順3でコピーした `.../exec` のURL |
| `SHEETS_WEBHOOK_SECRET` | 手順2で決めた合言葉（`SECRET` と同じ値） |

CLIの場合:

```bash
vercel env add SHEETS_WEBHOOK_URL production
vercel env add SHEETS_WEBHOOK_SECRET production
vercel --prod
```

## 5. 動作確認

- アプリで実践ログを1件追加 → 数秒後にスプレッドシートに反映されればOK
- 反映されない場合は、Apps Scriptの **実行数**（左メニューの時計アイコン）でエラーを確認
- 手動で再送したい場合は `https://<アプリURL>/api/cron/notion-sync` を開く（Cronと同じ処理。`CRON_SECRET` 設定時は `Authorization: Bearer <CRON_SECRET>` が必要）

## 補足

- 同期は「全件スナップショット」。アプリの現在の全データを毎回送り、IDをキーに更新・追加・削除するため、取りこぼしても次回で必ず一致します。
- シートは4つ（メンバー / 悩み・目標 / 実践ログ / AI提案）。手で編集しても、次の同期でアプリ側の内容に上書きされます（シートは閲覧・分析用）。
- 環境変数を外せば同期は止まり、アプリはそのまま動きます。
