"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, CircleHelp } from "lucide-react";
import Link from "next/link";

import { describeOperatingMargin, describeRevenueCagr } from "@/lib/financials/display";
import type { ScreeningConditions, SortKey } from "@/lib/screening/params";
import type { ConditionStatus, ScreeningRow } from "@/lib/screening/result";
import { stockDetailHref } from "@/lib/stocks/detail";
import { cn } from "@/lib/utils";

import { AutoJudgmentLabel } from "@/components/ownership/ownership-bar";
import { ownerConditionText } from "@/lib/ownership/display";

import { OwnerJudgmentCell, OwnershipCell } from "./owner-cells";
import { StatusMark } from "./status-mark";
import { SupplementMark } from "./supplement-mark";

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
      {/* 最後の1〜2文字だけが次の行に落ちないよう、行の長さをそろえて折り返す（Sprint 6 評価の m2） */}
      <span className="text-balance">{text}</span>
    </span>
  );
}

function cagrCell(row: ScreeningRow) {
  if (!row.has_financials) return <Unavailable text="財務データなし" />;
  const display = describeRevenueCagr(row);
  if (display.kind === "unavailable") return <Unavailable text={display.text} />;
  return (
    <span className="inline-flex items-center justify-end">
      <span className={cn("tabular font-mono", valueTone(row.status.cagr))}>{display.text}</span>
      {row.revenue_cagr_supplemented && (
        <SupplementMark
          supplement={row.revenue_cagr_supplement}
          mixedConsolidation={row.revenue_cagr_mixed_consolidation}
          mixedStandard={row.revenue_cagr_mixed_standard}
        />
      )}
    </span>
  );
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
        <span className="text-[0.7rem] whitespace-nowrap text-muted-foreground">データ期間開始以前</span>
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

/** labelTail は見出しの末尾で、途中で折り返さない（「推定上場年数」「（初出日）」の切れ目で折り返す） */
type Column = { key: SortKey; label: string; labelTail?: string; align: "left" | "right"; note?: string; className?: string };

/**
 * 列（Sprint 10 で条件④の2列を加えた）。1280×800 で表が横スクロールしないよう、市場区分と業種は1つの列に2段で並べる
 * （並べ替えのボタンは2つのまま）。
 */
const COLUMNS: Column[] = [
  { key: "code", label: "コード", align: "left", className: "w-[4.5rem]" },
  { key: "name", label: "社名", align: "left" },
  { key: "cagr", label: "売上CAGR（%）", align: "right", className: "w-[5.75rem]" },
  { key: "margin", label: "営業利益率（%）", align: "right", className: "w-[5.5rem]" },
  { key: "years", label: "推定上場年数", labelTail: "（初出日）", align: "right", note: "初出日から推定", className: "w-[6rem]" },
];
const OWNERSHIP_COLUMN: Column = { key: "owner", label: "保有状態", labelTail: "（オーナー系合計）", align: "left", note: "大株主上位の区分", className: "w-[10.25rem]" };

function SortButton({ column, conditions, onSort }: { column: Column; conditions: ScreeningConditions; onSort: (key: SortKey) => void }) {
  const active = conditions.sort === column.key;
  const Icon = !active ? ArrowUpDown : conditions.order === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onSort(column.key)}
      className={cn(
        "inline-flex flex-col rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
        column.align === "right" ? "items-end text-right" : "items-start text-left",
        active && "text-foreground",
      )}
      data-testid={`sort-${column.key}`}
    >
      {/* 矢印は見出しの文字の最後の行のすぐ隣に置く（右揃えの列でもセルの反対側に離れない。Sprint 6 評価の m3） */}
      <span>
        {column.label}
        <span className="inline-block whitespace-nowrap">
          {column.labelTail}
          <Icon aria-hidden="true" data-testid="sort-icon" className={cn("ml-0.5 inline size-3 align-[-0.125em]", !active && "opacity-40")} />
        </span>
      </span>
      {column.note && <span className="text-[0.65rem] font-normal text-muted-foreground">{column.note}</span>}
    </button>
  );
}

/** 市場区分と業種の見出し（1つの列に、並べ替えのボタンを2つ） */
function MarketSectorHeader({ conditions, onSort }: { conditions: ScreeningConditions; onSort: (key: SortKey) => void }) {
  const active = conditions.sort === "market" || conditions.sort === "sector";
  return (
    <th
      scope="col"
      aria-sort={active ? (conditions.order === "asc" ? "ascending" : "descending") : undefined}
      className="w-[5.5rem] bg-surface px-2 py-1.5 text-left align-bottom font-medium"
    >
      <span className="flex flex-col items-start gap-0.5">
        <SortButton column={{ key: "market", label: "市場区分", align: "left" }} conditions={conditions} onSort={onSort} />
        <SortButton column={{ key: "sector", label: "業種", align: "left" }} conditions={conditions} onSort={onSort} />
      </span>
    </th>
  );
}


function SortHeader({ column, conditions, onSort }: { column: Column; conditions: ScreeningConditions; onSort: (key: SortKey) => void }) {
  const active = conditions.sort === column.key;
  const sticky = column.key === "code" ? "sticky left-0 z-20" : column.key === "name" ? "sticky left-[4.5rem] z-20" : "";
  return (
    <th
      scope="col"
      aria-sort={active ? (conditions.order === "asc" ? "ascending" : "descending") : undefined}
      className={cn("bg-surface px-2 py-1.5 align-bottom font-medium", column.align === "right" ? "text-right" : "text-left", column.className, sticky, sticky && "lg:static")}
    >
      <SortButton column={column} conditions={conditions} onSort={onSort} />
    </th>
  );
}

/**
 * 行のクリックで詳細を開く（リンクの上のクリック・文字の選択中は何もしない。修飾キー・中クリックは新しいタブ）。
 * 同じタブでの遷移は openDetail に任せる（待っている条件の書き換えと遷移の順番をそろえる。Sprint 7 評価の B1）。
 */
function useRowNavigation(openDetail: (href: string) => void) {
  const insideInteractive = (target: EventTarget | null) => target instanceof Element && target.closest("a, button, input, label") !== null;
  return {
    onClick: (event: React.MouseEvent<HTMLTableRowElement>, href: string) => {
      if (event.defaultPrevented || event.button !== 0 || insideInteractive(event.target)) return;
      if ((window.getSelection()?.toString() ?? "") !== "") return;
      if (event.metaKey || event.ctrlKey || event.shiftKey) {
        window.open(href, "_blank", "noopener");
        return;
      }
      openDetail(href);
    },
    /** リンク（コード・社名）のクリックと Enter。修飾キー・中クリック以外は、next/link の遷移の代わりに openDetail を使う。 */
    onLinkClick: (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      openDetail(href);
    },
    onAuxClick: (event: React.MouseEvent<HTMLTableRowElement>, href: string) => {
      if (event.button !== 1 || insideInteractive(event.target)) return;
      event.preventDefault();
      window.open(href, "_blank", "noopener");
    },
  };
}

/**
 * 結果の表。数値の列は右揃え・tabular-nums。狭い画面では枠の中だけで横スクロールし、コードと社名を左に固定する。
 * conditions は並べ替えの見出し用（操作の直後から新しい並びを示す）、resultConditions・resultQuery は表示中の結果の条件
 * （サーバーが判定に使った条件）。条件の印と詳細へのリンクは、表示中の結果の条件から作る（Sprint 6 評価の m5、Sprint 7 の第2章の1）。
 */
export function ResultsTable({
  rows,
  conditions,
  resultConditions,
  resultQuery,
  referenceDate,
  onSort,
  onOpenDetail,
}: {
  rows: ScreeningRow[];
  conditions: ScreeningConditions;
  resultConditions: ScreeningConditions;
  resultQuery: string;
  referenceDate: string | null;
  onSort: (key: SortKey) => void;
  /** 同じタブで詳細を開く（スクリーニングの画面が、待っている条件の書き換えを先に済ませてから遷移する） */
  onOpenDetail: (href: string) => void;
}) {
  const navigation = useRowNavigation(onOpenDetail);
  return (
    <div className="overflow-x-auto rounded-lg border bg-card lg:overflow-visible" data-testid="results-scroll">
      <table className="w-full min-w-[60rem] table-fixed text-sm lg:min-w-0" data-testid="screening-table">
        <thead className="border-b text-xs text-muted-foreground lg:sticky lg:top-[3.5625rem] lg:z-10">
          <tr>
            <SortHeader column={COLUMNS[0]} conditions={conditions} onSort={onSort} />
            <SortHeader column={COLUMNS[1]} conditions={conditions} onSort={onSort} />
            <MarketSectorHeader conditions={conditions} onSort={onSort} />
            {COLUMNS.slice(2).map((column) => (
              <SortHeader key={column.key} column={column} conditions={conditions} onSort={onSort} />
            ))}
            <th scope="col" className="w-[6.75rem] bg-surface px-2 py-1.5 text-left align-bottom font-medium" data-testid="header-owner-judgment">
              <span className="flex flex-col items-start gap-0.5">
                <span>条件④</span>
                <AutoJudgmentLabel />
              </span>
            </th>
            <SortHeader column={OWNERSHIP_COLUMN} conditions={conditions} onSort={onSort} />
            <th scope="col" className="w-[8.5rem] bg-surface px-2 py-1.5 text-left align-bottom font-medium">
              条件
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => {
            const href = stockDetailHref(row.code, resultQuery);
            return (
              <tr
                key={row.code}
                data-code={row.code}
                data-href={href}
                className="group cursor-pointer hover:bg-muted/60"
                onClick={(event) => navigation.onClick(event, href)}
                onAuxClick={(event) => navigation.onAuxClick(event, href)}
              >
                <td className="tabular sticky left-0 z-[1] bg-card px-2 py-1.5 font-mono group-hover:bg-muted lg:static lg:bg-transparent">
                  <Link
                    href={href}
                    onClick={(event) => navigation.onLinkClick(event, href)}
                    className="rounded-sm underline-offset-2 outline-none group-hover:underline hover:text-signal-strong focus-visible:ring-2 focus-visible:ring-ring/50"
                    data-testid="row-link-code"
                  >
                    {row.code}
                  </Link>
                </td>
                <td className="sticky left-[4.5rem] z-[1] bg-card px-2 py-1.5 group-hover:bg-muted lg:static lg:bg-transparent">
                  <Link
                    href={href}
                    onClick={(event) => navigation.onLinkClick(event, href)}
                    tabIndex={-1}
                    className="line-clamp-2 leading-snug font-medium break-all underline-offset-2 group-hover:underline hover:text-signal-strong"
                    title={row.company_name}
                    data-testid="row-link-name"
                  >
                    {row.company_name}
                  </Link>
                </td>
                <td className="px-2 py-1.5 text-xs leading-snug" data-testid="cell-market-sector">
                  <span className="block whitespace-nowrap" data-testid="cell-market">
                    {row.market_name ?? "—"}
                  </span>
                  <span className="line-clamp-2 text-muted-foreground" data-testid="cell-sector">
                    {row.sector33_name ?? "—"}
                  </span>
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
                <td className="px-2 py-1.5" data-testid="cell-owner-judgment" data-result={row.ownership.result}>
                  <OwnerJudgmentCell ownership={row.ownership} mode={resultConditions.ownerMode} threshold={resultConditions.owner} />
                </td>
                <td className="px-2 py-1.5" data-testid="cell-ownership">
                  <OwnershipCell ownership={row.ownership} />
                </td>
                <td className="px-2 py-1.5">
                  <span className="flex gap-0.5">
                    <StatusMark conditionKey="cagr" status={row.status.cagr} threshold={resultConditions.cagr} />
                    <StatusMark conditionKey="margin" status={row.status.margin} threshold={resultConditions.margin} />
                    <StatusMark conditionKey="years" status={row.status.years} threshold={resultConditions.years} />
                    <StatusMark
                      conditionKey="owner"
                      status={row.status.owner}
                      threshold={resultConditions.owner}
                      conditionText={ownerConditionText(resultConditions.ownerMode, resultConditions.owner)}
                    />
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
