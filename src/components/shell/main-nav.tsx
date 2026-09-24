"use client";

import { usePathname } from "next/navigation";

import { isNavItemActive, NAV_ITEMS } from "@/lib/navigation";
import { cn } from "@/lib/utils";

import { AppLink } from "./app-link";

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
  const vertical = orientation === "vertical";

  return (
    <nav aria-label="メイン" className={className}>
      <ul className={cn("flex", vertical ? "flex-col gap-0.5" : "items-center gap-1")}>
        {NAV_ITEMS.map((item) => {
          const active = isNavItemActive(pathname, item.href);
          return (
            <li key={item.href}>
              <AppLink
                href={item.href}
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
