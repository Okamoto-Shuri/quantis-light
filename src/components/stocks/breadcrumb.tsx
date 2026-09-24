import { ChevronRight } from "lucide-react";

import { AppLink } from "@/components/shell/app-link";

/** パンくず「スクリーニング › 99991 社名」。スクリーニングへのリンクは受け取った条件の正規形のクエリ付き（AC7.6）。 */
export function StockBreadcrumb({ screeningHref, current }: { screeningHref: string; current: string }) {
  return (
    <nav aria-label="パンくず" data-testid="breadcrumb">
      <ol className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
        <li>
          <AppLink
            href={screeningHref}
            className="rounded-sm underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
            data-testid="breadcrumb-screening"
          >
            スクリーニング
          </AppLink>
        </li>
        <li aria-hidden="true">
          <ChevronRight className="size-3.5" />
        </li>
        <li aria-current="page" className="min-w-0 truncate text-foreground">
          {current}
        </li>
      </ol>
    </nav>
  );
}
