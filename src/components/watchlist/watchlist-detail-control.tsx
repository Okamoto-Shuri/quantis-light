"use client";

import { CircleAlert } from "lucide-react";
import { useState } from "react";

import { WATCHLIST_MESSAGES } from "@/lib/watchlist/memo";

import { WatchlistToggle, type WatchlistState } from "./watchlist-toggle";

/** 銘柄詳細の見出しのウォッチリストの操作（Sprint 14）。読み出しに失敗したら無効にして注記する（未登録として表示しない） */
export function WatchlistDetailControl({
  code,
  companyName,
  state,
  loadError,
}: {
  code: string;
  companyName: string;
  state: WatchlistState;
  loadError: boolean;
}) {
  const [status, setStatus] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
      <WatchlistToggle code={code} companyName={companyName} state={state} variant="button" disabled={loadError} onStatus={setStatus} />
      {loadError && (
        <span className="inline-flex items-center gap-1 self-center text-xs text-caution-strong" data-testid="watchlist-load-error">
          <CircleAlert aria-hidden="true" className="size-3.5" />
          {WATCHLIST_MESSAGES.load_error}
        </span>
      )}
      <span role="status" aria-live="polite" className="self-center text-xs text-signal-strong" data-testid="watchlist-status">
        {status}
      </span>
    </div>
  );
}
