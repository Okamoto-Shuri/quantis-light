import { CardSkeleton, PageSkeleton, SectionHeadingSkeleton, TableSkeleton, TileSkeleton } from "@/components/shell/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/** 要約の区画（見出し・説明・タイルの並び）。 */
function SummarySectionSkeleton({ tiles }: { tiles: number }) {
  return (
    <div className="space-y-3">
      <SectionHeadingSkeleton width="w-48" description />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: tiles }, (_, i) => (
          <TileSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

/** 取り込み状況の読み込み中（データソース・手動取り込み・銘柄コードで確認・各区画・実行履歴の順）。 */
export function ImportsSkeleton() {
  return (
    <PageSkeleton title="取り込み状況" description="データソースの設定、手動取り込み、実行履歴" className="space-y-6">
      <div className="space-y-3">
        <SectionHeadingSkeleton width="w-36" />
        <div className="grid gap-3 md:grid-cols-3">
          <CardSkeleton className="min-h-40" lines={2} />
          <CardSkeleton className="min-h-40" lines={2} />
          <CardSkeleton className="min-h-40" lines={3} />
        </div>
      </div>

      <div className="space-y-3 rounded-lg border bg-card p-4">
        <SectionHeadingSkeleton width="w-24" description />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto] lg:items-end">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
          <Skeleton className="h-9 w-32" />
        </div>
      </div>

      <div className="space-y-3">
        <SectionHeadingSkeleton width="w-28" description />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>

      <SummarySectionSkeleton tiles={4} />

      <div className="space-y-3">
        <SectionHeadingSkeleton width="w-20" />
        <TableSkeleton rows={5} rowClassName="h-9" columns={[{ width: "w-12" }, { width: "w-32", fr: 2 }, { width: "w-16" }, { width: "w-20" }, { width: "w-10", align: "end" }]} />
      </div>
    </PageSkeleton>
  );
}
