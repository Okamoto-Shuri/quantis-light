import { cn } from "@/lib/utils";

/** 製品ロゴ（上昇する3本のバー）とワードマーク。 */
export function BrandMark({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-medium tracking-tight whitespace-nowrap", className)}>
      <svg viewBox="0 0 20 20" aria-hidden="true" className="size-5 shrink-0">
        <rect x="2" y="11" width="4" height="7" rx="1" className="fill-muted-foreground/50" />
        <rect x="8" y="7" width="4" height="11" rx="1" className="fill-muted-foreground/80" />
        <rect x="14" y="2" width="4" height="16" rx="1" className="fill-signal" />
      </svg>
      {!compact && (
        <span>
          Quantis <span className="text-muted-foreground">Light</span>
        </span>
      )}
    </span>
  );
}
