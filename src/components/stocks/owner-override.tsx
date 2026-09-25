"use client";

import { PencilLine, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { AutoJudgmentLabel, ManualOverrideLabel } from "@/components/ownership/ownership-bar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  formatJstDateTime,
  formatTruncPct,
  OVERRIDE_PRESIDENT_MODE_NOTE,
  OWNER_RESULT_LABELS,
  OWNER_VERDICTS,
  type AutoSnapshot,
  type OwnerOverride,
  type OwnerResult,
  type OwnerVerdict,
  type UndeterminableReason,
} from "@/lib/ownership/display";
import { MEMO_ERROR_MESSAGES, MEMO_MAX_LENGTH, memoLength, trimMemo, validateMemo } from "@/lib/ownership/memo";
import type { OwnerMode } from "@/lib/screening/params";
import { cn } from "@/lib/utils";

/**
 * 条件④の手動補正（Sprint 11。F10・AC10.1〜AC10.5）。銘柄詳細の「条件④ 判定根拠」の先頭に置く。
 * 書き込みは API（PUT・DELETE /api/stocks/[code]/ownership-override、POST …/acknowledge）で、成功したら router.refresh() で
 * 画面を取り直す（クライアントのルーターのキャッシュも捨てるので、スクリーニングに戻っても補正後の結果が出る）。
 * 判定・記録・「自動判定が更新されたか」は DB が決め、ここでは表示と入力の検証だけを行う（メモの規則は lib/ownership/memo.ts）。
 */

const numberFormat = new Intl.NumberFormat("ja-JP");

const REASON_SHORT: Record<UndeterminableReason, string> = {
  no_annual_report: "有報が未取得",
  annual_report_pending: "有報が取り込み待ち",
  shareholders_not_extracted: "大株主を抽出できなかった",
  officers_not_extracted: "役員を抽出できなかった",
  president_not_found: "社長が見つからない",
};

function resultTone(result: OwnerResult) {
  if (result === "president_top" || result === "owner_company") return "text-signal-strong";
  if (result === "undeterminable") return "text-caution-strong";
  return "text-foreground";
}

function snapshotResultText(snapshot: AutoSnapshot): string {
  const label = OWNER_RESULT_LABELS[snapshot.result];
  return snapshot.result === "undeterminable" && snapshot.undeterminable_reason
    ? `${label}（${REASON_SHORT[snapshot.undeterminable_reason]}）`
    : label;
}

type SaveError = { kind: "validation"; message: string } | { kind: "request"; message: string };

function requestErrorMessage(status: number | null, action: string): string {
  if (status === 401) return `${action}できませんでした。ログインの有効期限が切れています。再読み込みしてログインし直してください。`;
  if (status === 403) return `${action}できませんでした。この操作を行う権限がありません。`;
  return `${action}できませんでした。時間をおいてもう一度お試しください。`;
}

async function send(url: string, method: "PUT" | "DELETE" | "POST", body?: unknown): Promise<{ ok: boolean; status: number | null }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: null };
  }
}

export function OwnerOverridePanel({
  code,
  override,
  autoResult,
  mode,
}: {
  code: string;
  override: OwnerOverride | null;
  autoResult: OwnerResult;
  mode: OwnerMode;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const url = `/api/stocks/${encodeURIComponent(code)}/ownership-override`;
  const state = editing ? "editing" : override ? "saved" : "none";

  // 保存・取り消しの後は元のボタンが消えるので、次の状態の操作にフォーカスを移す（Sprint 11 評価の m3）
  const containerRef = useRef<HTMLDivElement>(null);
  const focusAfter = useRef<{ state: "saved" | "none"; testId: string } | null>(null);
  useEffect(() => {
    const next = focusAfter.current;
    if (!next || isPending || next.state !== state) return;
    const target = containerRef.current?.querySelector<HTMLElement>(`[data-testid="${next.testId}"]`);
    if (target) {
      target.focus();
      focusAfter.current = null;
    }
  });

  /** 書き込みの後に画面を取り直す（状態の切り替えと取り直しを同じ遷移で反映し、古い表示が一瞬出ないようにする） */
  const refreshAfter = (next: () => void) => {
    startTransition(() => {
      next();
      router.refresh();
    });
  };

  const remove = async () => {
    setBusy(true);
    setActionError(null);
    const res = await send(url, "DELETE");
    setBusy(false);
    if (!res.ok) {
      setActionError(requestErrorMessage(res.status, "補正を取り消"));
      return;
    }
    focusAfter.current = { state: "none", testId: "owner-override-open" };
    refreshAfter(() => setEditing(false));
  };

  const acknowledge = async () => {
    setBusy(true);
    setActionError(null);
    const res = await send(`${url}/acknowledge`, "POST");
    setBusy(false);
    if (!res.ok) {
      setActionError(requestErrorMessage(res.status, "確認済みに"));
      return;
    }
    refreshAfter(() => undefined);
  };

  return (
    <div
      className={cn("space-y-2 rounded-md border px-3 py-2.5", override && !editing ? "border-manual/40 bg-manual-muted/40" : "border-dashed")}
      ref={containerRef}
      data-testid="owner-override"
      data-state={state}
      aria-busy={isPending || busy}
    >
      {state === "none" && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
            自動判定が誤っていると確認できた場合に、この銘柄の条件④の判定を上書きできます。補正はあなたのアカウントだけに保存され、スクリーニングにも使われます。
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)} data-testid="owner-override-open">
            <PencilLine aria-hidden="true" />
            判定を手動で補正する
          </Button>
        </div>
      )}

      {state === "editing" && (
        <OverrideForm
          url={url}
          initial={override ? { verdict: override.verdict, memo: override.memo } : null}
          pending={isPending}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            focusAfter.current = { state: "saved", testId: "owner-override-edit" };
            refreshAfter(() => setEditing(false));
          }}
        />
      )}

      {state === "saved" && override && (
        <SavedOverride
          override={override}
          autoResult={autoResult}
          mode={mode}
          busy={busy || isPending}
          onEdit={() => {
            setActionError(null);
            setEditing(true);
          }}
          onDelete={remove}
          onAcknowledge={acknowledge}
        />
      )}

      {actionError && (
        <p role="alert" className="text-sm text-destructive-strong" data-testid="owner-override-action-error">
          {actionError}
        </p>
      )}
    </div>
  );
}

function OverrideForm({
  url,
  initial,
  pending,
  onCancel,
  onSaved,
}: {
  url: string;
  initial: { verdict: OwnerVerdict; memo: string } | null;
  pending: boolean;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const id = useId();
  const [verdict, setVerdict] = useState<OwnerVerdict | null>(initial?.verdict ?? null);
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [error, setError] = useState<SaveError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);
  const length = memoLength(trimMemo(memo));

  useEffect(() => {
    // 開いたら最初の入力（選択肢）にフォーカスを移す（キーボードだけで操作できるように）
    const target = groupRef.current?.querySelector<HTMLButtonElement>("button[data-state=checked]") ?? groupRef.current?.querySelector("button");
    target?.focus();
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting || pending) return;
    if (verdict === null) {
      setError({ kind: "validation", message: "補正後の判定を選んでください" });
      return;
    }
    const memoError = validateMemo(memo);
    if (memoError) {
      setError({ kind: "validation", message: MEMO_ERROR_MESSAGES[memoError] });
      return;
    }
    setError(null);
    setSubmitting(true);
    const res = await send(url, "PUT", { verdict, memo: trimMemo(memo) });
    setSubmitting(false);
    if (!res.ok) {
      setError({ kind: "request", message: requestErrorMessage(res.status, "保存") });
      return;
    }
    onSaved();
  };

  const disabled = submitting || pending;
  return (
    <form className="space-y-3" onSubmit={submit} noValidate data-testid="owner-override-form">
      <fieldset className="space-y-1.5">
        <legend className="mb-1 flex items-center gap-1.5 text-sm font-medium">
          <ManualOverrideLabel />
          補正後の判定
        </legend>
        <RadioGroup
          ref={groupRef}
          value={verdict ?? ""}
          onValueChange={(value) => {
            setVerdict(value as OwnerVerdict);
            if (error?.kind === "validation") setError(null);
          }}
          aria-label="補正後の判定"
          className="gap-1.5"
          disabled={disabled}
        >
          {OWNER_VERDICTS.map((v) => (
            <div key={v} className="flex items-center gap-2">
              <RadioGroupItem value={v} id={`${id}-${v}`} data-testid={`owner-override-verdict-${v}`} />
              <label htmlFor={`${id}-${v}`} className="text-sm">
                {OWNER_RESULT_LABELS[v]}
              </label>
            </div>
          ))}
        </RadioGroup>
      </fieldset>

      <div className="space-y-1">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={`${id}-memo`} className="text-sm font-medium">
            理由のメモ（必須）
          </label>
          <span
            className={cn("tabular font-mono text-xs", length > MEMO_MAX_LENGTH ? "text-destructive-strong" : "text-muted-foreground")}
            data-testid="owner-override-count"
            aria-live="polite"
          >
            {numberFormat.format(length)} / {numberFormat.format(MEMO_MAX_LENGTH)}
          </span>
        </div>
        {/* maxLength は付けない（UTF-16 の単位で数えるため「𠮷」1,000 個が入らない）。上限はコードポイントで検証する */}
        <textarea
          id={`${id}-memo`}
          value={memo}
          onChange={(event) => {
            setMemo(event.target.value);
            if (error?.kind === "validation") setError(null);
          }}
          rows={4}
          disabled={disabled}
          aria-invalid={error?.kind === "validation" && verdict !== null ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          placeholder="例: 有報の「関係会社の状況」で、〇〇興産は社長の資産管理会社と確認"
          className="w-full rounded-md border border-input bg-background px-2.5 py-2 text-sm leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60 aria-invalid:border-destructive"
          data-testid="owner-override-memo"
        />
      </div>

      {error && (
        <p
          id={`${id}-error`}
          role={error.kind === "request" ? "alert" : undefined}
          className="text-sm text-destructive-strong"
          data-testid={error.kind === "request" ? "owner-override-save-error" : "owner-override-error"}
        >
          {error.message}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={disabled} data-testid="owner-override-save">
          {disabled ? "保存しています…" : "保存"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={disabled} data-testid="owner-override-cancel">
          キャンセル
        </Button>
      </div>
    </form>
  );
}

function SavedOverride({
  override,
  autoResult,
  mode,
  busy,
  onEdit,
  onDelete,
  onAcknowledge,
}: {
  override: OwnerOverride;
  autoResult: OwnerResult;
  mode: OwnerMode;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onAcknowledge: () => void;
}) {
  return (
    <div className="space-y-2.5">
      {override.auto_changed && <AutoChangedNotice override={override} busy={busy} onAcknowledge={onAcknowledge} />}

      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="space-y-1">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <ManualOverrideLabel />
            <span className={cn("font-semibold", resultTone(override.verdict))} data-testid="owner-override-verdict" data-verdict={override.verdict}>
              {OWNER_RESULT_LABELS[override.verdict]}
            </span>
          </p>
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            元の
            <AutoJudgmentLabel />
            <span className={resultTone(autoResult)} data-testid="owner-override-auto-result" data-result={autoResult}>
              {OWNER_RESULT_LABELS[autoResult]}
            </span>
          </p>
          {mode === "president" && override.verdict === "owner_company" && (
            <p className="text-xs text-muted-foreground" data-testid="owner-override-mode-note">
              {OVERRIDE_PRESIDENT_MODE_NOTE}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onEdit} disabled={busy} data-testid="owner-override-edit">
            <PencilLine aria-hidden="true" />
            編集
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="outline" size="sm" disabled={busy} data-testid="owner-override-delete">
                <Trash2 aria-hidden="true" />
                補正を取り消す
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent data-testid="owner-override-delete-dialog">
              <AlertDialogTitle>補正を取り消しますか</AlertDialogTitle>
              <AlertDialogDescription>補正を取り消すと、自動判定に戻ります。メモも消えます。</AlertDialogDescription>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="owner-override-delete-cancel">キャンセル</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete} data-testid="owner-override-delete-confirm">
                  取り消す
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">理由のメモ</p>
        <p className="text-sm leading-relaxed break-words whitespace-pre-line" data-testid="owner-override-memo-text">
          {override.memo}
        </p>
        <p className="text-xs text-muted-foreground" data-testid="owner-override-dates">
          補正 <span className="tabular font-mono">{formatJstDateTime(override.created_at)}</span>
          {override.updated_at !== override.created_at && (
            <>
              {" ／ 更新 "}
              <span className="tabular font-mono">{formatJstDateTime(override.updated_at)}</span>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

const NOTICE_ROWS: { key: string; label: string; value: (s: AutoSnapshot) => string; same: (a: AutoSnapshot, b: AutoSnapshot) => boolean }[] = [
  {
    key: "result",
    label: "自動判定",
    value: snapshotResultText,
    same: (a, b) => a.result === b.result && a.undeterminable_reason === b.undeterminable_reason && a.status === b.status,
  },
  {
    key: "owner_total",
    label: "オーナー系合計",
    value: (s) => (s.owner_total_pct === null ? "—" : formatTruncPct(s.owner_total_pct)),
    same: (a, b) => a.owner_total_pct === b.owner_total_pct || (a.owner_total_pct !== null && b.owner_total_pct !== null && Number(a.owner_total_pct) === Number(b.owner_total_pct)),
  },
  {
    key: "president_top",
    label: "社長が筆頭株主",
    value: (s) => (s.president_is_top_holder === null ? "—" : s.president_is_top_holder ? "はい" : "いいえ"),
    same: (a, b) => a.president_is_top_holder === b.president_is_top_holder,
  },
  {
    key: "shareholders_doc",
    label: "大株主の書類",
    value: (s) => s.shareholders_doc_id ?? "—",
    same: (a, b) => a.shareholders_doc_id === b.shareholders_doc_id,
  },
  {
    key: "officers_doc",
    label: "役員の書類",
    value: (s) => s.officers_doc_id ?? "—",
    same: (a, b) => a.officers_doc_id === b.officers_doc_id,
  },
];

/** 「補正後に自動判定が更新されました」（AC10.5）。補正時と現在の自動判定を並べ、変わった項目を強調する */
function AutoChangedNotice({ override, busy, onAcknowledge }: { override: OwnerOverride; busy: boolean; onAcknowledge: () => void }) {
  const before = override.auto_at_override;
  const now = override.auto_current;
  return (
    <div role="status" className="space-y-2 rounded-md border border-caution/50 bg-caution-muted px-3 py-2.5 text-caution-strong" data-testid="owner-override-auto-changed">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <RefreshCw aria-hidden="true" className="size-4 shrink-0" />
        補正後に自動判定が更新されました
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-foreground" data-testid="owner-override-auto-changed-table">
          <thead className="text-caution-strong">
            <tr>
              <th scope="col" className="py-1 pr-3 text-left font-medium" />
              <th scope="col" className="py-1 pr-3 text-left font-medium">
                補正時
              </th>
              <th scope="col" className="py-1 text-left font-medium">
                現在
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-caution/20">
            {NOTICE_ROWS.map((row) => {
              const changed = !row.same(before, now);
              return (
                <tr key={row.key} data-testid="owner-override-auto-changed-row" data-row={row.key} data-changed={changed}>
                  <th scope="row" className="py-1 pr-3 text-left font-normal whitespace-nowrap text-caution-strong">
                    {row.label}
                  </th>
                  <td className="tabular py-1 pr-3" data-testid="auto-changed-before">
                    {row.value(before)}
                  </td>
                  <td className={cn("tabular py-1", changed && "font-semibold")} data-testid="auto-changed-now">
                    {row.value(now)}
                    {changed && <span className="ml-1 rounded-sm bg-caution/20 px-1 text-[0.65rem] font-medium text-caution-strong">変更</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Button type="button" size="sm" variant="outline" onClick={onAcknowledge} disabled={busy} data-testid="owner-override-acknowledge">
          確認済みにする
        </Button>
        <span className="text-xs">補正を見直す場合は『編集』から変更できます。</span>
      </div>
    </div>
  );
}
