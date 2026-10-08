"use client";

import { CircleAlert, CornerDownLeft, Loader2, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { Command, CommandDialog, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { NAV_ITEMS } from "@/lib/navigation";
import type { StockSearchHit } from "@/lib/stocks/search";

import { useIsNotFoundDocument } from "./app-link";

/** 入力が止まってから検索するまでの時間 */
const SEARCH_DEBOUNCE_MS = 200;

type SearchState =
  | { kind: "idle" }
  | { kind: "loading"; query: string; hits: StockSearchHit[] }
  | { kind: "done"; query: string; hits: StockSearchHit[] }
  | { kind: "error"; query: string };

// macOS かどうか（ショートカットの表示だけに使う。サーバーと初回の描画は ⌘K）
const noopSubscribe = () => () => {};
const isApplePlatform = () => /Mac|iPhone|iPad/.test(navigator.userAgent);

/**
 * ヘッダーの「銘柄を検索」（コマンドパレット。shadcn の Command）。⌘K・Ctrl+K でも開く。
 * - コード（前方一致）・社名・英文社名（部分一致）で GET /api/stocks/search を呼び、選ぶと銘柄詳細へ移る（条件は既定のプリセット）
 * - 入力が空の間は画面の移動（ナビゲーションの項目）を出す
 * - 絞り込みはサーバーが行う（cmdk の絞り込みは使わない）。後から届いた古い応答は捨てる
 * - global-not-found の中では next/navigation の遷移が効かないので、文書遷移にする
 */
export function StockSearch() {
  const router = useRouter();
  const documentNavigation = useIsNotFoundDocument();
  const apple = useSyncExternalStore(noopSubscribe, isApplePlatform, () => true);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({ kind: "idle" });
  // 閉じたらフォーカスを開く前の要素に戻す（状態で開くので、Radix の自動の戻し先（トリガー）が無い）。移動したときは戻さない
  const returnFocus = useRef<HTMLElement | null>(null);
  const navigated = useRef(false);

  const trimmed = query.trim();
  useEffect(() => {
    if (trimmed === "") return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setState((prev) => ({ kind: "loading", query: trimmed, hits: prev.kind === "done" || prev.kind === "loading" ? prev.hits : [] }));
      try {
        const response = await fetch(`/api/stocks/search?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as { data: StockSearchHit[] };
        setState({ kind: "done", query: trimmed, hits: body.data });
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("[stock-search] 銘柄の検索に失敗しました", error);
        setState({ kind: "error", query: trimmed });
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed]);

  function rememberFocus() {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    navigated.current = false;
  }

  const changeOpen = (next: boolean) => {
    if (next && !open) rememberFocus();
    setOpen(next);
    if (!next) {
      setQuery("");
      setState({ kind: "idle" });
    }
  };

  const toggle = useEffectEvent(() => changeOpen(!open));
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        toggle();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const go = (href: string) => {
    navigated.current = true;
    changeOpen(false);
    if (documentNavigation) window.location.assign(href);
    else router.push(href);
  };

  const hits = trimmed !== "" && (state.kind === "done" || state.kind === "loading") ? state.hits : [];
  // 今の入力の応答がまだ届いていない間（入力の待ち・要求中）は「検索しています」
  const settled = (state.kind === "done" || state.kind === "error") && state.query === trimmed;
  const loading = trimmed !== "" && !settled;
  const failed = trimmed !== "" && settled && state.kind === "error";
  const shortcut = apple ? "⌘K" : "Ctrl K";

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => changeOpen(true)}
        aria-label="銘柄を検索"
        aria-keyshortcuts={apple ? "Meta+K" : "Control+K"}
        className="h-8 w-8 justify-start gap-2 px-0 text-muted-foreground max-xl:justify-center xl:w-52 xl:px-2.5"
        data-testid="stock-search-open"
      >
        <Search aria-hidden="true" />
        <span className="hidden xl:inline">銘柄を検索</span>
        <kbd aria-hidden="true" className="ml-auto hidden rounded border bg-muted px-1.5 font-mono text-[0.65rem] leading-4 xl:inline">
          {shortcut}
        </kbd>
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={changeOpen}
        title="銘柄を検索"
        description="銘柄コードまたは社名を入力して、銘柄詳細を開きます"
        className="sm:max-w-xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!navigated.current && returnFocus.current?.isConnected) returnFocus.current.focus();
        }}
      >
        <Command shouldFilter={false} label="銘柄を検索" data-testid="stock-search">
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="銘柄コード・社名（例: 7203、トヨタ）"
            aria-label="銘柄コードまたは社名"
            maxLength={50}
            data-testid="stock-search-input"
          />
          <CommandList className="max-h-[min(24rem,60dvh)]">
            {trimmed === "" ? (
              <CommandGroup heading="移動">
                {NAV_ITEMS.map((item) => (
                  <CommandItem key={item.href} value={`nav:${item.href}`} onSelect={() => go(item.href)}>
                    <CornerDownLeft aria-hidden="true" className="text-muted-foreground" />
                    {item.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : failed ? (
              <p role="alert" className="flex items-center justify-center gap-2 py-6 text-sm text-destructive-strong" data-testid="stock-search-error">
                <CircleAlert aria-hidden="true" className="size-4" />
                検索できませんでした。時間をおいてもう一度お試しください
              </p>
            ) : hits.length === 0 ? (
              <p className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground" data-testid="stock-search-status">
                {loading ? (
                  <>
                    <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                    検索しています…
                  </>
                ) : (
                  "一致する銘柄がありません"
                )}
              </p>
            ) : (
              <CommandGroup heading={loading ? "銘柄（検索しています…）" : `銘柄（${hits.length}件${hits.length >= 20 ? "。入力を続けると絞り込めます" : ""}）`}>
                {hits.map((hit) => (
                  <CommandItem
                    key={hit.code}
                    value={hit.code}
                    onSelect={() => go(`/stocks/${hit.code}`)}
                    data-testid="stock-search-item"
                    data-code={hit.code}
                  >
                    <span className="tabular w-12 shrink-0 font-mono text-xs text-muted-foreground">{hit.code}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{hit.companyName}</span>
                    {hit.delisted ? (
                      <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[0.65rem] text-muted-foreground">上場廃止</span>
                    ) : (
                      <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                        {[hit.marketName, hit.sectorName].filter(Boolean).join("・")}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
          <div className="flex items-center gap-3 border-t px-3 py-2 text-[0.7rem] text-muted-foreground" aria-hidden="true">
            <span>
              <kbd className="font-mono">↑↓</kbd> 選択
            </span>
            <span>
              <kbd className="font-mono">Enter</kbd> 開く
            </span>
            <span>
              <kbd className="font-mono">Esc</kbd> 閉じる
            </span>
          </div>
        </Command>
      </CommandDialog>
    </>
  );
}
