"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const stop = (event: React.SyntheticEvent) => event.stopPropagation();

/**
 * 短い補足のツールチップ（ブラウザの title 属性の置き換え。shadcn の Tooltip）。
 * - マウスを乗せる・フォーカスで開く（title と違い、キーボードでも見える）。Provider は AppDocument に1つ
 * - トリガーの子に data-hint={text} を付ける（E2E は title の代わりにこれで文言を確かめる）
 * - 子は1つの要素（ref を受け取れるもの）。読み上げが要る文は、呼び出し側が aria-label・sr-only でも持つ
 *   （Tooltip の aria-describedby は開いている間だけなので）
 * - 中のクリックは外に伝えない（結果の表の行のクリックは銘柄詳細へ移るため。ポータルの中のイベントも行に届く）
 */
export function Hint({
  text,
  side = "top",
  align = "center",
  children,
}: {
  /** 無ければツールチップを付けずに子をそのまま描く */
  text: string | null | undefined;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  children: React.ReactElement;
}) {
  if (!text) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild data-hint={text}>
        {children}
      </TooltipTrigger>
      <TooltipContent side={side} align={align} sideOffset={4} className="whitespace-pre-line" onClick={stop} onPointerDown={stop}>
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
