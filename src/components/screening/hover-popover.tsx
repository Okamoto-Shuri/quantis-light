"use client";

import { useRef, useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * マウスを乗せる、またはクリック・Enter・Space で開くポップオーバー（一覧のセルの補足。Sprint 9 の「補完」の印から共通化）。
 * 行のクリック（銘柄詳細へ移る）に伝わらないよう、トリガーとポップオーバーの中のイベントは止める。Esc・外側のクリックで閉じる。
 * ブラウザの標準のツールチップと重ならないよう、title 属性は付けない（Sprint 9 評価の m3）。
 */
export function HoverPopover({
  trigger,
  triggerClassName,
  ariaLabel,
  testId,
  contentTestId,
  contentClassName,
  align = "end",
  children,
}: {
  trigger: React.ReactNode;
  triggerClassName?: string;
  ariaLabel: string;
  testId: string;
  contentTestId: string;
  contentClassName?: string;
  align?: "start" | "center" | "end";
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  };
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn("outline-none focus-visible:ring-2 focus-visible:ring-ring/50", triggerClassName)}
          aria-label={ariaLabel}
          data-testid={testId}
          onClick={(event) => {
            // マウスを乗せて開いた後のクリックで閉じないよう、Radix の開閉の切り替えをやめて常に開く
            event.stopPropagation();
            event.preventDefault();
            cancelClose();
            setOpen(true);
          }}
          onAuxClick={stop}
          onMouseDown={stop}
          onPointerEnter={() => {
            cancelClose();
            setOpen(true);
          }}
          onPointerLeave={scheduleClose}
        >
          {trigger}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        collisionPadding={8}
        className={cn("w-auto max-w-[min(22rem,calc(100vw-16px))] gap-1.5 p-3 text-xs", contentClassName)}
        data-testid={contentTestId}
        onClick={stop}
        onAuxClick={stop}
        onPointerEnter={cancelClose}
        onPointerLeave={scheduleClose}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
