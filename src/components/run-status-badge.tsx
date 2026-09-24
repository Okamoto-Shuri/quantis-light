import { RUN_STATUS_LABELS, type RunStatus } from "@/lib/ingestion/runs";
import { cn } from "@/lib/utils";

const STYLES: Record<RunStatus, { badge: string; dot: string }> = {
  succeeded: { badge: "border-signal/30 bg-signal-muted text-signal-strong", dot: "bg-signal" },
  partial: { badge: "border-caution/35 bg-caution-muted text-caution-strong", dot: "bg-caution" },
  failed: { badge: "border-destructive/30 bg-destructive-muted text-destructive-strong", dot: "bg-destructive" },
  running: { badge: "border-border bg-muted text-foreground", dot: "bg-muted-foreground animate-pulse" },
};

/** 取り込みの結果。色だけに頼らず、必ず文字でも示す。 */
export function RunStatusBadge({ status, className }: { status: RunStatus; className?: string }) {
  const style = STYLES[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        style.badge,
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", style.dot)} />
      {RUN_STATUS_LABELS[status]}
    </span>
  );
}
