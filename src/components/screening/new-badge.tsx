"use client";

import { changeReasonKey, changeReasonText, capturedAtText, type ChangeReason } from "@/lib/screening/changes";

import { HoverPopover } from "./hover-popover";

/**
 * スクリーニングの結果の「NEW」（Sprint 14。AC13.3）。表示中の条件で、前回の取り込み（比較の基準の記録）から新たに該当した銘柄に付ける。
 * マウスを乗せる、またはクリック（Enter・Space）で、記録の日時と理由を示す（行のクリックには伝えない。HoverPopover）。
 */
export function NewBadge({ capturedAt, reasons }: { capturedAt: string | null; reasons: ChangeReason[] }) {
  return (
    <HoverPopover
      ariaLabel="NEW: 前回の取り込みから新たに該当（理由を表示）"
      testId="new-badge"
      contentTestId="new-badge-detail"
      align="start"
      triggerClassName="inline-flex h-4 items-center rounded-sm border border-signal/40 bg-signal-muted px-1 font-sans text-[0.6rem] leading-none font-semibold tracking-wide text-signal-strong hover:border-signal"
      trigger="NEW"
    >
      <p className="font-medium">前回の取り込み（{capturedAtText(capturedAt)} の開始時点）から新たに該当</p>
      <ul className="space-y-0.5">
        {reasons.map((reason) => (
          <li key={changeReasonKey(reason)} data-testid="new-badge-reason" data-reason={changeReasonKey(reason)}>
            {changeReasonText(reason)}
          </li>
        ))}
      </ul>
    </HoverPopover>
  );
}
