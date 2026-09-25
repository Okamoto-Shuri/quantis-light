import { runStatusLabel, type PartialKind, type RunStatus } from "@/lib/ingestion/runs";
import { cn } from "@/lib/utils";

const STYLES: Record<RunStatus, { badge: string; dot: string }> = {
  succeeded: { badge: "border-signal/30 bg-signal-muted text-signal-strong", dot: "bg-signal" },
  partial: { badge: "border-caution/35 bg-caution-muted text-caution-strong", dot: "bg-caution" },
  failed: { badge: "border-destructive/30 bg-destructive-muted text-destructive-strong", dot: "bg-destructive" },
  running: { badge: "border-border bg-muted text-foreground", dot: "bg-muted-foreground animate-pulse" },
};

/** 一部完了（時間切れ・応答なしで止まり、失敗なし）は、一部失敗と文字で区別する（色は同じ注意の色で、点を輪にする）。 */
const INCOMPLETE_DOT = "bg-transparent ring-1 ring-caution ring-inset";

/**
 * 取り込みの結果。色だけに頼らず、必ず文字でも示す。partialKind を渡すと、partial を「一部完了」「一部失敗」に分けて表示する
 * （渡さなければ Sprint 3 からの「一部失敗」）。
 */
export function RunStatusBadge({
  status,
  partialKind = null,
  className,
}: {
  status: RunStatus;
  partialKind?: PartialKind | null;
  className?: string;
}) {
  const style = STYLES[status];
  const incomplete = status === "partial" && partialKind === "incomplete";
  return (
    <span
      data-status={status}
      data-partial-kind={status === "partial" ? (partialKind ?? "failed") : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        style.badge,
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", incomplete ? INCOMPLETE_DOT : style.dot)} />
      {runStatusLabel(status, status === "partial" ? (partialKind ?? "failed") : null)}
    </span>
  );
}
