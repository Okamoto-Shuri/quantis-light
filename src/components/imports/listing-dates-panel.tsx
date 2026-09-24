import { CircleAlert, CircleDashed, History } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatCount } from "@/lib/format";
import { describeListingAge, type ListingAge } from "@/lib/listing/ages";
import type { ListingEntry, ListingSummary, Result } from "@/lib/listing/queries";
import { cn } from "@/lib/utils";

import { SummaryNumber, SummaryTile } from "./summary-tile";

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

function Summary({ summary }: { summary: ListingSummary }) {
  const undetermined = Math.max(0, summary.stockCount - summary.determinedCount);
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <SummaryTile
        label="基準日"
        testId="listing-reference-date"
        value={
          summary.referenceDate ? (
            <span className="tabular font-mono text-base">{summary.referenceDate}</span>
          ) : (
            <span className="text-muted-foreground">なし</span>
          )
        }
        note={summary.referenceDate ? undefined : "株価の取り込み実績がありません"}
      />
      <SummaryTile
        label="データ期間の開始日"
        testId="listing-data-start"
        value={summary.dataStartDate ? <span className="tabular font-mono text-base">{summary.dataStartDate}</span> : <Dash />}
      />
      <SummaryTile
        label="初出日が確定した銘柄"
        testId="listing-determined"
        value={<SummaryNumber value={formatCount(summary.determinedCount)} unit="銘柄" />}
        note={
          <>
            うち、データ期間開始以前から上場: <span className="tabular font-mono">{formatCount(summary.beforeDataStartCount)}</span> 銘柄
          </>
        }
      />
      <SummaryTile
        label="未確定の銘柄"
        testId="listing-undetermined"
        value={<SummaryNumber value={formatCount(undetermined)} unit="銘柄" />}
        note="銘柄マスタにあって、初出日が未取り込み"
      />
    </dl>
  );
}

/** 銘柄コードで確認したときの、推定上場年数のカード。 */
export function ListingCard({ age }: { age: ListingAge }) {
  const display = describeListingAge(age);
  return (
    <article className="min-w-0 rounded-lg border bg-card px-4 py-3" data-testid="listing-lookup-card" aria-labelledby="listing-card-heading">
      <h4 id="listing-card-heading" className="text-sm font-medium">
        推定上場年数
      </h4>
      <dl className="mt-3 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-[max-content_max-content_minmax(0,1fr)]">
        <div className="min-w-0 space-y-0.5">
          <dt className="text-xs whitespace-nowrap text-muted-foreground">初出日</dt>
          <dd className="tabular font-mono" data-testid="listing-first-date">
            {age.first_price_date ?? <Dash />}
          </dd>
        </div>
        <div className="min-w-0 space-y-0.5">
          <dt className="text-xs whitespace-nowrap text-muted-foreground">データ期間の開始日</dt>
          <dd className="tabular font-mono">{age.data_start_date ?? <Dash />}</dd>
        </div>
        <div className="min-w-0 space-y-0.5">
          <dt className="text-xs whitespace-nowrap text-muted-foreground">推定上場年数</dt>
          <dd className="min-w-0 space-y-0.5" data-testid="listing-years">
            <ListingAgeValue age={age} className={display.kind === "years" ? "text-base font-medium" : undefined} />
            {display.kind === "years" && <span className="block text-xs text-muted-foreground">株価データの初出日からの推定</span>}
            {display.kind === "before_data_start" && (
              <span className="block text-xs text-muted-foreground">
                データ期間の開始日より前から上場している可能性があるため、年数を特定できません
              </span>
            )}
          </dd>
        </div>
      </dl>
    </article>
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
export function ListingDatesPanel({ summary, recent }: { summary: Result<ListingSummary>; recent: Result<ListingEntry[]> }) {
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
          <RecentListings entries={recent.value} />
        </>
      )}
    </section>
  );
}
