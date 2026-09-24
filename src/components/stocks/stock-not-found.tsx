"use client";

import { SearchX } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { normalizeStockCode } from "@/lib/listing/ages";
import { searchParamsToRecord } from "@/lib/screening/params";
import { detailConditionsFromParams } from "@/lib/stocks/detail";

import { StockBreadcrumb } from "./breadcrumb";

function codeFromPath(pathname: string): string | null {
  const segment = pathname.split("/")[2] ?? "";
  try {
    return normalizeStockCode(decodeURIComponent(segment));
  } catch {
    return null;
  }
}

/**
 * 「銘柄が見つかりません」（AC7.5）。not-found.tsx は props を受け取らないので、コードとクエリは URL から読む。
 * コードは正規化できたときだけ表示する。スクリーニングに戻るリンクは受け取ったクエリの正規形を保つ。
 */
export function StockNotFound() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const code = codeFromPath(pathname);
  const { screeningHref } = detailConditionsFromParams(searchParamsToRecord(new URLSearchParams(searchParams.toString())));

  return (
    <div className="space-y-5" data-testid="stock-not-found">
      <StockBreadcrumb screeningHref={screeningHref} current="銘柄が見つかりません" />
      <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed bg-card px-6 py-10">
        <span className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <SearchX aria-hidden="true" className="size-5" />
        </span>
        <div className="space-y-1.5">
          <p className="font-mono text-sm text-muted-foreground">404</p>
          <h1 className="text-2xl font-semibold tracking-tight">銘柄が見つかりません</h1>
          {code && (
            <p className="text-sm">
              銘柄コード <span className="tabular font-mono" data-testid="not-found-code">{code}</span>
            </p>
          )}
          <p className="max-w-prose text-sm text-muted-foreground">
            銘柄マスタに無いコードか、上場廃止などで一覧から外れた可能性があります。
          </p>
        </div>
        <Link
          href={screeningHref}
          className="text-sm font-medium text-signal-strong underline-offset-4 hover:underline"
          data-testid="not-found-back"
        >
          スクリーニングに戻る
        </Link>
      </div>
    </div>
  );
}
