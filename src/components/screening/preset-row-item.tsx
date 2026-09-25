"use client";

import { Loader2, Pencil, Star, Trash2 } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { jstDateOf } from "@/lib/stocks/annual-report";
import { PRESET_NAME_MAX_LENGTH, presetNameLength, presetSummaryParts, type Preset } from "@/lib/screening/presets";

import { DefaultBadge, ProblemMark, SummaryList } from "./preset-shared";

/** 管理のダイアログの1行（適用・名前の変更・上書き・既定の切り替え・削除） */
export function PresetRowItem({
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
