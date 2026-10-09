"use client";

import { useEffect, useId, useState } from "react";

import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { parseThresholdInput, thresholdErrorMessage, type ConditionKey } from "@/lib/screening/params";
import { cn } from "@/lib/utils";

export type ThresholdFieldProps = {
  conditionKey: ConditionKey;
  /** 見出し（例: 「条件① 売上CAGR」） */
  title: string;
  /** スイッチのラベル（例: 「条件① 売上CAGR を使う」） */
  switchLabel: string;
  /** 閾値の前後の文言（例: 「売上CAGR ≥」「%」、「上場」「年以内」） */
  prefix: string;
  suffix: string;
  inputLabel: string;
  slider: { min: number; max: number; step: number };
  /** 現在の閾値（正規形の文字列） */
  value: string;
  enabled: boolean;
  /** 条件はオンのまま、閾値の入力だけを無効にする（条件④の「社長が筆頭株主のみ」） */
  inputDisabled?: boolean;
  /** 見出しの横に置く部品（「自動判定」のラベルなど） */
  titleAddon?: React.ReactNode;
  /** スイッチと閾値の間に置く部品（条件④のモードなど） */
  beforeInput?: React.ReactNode;
  onToggle: (enabled: boolean) => void;
  /** 有効な値になったとき（入力欄・スライダー）。画面の条件（未反映の条件）を書き換えるだけで、検索はしない */
  onCommit: (value: string) => void;
  /** 入力欄の Enter（「スクリーニング」と同じ。値は入力のたびに onCommit で渡し済み） */
  onSubmit?: () => void;
  /** 入力欄にエラーを表示しているかを親に知らせる（Sprint 13: プリセットの保存のダイアログの注記。表示を始めたら true、やめたら false） */
  onInvalidChange?: (invalid: boolean) => void;
  children?: React.ReactNode;
};

/**
 * 1つの条件（スイッチ・数値入力・スライダー・注記）。入力欄の不正な値は、他の操作をしても残す（条件は直前の有効な値のまま）。
 * 検索は「スクリーニング」のボタン（入力欄の Enter を含む）で行うので、ここでは待たずに値を渡す。
 */
export function ThresholdField({
  conditionKey,
  title,
  switchLabel,
  prefix,
  suffix,
  inputLabel,
  slider,
  value,
  enabled,
  inputDisabled = false,
  titleAddon,
  beforeInput,
  onToggle,
  onCommit,
  onSubmit,
  onInvalidChange,
  children,
}: ThresholdFieldProps) {
  const inputEnabled = enabled && !inputDisabled;
  const id = useId();
  const [text, setText] = useState(value);
  const [shownValue, setShownValue] = useState(value);

  // 外から値が変わったとき（スライダー、既定に戻す、戻る・進む）は、入力欄をその値に合わせる。
  // 入力中の文字列が同じ値を表しているとき（例: 「020」）はそのまま残す。
  if (value !== shownValue) {
    setShownValue(value);
    if (parseThresholdInput(conditionKey, text) !== value) setText(value);
  }

  const parsed = parseThresholdInput(conditionKey, text);
  const invalid = parsed === null;
  const errorId = `${id}-error`;
  const showError = invalid && inputEnabled;

  // エラーを表示している間だけ親に知らせる（部品が作り直されたとき・値が直ったときに取り消す）
  useEffect(() => {
    if (!showError || !onInvalidChange) return;
    onInvalidChange(true);
    return () => onInvalidChange(false);
  }, [showError, onInvalidChange]);

  const sliderValue = Math.min(Math.max(Number(value), slider.min), slider.max);

  return (
    <fieldset
      className={cn("space-y-2.5 rounded-md", !enabled && "text-muted-foreground")}
      data-testid={`condition-${conditionKey}`}
      data-enabled={enabled}
    >
      <legend className="sr-only">{title}</legend>
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5">
          <span className="text-xs font-medium tracking-wide text-muted-foreground" aria-hidden="true">
            {title}
          </span>
          {titleAddon}
        </span>
        <Switch checked={enabled} onCheckedChange={onToggle} aria-label={switchLabel} size="sm" />
      </div>
      {beforeInput}
      <div className={cn("flex items-baseline gap-2", !inputEnabled && "opacity-60")}>
        <label htmlFor={id} className="text-sm font-medium whitespace-nowrap text-foreground">
          {prefix}
        </label>
        <Input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          aria-label={inputLabel}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          disabled={!inputEnabled}
          value={text}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            const nextValue = parseThresholdInput(conditionKey, next);
            if (nextValue !== null && nextValue !== value) onCommit(nextValue);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            // 無効な値のままでは検索しない（エラーの表示が残る）
            if (!invalid) onSubmit?.();
          }}
          className="tabular h-8 w-20 text-right font-mono"
        />
        <span className="text-sm text-foreground">{suffix}</span>
      </div>
      {showError && (
        <p id={errorId} className="text-xs text-destructive-strong" role="alert">
          {thresholdErrorMessage(conditionKey)}
        </p>
      )}
      <div className={cn("px-1 py-1", !inputEnabled && "opacity-60")}>
        <Slider
          min={slider.min}
          max={slider.max}
          step={slider.step}
          value={[sliderValue]}
          disabled={!inputEnabled}
          thumbLabel={`${inputLabel}（スライダー）`}
          onValueChange={([next]) => {
            if (next === undefined) return;
            const normalized = parseThresholdInput(conditionKey, String(next));
            if (normalized !== null && normalized !== value) onCommit(normalized);
          }}
        />
        <div className="mt-1 flex justify-between text-[0.7rem] text-muted-foreground" aria-hidden="true">
          <span className="tabular font-mono">{slider.min}</span>
          <span className="tabular font-mono">{slider.max}</span>
        </div>
      </div>
      {children}
    </fieldset>
  );
}
