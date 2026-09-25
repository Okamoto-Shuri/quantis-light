import { ChevronRight } from "lucide-react";

import { IrregularBadge } from "@/components/financials/period-badges";
import { PeriodDocument, SourceLabel } from "@/components/financials/period-source";
import {
  basisLabel,
  fiscalPeriodLabel,
  formatMillionYen,
  isEdinetSource,
  OPERATING_PROFIT_NOT_STATED_NOTE,
  revenueElementLabel,
  type FinancialMetrics,
  type FinancialPeriod,
} from "@/lib/financials/display";
import { formatCount } from "@/lib/format";
import type { FiscalSlot, SlotPosition } from "@/lib/stocks/slots";
import { cn } from "@/lib/utils";

const Dash = () => <span className="text-muted-foreground">—</span>;

/**
 * 金額のセル。表示は百万円（四捨五入）、title に保存値（円）。値が NULL なら、決算短信の期は「開示なし」、
 * EDINET の期は「記載なし」（書類の表にその行が無い）。label は売上高の記載の名前（「売上収益」など。売上高以外のとき）。
 */
function AmountCell({ yen, testId, edinet, label, notStatedTitle }: { yen: number | null; testId: string; edinet: boolean; label?: string | null; notStatedTitle?: string }) {
  if (yen === null) {
    return edinet ? (
      <td className="px-3 py-2 text-right whitespace-nowrap" data-testid={testId} data-kind="not-stated" title={notStatedTitle}>
        <span className="text-xs text-muted-foreground">記載なし</span>
      </td>
    ) : (
      <td className="px-3 py-2 text-right whitespace-nowrap" data-testid={testId} data-kind="not-disclosed">
        <span className="text-xs text-muted-foreground">開示なし</span>
      </td>
    );
  }
  return (
    <td
      className={cn("tabular px-3 py-2 text-right font-mono whitespace-nowrap", yen < 0 && "text-destructive-strong")}
      title={`${label ? `${label} ` : ""}${formatCount(yen)}円`}
      data-testid={testId}
      data-yen={String(yen)}
    >
      {label && (
        <span className="mr-1.5 font-sans text-[0.7rem] text-muted-foreground" data-testid="revenue-label">
          {label}
        </span>
      )}
      {formatMillionYen(yen)}
    </td>
  );
}

function PeriodCells({ period }: { period: FinancialPeriod }) {
  return (
    <>
      <td className="px-3 py-2 whitespace-nowrap">
        <span className="tabular font-mono text-xs">
          {period.fiscal_year_start}〜{period.fiscal_year_end}
        </span>
        {period.is_irregular && (
          <span className="ml-2">
            <IrregularBadge months={period.period_months} />
          </span>
        )}
      </td>
      <AmountCell
        yen={period.net_sales}
        testId="cell-net-sales"
        edinet={isEdinetSource(period.source)}
        label={revenueElementLabel(period.revenue_element)}
        notStatedTitle="書類の『主要な経営指標等の推移』に売上高の記載がありません"
      />
      <AmountCell
        yen={period.operating_profit}
        testId="cell-operating-profit"
        edinet={isEdinetSource(period.source)}
        notStatedTitle={OPERATING_PROFIT_NOT_STATED_NOTE}
      />
      <td className="px-3 py-2 text-xs whitespace-nowrap">{basisLabel(period.consolidated, period.accounting_standard)}</td>
      <td className="px-3 py-2 whitespace-nowrap" data-testid="cell-source" data-source={period.source}>
        <SourceLabel source={period.source} />
      </td>
      <td className="px-3 py-2">
        <PeriodDocument period={period} />
      </td>
    </>
  );
}

function Head({ first }: { first: string }) {
  return (
    <thead className="border-b bg-surface text-xs text-muted-foreground">
      <tr>
        <th scope="col" className="px-3 py-2 text-left font-medium whitespace-nowrap">
          {first}
        </th>
        <th scope="col" className="px-3 py-2 text-left font-medium whitespace-nowrap">決算期</th>
        <th scope="col" className="px-3 py-2 text-left font-medium whitespace-nowrap">期間</th>
        <th scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap">売上高（百万円）</th>
        <th scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap">営業利益（百万円）</th>
        <th scope="col" className="px-3 py-2 text-left font-medium whitespace-nowrap">基準</th>
        <th scope="col" className="px-3 py-2 text-left font-medium whitespace-nowrap">出典（売上高・営業利益）</th>
        <th scope="col" className="px-3 py-2 text-left font-medium whitespace-nowrap">書類・開示日</th>
      </tr>
    </thead>
  );
}

/**
 * 5期の表（FY-4 が上）。「データなし」の枠は想定の決算期を示す。売上CAGR を算出できたときは、算出に使った5期の行の左端に線を引く。
 */
export function FivePeriodTable({ slots, metrics }: { slots: FiscalSlot<FinancialPeriod>[]; metrics: FinancialMetrics | null }) {
  const usedForCagr = metrics !== null && metrics.revenue_cagr_unavailable_reason === null && metrics.revenue_cagr_base_fiscal_year_end !== null;
  return (
    <div className="space-y-1.5">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[56rem] text-sm" data-testid="five-period-table">
          <Head first="位置" />
          <tbody className="divide-y">
            {slots.map((slot) => (
              <tr
                key={slot.position}
                data-slot={slot.position}
                data-fiscal-year-end={slot.fiscalYearEnd}
                data-missing={slot.period ? undefined : "true"}
                data-used={usedForCagr && slot.period ? "true" : undefined}
                className={cn(!slot.period && "bg-muted/40")}
              >
                <td className={cn("px-3 py-2 whitespace-nowrap", usedForCagr && slot.period && "border-l-2 border-l-signal")}>
                  <span className="tabular font-mono text-xs">{slot.position}</span>
                  {usedForCagr && slot.period && <span className="sr-only">（売上CAGR の算出に使用）</span>}
                </td>
                <td className="tabular px-3 py-2 font-mono whitespace-nowrap">{fiscalPeriodLabel(slot.fiscalYearEnd)}</td>
                {slot.period ? (
                  <PeriodCells period={slot.period} />
                ) : (
                  <>
                    <td className="px-3 py-2">
                      <Dash />
                    </td>
                    <td colSpan={2} className="px-3 py-2 text-right" data-testid="cell-missing">
                      <span className="inline-flex rounded-sm border border-dashed px-1.5 py-0.5 text-xs text-muted-foreground">データなし</span>
                    </td>
                    <td className="px-3 py-2">
                      <Dash />
                    </td>
                    <td className="px-3 py-2">
                      <Dash />
                    </td>
                    <td className="px-3 py-2">
                      <Dash />
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {usedForCagr ? (
          <span className="inline-flex items-center gap-1.5" data-testid="used-for-cagr-legend">
            <span aria-hidden="true" className="h-3 w-0.5 rounded-full bg-signal" />
            売上CAGR の算出に使用した期
          </span>
        ) : (
          <span data-testid="used-for-cagr-legend">売上CAGR を算出できないため、算出に使用した期はありません</span>
        )}
        <span>
          「データなし」は保存済みの通期実績にその期が無いこと、「開示なし」は決算短信に値が無いこと、「記載なし」は EDINET の書類の「主要な経営指標等の推移」にその行が無いことを示します
        </span>
      </p>
    </div>
  );
}

/** 保存済みの通期実績すべて（古い順）。5期の枠の外の期がある、または6期以上あるときだけ出す。 */
export function AllPeriods({ periods, slots }: { periods: FinancialPeriod[]; slots: FiscalSlot<FinancialPeriod>[] }) {
  const positionOf = new Map<string, SlotPosition>(slots.filter((s) => s.period).map((s) => [s.fiscalYearEnd, s.position]));
  const outside = periods.filter((p) => !positionOf.has(p.fiscal_year_end));
  if (outside.length === 0) return null;
  const sorted = [...periods].sort((a, b) => (a.fiscal_year_end < b.fiscal_year_end ? -1 : 1));
  return (
    <details className="group rounded-md border" data-testid="all-periods">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-sm font-medium outline-none select-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden="true" className="size-4 transition-transform group-open:rotate-90" />
        保存済みの通期実績をすべて表示（<span className="tabular">{formatCount(periods.length)}</span>期）
        <span className="text-xs font-normal text-muted-foreground">5期の枠の外の期: {formatCount(outside.length)}期</span>
      </summary>
      <div className="overflow-x-auto border-t">
        <table className="w-full min-w-[56rem] text-sm" data-testid="all-periods-table">
          <Head first="位置" />
          <tbody className="divide-y">
            {sorted.map((period) => {
              const position = positionOf.get(period.fiscal_year_end);
              return (
                <tr key={period.fiscal_year_end} data-fiscal-year-end={period.fiscal_year_end} data-slot={position}>
                  <td className="tabular px-3 py-2 font-mono text-xs whitespace-nowrap">{position ?? <Dash />}</td>
                  <td className="tabular px-3 py-2 font-mono whitespace-nowrap">{fiscalPeriodLabel(period.fiscal_year_end)}</td>
                  <PeriodCells period={period} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}
