import { PageSkeleton, TableSkeleton } from "@/components/shell/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/** 条件パネルの1つの条件（見出しとスイッチ、入力欄、スライダー）。 */
function ConditionSkeleton() {
  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-5 w-9 rounded-full" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-9 w-20" />
      </div>
      <Skeleton className="h-1.5 w-full rounded-full" />
    </div>
  );
}

/**
 * スクリーニングの読み込み中（条件パネル・プリセット・結果の表と同じ配置。幅も完成後と同じ max-w-7xl）。
 * ページの Suspense の fallback。条件の変更（URL の書き換え）では出ない（遷移中は表示を保ち、ScreeningView が表を薄くして示す）。
 */
export function ScreeningSkeleton() {
  return (
    <PageSkeleton title="スクリーニング" wide>
      <div className="lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start lg:gap-6">
        <div className="hidden space-y-4 rounded-lg border bg-card p-4 lg:block">
          <div className="space-y-2.5">
            <Skeleton className="h-4 w-20" />
            <div className="flex flex-wrap gap-3">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
          <div className="space-y-2.5">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-9 w-full" />
          </div>
          <ConditionSkeleton />
          <Skeleton className="h-20 w-full" />
          <ConditionSkeleton />
          <ConditionSkeleton />
          <ConditionSkeleton />
        </div>

        <div className="min-w-0 space-y-3">
          <div className="space-y-2 rounded-lg border bg-card p-3 lg:hidden">
            <div className="flex items-start justify-between gap-3">
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-8 w-28" />
            </div>
            <Skeleton className="h-14 w-full" />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-8 w-44" />
            <Skeleton className="h-8 w-36" />
            <Skeleton className="h-8 w-16" />
          </div>

          <div className="flex items-center justify-between gap-3 py-1">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-28" />
          </div>

          <TableSkeleton
            rowClassName="h-[3.25rem]"
            innerClassName="min-w-[60rem] lg:min-w-0"
            rows={10}
            columns={[
              { width: "w-16", fr: 1.1 },
              { width: "w-24", fr: 1.4, lines: 2 },
              { width: "w-14", fr: 1.1, lines: 2 },
              { width: "w-12", align: "end" },
              { width: "w-12", align: "end" },
              { width: "w-12", align: "end", lines: 2 },
              { width: "w-20", fr: 1.1 },
              { width: "w-28", fr: 1.6 },
              { width: "w-24", fr: 1.3 },
            ]}
          />
        </div>
      </div>
    </PageSkeleton>
  );
}
