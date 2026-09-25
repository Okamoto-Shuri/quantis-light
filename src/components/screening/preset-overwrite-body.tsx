"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { AlertDialogCancel, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { ScreeningConditions } from "@/lib/screening/params";
import { presetSummaryParts, type Preset } from "@/lib/screening/presets";

import { SummaryList } from "./preset-shared";

/** 上書きの確認の本文（保存済みと現在の条件の要約を並べ、違う項目を強調する） */
export function PresetOverwriteBody({
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
