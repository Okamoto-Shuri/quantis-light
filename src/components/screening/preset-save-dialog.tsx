"use client";

import { Loader2, TriangleAlert } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ConditionKey, ScreeningConditions } from "@/lib/screening/params";
import {
  invalidInputNote,
  PRESET_MESSAGES,
  PRESET_NAME_MAX_LENGTH,
  presetNameLength,
  presetSummaryParts,
  validatePresetName,
  type Preset,
} from "@/lib/screening/presets";

import { callApi, errorMessage, SummaryList } from "./preset-shared";

/** 保存のダイアログ（Sprint 13。表示中の結果の条件に名前を付けて保存する） */
export function PresetSaveDialog({
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
