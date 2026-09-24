/**
 * 銘柄詳細の「通期5期（FY-4〜FY0）」の枠（契約の第2章の3）。
 * - FY0 は保存済みの通期実績のうち、事業年度の終了日が最も新しい期
 * - FY-k は、1つ新しい枠の期の開始日の前日に終わる期（Sprint 5 の「連続」の定義。DB の financial_metrics_from_periods と同じ）
 * - 1つ新しい枠が「データなし」のときは、その枠の想定の終了日 E から次の枠の想定の終了日を決める:
 *     E が月末なら前年の同じ月の末日（2025-02-28 → 2024-02-29）、月末でなければ前年の同じ月の同じ日（2024-08-20 → 2023-08-20）
 * - 探すのはその終了日にちょうど終わる期
 * 期の連続の判定は DB と同じ規則なので、FY0 から連続して見つかる枠の数は financial_metrics.revenue_cagr_period_count と一致する。
 */

export const SLOT_POSITIONS = ["FY-4", "FY-3", "FY-2", "FY-1", "FY0"] as const;
export type SlotPosition = (typeof SLOT_POSITIONS)[number];

export type PeriodLike = { fiscal_year_start: string; fiscal_year_end: string };

export type FiscalSlot<P extends PeriodLike> = {
  position: SlotPosition;
  /** その枠の期の終了日（「データなし」の枠では想定の終了日） */
  fiscalYearEnd: string;
  period: P | null;
};

function parse(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return { y, m, d };
}

function format(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 日付の前日（YYYY-MM-DD）。 */
export function dayBefore(date: string): string {
  const { y, m, d } = parse(date);
  const t = new Date(Date.UTC(y, m - 1, d - 1));
  return format(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** 「データなし」の枠の想定の終了日から、1つ前の枠の想定の終了日を求める（月末なら前年の同じ月の末日、それ以外は前年の同じ日）。 */
export function previousFiscalYearEnd(end: string): string {
  const { y, m, d } = parse(end);
  if (d === daysInMonth(y, m)) return format(y - 1, m, daysInMonth(y - 1, m));
  return format(y - 1, m, d);
}

/** 5期の枠（古い順。FY-4 が先頭）。通期実績が無ければ空の配列。 */
export function buildFiscalSlots<P extends PeriodLike>(periods: readonly P[]): FiscalSlot<P>[] {
  if (periods.length === 0) return [];
  const byEnd = new Map(periods.map((period) => [period.fiscal_year_end, period]));
  const latest = periods.reduce((a, b) => (b.fiscal_year_end > a.fiscal_year_end ? b : a));
  const newestFirst: FiscalSlot<P>[] = [{ position: "FY0", fiscalYearEnd: latest.fiscal_year_end, period: latest }];
  for (let k = 1; k < SLOT_POSITIONS.length; k += 1) {
    const newer = newestFirst[k - 1]!;
    const end = newer.period ? dayBefore(newer.period.fiscal_year_start) : previousFiscalYearEnd(newer.fiscalYearEnd);
    newestFirst.push({ position: SLOT_POSITIONS[SLOT_POSITIONS.length - 1 - k]!, fiscalYearEnd: end, period: byEnd.get(end) ?? null });
  }
  return newestFirst.reverse();
}

/** FY0 から途切れずに期がある枠の数（DB の revenue_cagr_period_count と同じ意味）。 */
export function consecutiveSlotCount(slots: readonly FiscalSlot<PeriodLike>[]): number {
  let count = 0;
  for (let i = slots.length - 1; i >= 0; i -= 1) {
    if (!slots[i]!.period) break;
    count += 1;
  }
  return count;
}
