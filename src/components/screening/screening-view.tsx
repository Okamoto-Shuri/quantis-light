"use client";

import { ArrowRight, ChevronLeft, ChevronRight, CircleAlert, DatabaseZap, Loader2, SearchX, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { formatCount } from "@/lib/format";
import {
  DEFAULT_CONDITIONS,
  defaultOrder,
  serializeScreeningParams,
  type ConditionKey,
  type ScreeningConditions,
  type SortKey,
} from "@/lib/screening/params";
import type { FilterOptions, ScreeningResult } from "@/lib/screening/result";
import type { MarketCode } from "@/lib/screening/sectors";
import { cn } from "@/lib/utils";

import { ConditionPanel, ProvisionalCagrNote, type PanelHandlers } from "./condition-panel";
import { ResultsTable } from "./results-table";

type Queued = { query: string; delay: number };

/**
 * スクリーニングの画面の本体。状態の正本は URL（サーバーが URL から描画した結果を props で受け取る）。
 * 操作はこのコンポーネントの条件をすぐ書き換え、URL を router.replace で書き換える（閾値の入力のたびに履歴を増やさない）。
 * 連続した操作は最後の1回だけを URL に書く（待ちの間に次の操作が来たら前の書き換えを取り消す）。
 * 描画中の URL の書き換えの結果が古い（後の操作がある）ときは、その結果で条件を戻さない。
 */
export function ScreeningView({
  conditions,
  queryKey,
  result,
  options,
  invalidFields,
}: {
  conditions: ScreeningConditions;
  queryKey: string;
  result: ScreeningResult | null;
  options: FilterOptions | null;
  invalidFields: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [current, setCurrent] = useState(conditions);
  const [pushed, setPushed] = useState(queryKey);
  const [seenKey, setSeenKey] = useState(queryKey);
  const [resetToken, setResetToken] = useState(0);
  const [queued, setQueued] = useState<Queued | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // URL が外から変わったとき（戻る・進む、最終ページへの置き換え）は、条件をサーバーの値に合わせる
  if (queryKey !== seenKey) {
    setSeenKey(queryKey);
    if (queryKey !== pushed && !isPending && queued === null) {
      setCurrent(conditions);
      setPushed(queryKey);
      setResetToken((token) => token + 1);
    }
  }

  useEffect(() => {
    if (queued === null) return;
    const timer = setTimeout(() => {
      setQueued(null);
      setPushed(queued.query);
      startTransition(() => {
        router.replace(`/screening?${queued.query}`, { scroll: false });
      });
    }, queued.delay);
    return () => clearTimeout(timer);
  }, [queued, router]);

  /** 条件を変えて URL に反映する。delay ミリ秒の間に次の操作があれば、この書き換えは取り消される。 */
  const apply = (next: ScreeningConditions, delay = 0) => {
    setCurrent(next);
    setQueued({ query: serializeScreeningParams(next), delay });
  };
  const change = (patch: Partial<ScreeningConditions>, delay = 0) => apply({ ...current, ...patch, page: 1 }, delay);

  const handlers: PanelHandlers = {
    setEnabled: (key: ConditionKey, enabled: boolean) =>
      change({ off: enabled ? current.off.filter((k) => k !== key) : [...current.off, key] }),
    draftThreshold: (key, value) => setCurrent((prev) => ({ ...prev, [key]: value })),
    commitThreshold: (key, value, delay) => change({ [key]: value }, delay),
    setIncludeUnavailable: (include) => change({ includeUnavailable: include }),
    toggleMarket: (code: MarketCode, checked) =>
      change({ market: checked ? [...current.market, code].sort() : current.market.filter((c) => c !== code) }),
    toggleSector: (code, checked) =>
      change({ sector: checked ? [...current.sector, code].sort() : current.sector.filter((c) => c !== code) }),
    reset: () => apply({ ...DEFAULT_CONDITIONS, off: [], market: [], sector: [] }),
  };

  const onSort = (key: SortKey) =>
    change({ sort: key, order: current.sort === key ? (current.order === "asc" ? "desc" : "asc") : defaultOrder(key) });

  const goToPage = (page: number) => {
    apply({ ...current, page });
    document.getElementById("screening-results")?.scrollIntoView({ block: "start" });
  };

  const updating = isPending || queued !== null;

  return (
    <div className="lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start lg:gap-6">
      <aside
        aria-label="条件"
        className="hidden rounded-lg border bg-card p-4 lg:sticky lg:top-[4.5rem] lg:block lg:max-h-[calc(100vh-5.5rem)] lg:overflow-y-auto"
      >
        <ConditionPanel key={`desktop-${resetToken}`} conditions={current} options={options} handlers={handlers} />
      </aside>

      <div className="min-w-0 space-y-3">
        {/* 狭い画面: 条件パネルは折りたたみ、要約と AC6.12 の注記を常に見せる */}
        <div className="space-y-2 rounded-lg border bg-card p-3 lg:hidden" data-testid="conditions-summary">
          <div className="flex items-start justify-between gap-3">
            <p className="tabular text-sm">{summaryText(current)}</p>
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm" className="shrink-0">
                  <SlidersHorizontal aria-hidden="true" />
                  条件を変更
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-full overflow-y-auto sm:max-w-sm">
                <SheetHeader className="pb-0">
                  <SheetTitle>条件</SheetTitle>
                  <SheetDescription>変更すると結果がすぐ更新されます</SheetDescription>
                </SheetHeader>
                <div className="px-4 pb-6">
                  <ConditionPanel key={`sheet-${resetToken}`} conditions={current} options={options} handlers={handlers} />
                </div>
              </SheetContent>
            </Sheet>
          </div>
          <ProvisionalCagrNote />
        </div>

        {invalidFields.length > 0 && (
          <p
            role="status"
            className="flex items-start gap-2 rounded-md border border-caution/40 bg-caution-muted px-3 py-2 text-sm text-caution-strong"
            data-testid="invalid-params-notice"
          >
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            URL の条件の一部（{invalidFields.join("、")}）が無効なため、既定値で表示しています
          </p>
        )}

        <Results result={result} conditions={current} updating={updating} onSort={onSort} onPage={goToPage} onInclude={() => handlers.setIncludeUnavailable(true)} />
      </div>
    </div>
  );
}

function summaryText(conditions: ScreeningConditions): string {
  const off = (key: ConditionKey) => conditions.off.includes(key);
  return [
    off("cagr") ? "CAGR オフ" : `CAGR ≥${conditions.cagr}%`,
    off("margin") ? "営業利益率 オフ" : `営業利益率 ≥${conditions.margin}%`,
    off("years") ? "上場年数 オフ" : `上場${conditions.years}年以内`,
  ].join(" ・ ");
}

function Results({
  result,
  conditions,
  updating,
  onSort,
  onPage,
  onInclude,
}: {
  result: ScreeningResult | null;
  conditions: ScreeningConditions;
  updating: boolean;
  onSort: (key: SortKey) => void;
  onPage: (page: number) => void;
  onInclude: () => void;
}) {
  if (!result) {
    return (
      <Alert variant="destructive" id="screening-results">
        <AlertTitle>検索結果を読み込めませんでした</AlertTitle>
        <AlertDescription>時間をおいて再読み込みしてください。</AlertDescription>
      </Alert>
    );
  }

  if (result.stockCount === 0) {
    return (
      <section
        id="screening-results"
        data-testid="screening-results"
        aria-labelledby="screening-empty-heading"
        className="flex flex-col items-start gap-4 rounded-lg border border-dashed bg-card px-6 py-10"
      >
        <span className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <DatabaseZap aria-hidden="true" className="size-5" />
        </span>
        <div className="space-y-1.5">
          <h2 id="screening-empty-heading" className="text-lg font-semibold tracking-tight" data-testid="no-data">
            まだデータが取り込まれていません
          </h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            銘柄マスタ・株価の初出日・財務データが取り込まれると、保存済みデータから銘柄を検索できます。
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/imports">
            取り込み状況を見る
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </section>
    );
  }

  const from = (result.page - 1) * result.pageSize + 1;
  const to = Math.min(result.page * result.pageSize, result.total);

  return (
    <section id="screening-results" data-testid="screening-results" aria-label="検索結果" aria-busy={updating} className="scroll-mt-20 space-y-3">
      {(result.metricsCount === 0 || result.listingDatesCount === 0) && (
        <div className="space-y-1 rounded-md border border-caution/40 bg-caution-muted px-3 py-2 text-sm text-caution-strong" data-testid="missing-data-notice">
          {result.metricsCount === 0 && <p>財務指標がまだ算出されていません。</p>}
          {result.listingDatesCount === 0 && <p>株価の初出日がまだ取り込まれていません。</p>}
          <Link href="/imports" className="inline-flex items-center gap-1 underline underline-offset-2">
            取り込み状況を見る
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1" data-testid="result-summary" aria-live="polite">
        <p className="text-sm">
          該当 <span className="tabular font-mono text-lg font-semibold" data-testid="result-count">{formatCount(result.total)}</span> 件
          <span className="text-muted-foreground">
            （銘柄マスタ <span className="tabular font-mono">{formatCount(result.stockCount)}</span> 銘柄中）
          </span>
        </p>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {updating && (
            <span className="inline-flex items-center gap-1" data-testid="updating">
              <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
              更新中…
            </span>
          )}
          {result.total > 0 && (
            <span className="tabular font-mono" data-testid="result-range">
              {formatCount(from)}〜{formatCount(to)} 件目を表示
            </span>
          )}
        </div>
      </div>

      {result.excludedUnavailable > 0 && !conditions.includeUnavailable && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground" data-testid="excluded-unavailable">
          <span>
            算出不可・未確定のため除外: <span className="tabular font-mono">{formatCount(result.excludedUnavailable)}</span> 件
          </span>
          <Button variant="link" size="xs" className="h-auto px-0" onClick={onInclude}>
            含めて表示
          </Button>
        </p>
      )}

      {result.total === 0 ? (
        <div className="flex items-start gap-3 rounded-lg border border-dashed bg-card px-4 py-8" data-testid="no-match">
          <SearchX aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="space-y-0.5">
            <p className="text-sm font-medium">条件に一致する銘柄はありません</p>
            <p className="text-sm text-muted-foreground">
              閾値を下げる、条件をオフにする、または『算出不可を含める』をオンにすると表示される場合があります。
            </p>
          </div>
        </div>
      ) : (
        <div className={cn("transition-opacity", updating && "opacity-60")}>
          <ResultsTable rows={result.rows} conditions={conditions} referenceDate={result.referenceDate} onSort={onSort} />
        </div>
      )}

      {result.totalPages > 1 && (
        <nav aria-label="ページ送り" className="flex items-center justify-end gap-2" data-testid="pagination">
          <Button variant="outline" size="sm" disabled={result.page <= 1} onClick={() => onPage(result.page - 1)}>
            <ChevronLeft aria-hidden="true" />
            前へ
          </Button>
          <span className="tabular font-mono text-sm" data-testid="page-position">
            {result.page} / {result.totalPages} ページ
          </span>
          <Button variant="outline" size="sm" disabled={result.page >= result.totalPages} onClick={() => onPage(result.page + 1)}>
            次へ
            <ChevronRight aria-hidden="true" />
          </Button>
        </nav>
      )}
    </section>
  );
}
