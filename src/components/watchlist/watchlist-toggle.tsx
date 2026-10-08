"use client";

import { Loader2, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Hint } from "@/components/shell/hint";
import { notifyError, notifySuccess } from "@/components/shell/notify";
import { Button } from "@/components/ui/button";
import { jstDateOf } from "@/lib/stocks/annual-report";
import { WATCHLIST_MESSAGES } from "@/lib/watchlist/memo";
import { cn } from "@/lib/utils";

/**
 * ウォッチリストの追加・削除の星（Sprint 14。AC13.1）。スクリーニングの行（icon）と銘柄詳細の見出し（button）で使う。
 * - API（ユーザーのセッション・RLS）が成功してからアイコンを切り替える。待つ間は無効（aria-busy）。結果は通知（notify）で知らせ、失敗は元の状態のまま。追加・メモの無い銘柄を外したときは通知に「元に戻す」
 * - メモのある銘柄を外すときは確認のダイアログ（メモも削除される）。メモが無ければ確認なし
 * - 押しても行の遷移（詳細を開く）はしない（イベントを止める）
 * - 成功したら router.refresh()（ほかの画面の表示が、戻る・ヘッダーの遷移で古いまま出ないようにする）
 */
export type WatchlistState = { addedAt: string; hasMemo: boolean } | null;

type SendResult = { kind: "added"; state: NonNullable<WatchlistState> } | { kind: "removed" } | { kind: "failed"; message: string };

async function sendWatchlist(code: string, method: "PUT" | "DELETE"): Promise<SendResult> {
  try {
    const response = await fetch(`/api/watchlist/${encodeURIComponent(code)}`, { method });
    const body = (await response.json().catch(() => ({}))) as { error?: string; data?: { addedAt?: string; memo?: string | null } };
    if (method === "PUT" && response.ok && body.data?.addedAt) {
      return { kind: "added", state: { addedAt: body.data.addedAt, hasMemo: Boolean(body.data.memo) } };
    }
    if (method === "DELETE" && (response.ok || body.error === "not_found")) return { kind: "removed" };
    return { kind: "failed", message: body.error === "watchlist_limit" ? WATCHLIST_MESSAGES.limit : WATCHLIST_MESSAGES.update_failed };
  } catch {
    return { kind: "failed", message: WATCHLIST_MESSAGES.update_failed };
  }
}

/**
 * 通知の「元に戻す」。星の部品が消えた後（ウォッチリストの行を外した後など）にも押せるので、部品の状態を使わない。
 * 星の表示は router.refresh() で届くサーバーの状態に合わせる。
 */
async function undo(code: string, companyName: string, method: "PUT" | "DELETE", router: ReturnType<typeof useRouter>) {
  const result = await sendWatchlist(code, method);
  if (result.kind === "failed") {
    notifyError("watchlist-status", result.message);
    return;
  }
  notifySuccess(
    "watchlist-status",
    result.kind === "added" ? `『${companyName}』をウォッチリストに戻しました` : `『${companyName}』の追加を取り消しました`,
  );
  router.refresh();
}

export function WatchlistToggle({
  code,
  companyName,
  state,
  variant = "icon",
  disabled = false,
}: {
  code: string;
  companyName: string;
  state: WatchlistState;
  variant?: "icon" | "button";
  /** 読み出しに失敗したとき（登録済みかどうかが分からない） */
  disabled?: boolean;
}) {
  const router = useRouter();
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
  // 文字の見えるボタン（詳細）は、アクセシブルな名前を見える文字で始める（WCAG 2.5.3。Sprint 14 評価の m4）
  const label = `${on ? (variant === "button" ? "ウォッチリスト登録済み（外す）" : "ウォッチリストから外す") : "ウォッチリストに追加"}: ${code} ${companyName}`;
  const addedDate = current ? jstDateOf(current.addedAt) : null;
  const hint = disabled ? WATCHLIST_MESSAGES.load_error : on ? `ウォッチリストに登録済み（${addedDate} に追加）` : "ウォッチリストに追加";

  const request = async (method: "PUT" | "DELETE") => {
    setBusy(true);
    try {
      const result = await sendWatchlist(code, method);
      if (result.kind === "added") {
        setCurrent(result.state);
        // 元に戻す（外す）。メモはまだ無いので確認は要らない
        notifySuccess("watchlist-status", `『${companyName}』をウォッチリストに追加しました`, {
          action: { label: "元に戻す", onClick: () => void undo(code, companyName, "DELETE", router) },
        });
        router.refresh();
      } else if (result.kind === "removed") {
        // メモのあった銘柄はメモが消えて戻せないので、「元に戻す」を出さない（確認のダイアログで取り消せないと伝えている）
        const hadMemo = current?.hasMemo ?? false;
        setCurrent(null);
        notifySuccess(
          "watchlist-status",
          `『${companyName}』をウォッチリストから外しました`,
          hadMemo ? {} : { action: { label: "元に戻す", onClick: () => void undo(code, companyName, "PUT", router) } },
        );
        router.refresh();
      } else {
        notifyError("watchlist-status", result.message);
      }
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
      className={cn("relative inline-flex", variant === "button" && "flex-col items-start gap-1")}
      onClick={(event) => event.stopPropagation()}
    >
      {/* 補足（追加日・読み出しの失敗）。無効のボタンにはポインターのイベントが届かないので、外側の span で受ける */}
      <Hint text={hint} align="start">
        <span className="inline-flex">
          {variant === "icon" ? (
            <button
              ref={buttonRef}
              type="button"
              aria-label={label}
              aria-pressed={on}
              aria-busy={busy || undefined}
              disabled={disabled}
              onClick={onClick}
              data-testid="watchlist-toggle"
              data-state={on ? "on" : "off"}
              className="inline-flex size-5 items-center justify-center rounded-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
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
              disabled={disabled}
              onClick={onClick}
              data-testid="watchlist-toggle"
              data-state={on ? "on" : "off"}
            >
              {icon}
              <span aria-hidden="true">{on ? "ウォッチリスト登録済み" : "ウォッチリストに追加"}</span>
            </Button>
          )}
        </span>
      </Hint>
      {variant === "button" && on && addedDate && (
        <span className="text-xs text-muted-foreground" data-testid="watchlist-added-note">
          <span className="tabular font-mono">{addedDate}</span> にウォッチリストに追加
        </span>
      )}

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
