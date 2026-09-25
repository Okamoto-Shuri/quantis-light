"use client";

import { CircleAlert, CircleCheck, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { formatDateTimeJst } from "@/lib/format";
import { formatRunResult } from "@/lib/ingestion/result-message";
import { RUN_TARGET_LABELS, type ApiRun, type RunView } from "@/lib/ingestion/runs";
import { cn } from "@/lib/utils";

/** 実行中は、この間隔で画面（サーバーコンポーネント）を取り直す。 */
const POLL_INTERVAL_MS = 1500;

type Notice = { tone: "success" | "warning" | "error" | "info"; text: string };

/** 手動で取り込める対象（API の target と、画面の表示）。 */
const TARGET_OPTIONS = [
  { value: "stock_master", label: "銘柄マスタ", description: "上場銘柄の一覧（コード、社名、市場区分、業種）" },
  { value: "daily_quotes", label: "株価（初出日）", description: "初出日が未確定の銘柄の、株価データの初出日" },
  { value: "financials", label: "財務（決算短信）", description: "通期の決算短信の売上高・営業利益（開示日ごと。1回で約190日分）" },
  {
    value: "edinet_reports",
    label: "有報（EDINET）",
    description: "直近の有価証券報告書の大株主・役員（書類一覧の取得と、未処理の書類の取得）",
  },
] as const;

type ManualTarget = (typeof TARGET_OPTIONS)[number]["value"];

function isManualTarget(value: string): value is ManualTarget {
  return TARGET_OPTIONS.some((option) => option.value === value);
}

/** API の応答から、開始できなかった理由の文言を作る。 */
async function describeStartFailure(response: Response): Promise<string> {
  if (response.status === 403) {
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
    if (body?.error === "cross_origin") {
      return "取り込みを開始できませんでした。別のサイトからの要求とみなされました。アプリの URL を開き直してから、もう一度押してください";
    }
  }
  if (response.status === 401 || response.status === 403) return "取り込みを開始できませんでした。ログインし直してください";
  return `取り込みを開始できませんでした（HTTP ${response.status}）`;
}

/**
 * 「今すぐ取り込み」。対象を選んで押すと POST /api/ingestion/runs で実行を開始し、終わるまで画面を自動で更新する。
 * 実行中かどうかはサーバーの状態（activeRun）で決める。別のタブや定期実行による実行中も同じように扱う。
 */
export function ManualIngestion({ activeRun, recentRuns }: { activeRun: ApiRun | null; recentRuns: RunView[] }) {
  const router = useRouter();
  const [target, setTarget] = useState<ManualTarget>("stock_master");
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
    const tone = watchedRun.status === "succeeded" ? "success" : watchedRun.status === "partial" ? "warning" : "error";
    notice = { tone, text: formatRunResult(watchedRun) };
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
        body: JSON.stringify({ target }),
      });
      if (response.status === 202) {
        const body = (await response.json()) as { data: { runId: number } };
        setWatchedRunId(body.data.runId);
      } else if (response.status === 409) {
        setRequestNotice({ tone: "info", text: "ほかの取り込みが実行中のため、新しく開始しませんでした" });
      } else {
        setRequestNotice({ tone: "error", text: await describeStartFailure(response) });
      }
    } catch {
      setRequestNotice({ tone: "error", text: "取り込みを開始できませんでした（通信エラー）" });
    } finally {
      setRequesting(false);
      router.refresh();
    }
  }

  const NoticeIcon = notice?.tone === "success" ? CircleCheck : notice?.tone === "warning" ? TriangleAlert : CircleAlert;

  return (
    <section aria-labelledby="manual-heading" className="rounded-lg border bg-card">
      <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-3">
          <div className="space-y-1">
            <h2 id="manual-heading" className="text-sm font-medium">
              手動取り込み
            </h2>
            <p className="text-sm text-muted-foreground">対象を選んで、J-Quants または EDINET から取り込みます。</p>
            {activeRun && (
              <p className="text-sm text-muted-foreground" data-testid="active-run">
                実行中: {RUN_TARGET_LABELS[activeRun.target]}（開始{" "}
                <span className="tabular font-mono text-foreground">{formatDateTimeJst(activeRun.startedAt)}</span>）
              </p>
            )}
          </div>
          {/*
            対象の選択は、ネイティブのラジオボタンにする（Tab でグループに入り、矢印キーで選択が変わる。
            radix の RadioGroup は、ラベルで包むと最初の矢印キーで選択が変わらないことがあるため）。
          */}
          <fieldset role="radiogroup" aria-labelledby="manual-target-legend" className="min-w-0" disabled={running} data-testid="manual-target">
            <legend id="manual-target-legend" className="mb-2 text-xs font-medium text-muted-foreground">
              対象
            </legend>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {TARGET_OPTIONS.map((option) => {
                const id = `manual-target-${option.value}`;
                return (
                  <label
                    key={option.value}
                    htmlFor={id}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-md border bg-background px-3 py-2.5 transition-colors hover:bg-accent has-[:checked]:border-signal has-[:checked]:bg-signal-muted has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
                      running && "cursor-not-allowed opacity-60 hover:bg-background",
                    )}
                  >
                    <input
                      type="radio"
                      id={id}
                      name="manual-target"
                      value={option.value}
                      checked={target === option.value}
                      onChange={(event) => isManualTarget(event.target.value) && setTarget(event.target.value)}
                      aria-describedby={`${id}-desc`}
                      className="mt-0.5 size-4 shrink-0 accent-primary outline-none"
                    />
                    <span className="min-w-0 space-y-0.5">
                      <span className="block text-sm font-medium">{option.label}</span>
                      <span id={`${id}-desc`} className="block text-xs leading-snug text-muted-foreground">
                        {option.description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        </div>
        <Button
          type="button"
          size="lg"
          onClick={start}
          aria-disabled={running}
          className={cn("w-full shrink-0 px-4 sm:w-auto", running && "cursor-not-allowed opacity-60 hover:bg-primary")}
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
              notice.tone === "warning" && "text-caution-strong",
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
