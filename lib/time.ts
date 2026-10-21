// Postgresの BIGINT（エポックミリ秒）は、node-postgres 系ドライバでは「文字列」として返る。
// そのまま new Date() に渡すと Invalid Date になり、toISOString() は例外を投げる。
// 表示や計算の前に、ここで数値へ正規化する。

/** エポックミリ秒として解釈できる値を数値にする。解釈できない場合は null。 */
export function toEpochMs(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** エポックミリ秒を「YYYY-MM-DD」に整形する（UTC基準）。不正値は空文字。 */
export function formatDate(value: unknown): string {
  const ms = toEpochMs(value);
  if (ms === null) return "";
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/** エポックミリ秒を日本語の日時表記に整形する。不正値は空文字。 */
export function formatDateTime(value: unknown): string {
  const ms = toEpochMs(value);
  if (ms === null) return "";
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("ja-JP");
}
