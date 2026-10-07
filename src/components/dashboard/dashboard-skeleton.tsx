import { PageSkeleton, SectionHeadingSkeleton, TileSkeleton } from "@/components/shell/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/** ダッシュボードの読み込み中（データの鮮度・前回からの変化・件数のタイルと同じ配置）。 */
export function DashboardSkeleton() {
  return (
    <PageSkeleton title="ダッシュボード" description="保存済みデータの鮮度と件数" className="space-y-6">
      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-28" />
        </div>
        <div className="grid divide-y md:grid-cols-[3fr_2fr] md:divide-x md:divide-y-0">
          <div className="space-y-2 px-4 py-4">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="space-y-2 px-4 py-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-32 rounded-full" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-3 w-full max-w-md" />
        </div>
        <Skeleton className="h-12 w-full" />
      </div>

      <div className="space-y-3">
        <SectionHeadingSkeleton width="w-36" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <TileSkeleton />
          <TileSkeleton meter />
          <TileSkeleton meter />
        </div>
      </div>
    </PageSkeleton>
  );
}
