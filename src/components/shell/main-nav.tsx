"use client";

import { usePathname, useSearchParams } from "next/navigation";

import { isNavItemActive, NAV_ITEMS } from "@/lib/navigation";
import { navItemHref } from "@/lib/navigation-href";
import { cn } from "@/lib/utils";

import { AppLink, useIsNotFoundDocument } from "./app-link";

/**
 * ナビゲーションの項目。横並び（ヘッダー）と縦並び（モバイルのドロワー）の両方で使う。
 * 現在の画面の項目には aria-current="page" を付ける。
 */
export function MainNav({
  orientation,
  onNavigate,
  className,
}: {
  orientation: "horizontal" | "vertical";
  onNavigate?: () => void;
  className?: string;
}) {
  const pathname = usePathname();
  // 404 の画面では、どの項目も現在の画面として示さない（/imports/zzz などの配下のパスを含む）
  const notFound = useIsNotFoundDocument();
  const vertical = orientation === "vertical";
  // 銘柄詳細を開いている間は、「スクリーニング」のリンクに受け取った条件を付ける（AC7.6。パンくずと同じ URL）
  const searchParams = useSearchParams();

  return (
    <nav aria-label="メイン" className={className}>
      <ul className={cn("flex", vertical ? "flex-col gap-0.5" : "items-center gap-1")}>
        {NAV_ITEMS.map((item) => {
          const active = !notFound && isNavItemActive(pathname, item.href);
          return (
            <li key={item.href}>
              <AppLink
                href={notFound ? item.href : navItemHref(item.href, pathname, searchParams.toString())}
                aria-current={active ? "page" : undefined}
                onClick={onNavigate}
                className={cn(
                  "relative flex items-center rounded-md text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  vertical ? "h-10 px-3" : "h-9 px-3",
                  active
                    ? "bg-accent font-medium text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  // 横並びでは、現在の画面の下端に細いアクセントの線を引く
                  !vertical && active && "after:absolute after:inset-x-3 after:-bottom-[11px] after:h-0.5 after:rounded-full after:bg-signal",
                  // 縦並びでは、左端に線を引く
                  vertical && active && "before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-signal",
                )}
              >
                {item.label}
              </AppLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
