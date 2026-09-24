"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Check, CircleHelp, Minus } from "lucide-react";

import { describeOperatingMargin, describeRevenueCagr } from "@/lib/financials/display";
import type { ConditionKey, ScreeningConditions, SortKey } from "@/lib/screening/params";
import type { ConditionStatus, ScreeningRow } from "@/lib/screening/result";
import { cn } from "@/lib/utils";

const CONDITION_LABELS: Record<ConditionKey, string> = { cagr: "条件① 売上CAGR", margin: "条件② 営業利益率", years: "条件③ 上場年数" };
const CONDITION_MARKS: Record<ConditionKey, string> = { cagr: "①", margin: "②", years: "③" };
const STATUS_LABELS: Record<ConditionStatus, string> = { met: "満たす", unmet: "満たさない", unavailable: "算出不可", off: "オフ" };

/** 値のセルの文字の見た目（満たす = アクセント、満たさない = グレー、オフ = 通常）。 */
function valueTone(status: ConditionStatus) {
  if (status === "met") return "font-medium text-signal-strong";
  if (status === "unmet") return "text-muted-foreground";
  return "text-foreground";
}

/** 算出不可・財務データなし・未確定の表示（数値と区別する。アイコンと小さい斜体の文字）。 */
function Unavailable({ text }: { text: string }) {
  return (
    <span data-kind="unavailable" className="inline-flex items-start justify-end gap-1 text-left text-xs text-muted-foreground italic">
      <CircleHelp aria-hidden="true" className="mt-px size-3 shrink-0 not-italic" />
      <span>{text}</span>
    </span>
  );
}

function cagrCell(row: ScreeningRow) {
  if (!row.has_financials) return <Unavailable text="財務データなし" />;
  const display = describeRevenueCagr(row);
  if (display.kind === "unavailable") return <Unavailable text={display.text} />;
  return <span className={cn("tabular font-mono", valueTone(row.status.cagr))}>{display.text}</span>;
}

function marginCell(row: ScreeningRow) {
  if (!row.has_financials) return <Unavailable text="財務データなし" />;
  const display = describeOperatingMargin(row);
  if (display.kind === "unavailable") return <Unavailable text={display.text} />;
  return <span className={cn("tabular font-mono", valueTone(row.status.margin))}>{display.text}</span>;
}

function yearsCell(row: ScreeningRow, referenceDate: string | null) {
  if (!row.first_price_date) return <Unavailable text="未確定" />;
  if (!referenceDate) return <span className="text-muted-foreground">—</span>;
  if (row.listed_before_data_start) {
    return (
      <span className={cn("flex flex-col items-end", valueTone(row.status.years))}>
        <span className="tabular font-mono">{row.listing_years_lower_bound ?? 0}年超</span>
        <span className="text-[0.7rem] text-muted-foreground">データ期間開始以前</span>
      </span>
    );
  }
  return (
    <span className="flex flex-col items-end">
      <span className={cn("tabular font-mono", valueTone(row.status.years))}>{(row.estimated_listing_years ?? 0).toFixed(1)}年</span>
      <span className="tabular font-mono text-[0.7rem] text-muted-foreground">{row.first_price_date}</span>
    </span>
  );
}

function StatusMark({ conditionKey, status, threshold }: { conditionKey: ConditionKey; status: ConditionStatus; threshold: string }) {
  const title = `${CONDITION_LABELS[conditionKey]}${status === "off" ? "" : `（${thresholdText(conditionKey, threshold)}）`}: ${STATUS_LABELS[status]}`;
  const Icon = status === "met" ? Check : status === "unmet" ? Minus : status === "unavailable" ? CircleHelp : null;
  return (
    <span
      className={cn(
        "relative inline-flex h-5 min-w-5 items-center justify-center gap-px rounded-sm px-0.5 text-[0.65rem] leading-none whitespace-nowrap",
        status === "met" && "bg-signal-muted text-signal-strong",
        status === "unmet" && "text-muted-foreground",
        status === "unavailable" && "bg-caution-muted text-caution-strong",
        status === "off" && "border border-dashed text-muted-foreground",
      )}
      title={title}
      data-testid={`condition-status-${conditionKey}`}
      data-status={status}
    >
      <span aria-hidden="true">{CONDITION_MARKS[conditionKey]}</span>
      {Icon ? <Icon aria-hidden="true" className="size-3" strokeWidth={2.5} /> : <span aria-hidden="true" className="text-[0.6rem]">オフ</span>}
      <span className="sr-only">{title}</span>
    </span>
  );
}

function thresholdText(key: ConditionKey, threshold: string) {
  if (key === "years") return `${threshold}年以内`;
  return `≥${threshold}%`;
}

type Column = { key: SortKey; label: string; align: "left" | "right"; note?: string; className?: string };

const COLUMNS: Column[] = [
  { key: "code", label: "コード", align: "left", className: "w-[4.5rem]" },
  { key: "name", label: "社名", align: "left" },
  { key: "market", label: "市場区分", align: "left", className: "w-[5.5rem]" },
  { key: "sector", label: "業種", align: "left", className: "w-[6rem]" },
  { key: "cagr", label: "売上CAGR（%）", align: "right", className: "w-[6.5rem]" },
  { key: "margin", label: "営業利益率（%）", align: "right", className: "w-[6.5rem]" },
  { key: "years", label: "推定上場年数（初出日）", align: "right", note: "初出日から推定", className: "w-[7rem]" },
];

function SortHeader({ column, conditions, onSort }: { column: Column; conditions: ScreeningConditions; onSort: (key: SortKey) => void }) {
  const active = conditions.sort === column.key;
  const Icon = !active ? ArrowUpDown : conditions.order === "asc" ? ArrowUp : ArrowDown;
  const sticky = column.key === "code" ? "sticky left-0 z-20" : column.key === "name" ? "sticky left-[4.5rem] z-20" : "";
  return (
    <th
      scope="col"
      aria-sort={active ? (conditions.order === "asc" ? "ascending" : "descending") : undefined}
      className={cn("bg-surface px-2 py-1.5 align-bottom font-medium", column.align === "right" ? "text-right" : "text-left", column.className, sticky, sticky && "lg:static")}
    >
      <button
        type="button"
        onClick={() => onSort(column.key)}
        className={cn(
          "flex w-full items-start gap-1 rounded-sm text-left whitespace-nowrap outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
          column.align === "right" && "flex-row-reverse justify-start text-right",
          active && "text-foreground",
        )}
        data-testid={`sort-${column.key}`}
      >
        <span className="flex flex-col whitespace-normal">
          <span>{column.label}</span>
          {column.note && <span className="text-[0.65rem] font-normal text-muted-foreground">{column.note}</span>}
        </span>
        <Icon aria-hidden="true" className={cn("mt-0.5 size-3 shrink-0", !active && "opacity-40")} />
      </button>
    </th>
  );
}

/** 結果の表。数値の列は右揃え・tabular-nums。狭い画面では枠の中だけで横スクロールし、コードと社名を左に固定する。 */
export function ResultsTable({
  rows,
  conditions,
  referenceDate,
  onSort,
}: {
  rows: ScreeningRow[];
  conditions: ScreeningConditions;
  referenceDate: string | null;
  onSort: (key: SortKey) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-card lg:overflow-visible" data-testid="results-scroll">
      <table className="w-full min-w-[52rem] table-fixed text-sm lg:min-w-0" data-testid="screening-table">
        <thead className="border-b text-xs text-muted-foreground lg:sticky lg:top-[3.5625rem] lg:z-10">
          <tr>
            {COLUMNS.map((column) => (
              <SortHeader key={column.key} column={column} conditions={conditions} onSort={onSort} />
            ))}
            <th scope="col" className="w-[6.75rem] bg-surface px-2 py-1.5 text-left align-bottom font-medium">
              条件
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={row.code} data-code={row.code} className="group hover:bg-muted/40">
              <td className="tabular sticky left-0 z-[1] bg-card px-2 py-1.5 font-mono group-hover:bg-muted lg:static lg:bg-transparent">
                {row.code}
              </td>
              <td className="sticky left-[4.5rem] z-[1] bg-card px-2 py-1.5 group-hover:bg-muted lg:static lg:bg-transparent">
                <span className="line-clamp-2 leading-snug break-all" title={row.company_name}>
                  {row.company_name}
                </span>
              </td>
              <td className="px-2 py-1.5 whitespace-nowrap">{row.market_name ?? "—"}</td>
              <td className="px-2 py-1.5">
                <span className="line-clamp-2 leading-snug">{row.sector33_name ?? "—"}</span>
              </td>
              <td className="px-2 py-1.5 text-right" data-testid="cell-cagr">
                {cagrCell(row)}
              </td>
              <td className="px-2 py-1.5 text-right" data-testid="cell-margin">
                {marginCell(row)}
              </td>
              <td className="px-2 py-1.5 text-right" data-testid="cell-years">
                {yearsCell(row, referenceDate)}
              </td>
              <td className="px-2 py-1.5">
                <span className="flex gap-0.5">
                  <StatusMark conditionKey="cagr" status={row.status.cagr} threshold={conditions.cagr} />
                  <StatusMark conditionKey="margin" status={row.status.margin} threshold={conditions.margin} />
                  <StatusMark conditionKey="years" status={row.status.years} threshold={conditions.years} />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
