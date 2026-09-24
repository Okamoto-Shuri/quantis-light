/**
 * 株価の初出日の取り込みで使う日付の計算（純粋な関数）。日付は YYYY-MM-DD の文字列で扱う。
 */

/** J-Quants Standard プランで株価四本値を取得できる期間（「10年前まで」。今日から遡る移動する期間）。 */
export const PRICE_HISTORY_YEARS = 10;

/** データ期間の開始日を探す日数（休場日の連続を超える長さ）。 */
export const DATA_START_PROBE_DAYS = 14;

const jstDateFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** 時刻（ミリ秒）の日本時間の日付。 */
export function jstDate(epochMs: number): string {
  return jstDateFormatter.format(new Date(epochMs));
}

function parse(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d };
}

function format(utc: Date): string {
  return utc.toISOString().slice(0, 10);
}

/** 日付に日数を足す。 */
export function addDays(date: string, days: number): string {
  const { y, m, d } = parse(date);
  return format(new Date(Date.UTC(y, m - 1, d + days)));
}

/** 日付から年数を引く。2月29日で、引いた先の年に2月29日が無ければ2月28日にする（Postgres の date - interval と同じ）。 */
export function subtractYears(date: string, years: number): string {
  const { y, m, d } = parse(date);
  const year = y - years;
  const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return format(new Date(Date.UTC(year, m - 1, Math.min(d, lastDay))));
}

/**
 * データ期間の開始日の探索を始める日。実行日（日本時間）の10年前の翌日。
 * 「10年前まで」の境目の解釈の違いで期間外にならないよう、1日だけ内側から始める。
 */
export function dataStartProbeFrom(runDate: string): string {
  return addDays(subtractYears(runDate, PRICE_HISTORY_YEARS), 1);
}
