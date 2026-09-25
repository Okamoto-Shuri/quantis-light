"use client";

import { CircleAlert } from "lucide-react";
import { useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ScreeningConditions } from "@/lib/screening/params";
import { PRESET_MESSAGES, validatePresetName, type Preset } from "@/lib/screening/presets";

import { PresetOverwriteBody } from "./preset-overwrite-body";
import { PresetRowItem } from "./preset-row-item";
import { callApi, errorMessage } from "./preset-shared";

/** 管理のダイアログ（Sprint 13。名前の変更・上書き・既定の切り替え・削除） */
export function PresetManageDialog({
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
  // 確認のダイアログが閉じるアニメーションの間（確定の直後）の Esc は、閉じかけの確認のダイアログに届く。
  // その Esc は管理のダイアログを閉じる操作として扱う（Sprint 13 評価の m2）
  const closingEscape = (event: KeyboardEvent, target: Preset | null) => {
    if (target !== null) return;
    event.preventDefault();
    onOpenChange(false);
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
          <AlertDialogContent
            data-testid="preset-overwrite-dialog"
            className="max-w-lg"
            onCloseAutoFocus={restoreFocus}
            onEscapeKeyDown={(event) => closingEscape(event, overwriteTarget)}
          >
            {overwriteTarget && (
              <PresetOverwriteBody
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
            onEscapeKeyDown={(event) => closingEscape(event, deleteTarget)}
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
