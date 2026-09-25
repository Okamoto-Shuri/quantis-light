"use client";

import { Bookmark, Check, ChevronDown, CircleAlert, Loader2, Pencil, Save, Settings2, Star, Trash2, TriangleAlert } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { jstDateOf } from "@/lib/stocks/annual-report";
import { DEFAULT_CONDITIONS, searchParamsToRecord, type ConditionKey, type ScreeningConditions } from "@/lib/screening/params";
import {
  invalidInputNote,
  matchingPresets,
  PRESET_LIMIT,
  PRESET_MESSAGES,
  PRESET_NAME_MAX_LENGTH,
  presetNameLength,
  presetQueryOf,
  presetSummaryParts,
  selectorCurrent,
  STANDARD_QUERY,
  validatePresetName,
  type Preset,
  type SummaryPart,
} from "@/lib/screening/presets";
import { hasScreeningParams } from "@/lib/stocks/detail";
import { cn } from "@/lib/utils";

/**
 * 条件プリセットの操作（Sprint 13。F12）。結果の列の先頭の1行: セレクター（適用）・現在の条件を保存・管理。
 * - 状態の正本は URL。「適用中」は、表示中の条件のクエリと保存したクエリの完全一致で決める（最後に選んだプリセットは持たない）
 * - 保存・上書きするのは表示中の結果の条件（resultConditions）。書き換えを待っている間は、確定してから保存する
 * - 書き込みは API（ユーザーのセッション・RLS）。成功したら router.refresh() で一覧を取り直す
 * - presets が null は一覧の読み出しの失敗（0件として扱わない。契約の第2章の8）
 */

export type PresetBarProps = {
  presets: Preset[] | null;
  /** 画面の今の条件のクエリ（入力の確定を待っている値を含む。適用中の表示に使う） */
  currentQuery: string;
  /** 表示中の結果の条件（保存・上書きの内容）とそのクエリ */
  resultConditions: ScreeningConditions;
  resultQuery: string;
  updating: boolean;
  /** 入力欄にエラーを表示中の条件 */
  invalidInputKeys: ConditionKey[];
  /** 条件を適用する（URL を書き換える） */
  onApply: (conditions: ScreeningConditions) => void;
  /** 待っている条件の書き換えをすぐに発行する */
  onFlush: () => void;
};

type ApiResult = { ok: true; status: number; body: Record<string, unknown> } | { ok: false; status: number; body: Record<string, unknown> };

async function callApi(method: "POST" | "PATCH" | "DELETE", url: string, body?: unknown): Promise<ApiResult> {
  try {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: response.ok, status: response.status, body: json };
  } catch {
    return { ok: false, status: 0, body: {} };
  }
}

/** API のエラーを利用者向けの文言にする */
function errorMessage(result: ApiResult): string {
  const code = result.body.error;
  if (code === "duplicate_name") return PRESET_MESSAGES.duplicate_name;
  if (code === "preset_limit") return PRESET_MESSAGES.preset_limit;
  if (code === "not_found") return "プリセットが見つかりません（削除された可能性があります）。再読み込みしてください";
  return PRESET_MESSAGES.save_failed;
}

function DefaultBadge() {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-0.5 rounded-sm border border-signal/30 bg-signal-muted px-1 py-px text-[0.7rem] leading-tight font-medium text-signal-strong"
      data-testid="preset-default-badge"
    >
      <Star aria-hidden="true" className="size-3" />
      既定
    </span>
  );
}

function presetProblem(preset: Preset): string | null {
  if (preset.status === "invalid") return "一部の条件が無効です";
  if (preset.status === "noncanonical") return "条件の書き方が標準の形ではありません";
  return null;
}

function ProblemMark({ preset }: { preset: Preset }) {
  const problem = presetProblem(preset);
  if (!problem) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-caution-strong" data-testid="preset-invalid-mark">
      <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
      {problem}
    </span>
  );
}

export function PresetBar({
  presets,
  currentQuery,
  resultConditions,
  resultQuery,
  updating,
  invalidInputKeys,
  onApply,
  onFlush,
}: PresetBarProps) {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [applyNotice, setApplyNotice] = useState<{ text: string; query: string } | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  // ダイアログは状態で開くので、閉じたら開いたボタンにフォーカスを戻す（Radix の自動の戻し先はトリガーだけ）
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const manageButtonRef = useRef<HTMLButtonElement>(null);
  const focusBack = (event: Event, button: HTMLButtonElement | null) => {
    if (!button || button.disabled) return;
    event.preventDefault();
    button.focus();
  };
  const focusSaveButton = (event: Event) => focusBack(event, saveButtonRef.current);
  const focusManageButton = (event: Event) => focusBack(event, manageButtonRef.current);

  const current = selectorCurrent(presets, currentQuery);
  const matchedIds = new Set(presets ? matchingPresets(presets, currentQuery).map((preset) => preset.id) : []);
  const currentLabel = current.kind === "preset" ? current.preset.name : current.kind === "standard" ? "標準の条件" : "保存されていない条件";
  const defaultPreset = presets?.find((preset) => preset.is_default) ?? null;
  const limitReached = presets !== null && presets.length >= PRESET_LIMIT;
  const saveDisabledReason =
    presets === null ? "プリセットを読み込めないため保存できません" : limitReached ? `${PRESET_MESSAGES.preset_limit}（管理から削除してください）` : null;

  const apply = (preset: Preset | null) => {
    setStatus(null);
    if (preset === null) {
      setApplyNotice(null);
      onApply({ ...DEFAULT_CONDITIONS, off: [], market: [], sector: [] });
      return;
    }
    onApply(preset.conditions);
    const query = presetQueryOf(preset.conditions);
    if (preset.status === "invalid") {
      setApplyNotice({
        text: `プリセット『${preset.name}』の条件の一部（${preset.invalidFields.join(", ")}）が無効なため、既定値で適用しました`,
        query,
      });
    } else if (preset.status === "noncanonical") {
      setApplyNotice({ text: `プリセット『${preset.name}』の条件を標準の形に直して適用しました`, query });
    } else {
      setApplyNotice(null);
    }
  };

  /**
   * 書き込みの後: 一覧を取り直し、結果を知らせる。
   * 条件のパラメータの無い URL（/screening）のまま router.refresh() すると、既定のプリセットを作った・変えたときにサーバーが
   * そのプリセットへリダイレクトし、表示中の条件が変わってしまう。そこで、その場合は表示中の条件の URL に置き換えて取り直す
   * （同じ条件のまま。プリセットの操作では条件を変えない）。
   */
  const done = (message: string) => {
    setStatus(message);
    if (hasScreeningParams(searchParamsToRecord(new URLSearchParams(window.location.search)))) router.refresh();
    else router.replace(`/screening?${resultQuery}`, { scroll: false });
  };

  // 適用の注記は、適用した条件のままの間だけ出す（条件を変えたら消す）
  const showApplyNotice = applyNotice !== null && applyNotice.query === currentQuery;

  return (
    <div className="space-y-2" data-testid="screening-presets">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <Bookmark aria-hidden="true" className="size-3.5" />
          プリセット
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="max-w-full min-w-0 justify-between gap-1.5"
              aria-label={`プリセット: ${currentLabel}`}
              data-testid="preset-selector"
              data-current={current.kind === "preset" ? current.preset.id : current.kind}
            >
              <span className={cn("truncate", current.kind === "none" && "text-muted-foreground")}>{currentLabel}</span>
              {current.kind === "preset" && current.preset.is_default && <DefaultBadge />}
              <ChevronDown aria-hidden="true" className="opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-auto max-w-[min(24rem,calc(100vw-2rem))] min-w-64" data-testid="preset-menu">
            <DropdownMenuItem
              onSelect={() => apply(null)}
              data-testid="preset-option"
              data-preset-id="standard"
              data-matched={currentQuery === STANDARD_QUERY ? "true" : "false"}
            >
              <CheckSlot checked={currentQuery === STANDARD_QUERY} />
              <span>標準の条件（アプリの初期値）</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {presets === null ? (
              <p className="flex items-start gap-1.5 px-2 py-1.5 text-xs text-destructive-strong" data-testid="preset-list-error" role="alert">
                <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                {PRESET_MESSAGES.list_error}
              </p>
            ) : presets.length === 0 ? (
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground" data-testid="preset-empty">
                保存したプリセットはありません
              </DropdownMenuLabel>
            ) : (
              presets.map((preset) => (
                <DropdownMenuItem
                  key={preset.id}
                  onSelect={() => apply(preset)}
                  data-testid="preset-option"
                  data-preset-id={preset.id}
                  data-matched={matchedIds.has(preset.id) ? "true" : "false"}
                  className="items-start"
                >
                  <CheckSlot checked={matchedIds.has(preset.id)} />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="break-all">{preset.name}</span>
                      {preset.is_default && <DefaultBadge />}
                    </span>
                    <ProblemMark preset={preset} />
                  </span>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="outline"
          size="sm"
          ref={saveButtonRef}
          disabled={saveDisabledReason !== null}
          onClick={() => {
            onFlush();
            setStatus(null);
            setSaveOpen(true);
          }}
          data-testid="preset-save-button"
        >
          <Save aria-hidden="true" />
          現在の条件を保存
        </Button>
        <Button
          ref={manageButtonRef}
          variant="ghost"
          size="sm"
          onClick={() => {
            setStatus(null);
            setManageOpen(true);
          }}
          data-testid="preset-manage-button"
        >
          <Settings2 aria-hidden="true" />
          管理
        </Button>
        {saveDisabledReason && (
          <span className="text-xs text-muted-foreground" data-testid="preset-save-disabled-reason">
            {saveDisabledReason}
          </span>
        )}
        <span role="status" aria-live="polite" className="text-xs text-signal-strong" data-testid="preset-status">
          {status}
        </span>
      </div>

      {showApplyNotice && applyNotice && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-md border border-caution/40 bg-caution-muted px-3 py-1.5 text-xs text-caution-strong"
          data-testid="preset-invalid-notice"
        >
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          {applyNotice.text}
        </p>
      )}

      <SaveDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        resultConditions={resultConditions}
        resultQuery={resultQuery}
        updating={updating}
        invalidInputKeys={invalidInputKeys}
        defaultPreset={defaultPreset}
        onCloseAutoFocus={focusSaveButton}
        onSaved={(name) => {
          setSaveOpen(false);
          done(`『${name}』を保存しました`);
        }}
      />

      <ManageDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        presets={presets}
        resultConditions={resultConditions}
        resultQuery={resultQuery}
        updating={updating}
        onFlush={onFlush}
        onCloseAutoFocus={focusManageButton}
        onApply={(preset) => {
          setManageOpen(false);
          apply(preset);
        }}
        onDone={done}
      />
    </div>
  );
}

function CheckSlot({ checked }: { checked: boolean }) {
  return (
    <span className="flex size-4 shrink-0 items-center justify-center" data-testid={checked ? "preset-check" : undefined}>
      {checked && <Check aria-label="適用中" className="size-4 text-signal-strong" />}
    </span>
  );
}

// ---------------------------------------------------------------------------
// 保存のダイアログ
// ---------------------------------------------------------------------------

function SummaryList({ parts, highlight, testId }: { parts: SummaryPart[]; highlight?: Set<string>; testId?: string }) {
  return (
    <ul className="flex flex-wrap gap-1.5 text-xs" data-testid={testId}>
      {parts.map((part) => {
        const changed = highlight?.has(part.key) ?? false;
        return (
          <li
            key={part.key}
            className={cn(
              "rounded-sm border px-1.5 py-0.5",
              changed ? "border-caution/50 bg-caution-muted font-semibold text-caution-strong" : "bg-surface text-foreground",
            )}
            data-changed={changed ? "true" : undefined}
          >
            {changed && <span className="sr-only">変更: </span>}
            {part.text}
            {changed && (
              <span aria-hidden="true" className="ml-1 font-normal">
                ●
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function SaveDialog({
  open,
  onOpenChange,
  resultConditions,
  resultQuery,
  updating,
  invalidInputKeys,
  defaultPreset,
  onCloseAutoFocus,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resultConditions: ScreeningConditions;
  resultQuery: string;
  updating: boolean;
  invalidInputKeys: ConditionKey[];
  defaultPreset: Preset | null;
  onCloseAutoFocus: (event: Event) => void;
  onSaved: (name: string) => void;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const [makeDefault, setMakeDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName("");
      setMakeDefault(false);
      setError(null);
      setSubmitting(false);
    }
  }

  const note = invalidInputNote(invalidInputKeys, resultConditions);

  const submit = async () => {
    const problem = validatePresetName(name);
    if (problem) {
      setError(PRESET_MESSAGES[problem]);
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await callApi("POST", "/api/screening/presets", { name, query: resultQuery, isDefault: makeDefault });
    setSubmitting(false);
    if (result.ok) {
      onSaved(String((result.body.data as { name?: string } | undefined)?.name ?? name));
      return;
    }
    const fields = result.body.fields;
    if (result.body.error === "invalid_preset" && Array.isArray(fields) && fields.includes("name")) {
      setError(PRESET_MESSAGES[validatePresetName(name) ?? "name_invalid_chars"]);
      return;
    }
    setError(errorMessage(result));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="preset-save-dialog" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>条件をプリセットとして保存</DialogTitle>
          <DialogDescription>表示中の結果の条件に名前を付けて保存します。</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!updating && !submitting) void submit();
          }}
        >
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">保存する条件</p>
            <SummaryList parts={presetSummaryParts(resultConditions)} testId="preset-conditions-summary" />
            {note && (
              <p className="flex items-start gap-1.5 text-xs text-caution-strong" data-testid="preset-invalid-input-note">
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                {note}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor={`${id}-name`} className="text-sm font-medium">
                プリセットの名前
              </label>
              <span className="tabular font-mono text-xs text-muted-foreground" data-testid="preset-name-count">
                {presetNameLength(name)} / {PRESET_NAME_MAX_LENGTH}
              </span>
            </div>
            <Input
              id={`${id}-name`}
              value={name}
              autoComplete="off"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
            />
            {error && (
              <p id={`${id}-error`} className="text-xs text-destructive-strong" role="alert" data-testid="preset-name-error">
                {error}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <div className="flex items-start gap-2">
              <Checkbox id={`${id}-default`} checked={makeDefault} onCheckedChange={(checked) => setMakeDefault(checked === true)} className="mt-0.5" />
              <label htmlFor={`${id}-default`} className="text-sm">
                既定にする（スクリーニングを開いたときにこの条件で表示します）
              </label>
            </div>
            {makeDefault && defaultPreset && (
              <p className="pl-6 text-xs text-muted-foreground" data-testid="preset-default-replace-note">
                『{defaultPreset.name}』の代わりに既定になります
              </p>
            )}
          </div>
          <DialogFooter>
            {updating && (
              <span className="inline-flex items-center gap-1 self-center text-xs text-muted-foreground" data-testid="preset-waiting">
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                結果の更新を待っています
              </span>
            )}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              キャンセル
            </Button>
            <Button type="submit" disabled={updating || submitting}>
              {submitting && <Loader2 aria-hidden="true" className="animate-spin" />}
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// 管理のダイアログ
// ---------------------------------------------------------------------------

function ManageDialog({
  open,
  onOpenChange,
  presets,
  resultConditions,
  resultQuery,
  updating,
  onFlush,
  onCloseAutoFocus,
  onApply,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presets: Preset[] | null;
  resultConditions: ScreeningConditions;
  resultQuery: string;
  updating: boolean;
  onFlush: () => void;
  onCloseAutoFocus: (event: Event) => void;
  onApply: (preset: Preset) => void;
  onDone: (message: string) => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  // 確認のダイアログは状態で開く（トリガーを持たない）ので、閉じたら開いたボタンにフォーカスを戻す。
  // ボタンが無くなっていれば（削除した行）管理のダイアログに戻す（body に落とさない）
  const openerRef = useRef<HTMLElement | null>(null);
  const rememberOpener = () => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };
  const restoreFocus = (event: Event) => {
    event.preventDefault();
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener && opener.isConnected && !opener.hasAttribute("disabled")) opener.focus();
    else contentRef.current?.focus();
  };
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [overwriteTarget, setOverwriteTarget] = useState<Preset | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Preset | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setRenamingId(null);
      setError(null);
    }
  }

  const run = async (preset: Preset, method: "PATCH" | "DELETE", body: unknown, message: string) => {
    setBusyId(preset.id);
    setError(null);
    const result = await callApi(method, `/api/screening/presets/${preset.id}`, body);
    setBusyId(null);
    if (!result.ok) {
      setError({ id: preset.id, text: errorMessage(result) });
      return false;
    }
    onDone(message);
    return true;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={contentRef}
        className="max-w-2xl"
        data-testid="preset-manage-dialog"
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={(event) => {
          // 名前の変更中の Esc は、変更の取り消しだけにする（ダイアログは閉じない）
          if (renamingId !== null) {
            event.preventDefault();
            setRenamingId(null);
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>プリセットの管理</DialogTitle>
          <DialogDescription>名前の変更、現在の条件での上書き、既定の切り替え、削除ができます。</DialogDescription>
        </DialogHeader>

        {presets === null ? (
          <p className="flex items-start gap-1.5 text-sm text-destructive-strong" data-testid="preset-list-error" role="alert">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {PRESET_MESSAGES.list_error}
          </p>
        ) : presets.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="preset-empty">
            保存したプリセットはありません。『現在の条件を保存』から追加できます
          </p>
        ) : (
          <ul className="divide-y rounded-md border" data-testid="preset-rows">
            {presets.map((preset) => (
              <PresetRowItem
                key={preset.id}
                preset={preset}
                renaming={renamingId === preset.id}
                busy={busyId === preset.id}
                error={error?.id === preset.id ? error.text : null}
                sameAsCurrent={preset.query === resultQuery}
                onApply={() => onApply(preset)}
                onStartRename={() => {
                  setError(null);
                  setRenamingId(preset.id);
                }}
                onCancelRename={() => setRenamingId(null)}
                onRename={async (name) => {
                  const problem = validatePresetName(name);
                  if (problem) {
                    setError({ id: preset.id, text: PRESET_MESSAGES[problem] });
                    return;
                  }
                  const ok = await run(preset, "PATCH", { name }, `『${preset.name}』の名前を変更しました`);
                  if (ok) setRenamingId(null);
                }}
                onOverwrite={() => {
                  onFlush();
                  rememberOpener();
                  setOverwriteTarget(preset);
                }}
                onToggleDefault={() =>
                  void run(
                    preset,
                    "PATCH",
                    { isDefault: !preset.is_default },
                    preset.is_default ? `『${preset.name}』の既定を解除しました` : `『${preset.name}』を既定にしました`,
                  )
                }
                onDelete={() => {
                  rememberOpener();
                  setDeleteTarget(preset);
                }}
              />
            ))}
          </ul>
        )}

        <AlertDialog open={overwriteTarget !== null} onOpenChange={(next) => !next && setOverwriteTarget(null)}>
          <AlertDialogContent data-testid="preset-overwrite-dialog" className="max-w-lg" onCloseAutoFocus={restoreFocus}>
            {overwriteTarget && (
              <OverwriteBody
                preset={overwriteTarget}
                resultConditions={resultConditions}
                updating={updating}
                onConfirm={async () => {
                  const target = overwriteTarget;
                  const ok = await run(target, "PATCH", { query: resultQuery }, `『${target.name}』を現在の条件で上書きしました`);
                  if (ok) setOverwriteTarget(null);
                }}
              />
            )}
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={deleteTarget !== null} onOpenChange={(next) => !next && setDeleteTarget(null)}>
          <AlertDialogContent
            data-testid="preset-delete-dialog"
            onCloseAutoFocus={restoreFocus}
          >
            {deleteTarget && (
              <>
                <AlertDialogTitle>プリセット『{deleteTarget.name}』を削除しますか？</AlertDialogTitle>
                <AlertDialogDescription>
                  この操作は取り消せません。
                  {deleteTarget.is_default && (
                    <>
                      <br />
                      既定のプリセットです。削除すると、スクリーニングは標準の条件で開きます
                    </>
                  )}
                </AlertDialogDescription>
                <AlertDialogFooter>
                  <AlertDialogCancel>キャンセル</AlertDialogCancel>
                  <Button
                    variant="destructive"
                    onClick={async () => {
                      const target = deleteTarget;
                      const ok = await run(target, "DELETE", undefined, `『${target.name}』を削除しました`);
                      if (ok) setDeleteTarget(null);
                    }}
                  >
                    削除
                  </Button>
                </AlertDialogFooter>
              </>
            )}
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

function OverwriteBody({
  preset,
  resultConditions,
  updating,
  onConfirm,
}: {
  preset: Preset;
  resultConditions: ScreeningConditions;
  updating: boolean;
  onConfirm: () => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const before = presetSummaryParts(preset.conditions);
  const after = presetSummaryParts(resultConditions);
  const beforeText = new Map(before.map((part) => [part.key, part.text]));
  const afterText = new Map(after.map((part) => [part.key, part.text]));
  const changedBefore = new Set(before.filter((part) => afterText.get(part.key) !== part.text).map((part) => part.key));
  const changedAfter = new Set(after.filter((part) => beforeText.get(part.key) !== part.text).map((part) => part.key));
  return (
    <>
      <AlertDialogTitle>『{preset.name}』を現在の条件で上書きしますか？</AlertDialogTitle>
      <AlertDialogDescription>保存済みの条件を、表示中の結果の条件に置き換えます。名前と既定は変わりません。</AlertDialogDescription>
      <div className="space-y-2">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">保存済み</p>
          <SummaryList parts={before} highlight={changedBefore} testId="preset-overwrite-before" />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">現在</p>
          <SummaryList parts={after} highlight={changedAfter} testId="preset-overwrite-after" />
        </div>
      </div>
      <AlertDialogFooter>
        {updating && (
          <span className="inline-flex items-center gap-1 self-center text-xs text-muted-foreground">
            <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
            結果の更新を待っています
          </span>
        )}
        <AlertDialogCancel>キャンセル</AlertDialogCancel>
        <Button
          disabled={updating || submitting}
          onClick={async () => {
            setSubmitting(true);
            await onConfirm();
            setSubmitting(false);
          }}
        >
          上書き
        </Button>
      </AlertDialogFooter>
    </>
  );
}

function PresetRowItem({
  preset,
  renaming,
  busy,
  error,
  sameAsCurrent,
  onApply,
  onStartRename,
  onCancelRename,
  onRename,
  onOverwrite,
  onToggleDefault,
  onDelete,
}: {
  preset: Preset;
  renaming: boolean;
  busy: boolean;
  error: string | null;
  sameAsCurrent: boolean;
  onApply: () => void;
  onStartRename: () => void;
  onCancelRename: () => void;
  onRename: (name: string) => Promise<void>;
  onOverwrite: () => void;
  onToggleDefault: () => void;
  onDelete: () => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(preset.name);
  const [wasRenaming, setWasRenaming] = useState(renaming);
  if (renaming !== wasRenaming) {
    setWasRenaming(renaming);
    if (renaming) setDraft(preset.name);
  }

  return (
    <li className="space-y-2 px-3 py-2.5" data-testid="preset-row" data-preset-id={preset.id}>
      {renaming ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void onRename(draft);
          }}
        >
          <label htmlFor={`${id}-rename`} className="sr-only">
            新しい名前
          </label>
          <Input
            id={`${id}-rename`}
            value={draft}
            autoFocus
            autoComplete="off"
            className="h-8 w-56 max-w-full"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(event) => setDraft(event.target.value)}
          />
          <span className="tabular font-mono text-xs text-muted-foreground">
            {presetNameLength(draft)} / {PRESET_NAME_MAX_LENGTH}
          </span>
          <Button type="submit" size="sm" disabled={busy}>
            保存
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onCancelRename}>
            キャンセル
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium break-all" data-testid="preset-row-name">
            {preset.name}
          </span>
          {preset.is_default && <DefaultBadge />}
          <ProblemMark preset={preset} />
          <span className="ml-auto text-xs text-muted-foreground">
            更新 <span className="tabular font-mono" data-testid="preset-row-updated">{jstDateOf(preset.updated_at)}</span>
          </span>
        </div>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive-strong" role="alert" data-testid="preset-row-error">
          {error}
        </p>
      )}
      <SummaryList parts={presetSummaryParts(preset.conditions)} />
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="xs" variant="outline" onClick={onApply} disabled={busy}>
          適用
        </Button>
        <Button size="xs" variant="outline" onClick={onStartRename} disabled={busy || renaming}>
          <Pencil aria-hidden="true" />
          名前を変更
        </Button>
        <Button size="xs" variant="outline" onClick={onOverwrite} disabled={busy || sameAsCurrent} aria-describedby={sameAsCurrent ? `${id}-same` : undefined}>
          現在の条件で上書き
        </Button>
        <Button size="xs" variant="outline" onClick={onToggleDefault} disabled={busy}>
          <Star aria-hidden="true" />
          {preset.is_default ? "既定を解除" : "既定にする"}
        </Button>
        <Button size="xs" variant="outline" className="text-destructive-strong" onClick={onDelete} disabled={busy}>
          <Trash2 aria-hidden="true" />
          削除
        </Button>
        {sameAsCurrent && (
          <span id={`${id}-same`} className="text-xs text-muted-foreground">
            現在の条件と同じです
          </span>
        )}
        {busy && <Loader2 aria-label="処理中" className="size-3.5 animate-spin text-muted-foreground" />}
      </div>
    </li>
  );
}
