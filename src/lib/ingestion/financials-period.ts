import { addDays, subtractYears } from "./listing-period";

/**
 * 財務の取り込みで使う日付の計算（純粋な関数）。日付は YYYY-MM-DD の文字列で扱う。
 */

/** 取り込む開示日の範囲（実行日の何年前から）。FY-4 の開示（最大で約5年3か月前）に余裕を持たせる。 */
export const FINANCIALS_LOOKBACK_YEARS = 6;
/** 取得済みでも毎回取り直す直近の日数（実行日を含む）。速報→確報の差し替えや反映の遅れを拾う。 */
export const RECENT_REFETCH_DAYS = 7;

/** 取得範囲: 実行日の6年前の日から実行日まで（両端を含む）。 */
export function financialsWindow(runDate: string): { start: string; end: string } {
  return { start: subtractYears(runDate, FINANCIALS_LOOKBACK_YEARS), end: runDate };
}

function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** 期間の平日（土日を除く）。取引カレンダーを取得できなかったときの代用。新しい順。 */
export function weekdaysBetween(start: string, end: string): string[] {
  const days: string[] = [];
  for (let date = end; date >= start; date = addDays(date, -1)) {
    const dow = dayOfWeek(date);
    if (dow !== 0 && dow !== 6) days.push(date);
  }
  return days;
}

/**
 * 処理する開示日の順番。
 * 1. 直近7日（実行日の6日前〜実行日）の営業日（取得済みでも取り直す）
 * 2. 取得範囲のうち、まだ取得していない営業日（新しい順）
 */
export function planDisclosureDates({
  businessDays,
  fetched,
  runDate,
}: {
  businessDays: readonly string[];
  fetched: ReadonlySet<string>;
  runDate: string;
}): { queue: string[]; recent: string[] } {
  const sorted = [...new Set(businessDays)].sort().reverse();
  const recentFrom = addDays(runDate, -(RECENT_REFETCH_DAYS - 1));
  const recent = sorted.filter((date) => date >= recentFrom && date <= runDate);
  const older = sorted.filter((date) => date < recentFrom && !fetched.has(date));
  return { queue: [...recent, ...older], recent };
}
