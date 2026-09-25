import { addDays } from "./listing-period";

/**
 * EDINET の書類一覧を取る日付の計算（純粋な関数）。日付は YYYY-MM-DD（日本時間）の文字列。
 */

/**
 * 書類一覧を取る期間（実行日の何日前から）。毎年1回提出される有報を、決算期の変更や提出の遅れを含めて1通以上拾える長さ。
 * Sprint 9（届出書）で延ばせるよう、定数1つで決める。
 */
export const EDINET_LOOKBACK_DAYS = 450;
/** 取得済みでも毎回取り直す直近の日数（実行日を含む）。取下書・不開示の情報は操作日のファイル日付に出るため。 */
export const EDINET_RECENT_REFETCH_DAYS = 7;

export function edinetWindow(runDate: string): { start: string; end: string } {
  return { start: addDays(runDate, -EDINET_LOOKBACK_DAYS), end: runDate };
}

/** 期間の日付（土日祝日を含む。EDINET は土日祝日の日付も指定できる）。新しい順。 */
export function datesBetween(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let date = end; date >= start; date = addDays(date, -1)) dates.push(date);
  return dates;
}

/**
 * 書類一覧を取る日の順番。
 * 1. 直近7日（実行日の6日前〜実行日。取得済みでも取り直す）。**古い順**に取る。取下書・不開示の情報は操作日の一覧に出るので、
 *    元の書類を保存した後に取下げを反映できるようにする（直近の提出と取下げが同じ実行に入ったとき）。
 * 2. 期間のうち、まだ取得していない日（新しい順）
 */
export function planListDates({
  runDate,
  fetched,
}: {
  runDate: string;
  fetched: ReadonlySet<string>;
}): { queue: string[]; recent: string[]; inWindow: string[] } {
  const window = edinetWindow(runDate);
  const inWindow = datesBetween(window.start, window.end);
  const recentFrom = addDays(runDate, -(EDINET_RECENT_REFETCH_DAYS - 1));
  const recent = inWindow.filter((date) => date >= recentFrom).reverse();
  const older = inWindow.filter((date) => date < recentFrom && !fetched.has(date));
  return { queue: [...recent, ...older], recent, inWindow };
}
