"use client";

import { Loader2, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { jstDateOf } from "@/lib/stocks/annual-report";
import { WATCHLIST_MESSAGES } from "@/lib/watchlist/memo";
import { cn } from "@/lib/utils";

/**
 * ウォッチリストの追加・削除の星（Sprint 14。AC13.1）。スクリーニングの行（icon）と銘柄詳細の見出し（button）で使う。
 * - API（ユーザーのセッション・RLS）が成功してからアイコンを切り替える。待つ間は無効（aria-busy）。失敗は元の状態のまま、onStatus で知らせる
 * - メモのある銘柄を外すときは確認のダイアログ（メモも削除される）。メモが無ければ確認なし
 * - 押しても行の遷移（詳細を開く）はしない（イベントを止める）
 * - 成功したら router.refresh()（ほかの画面の表示が、戻る・ヘッダーの遷移で古いまま出ないようにする）
 */
export type WatchlistState = { addedAt: string; hasMemo: boolean } | null;

export function WatchlistToggle({
  code,
  companyName,
  state,
  variant = "icon",
  disabled = false,
  onStatus,
}: {
  code: string;
  companyName: string;
  state: WatchlistState;
  variant?: "icon" | "button";
  /** 読み出しに失敗したとき（登録済みかどうかが分からない） */
  disabled?: boolean;
  onStatus: (message: string) => void;
}) {
  const router = useRouter();
  const tooltipId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [current, setCurrent] = useState<WatchlistState>(state);
  const [seen, setSeen] = useState(state);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // サーバーから新しい状態が届いたら合わせる（router.refresh・別の画面での変更）
  if (state !== seen && (state?.addedAt !== seen?.addedAt || state?.hasMemo !== seen?.hasMemo)) {
    setSeen(state);
    if (!busy) setCurrent(state);
  }

  const on = current !== null;
  const label = `${on ? "ウォッチリストから外す" : "ウォッチリストに追加"}: ${code} ${companyName}`;
  const addedDate = current ? jstDateOf(current.addedAt) : null;

  const request = async (method: "PUT" | "DELETE") => {
    setBusy(true);
    try {
      const response = await fetch(`/api/watchlist/${encodeURIComponent(code)}`, { method });
      const body = (await response.json().catch(() => ({}))) as { error?: string; data?: { addedAt?: string; memo?: string | null } };
      if (method === "PUT" && response.ok && body.data?.addedAt) {
        setCurrent({ addedAt: body.data.addedAt, hasMemo: Boolean(body.data.memo) });
        onStatus(`『${companyName}』をウォッチリストに追加しました`);
        router.refresh();
      } else if (method === "DELETE" && (response.ok || body.error === "not_found")) {
        setCurrent(null);
        onStatus(`『${companyName}』をウォッチリストから外しました`);
        router.refresh();
      } else {
        onStatus(body.error === "watchlist_limit" ? WATCHLIST_MESSAGES.limit : WATCHLIST_MESSAGES.update_failed);
      }
    } catch {
      onStatus(WATCHLIST_MESSAGES.update_failed);
    } finally {
      setBusy(false);
    }
  };

  const onClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (busy || disabled) return;
    if (on && current?.hasMemo) {
      setConfirmOpen(true);
      return;
    }
    void request(on ? "DELETE" : "PUT");
  };

  const icon = busy ? (
    <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
  ) : (
    <Star aria-hidden="true" className={cn("size-3.5", on ? "fill-caution-strong text-caution-strong" : "text-muted-foreground")} />
  );

  return (
    <span
      className={cn("group/wl relative inline-flex", variant === "button" && "flex-col items-start gap-1")}
      onClick={(event) => event.stopPropagation()}
    >
      {variant === "icon" ? (
        <button
          ref={buttonRef}
          type="button"
          aria-label={label}
          aria-pressed={on}
          aria-busy={busy || undefined}
          aria-describedby={tooltipId}
          disabled={disabled}
          onClick={onClick}
          data-testid="watchlist-toggle"
          data-state={on ? "on" : "off"}
          className="inline-flex size-5 items-center justify-center rounded-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
        >
          {icon}
        </button>
      ) : (
        <Button
          ref={buttonRef}
          type="button"
          size="sm"
          variant="outline"
          aria-label={label}
          aria-pressed={on}
          aria-busy={busy || undefined}
          aria-describedby={tooltipId}
          disabled={disabled}
          onClick={onClick}
          data-testid="watchlist-toggle"
          data-state={on ? "on" : "off"}
        >
          {icon}
          <span aria-hidden="true">{on ? "ウォッチリスト登録済み" : "ウォッチリストに追加"}</span>
        </Button>
      )}
      {variant === "button" && on && addedDate && (
        <span className="text-xs text-muted-foreground" data-testid="watchlist-added-note">
          <span className="tabular font-mono">{addedDate}</span> にウォッチリストに追加
        </span>
      )}
      <span
        id={tooltipId}
        role="tooltip"
        className="pointer-events-none absolute top-full left-0 z-30 mt-1 hidden w-max max-w-56 rounded-md border bg-popover px-2 py-1 text-xs whitespace-normal text-popover-foreground shadow-md group-hover/wl:block group-focus-within/wl:block"
      >
        {disabled ? WATCHLIST_MESSAGES.load_error : on ? `ウォッチリストに登録済み（${addedDate} に追加）` : "ウォッチリストに追加"}
      </span>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent
          data-testid="watchlist-remove-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            buttonRef.current?.focus();
          }}
        >
          <AlertDialogTitle>『{companyName}』をウォッチリストから外しますか？</AlertDialogTitle>
          <AlertDialogDescription>メモも削除されます。この操作は取り消せません。</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                await request("DELETE");
                setConfirmOpen(false);
              }}
            >
              外す
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </span>
  );
}
