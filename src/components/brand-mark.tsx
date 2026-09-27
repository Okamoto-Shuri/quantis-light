import Image from "next/image";

import quantisIcon from "@/assets/quantis-icon.png";
import { cn } from "@/lib/utils";

/** 上昇チャートを組み込んだ Q アイコンとワードマーク。 */
export function BrandMark({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-medium tracking-tight whitespace-nowrap", className)}>
      <Image
        src={quantisIcon}
        alt={compact ? "Quantis Light" : ""}
        width={28}
        height={28}
        unoptimized
        className="size-7 shrink-0 rounded-md"
      />
      {!compact && (
        <span>
          Quantis <span className="text-muted-foreground">Light</span>
        </span>
      )}
    </span>
  );
}
