import { PageSkeleton, TableSkeleton } from "@/components/shell/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/** ウォッチリストの読み込み中（判定の条件の行と表。幅は登録がある画面と同じ max-w-7xl）。 */
export function WatchlistSkeleton() {
  return (
    <PageSkeleton title="ウォッチリスト" description="登録した銘柄の最新の指標とメモ（既定の条件で判定）" wide>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Skeleton className="h-3.5 w-56" />
          <Skeleton className="h-4 w-36" />
        </div>
        <TableSkeleton
          rowClassName="h-14"
          innerClassName="min-w-[72rem]"
          rows={6}
          columns={[
            { width: "w-16" },
            { width: "w-24", fr: 1.4, lines: 2 },
            { width: "w-14", lines: 2 },
            { width: "w-12", align: "end" },
            { width: "w-12", align: "end" },
            { width: "w-12", align: "end", lines: 2 },
            { width: "w-20", fr: 1.1 },
            { width: "w-24", fr: 1.3 },
            { width: "w-20", fr: 1.5, lines: 2 },
            { width: "w-16" },
          ]}
        />
      </div>
    </PageSkeleton>
  );
}
