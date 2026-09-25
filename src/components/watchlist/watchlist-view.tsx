"use client";

import { ArrowRight, Ban, CircleAlert, CircleCheck, CircleMinus, CircleSlash, Filter, Pencil, Plus, Star } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { AutoJudgmentLabel } from "@/components/ownership/ownership-bar";
import { OwnerJudgmentCell } from "@/components/screening/owner-cells";
import { cagrCell, marginCell, yearsCell } from "@/components/screening/results-table";
import { Button } from "@/components/ui/button";
import type { ChangeReason } from "@/lib/screening/changes";
import { changeReasonText } from "@/lib/screening/changes";
import type { OwnerMode } from "@/lib/screening/params";
import { jstDateOf } from "@/lib/stocks/annual-report";
import { describeInclusion } from "@/lib/stocks/detail";
import { watchlistInclusionText, type WatchlistEntry, type WatchlistInclusionKind } from "@/lib/watchlist/entries";
import { normalizeWatchlistMemo, validateWatchlistMemo, WATCHLIST_MEMO_MAX_LENGTH, WATCHLIST_MESSAGES, watchlistMemoLength } from "@/lib/watchlist/memo";
import { cn } from "@/lib/utils";

import { WatchlistToggle } from "./watchlist-toggle";

/** 前回の取り込みからの変化（コード → 新たに該当・外れた と理由）。比較できない・失敗なら null */
export type WatchlistChanges = Record<string, { change: "new" | "removed"; reasons: ChangeReason[] }> | null;

/**
 * ウォッチリストの表（Sprint 14。AC13.2）。値・判定は DB（watchlist_entries。判定は screening_evaluate）の値で、ここは表示とメモの編集だけ。
 * メモの保存は API（ユーザーのセッション・RLS）。保存・取り消しの後は、その行の「編集」ボタンにフォーカスを戻す。
 */
export function WatchlistView({
  entries,
  referenceDate,
  ownerMode,
  ownerThreshold,
  changes,
}: {
  entries: WatchlistEntry[];
  referenceDate: string | null;
  ownerMode: OwnerMode;
  ownerThreshold: string;
  changes: WatchlistChanges;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // 保存した直後のメモ（サーバーの取り直しを待たずに表示する）。サーバーの値が届いたら消す
  const [saved, setSaved] = useState<Record<string, string | null>>({});
  const [seenEntries, setSeenEntries] = useState(entries);
  if (entries !== seenEntries) {
    setSeenEntries(entries);
    setSaved({});
  }
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  // 編集の終了の後の描画で、その行の「編集」ボタンにフォーカスを戻す
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    const code = pendingFocus.current;
    if (code === null) return;
    const button = editButtons.current.get(code);
    if (!button) return;
    pendingFocus.current = null;
    button.focus();
  });

  const finishEditing = (code: string) => {
    pendingFocus.current = code;
    setEditing(null);
  };

  return (
    <div className="space-y-2" data-layout="wide">
      <p role="status" aria-live="polite" className="min-h-4 text-xs text-signal-strong" data-testid="watchlist-status">
        {status}
      </p>
      <div className="relative overflow-x-auto rounded-lg border bg-card" data-testid="watchlist-scroll">
        <table className="w-full min-w-[72rem] table-fixed text-sm" data-testid="watchlist-table">
          <thead className="border-b bg-surface text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="sticky left-0 z-20 w-[6.5rem] bg-surface px-2 py-1.5 text-left font-medium">
                コード
              </th>
              <th scope="col" className="w-[9rem] px-2 py-1.5 text-left font-medium">
                社名
              </th>
              <th scope="col" className="w-[5.5rem] px-2 py-1.5 text-left font-medium">
                市場区分
              </th>
              <th scope="col" className="w-[5.75rem] px-2 py-1.5 text-right font-medium">
                売上CAGR（%）
              </th>
              <th scope="col" className="w-[5.5rem] px-2 py-1.5 text-right font-medium">
                営業利益率（%）
              </th>
              <th scope="col" className="w-[6rem] px-2 py-1.5 text-right font-medium">
                推定上場年数
              </th>
              <th scope="col" className="w-[6.75rem] px-2 py-1.5 text-left font-medium">
                <span className="flex flex-col items-start gap-0.5">
                  <span>条件④</span>
                  <AutoJudgmentLabel />
                </span>
              </th>
              <th scope="col" className="w-[8.5rem] px-2 py-1.5 text-left font-medium">
                既定の条件
              </th>
              <th scope="col" className="px-2 py-1.5 text-left font-medium">
                メモ
              </th>
              <th scope="col" className="w-[6rem] px-2 py-1.5 text-left font-medium">
                追加日
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {entries.map((entry) => {
              const memo = entry.code in saved ? saved[entry.code]! : entry.memo;
              return (
                <tr key={entry.code} data-testid="watchlist-row" data-code={entry.code} className="align-top">
                  <td className="tabular sticky left-0 z-[1] bg-card px-2 py-1.5 font-mono">
                    <span className="flex items-center gap-1">
                      <WatchlistToggle
                        code={entry.code}
                        companyName={entry.row.company_name}
                        state={{ addedAt: entry.created_at, hasMemo: memo !== null }}
                        onStatus={setStatus}
                      />
                      <Link
                        href={`/stocks/${entry.code}`}
                        className="rounded-sm underline-offset-2 hover:text-signal-strong hover:underline"
                        data-testid="watchlist-link"
                      >
                        {entry.code}
                      </Link>
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    <Link href={`/stocks/${entry.code}`} tabIndex={-1} className="line-clamp-2 leading-snug font-medium break-all hover:underline">
                      {entry.row.company_name}
                    </Link>
                  </td>
                  <td className="px-2 py-1.5 text-xs" data-testid="watchlist-market">
                    <span className="block">{entry.row.market_name ?? "—"}</span>
                    {entry.delisted_on && (
                      <span
                        className="mt-0.5 inline-flex items-center gap-1 rounded-sm border border-destructive/30 bg-destructive-muted px-1 py-px text-[0.7rem] font-medium text-destructive-strong"
                        data-testid="delisted-badge"
                      >
                        <Ban aria-hidden="true" className="size-3" />
                        上場廃止
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right" data-testid="watchlist-cagr">
                    {cagrCell(entry.row)}
                  </td>
                  <td className="px-2 py-1.5 text-right" data-testid="watchlist-margin">
                    {marginCell(entry.row)}
                  </td>
                  <td className="px-2 py-1.5 text-right" data-testid="watchlist-years">
                    {yearsCell(entry.row, referenceDate)}
                  </td>
                  <td
                    className="px-2 py-1.5"
                    data-testid="watchlist-owner"
                    data-result={entry.row.ownership.result}
                    data-auto-result={entry.row.ownership.auto_result}
                    data-override={entry.row.ownership.override ? "true" : undefined}
                  >
                    <OwnerJudgmentCell ownership={entry.row.ownership} mode={ownerMode} threshold={ownerThreshold} />
                  </td>
                  <td className="px-2 py-1.5">
                    <InclusionCell entry={entry} change={changes?.[entry.code] ?? null} />
                  </td>
                  <td className="px-2 py-1.5">
                    <MemoCell
                      code={entry.code}
                      memo={memo}
                      editing={editing === entry.code}
                      buttonRef={(element) => {
                        if (element) editButtons.current.set(entry.code, element);
                        else editButtons.current.delete(entry.code);
                      }}
                      onEdit={() => setEditing(entry.code)}
                      onCancel={() => finishEditing(entry.code)}
                      onSaved={(value) => {
                        setSaved((prev) => ({ ...prev, [entry.code]: value }));
                        setStatus("メモを保存しました");
                        finishEditing(entry.code);
                        router.refresh();
                      }}
                    />
                  </td>
                  <td className="tabular px-2 py-1.5 font-mono text-xs" data-testid="watchlist-added-on">
                    {jstDateOf(entry.created_at)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InclusionIcon({ kind }: { kind: WatchlistInclusionKind }) {
  const className = "mt-0.5 size-3.5 shrink-0";
  if (kind === "included") return <CircleCheck aria-hidden="true" className={className} />;
  if (kind === "filters") return <Filter aria-hidden="true" className={className} />;
  if (kind === "unmet") return <CircleMinus aria-hidden="true" className={className} />;
  if (kind === "delisted") return <Ban aria-hidden="true" className={className} />;
  return <CircleSlash aria-hidden="true" className={className} />;
}

function InclusionCell({ entry, change }: { entry: WatchlistEntry; change: { change: "new" | "removed"; reasons: ChangeReason[] } | null }) {
  const { kind, text } = watchlistInclusionText(entry);
  const detail = describeInclusion(entry).text;
  const tooltipId = useId();
  return (
    <div className="space-y-1">
      <span className="group/inc relative inline-flex">
        <span
          tabIndex={0}
          aria-describedby={tooltipId}
          className={cn(
            "inline-flex items-start gap-1 rounded-sm text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            kind === "included" ? "font-medium text-signal-strong" : "text-foreground",
          )}
          data-testid="watchlist-inclusion"
          data-kind={kind}
        >
          <InclusionIcon kind={kind} />
          {text}
        </span>
        <span
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none absolute top-full left-0 z-30 mt-1 hidden w-64 rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md group-focus-within/inc:block group-hover/inc:block"
        >
          {detail}
        </span>
      </span>
      {change && (
        <span
          className={cn(
            "block w-fit rounded-sm border px-1 py-px text-[0.65rem] leading-tight font-semibold",
            change.change === "new" ? "border-signal/40 bg-signal-muted text-signal-strong" : "border-border bg-muted text-muted-foreground",
          )}
          data-testid="watchlist-change-badge"
          data-change={change.change}
          aria-label={`${change.change === "new" ? "NEW（前回の取り込みから新たに該当）" : "外れた（前回の取り込みから該当しなくなった）"}: ${change.reasons.map(changeReasonText).join("、")}`}
        >
          {change.change === "new" ? "NEW" : "外れた"}
        </span>
      )}
    </div>
  );
}

function MemoCell({
  code,
  memo,
  editing,
  buttonRef,
  onEdit,
  onCancel,
  onSaved,
}: {
  code: string;
  memo: string | null;
  editing: boolean;
  buttonRef: (element: HTMLButtonElement | null) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSaved: (memo: string | null) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(memo ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [wasEditing, setWasEditing] = useState(editing);
  if (editing !== wasEditing) {
    setWasEditing(editing);
    if (editing) {
      setDraft(memo ?? "");
      setError(null);
    }
  }

  const save = async () => {
    if (validateWatchlistMemo(draft)) {
      setError(WATCHLIST_MESSAGES.memo_too_long);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/watchlist/${encodeURIComponent(code)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memo: normalizeWatchlistMemo(draft) }),
      });
      const body = (await response.json().catch(() => ({}))) as { data?: { memo?: string | null }; error?: string };
      if (!response.ok) {
        setError(body.error === "invalid_memo" ? WATCHLIST_MESSAGES.memo_too_long : WATCHLIST_MESSAGES.memo_save_failed);
        return;
      }
      onSaved(body.data?.memo ?? null);
    } catch {
      setError(WATCHLIST_MESSAGES.memo_save_failed);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <form
        className="space-y-1.5"
        data-testid="watchlist-memo-edit"
        onSubmit={(event) => {
          event.preventDefault();
          if (!saving) void save();
        }}
      >
        <label htmlFor={`${id}-memo`} className="sr-only">
          メモ（{code}）
        </label>
        <textarea
          id={`${id}-memo`}
          value={draft}
          autoFocus
          rows={3}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="block w-full min-w-40 resize-y rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              if (!saving) void save();
            } else if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <Button type="submit" size="xs" disabled={saving}>
            保存
          </Button>
          <Button type="button" size="xs" variant="outline" onClick={onCancel}>
            キャンセル
          </Button>
          <span className="tabular ml-auto font-mono text-xs text-muted-foreground" data-testid="watchlist-memo-count">
            {watchlistMemoLength(draft).toLocaleString("ja-JP")} / {WATCHLIST_MEMO_MAX_LENGTH.toLocaleString("ja-JP")}
          </span>
        </div>
        {error && (
          <p id={`${id}-error`} role="alert" className="flex items-start gap-1 text-xs text-destructive-strong" data-testid="watchlist-memo-error">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            {error}
          </p>
        )}
      </form>
    );
  }

  return (
    <div className="space-y-1">
      {memo !== null && (
        <p className="text-sm break-words whitespace-pre-line" data-testid="watchlist-memo">
          {memo}
        </p>
      )}
      <Button ref={buttonRef} type="button" size="xs" variant="ghost" className="h-auto px-1 py-0.5 text-xs text-muted-foreground" onClick={onEdit} data-testid="watchlist-memo-button">
        {memo === null ? <Plus aria-hidden="true" /> : <Pencil aria-hidden="true" />}
        {memo === null ? "メモを追加" : "編集"}
      </Button>
    </div>
  );
}

/** 空状態（Sprint 14） */
export function WatchlistEmpty() {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed bg-card px-6 py-8" data-testid="watchlist-empty">
      <span className="flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Star aria-hidden="true" className="size-4.5" />
      </span>
      <p className="text-sm">ウォッチリストはまだ空です。スクリーニングの結果や銘柄詳細の☆から追加できます</p>
      <Button asChild variant="outline" size="sm">
        <Link href="/screening">
          スクリーニングを開く
          <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
    </div>
  );
}
