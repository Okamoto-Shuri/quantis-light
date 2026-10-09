"use client";

import { ArrowRight, ChevronLeft, ChevronRight, CircleAlert, DatabaseZap, Loader2, Search, SearchX, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { formatCount } from "@/lib/format";
import { ownerConditionText } from "@/lib/ownership/display";
import {
  DEFAULT_CONDITIONS,
  defaultOrder,
  parseScreeningParams,
  searchParamsToRecord,
  serializeScreeningParams,
  type ConditionKey,
  type ScreeningConditions,
  type SortKey,
} from "@/lib/screening/params";
import { PRESET_MESSAGES, presetQueryOf, type Preset } from "@/lib/screening/presets";
import type { FilterOptions, ScreeningResult } from "@/lib/screening/result";
import type { MarketCode } from "@/lib/screening/sectors";
import { cn } from "@/lib/utils";

import { ConditionPanel, type PanelHandlers } from "./condition-panel";
import { PresetBar } from "./preset-bar";
import { ResultsTable } from "./results-table";
import { CagrSupplementNote } from "./status-mark";
import type { WatchlistState } from "@/components/watchlist/watchlist-toggle";
import { capturedAtText, type ChangeReason } from "@/lib/screening/changes";

/** Sprint 14: 表示中の条件での「新たに該当」（NEW）。error は読み出しの失敗（NEW を出さずに注記） */
export type NewMarks =
  | { status: "ok"; capturedAt: string | null; items: Record<string, ChangeReason[]>; count: number }
  | { status: "no_snapshot" | "empty_snapshot" | "error" };

/** ページを除いた条件のクエリ。画面の条件が結果に反映済みかの判定に使う（並べ替えは押した時点で画面の条件にも入れる） */
function conditionsQueryOf(conditions: ScreeningConditions): string {
  return serializeScreeningParams({ ...conditions, page: 1 });
}

/**
 * スクリーニングの画面の本体。状態の正本は URL（サーバーが URL から描画した結果を props で受け取る）。
 * 条件パネルの操作は画面の条件（draft。未反映の条件）だけを書き換え、「スクリーニング」のボタン（入力欄の Enter を含む）を
 * 押したときに URL を router.replace で書き換えて検索する（操作のたびにサーバーで検索しない）。
 * 並べ替え・ページ送り・「含めて表示」・プリセットの適用は、明示の操作なのですぐに検索する（並べ替え・ページ送りは
 * 表示中の結果の条件に対して行い、未反映の条件は検索に混ぜない）。
 */
export function ScreeningView({
  conditions,
  queryKey,
  result,
  options,
  invalidFields,
  presets,
  defaultPresetLoadError = false,
  watchlist,
  newMarks,
}: {
  conditions: ScreeningConditions;
  queryKey: string;
  result: ScreeningResult | null;
  options: FilterOptions | null;
  invalidFields: string[];
  /** Sprint 13: 自分のプリセット（null は読み出しの失敗） */
  presets: Preset[] | null;
  /** 既定のプリセットを確かめられなかった（条件のパラメータの無い URL で、プリセットを読めなかった） */
  defaultPresetLoadError?: boolean;
  /** Sprint 14: ページの行のウォッチリストの登録（null は読み出しの失敗） */
  watchlist: Record<string, WatchlistState> | null;
  newMarks: NewMarks;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState(conditions);
  const [pushed, setPushed] = useState(queryKey);
  const [seenKey, setSeenKey] = useState(queryKey);
  const [resetToken, setResetToken] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);

  // URL が外から変わったとき（戻る・進む、ヘッダーの「スクリーニング」）は、画面の条件をサーバーの値に合わせる。
  // 自分が書いた URL の結果（DB が最終ページに置き換えたものを含む）なら、検索中に変えた未反映の条件を残す
  if (queryKey !== seenKey) {
    setSeenKey(queryKey);
    if (queryKey !== pushed && !isPending) {
      if (conditionsQueryOf(conditions) !== conditionsQueryOf(parseQuery(pushed))) {
        setDraft(conditions);
        setResetToken((token) => token + 1);
      }
      setPushed(queryKey);
    }
  }

  /** URL を書き換えて検索する（履歴を増やさない） */
  const navigate = (next: ScreeningConditions) => {
    const query = serializeScreeningParams(next);
    setPushed(query);
    startTransition(() => {
      router.replace(`/screening?${query}`, { scroll: false });
    });
  };

  // 入力欄にエラーを表示中の条件（デスクトップとシートの2つのパネルから届くので、数で持つ）
  const [invalidInputCounts, setInvalidInputCounts] = useState<Partial<Record<ConditionKey, number>>>({});
  const reportInvalidInput = useCallback((key: ConditionKey, invalid: boolean) => {
    setInvalidInputCounts((prev) => ({ ...prev, [key]: Math.max(0, (prev[key] ?? 0) + (invalid ? 1 : -1)) }));
  }, []);
  const invalidInputKeys = (Object.keys(invalidInputCounts) as ConditionKey[]).filter((key) => (invalidInputCounts[key] ?? 0) > 0);

  /** 画面の条件が、表示中（または検索中）の結果の条件と違う */
  const dirty = conditionsQueryOf(draft) !== conditionsQueryOf(conditions) && conditionsQueryOf(draft) !== conditionsQueryOf(parseQuery(pushed));
  const updating = isPending;

  /**
   * 「スクリーニング」: 画面の条件で検索する。入力欄にエラーがあれば検索しない（直前の有効な値で黙って検索しないため）。
   * ページは先頭に戻す。検索したら true
   */
  const submit = () => {
    if (invalidInputKeys.length > 0) return false;
    const next = { ...draft, page: 1 };
    setDraft(next);
    navigate(next);
    return true;
  };

  // 詳細への遷移（Sprint 7 評価の B1）。検索の応答を待っている間に行をクリックすると、後から完了した書き換えが
  // 詳細への遷移を上書きしていた。そこで、完了（isPending が false）を待ってから詳細へ push する。
  // 詳細の URL は、クリックした時点で表示中の結果の条件のまま（Sprint 7 の第2章の1）。
  const detailHref = useRef<string | null>(null);
  /**
   * プリセットの保存・上書きの前: 未反映の条件があれば検索して結果に反映する（保存するのは結果の条件。保存のダイアログは
   * 検索の完了を待つ）。入力欄の無効な値は保存されない（ダイアログが注記する）ので、ここでは有効な値で検索する。
   */
  const flushDraft = () => {
    if (!dirty) return false;
    const next = { ...draft, page: 1 };
    setDraft(next);
    navigate(next);
    return true;
  };
  const openDetail = (href: string) => {
    if (isPending) {
      detailHref.current = href;
      return;
    }
    router.push(href);
  };
  useEffect(() => {
    const href = detailHref.current;
    if (href === null || isPending) return;
    detailHref.current = null;
    router.push(href);
  }, [isPending, router]);

  /** 画面の条件を変える（検索はしない） */
  const change = (patch: Partial<ScreeningConditions>) => setDraft((prev) => ({ ...prev, ...patch, page: 1 }));

  /**
   * 条件をまとめて置き換えて検索する（プリセットの適用）。
   * 条件パネルを作り直し、入力欄に残った無効な値とエラーの表示を捨てる。
   */
  const replaceAll = (next: ScreeningConditions) => {
    const copy = { ...next, off: [...next.off], market: [...next.market], sector: [...next.sector], page: 1 };
    setDraft(copy);
    navigate(copy);
    setResetToken((token) => token + 1);
  };

  /** 結果の側の操作（「含めて表示」）。表示中の結果の条件に足してすぐに検索し、画面の条件にも同じ変更を入れる */
  const applyToResult = (patch: Partial<ScreeningConditions>) => {
    setDraft((prev) => ({ ...prev, ...patch, page: 1 }));
    navigate({ ...conditions, ...patch, page: 1 });
  };

  const defaultPreset = presets?.find((preset) => preset.is_default) ?? null;
  const resetDescription = defaultPreset
    ? `既定のプリセット『${defaultPreset.name}』の条件に戻します（「スクリーニング」を押すと結果に反映します）`
    : "標準の条件（アプリの初期値）に戻します（「スクリーニング」を押すと結果に反映します）";

  const handlers: PanelHandlers = {
    setEnabled: (key: ConditionKey, enabled: boolean) =>
      change({ off: enabled ? draft.off.filter((k) => k !== key) : [...draft.off, key] }),
    commitThreshold: (key, value) => change({ [key]: value }),
    setIncludeUnavailable: (include) => change({ includeUnavailable: include }),
    setOwnerMode: (mode) => change({ ownerMode: mode }),
    setIncludeUndeterminable: (include) => change({ includeUndeterminable: include }),
    toggleMarket: (code: MarketCode, checked) =>
      change({ market: checked ? [...draft.market, code].sort() : draft.market.filter((c) => c !== code) }),
    toggleSector: (code, checked) =>
      change({ sector: checked ? [...draft.sector, code].sort() : draft.sector.filter((c) => c !== code) }),
    // 既定に戻すときは、入力欄に残った不正な値とエラーの表示も捨てる（条件パネルを作り直す。Sprint 6 評価の m1）。
    // 既定のプリセットがあればその条件（並べ替えを含む）、無ければ標準の条件（Sprint 13）。検索はボタンで
    reset: () => {
      const base = defaultPreset ? defaultPreset.conditions : DEFAULT_CONDITIONS;
      setDraft({ ...base, off: [...base.off], market: [...base.market], sector: [...base.sector], page: 1 });
      setResetToken((token) => token + 1);
    },
    submit: () => void submit(),
    reportInvalidInput,
  };

  const onSort = (key: SortKey) => {
    const order = conditions.sort === key ? (conditions.order === "asc" ? "desc" : "asc") : defaultOrder(key);
    setDraft((prev) => ({ ...prev, sort: key, order }));
    navigate({ ...conditions, sort: key, order, page: 1 });
  };

  /** シートの中の「スクリーニング」: 検索したらシートを閉じて結果を見せる */
  const submitFromSheet = () => {
    if (submit()) setSheetOpen(false);
  };

  const goToPage = (page: number) => {
    navigate({ ...conditions, page });
    document.getElementById("screening-results")?.scrollIntoView({ block: "start" });
  };

  return (
    <div className="lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start lg:gap-6" data-layout="wide">
      <aside
        aria-label="条件"
        className="hidden rounded-lg border bg-card lg:sticky lg:top-[4.5rem] lg:block lg:max-h-[calc(100vh-5.5rem)] lg:overflow-y-auto"
      >
        {/* 「スクリーニング」は列の先頭に固定する（1280×800 でも開いた直後からスクロールなしで押せる） */}
        <SubmitBar
          dirty={dirty}
          invalidInputKeys={invalidInputKeys}
          updating={updating}
          onSubmit={submit}
          className="sticky top-0 z-10 border-b bg-card p-3"
        />
        <div className="p-4">
          <ConditionPanel
            key={`desktop-${resetToken}`}
            conditions={draft}
            options={options}
            handlers={handlers}
            resetDescription={resetDescription}
          />
        </div>
      </aside>

      <div className="min-w-0 space-y-3">
        {/* 狭い画面: 条件パネルは折りたたみ、要約（表示中の結果の条件）と AC6.12 の注記を常に見せる */}
        <div className="space-y-2 rounded-lg border bg-card p-3 lg:hidden" data-testid="conditions-summary">
          <div className="flex items-start justify-between gap-3">
            <p className="tabular text-sm">{summaryText(conditions)}</p>
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm" className="shrink-0">
                  <SlidersHorizontal aria-hidden="true" />
                  条件を変更
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-full gap-0 sm:max-w-sm">
                <SheetHeader className="pb-0">
                  <SheetTitle>条件</SheetTitle>
                  <SheetDescription>条件を選んでから「スクリーニング」を押すと、結果を更新します</SheetDescription>
                </SheetHeader>
                <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-6">
                  <ConditionPanel
                    key={`sheet-${resetToken}`}
                    conditions={draft}
                    options={options}
                    handlers={{ ...handlers, submit: submitFromSheet }}
                    resetDescription={resetDescription}
                  />
                </div>
                <SubmitBar
                  dirty={dirty}
                  invalidInputKeys={invalidInputKeys}
                  updating={updating}
                  onSubmit={submitFromSheet}
                  className="border-t bg-background p-4"
                />
              </SheetContent>
            </Sheet>
          </div>
          <CagrSupplementNote />
        </div>

        {/* Sprint 13: 条件プリセット（デスクトップでは結果の列の先頭、狭い画面では条件の要約の直下） */}
        {defaultPresetLoadError && (
          <p
            role="status"
            className="flex items-start gap-2 rounded-md border border-caution/40 bg-caution-muted px-3 py-2 text-sm text-caution-strong"
            data-testid="preset-load-error"
          >
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {PRESET_MESSAGES.load_error}
          </p>
        )}
        <PresetBar
          presets={presets}
          currentQuery={presetQueryOf(conditions)}
          resultConditions={conditions}
          resultQuery={presetQueryOf(conditions)}
          updating={updating}
          invalidInputKeys={invalidInputKeys}
          onApply={replaceAll}
          onFlush={flushDraft}
        />

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

        {dirty && (
          <div
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-md border border-info/40 bg-info-muted px-3 py-2 text-sm text-info-strong"
            data-testid="conditions-dirty-note"
          >
            <span className="flex items-start gap-2">
              <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              条件が変更されています。「スクリーニング」を押すと結果に反映します
            </span>
            <Button
              type="button"
              size="sm"
              onClick={submit}
              disabled={invalidInputKeys.length > 0}
              data-testid="run-screening-inline"
            >
              <Search aria-hidden="true" />
              スクリーニング
            </Button>
          </div>
        )}

        <Results
          result={result}
          conditions={conditions}
          sortState={draft}
          resultQuery={queryKey}
          updating={updating}
          onSort={onSort}
          onPage={goToPage}
          onInclude={() => applyToResult({ includeUnavailable: true })}
          onIncludeUndeterminable={() => applyToResult({ includeUndeterminable: true })}
          onOpenDetail={openDetail}
          watchlist={watchlist}
          newMarks={newMarks}
        />
      </div>
    </div>
  );
}

function parseQuery(query: string): ScreeningConditions {
  return parseScreeningParams(searchParamsToRecord(new URLSearchParams(query))).conditions;
}

/**
 * 「スクリーニング」のボタンと状態の文。デスクトップでは条件の列の先頭に固定し、狭い画面ではシートの下端に置く。
 * 未反映の条件があれば強調し、入力欄にエラーがあれば押せない。
 */
function SubmitBar({
  dirty,
  invalidInputKeys,
  updating,
  onSubmit,
  className,
}: {
  dirty: boolean;
  invalidInputKeys: ConditionKey[];
  updating: boolean;
  onSubmit: () => void;
  className?: string;
}) {
  const invalid = invalidInputKeys.length > 0;
  return (
    <div className={cn("space-y-1.5", className)} data-testid="screening-submit-bar" data-dirty={dirty}>
      <Button type="button" className="w-full" variant={dirty ? "default" : "outline"} disabled={invalid} onClick={onSubmit} data-testid="run-screening">
        {updating ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Search aria-hidden="true" />}
        スクリーニング
      </Button>
      <p className="text-center text-xs text-muted-foreground" aria-live="polite" data-testid="screening-submit-status">
        {invalid ? (
          <span className="text-destructive-strong">入力に誤りがあります。直すと検索できます</span>
        ) : updating ? (
          "検索しています…"
        ) : dirty ? (
          <span className="text-info-strong">未反映の変更があります</span>
        ) : (
          "表示中の結果は、この条件で検索したものです"
        )}
      </p>
    </div>
  );
}


function summaryText(conditions: ScreeningConditions): string {
  const off = (key: ConditionKey) => conditions.off.includes(key);
  return [
    off("cagr") ? "CAGR オフ" : `CAGR ≥${conditions.cagr}%`,
    off("margin") ? "営業利益率 オフ" : `営業利益率 ≥${conditions.margin}%`,
    off("years") ? "上場年数 オフ" : `上場${conditions.years}年以内`,
    off("owner") ? "④ オフ" : `④ ${ownerConditionText(conditions.ownerMode, conditions.owner)}`,
  ].join(" ・ ");
}

function Results({
  result,
  conditions,
  sortState,
  resultQuery,
  updating,
  onSort,
  onPage,
  onInclude,
  onIncludeUndeterminable,
  onOpenDetail,
  watchlist,
  newMarks,
}: {
  result: ScreeningResult | null;
  /** 表示中の結果の条件 */
  conditions: ScreeningConditions;
  /** 並べ替えの見出しに示す並び（押した直後から新しい並びを示す） */
  sortState: ScreeningConditions;
  resultQuery: string;
  updating: boolean;
  onSort: (key: SortKey) => void;
  onPage: (page: number) => void;
  onInclude: () => void;
  onIncludeUndeterminable: () => void;
  onOpenDetail: (href: string) => void;
  watchlist: Record<string, WatchlistState> | null;
  newMarks: NewMarks;
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
      {(result.metricsCount === 0 || result.listingDatesCount === 0 || result.ownershipDeterminedCount === 0) && (
        <div className="space-y-1 rounded-md border border-caution/40 bg-caution-muted px-3 py-2 text-sm text-caution-strong" data-testid="missing-data-notice">
          {result.metricsCount === 0 && <p>財務指標がまだ算出されていません。</p>}
          {result.listingDatesCount === 0 && <p>株価の初出日がまだ取り込まれていません。</p>}
          {result.ownershipDeterminedCount === 0 && <p>条件④の判定がまだありません（有報が未取り込み）。</p>}
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

      {newMarks.status === "ok" && (
        <p className="text-xs text-muted-foreground" data-testid="new-count-note">
          うち{" "}
          <span className="rounded-sm border border-signal/40 bg-signal-muted px-1 text-[0.65rem] font-semibold text-signal-strong">NEW</span>{" "}
          <span className="tabular font-mono">{formatCount(newMarks.count)}</span> 件（前回の取り込みの開始時点{" "}
          <span className="tabular font-mono">{capturedAtText(newMarks.capturedAt)}</span> から新たに該当）
        </p>
      )}
      {newMarks.status === "error" && (
        <p className="flex items-center gap-1.5 text-xs text-caution-strong" data-testid="new-load-error">
          <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
          NEW の判定を取得できませんでした
        </p>
      )}
      {watchlist === null && (
        <p className="flex items-center gap-1.5 text-xs text-caution-strong" data-testid="watchlist-load-error">
          <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
          ウォッチリストを読み込めませんでした（☆は使えません）
        </p>
      )}

      {result.delistedCount > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="delisted-excluded-note">
          上場廃止の <span className="tabular font-mono">{formatCount(result.delistedCount)}</span> 銘柄は検索の対象外です
        </p>
      )}

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

      {result.excludedUndeterminable > 0 && !conditions.includeUndeterminable && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground" data-testid="excluded-undeterminable">
          <span>
            条件④が判定不能のため除外: <span className="tabular font-mono">{formatCount(result.excludedUndeterminable)}</span> 件
          </span>
          <Button variant="link" size="xs" className="h-auto px-0" onClick={onIncludeUndeterminable}>
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
              閾値を下げる、条件をオフにする、または『算出不可を含める』『判定不能の銘柄を含める』をオンにすると表示される場合があります。
            </p>
          </div>
        </div>
      ) : (
        <div className={cn("transition-opacity", updating && "opacity-60")}>
          <ResultsTable
            rows={result.rows}
            conditions={sortState}
            resultConditions={conditions}
            resultQuery={resultQuery}
            referenceDate={result.referenceDate}
            onSort={onSort}
            onOpenDetail={onOpenDetail}
            watchlist={watchlist}
            newItems={newMarks.status === "ok" ? newMarks.items : null}
            capturedAt={newMarks.status === "ok" ? newMarks.capturedAt : null}
          />
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
