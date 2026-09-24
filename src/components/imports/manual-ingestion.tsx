"use client";

import { CircleAlert, CircleCheck, LoaderCircle, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { formatDateTimeJst } from "@/lib/format";
import { formatRunResult } from "@/lib/ingestion/result-message";
import { RUN_TARGET_LABELS, type ApiRun } from "@/lib/ingestion/runs";
import { cn } from "@/lib/utils";

/** 実行中は、この間隔で画面（サーバーコンポーネント）を取り直す。 */
const POLL_INTERVAL_MS = 1500;

type Notice = { tone: "success" | "error" | "info"; text: string };

/**
 * 「今すぐ取り込み」。押すと POST /api/ingestion/runs で実行を開始し、終わるまで画面を自動で更新する。
 * 実行中かどうかはサーバーの状態（activeRun）で決める。別のタブや定期実行による実行中も同じように扱う。
 */
export function ManualIngestion({ activeRun, recentRuns }: { activeRun: ApiRun | null; recentRuns: ApiRun[] }) {
  const router = useRouter();
  const [requesting, setRequesting] = useState(false);
  const [watchedRunId, setWatchedRunId] = useState<number | null>(null);
  const [requestNotice, setRequestNotice] = useState<Notice | null>(null);

  const watchedRun = watchedRunId === null ? undefined : recentRuns.find((run) => run.id === watchedRunId);
  const watchedFinished = watchedRun !== undefined && watchedRun.status !== "running";
  const running = requesting || activeRun !== null || (watchedRunId !== null && !watchedFinished);
  const shouldPoll = activeRun !== null || (watchedRunId !== null && !watchedFinished);

  useEffect(() => {
    if (!shouldPoll) return;
    const timer = window.setInterval(() => router.refresh(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [shouldPoll, router]);

  let notice: Notice | null = requestNotice;
  if (watchedFinished && watchedRun) {
    notice = { tone: watchedRun.status === "succeeded" ? "success" : "error", text: formatRunResult(watchedRun) };
  }

  async function start() {
    if (running) return;
    setRequesting(true);
    setRequestNotice(null);
    setWatchedRunId(null);
    try {
      const response = await fetch("/api/ingestion/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: "stock_master" }),
      });
      if (response.status === 202) {
        const body = (await response.json()) as { data: { runId: number } };
        setWatchedRunId(body.data.runId);
      } else if (response.status === 409) {
        setRequestNotice({ tone: "info", text: "ほかの取り込みが実行中のため、新しく開始しませんでした" });
      } else if (response.status === 401 || response.status === 403) {
        setRequestNotice({ tone: "error", text: "取り込みを開始できませんでした。ログインし直してください" });
      } else {
        setRequestNotice({ tone: "error", text: `取り込みを開始できませんでした（HTTP ${response.status}）` });
      }
    } catch {
      setRequestNotice({ tone: "error", text: "取り込みを開始できませんでした（通信エラー）" });
    } finally {
      setRequesting(false);
      router.refresh();
    }
  }

  const NoticeIcon = notice?.tone === "success" ? CircleCheck : CircleAlert;

  return (
    <section aria-labelledby="manual-heading" className="rounded-lg border bg-card">
      <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h2 id="manual-heading" className="text-sm font-medium">
            手動取り込み
          </h2>
          <p className="text-sm text-muted-foreground">J-Quants から銘柄マスタを取り込みます。</p>
          {activeRun && (
            <p className="text-sm text-muted-foreground" data-testid="active-run">
              実行中: {RUN_TARGET_LABELS[activeRun.target]}（開始{" "}
              <span className="tabular font-mono text-foreground">{formatDateTimeJst(activeRun.startedAt)}</span>）
            </p>
          )}
        </div>
        <Button
          type="button"
          size="lg"
          onClick={start}
          aria-disabled={running}
          className={cn("w-full px-4 sm:w-auto", running && "cursor-not-allowed opacity-60 hover:bg-primary")}
        >
          {running ? (
            <>
              <LoaderCircle aria-hidden="true" className="animate-spin" />
              実行中…
            </>
          ) : (
            <>
              <RefreshCw aria-hidden="true" />
              今すぐ取り込み
            </>
          )}
        </Button>
      </div>
      <div role="status" aria-live="polite" className="empty:hidden">
        {notice && (
          <p
            data-testid="ingestion-result"
            data-tone={notice.tone}
            className={cn(
              "flex items-start gap-2 border-t px-4 py-3 text-sm break-words",
              notice.tone === "success" && "text-signal-strong",
              notice.tone === "error" && "text-destructive-strong",
            )}
          >
            <NoticeIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0">{notice.text}</span>
          </p>
        )}
      </div>
    </section>
  );
}
