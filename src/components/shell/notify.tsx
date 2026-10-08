"use client";

import { toast } from "sonner";

/**
 * 操作の結果の通知（トースト。sonner）。`<Toaster />` は AppDocument に1つだけ置く。
 * - channel ごとに通知は1つ（同じ channel の新しい通知は前の通知を置き換える）。続けて操作しても通知が積み上がらない
 * - 本文に data-testid={channel} を付ける（E2E は今までどおり getByTestId("watchlist-status") などで文言を確かめる）
 * - 読み上げは Toaster の aria-live で行うので、呼び出し側に role="status" の領域を重ねて置かない
 */
export type NotifyChannel = "watchlist-status" | "preset-status" | "owner-override-status";

type NotifyOptions = {
  /** 「元に戻す」などの操作。押すと通知は閉じる */
  action?: { label: string; onClick: () => void };
};

function body(channel: NotifyChannel, message: string) {
  return <span data-testid={channel}>{message}</span>;
}

export function notifySuccess(channel: NotifyChannel, message: string, options: NotifyOptions = {}) {
  toast.success(body(channel, message), { id: channel, action: options.action, duration: options.action ? 6000 : 4000 });
}

export function notifyError(channel: NotifyChannel, message: string) {
  toast.error(body(channel, message), { id: channel, action: undefined, duration: 6000 });
}
