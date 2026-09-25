"use client";

import { Bookmark, ChevronDown, CircleAlert, Save, Settings2, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DEFAULT_CONDITIONS, searchParamsToRecord, type ConditionKey, type ScreeningConditions } from "@/lib/screening/params";
import {
  matchingPresets,
  PRESET_LIMIT,
  PRESET_MESSAGES,
  presetQueryOf,
  selectorCurrent,
  STANDARD_QUERY,
  type Preset,
} from "@/lib/screening/presets";
import { hasScreeningParams } from "@/lib/stocks/detail";
import { cn } from "@/lib/utils";

import { PresetManageDialog } from "./preset-manage-dialog";
import { PresetSaveDialog } from "./preset-save-dialog";
import { CheckSlot, DefaultBadge, ProblemMark } from "./preset-shared";

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

      <PresetSaveDialog
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

      <PresetManageDialog
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
