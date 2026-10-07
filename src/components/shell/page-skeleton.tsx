import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * 画面の読み込み中の枠（loading.tsx・Suspense の fallback）。完成後の画面と同じ配置で骨組みを出し、差し替えのときに配置がずれないようにする。
 * - 見出しの文字は PageHeader と同じ見た目で出すが、heading の役割は付けない（E2E が見出しを「画面の表示が終わった」合図に使っているため）
 * - 支援技術には aria-busy と「読み込み中」の文だけを伝える（role="status" は既存のロケーターと衝突しうるので使わない）
 * - wide は完成後の画面が data-layout="wide"（max-w-7xl）のとき。読み込み中から同じ幅にして、差し替えで幅が変わらないようにする
 */
export function PageSkeleton({
  title,
  description = true,
  wide = false,
  className,
  children,
}: {
  title?: string;
  /** true なら説明の行を骨組みで出す。文字列ならその文を出す。false なら出さない */
  description?: boolean | string;
  wide?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div aria-busy="true" data-layout={wide ? "wide" : undefined} data-testid="page-skeleton">
      <span className="sr-only">読み込み中…</span>
      <div aria-hidden="true" className={cn("space-y-5", className)}>
        {title !== undefined && (
          <div className="space-y-1">
            <p className="text-2xl font-semibold tracking-tight">{title}</p>
            {typeof description === "string" ? (
              <p className="text-sm text-muted-foreground">{description}</p>
            ) : description ? (
              <Skeleton className="my-0.5 h-4 w-64 max-w-full" />
            ) : null}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/** 枠線のカード（見出しの帯＋本文）。 */
export function CardSkeleton({
  className,
  headingWidth = "w-28",
  lines = 3,
  children,
}: {
  className?: string;
  headingWidth?: string;
  lines?: number;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-lg border bg-card", className)}>
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <Skeleton className={cn("h-4", headingWidth)} />
        <Skeleton className="h-3.5 w-20" />
      </div>
      <div className="space-y-2.5 px-4 py-4">
        {children ?? Array.from({ length: lines }, (_, i) => <Skeleton key={i} className={cn("h-4", LINE_WIDTHS[i % LINE_WIDTHS.length])} />)}
      </div>
    </div>
  );
}

const LINE_WIDTHS = ["w-full", "w-11/12", "w-4/5", "w-2/3"];

/** 数値のタイル（ダッシュボード・取り込み状況の要約）。 */
export function TileSkeleton({ className, meter = false }: { className?: string; meter?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-3 rounded-lg border bg-card px-4 py-4", className)}>
      <Skeleton className="h-3 w-32" />
      <Skeleton className="h-8 w-24" />
      {meter && <Skeleton className="h-1 w-full rounded-full" />}
    </div>
  );
}

/**
 * 表の骨組み。列ごとの幅（Tailwind のクラス）を渡す。数値の列は右寄せにする（完成後の表と揃える）。
 * 行の高さは完成後の表に近い値にして、差し替えで高さが大きく変わらないようにする。
 */
export function TableSkeleton({
  columns,
  rows = 8,
  rowClassName = "h-11",
  className,
  innerClassName,
}: {
  /** width は骨組みの棒の幅、fr は列の幅の比（既定 1） */
  columns: { width: string; fr?: number; align?: "end"; lines?: 1 | 2 }[];
  rows?: number;
  rowClassName?: string;
  className?: string;
  /** 完成後の表が横にスクロールする画面では、同じ最小幅（min-w-[60rem] など）を渡す。はみ出した分は切る */
  innerClassName?: string;
}) {
  const template = { gridTemplateColumns: columns.map((column) => `minmax(0,${column.fr ?? 1}fr)`).join(" ") };
  return (
    <div className={cn("overflow-hidden rounded-lg border bg-card", className)}>
      <div className={innerClassName}>
        <div className="grid items-center gap-4 border-b bg-muted/40 px-4 py-2.5" style={template}>
          {columns.map((column, i) => (
            <Skeleton key={i} className={cn("h-3 w-12 max-w-full", column.align === "end" && "justify-self-end")} />
          ))}
        </div>
        <div className="divide-y">
          {Array.from({ length: rows }, (_, row) => (
            <div key={row} className={cn("grid items-center gap-4 px-4", rowClassName)} style={template}>
              {columns.map((column, i) => (
                <div key={i} className={cn("flex min-w-0 flex-col gap-1.5", column.align === "end" && "items-end")}>
                  <Skeleton className={cn("h-3.5 max-w-full", column.width)} />
                  {column.lines === 2 && <Skeleton className="h-3 w-3/5 max-w-full" />}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 区画の見出し（text-sm の h2 の代わり）と説明の行。 */
export function SectionHeadingSkeleton({ width = "w-32", description = false }: { width?: string; description?: boolean }) {
  return (
    <div className="space-y-2">
      <Skeleton className={cn("h-4", width)} />
      {description && <Skeleton className="h-3.5 w-full max-w-xl" />}
    </div>
  );
}
