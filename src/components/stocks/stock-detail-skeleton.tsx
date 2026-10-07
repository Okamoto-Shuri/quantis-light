import { ChevronRight } from "lucide-react";

import { TableSkeleton } from "@/components/shell/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/** 右の列の指標のカード（売上CAGR・営業利益率・推定上場年数）。 */
function MetricCardSkeleton() {
  return (
    <div className="space-y-2 rounded-lg border bg-card px-4 py-3">
      <Skeleton className="h-3 w-36" />
      <Skeleton className="h-6 w-20" />
      <Skeleton className="h-3 w-48" />
    </div>
  );
}

/** 業績推移のグラフ（5期の棒）。高さは完成後のグラフに近い値。 */
function ChartSkeleton() {
  const heights = ["h-[30%]", "h-[42%]", "h-[55%]", "h-[70%]", "h-[85%]"];
  return (
    <div className="space-y-2">
      <div className="flex justify-end gap-3">
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-3 w-14" />
      </div>
      <div className="flex h-44 items-end justify-around gap-4 border-b px-4">
        {heights.map((height) => (
          <div key={height} className="flex h-full w-full max-w-24 items-end gap-1.5">
            <Skeleton className={`w-full rounded-b-none ${height}`} />
            <Skeleton className="h-[10%] w-full rounded-b-none" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 銘柄詳細の本体の読み込み中（ページの Suspense の fallback）。
 * ページは銘柄の有無を先に確かめてから（HTTP 404 のため）これを出すので、コードと社名は確定した値を表示できる。
 * 見出し（h1）の役割は付けない（E2E が見出しを表示の完了の合図に使うため）。
 */
export function StockDetailSkeleton({ code, companyName }: { code: string; companyName: string }) {
  return (
    <div aria-busy="true" data-testid="page-skeleton">
      <span className="sr-only">
        {code} {companyName} の詳細を読み込み中…
      </span>
      <div aria-hidden="true" className="space-y-5">
        <div className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
          <span>スクリーニング</span>
          <ChevronRight className="size-3.5" />
          <span className="min-w-0 truncate text-foreground">
            {code} {companyName}
          </span>
        </div>

        <div className="space-y-1.5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="tabular rounded-md border bg-card px-2 py-0.5 font-mono text-sm">{code}</span>
            <p className="text-2xl font-semibold tracking-tight">{companyName}</p>
          </div>
          <Skeleton className="h-7 w-40" />
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-5 w-14" />
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="space-y-3 rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-40" />
            </div>
            <Skeleton className="h-9 w-full" />
            <div className="divide-y rounded-md border">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="space-y-1.5">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3.5 w-14" />
                  </div>
                  <Skeleton className="h-6 w-28" />
                </div>
              ))}
            </div>
            <Skeleton className="h-4 w-48" />
          </div>
          <div className="space-y-3">
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
          </div>
        </div>

        <div className="space-y-3 rounded-lg border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-3 w-full max-w-md" />
          </div>
          <ChartSkeleton />
          <TableSkeleton
            rows={5}
            rowClassName="h-9"
            innerClassName="min-w-[48rem]"
            columns={[
              { width: "w-10" },
              { width: "w-16" },
              { width: "w-36", fr: 2 },
              { width: "w-14", align: "end" },
              { width: "w-14", align: "end" },
              { width: "w-20" },
              { width: "w-16" },
              { width: "w-20" },
            ]}
          />
        </div>

        <div className="space-y-3 rounded-lg border bg-card p-4">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      </div>
    </div>
  );
}
