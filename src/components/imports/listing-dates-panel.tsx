import { CircleAlert, CircleDashed, History, Search } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCount } from "@/lib/format";
import { describeListingAge, type ListingAge } from "@/lib/listing/ages";
import type { ListingEntry, ListingSummary, Result } from "@/lib/listing/queries";
import { cn } from "@/lib/utils";

/** 銘柄コードで確認した結果（ページが検索パラメーターから作る）。 */
export type ListingLookup =
  | { kind: "none" }
  | { kind: "invalid"; input: string }
  | { kind: "not_found"; code: string }
  | { kind: "error" }
  | { kind: "found"; entry: ListingEntry };

const Dash = () => <span className="text-muted-foreground">—</span>;

/**
 * 推定上場年数の値。通常の年数は数値、それ以外（データ期間開始以前、未確定、基準日なし）は
 * アイコンと文字で区別する（色だけに頼らない）。
 */
export function ListingAgeValue({ age, className }: { age: ListingAge; className?: string }) {
  const display = describeListingAge(age);
  if (display.kind === "years") {
    return <span className={cn("tabular font-mono", className)}>{display.text}</span>;
  }
  const Icon = display.kind === "before_data_start" ? History : display.kind === "undetermined" ? CircleDashed : CircleAlert;
  return (
    <span
      data-kind={display.kind}
      className={cn(
        "inline-flex items-start gap-1.5 text-sm",
        display.kind === "no_reference" ? "text-caution-strong" : "text-muted-foreground",
        className,
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span>{display.text}</span>
    </span>
  );
}

function SummaryItem({ label, children, testId }: { label: string; children: React.ReactNode; testId: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border bg-card px-4 py-3" data-testid={testId}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

function Summary({ summary }: { summary: ListingSummary }) {
  const undetermined = Math.max(0, summary.stockCount - summary.determinedCount);
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <SummaryItem label="基準日" testId="listing-reference-date">
        {summary.referenceDate ? (
          <span className="tabular font-mono text-base">{summary.referenceDate}</span>
        ) : (
          <span className="text-muted-foreground">なし（株価の取り込み実績がありません）</span>
        )}
      </SummaryItem>
      <SummaryItem label="データ期間の開始日" testId="listing-data-start">
        {summary.dataStartDate ? <span className="tabular font-mono text-base">{summary.dataStartDate}</span> : <Dash />}
      </SummaryItem>
      <SummaryItem label="初出日が確定した銘柄" testId="listing-determined">
        <span className="tabular font-mono text-base">{formatCount(summary.determinedCount)}</span> 銘柄
        <span className="block text-xs text-muted-foreground">
          うち、データ期間開始以前から上場:{" "}
          <span className="tabular font-mono">{formatCount(summary.beforeDataStartCount)}</span> 銘柄
        </span>
      </SummaryItem>
      <SummaryItem label="未確定の銘柄" testId="listing-undetermined">
        <span className="tabular font-mono text-base">{formatCount(undetermined)}</span> 銘柄
        <span className="block text-xs text-muted-foreground">銘柄マスタにあって、初出日が未取り込み</span>
      </SummaryItem>
    </dl>
  );
}

function LookupResult({ lookup }: { lookup: ListingLookup }) {
  switch (lookup.kind) {
    case "none":
      return null;
    case "invalid":
      return (
        <p id="listing-code-error" className="text-sm text-destructive-strong" data-testid="listing-lookup-message">
          銘柄コードは4桁または5桁の英数字で入力してください
        </p>
      );
    case "not_found":
      return (
        <p className="text-sm text-muted-foreground" data-testid="listing-lookup-message">
          銘柄コード <span className="tabular font-mono text-foreground">{lookup.code}</span> は銘柄マスタにありません
        </p>
      );
    case "error":
      return (
        <p className="text-sm text-destructive-strong" data-testid="listing-lookup-message">
          銘柄を取得できませんでした。時間をおいて再読み込みしてください。
        </p>
      );
    case "found": {
      const { stock, age } = lookup.entry;
      const display = describeListingAge(age);
      return (
        <article className="rounded-md border bg-background px-4 py-3" data-testid="listing-lookup-card">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="tabular font-mono text-sm">{stock.code}</span>
            <h3 className="text-sm font-medium">{stock.company_name}</h3>
            <span className="text-xs text-muted-foreground">{stock.market_name ?? "市場区分なし"}</span>
          </div>
          <dl className="mt-3 grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">初出日</dt>
            <dd className="tabular font-mono" data-testid="listing-first-date">
              {age.first_price_date ?? <Dash />}
            </dd>
            <dt className="text-muted-foreground">データ期間の開始日</dt>
            <dd className="tabular font-mono">{age.data_start_date ?? <Dash />}</dd>
            <dt className="text-muted-foreground">推定上場年数</dt>
            <dd className="min-w-0 space-y-0.5" data-testid="listing-years">
              <ListingAgeValue age={age} className={display.kind === "years" ? "text-base font-medium" : undefined} />
              {display.kind === "years" && (
                <span className="block text-xs text-muted-foreground">株価データの初出日からの推定</span>
              )}
              {display.kind === "before_data_start" && (
                <span className="block text-xs text-muted-foreground">
                  データ期間の開始日より前から上場している可能性があるため、年数を特定できません
                </span>
              )}
            </dd>
          </dl>
        </article>
      );
    }
  }
}

function Lookup({ lookup }: { lookup: ListingLookup }) {
  const invalid = lookup.kind === "invalid";
  const defaultValue = lookup.kind === "invalid" ? lookup.input : lookup.kind === "not_found" ? lookup.code : lookup.kind === "found" ? lookup.entry.stock.code : "";
  return (
    <div className="min-w-0 space-y-3 rounded-lg border bg-card px-4 py-4">
      <h3 className="text-sm font-medium">銘柄コードで確認</h3>
      <form action="/imports" method="get" className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 space-y-1.5 sm:w-56">
          <label htmlFor="listing-code" className="text-xs text-muted-foreground">
            銘柄コード
          </label>
          <Input
            id="listing-code"
            name="code"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            maxLength={16}
            placeholder="例: 86970"
            defaultValue={defaultValue}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? "listing-code-error" : "listing-code-hint"}
            className="tabular h-9 font-mono"
          />
        </div>
        <Button type="submit" variant="outline" className="h-9 sm:w-auto">
          <Search aria-hidden="true" />
          確認
        </Button>
      </form>
      <p id="listing-code-hint" className="text-xs text-muted-foreground">
        4桁のコードは末尾に 0 を付けた5桁として探します（8697 → 86970）。
      </p>
      <LookupResult lookup={lookup} />
    </div>
  );
}

function RecentListings({ entries }: { entries: ListingEntry[] }) {
  return (
    <div className="min-w-0 space-y-2">
      <h3 className="text-sm font-medium">初出日の新しい銘柄</h3>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">データ期間の中で初出日が確定した銘柄はまだありません。</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[32rem] text-sm" data-testid="listing-recent-table">
            <thead className="border-b bg-surface text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">コード</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">社名</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">市場区分</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">初出日</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">推定上場年数</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {entries.map(({ stock, age }) => (
                <tr key={stock.code} data-code={stock.code}>
                  <td className="tabular px-3 py-2 font-mono whitespace-nowrap">{stock.code}</td>
                  <td className="px-3 py-2">{stock.company_name}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{stock.market_name ?? <Dash />}</td>
                  <td className="tabular px-3 py-2 font-mono whitespace-nowrap">{age.first_price_date}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <ListingAgeValue age={age} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** 取り込み状況の画面の「株価の初出日と推定上場年数」。値はすべて保存済みデータ（DB のビュー）から作る。 */
export function ListingDatesPanel({
  summary,
  recent,
  lookup,
}: {
  summary: Result<ListingSummary>;
  recent: Result<ListingEntry[]>;
  lookup: ListingLookup;
}) {
  return (
    <section aria-labelledby="listing-heading" className="space-y-3" data-testid="listing-dates">
      <div className="space-y-1">
        <h2 id="listing-heading" className="text-sm font-medium">
          株価の初出日と推定上場年数
        </h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          推定上場年数は、株価データの初出日からの推定です。J-Quants（Standard
          プラン）で取得できる株価は約10年分のため、それより前から上場している銘柄は「データ期間開始以前から上場（N年超）」と表示します。
        </p>
      </div>

      {!summary.ok || !recent.ok ? (
        <Alert variant="destructive" className="max-w-2xl">
          <AlertTitle>株価の初出日を取得できませんでした</AlertTitle>
          <AlertDescription>時間をおいて再読み込みしてください。</AlertDescription>
        </Alert>
      ) : (
        <>
          <Summary summary={summary.value} />
          {summary.value.determinedCount === 0 && (
            <div className="flex items-center gap-3 rounded-lg border border-dashed bg-card px-4 py-5" data-testid="listing-empty">
              <CircleDashed aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
              <div className="space-y-0.5">
                <p className="text-sm font-medium">株価の初出日はまだ取り込まれていません</p>
                <p className="text-sm text-muted-foreground">
                  手動取り込みで対象「株価（初出日）」を選んで「今すぐ取り込み」を押すか、定期実行を待ってください。
                </p>
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,27rem)_minmax(0,1fr)]">
            <Lookup lookup={lookup} />
            <RecentListings entries={recent.value} />
          </div>
        </>
      )}
    </section>
  );
}
