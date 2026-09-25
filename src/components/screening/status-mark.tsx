import { Check, CircleHelp, Info, Minus } from "lucide-react";

import type { ConditionKey } from "@/lib/screening/params";
import type { ConditionStatus } from "@/lib/screening/result";
import { cn } from "@/lib/utils";

/**
 * 条件の印と AC6.12 の注記。スクリーニングの一覧（client）と銘柄詳細（server）の両方で使うため、フックを使わない部品にしている。
 */

export const CONDITION_LABELS: Record<ConditionKey, string> = { cagr: "条件① 売上CAGR", margin: "条件② 営業利益率", years: "条件③ 上場年数" };
const CONDITION_MARKS: Record<ConditionKey, string> = { cagr: "①", margin: "②", years: "③" };
export const STATUS_LABELS: Record<ConditionStatus, string> = { met: "満たす", unmet: "満たさない", unavailable: "算出不可", off: "オフ" };

/** 閾値の表示（「≥20%」「5年以内」）。 */
export function thresholdText(key: ConditionKey, threshold: string) {
  if (key === "years") return `${threshold}年以内`;
  return `≥${threshold}%`;
}

/** 状態のアイコン（✓・−・?。オフは null）。 */
export function StatusIcon({ status, className, strokeWidth }: { status: ConditionStatus; className?: string; strokeWidth?: number }) {
  if (status === "met") return <Check aria-hidden="true" className={className} strokeWidth={strokeWidth} />;
  if (status === "unmet") return <Minus aria-hidden="true" className={className} strokeWidth={strokeWidth} />;
  if (status === "unavailable") return <CircleHelp aria-hidden="true" className={className} strokeWidth={strokeWidth} />;
  return null;
}

/** 印の見た目（満たす = アクセント、満たさない = グレー、算出不可 = 注意の色、オフ = 点線の枠）。色だけに頼らずアイコンと文字でも区別する。 */
export function statusTone(status: ConditionStatus) {
  return cn(
    status === "met" && "bg-signal-muted text-signal-strong",
    status === "unmet" && "text-muted-foreground",
    status === "unavailable" && "bg-caution-muted text-caution-strong",
    status === "off" && "border border-dashed text-muted-foreground",
  );
}

/** 一覧の小さな印（①✓ など）。threshold は結果の条件（サーバーが判定に使った閾値）。 */
export function StatusMark({ conditionKey, status, threshold }: { conditionKey: ConditionKey; status: ConditionStatus; threshold: string }) {
  const title = `${CONDITION_LABELS[conditionKey]}${status === "off" ? "" : `（${thresholdText(conditionKey, threshold)}）`}: ${STATUS_LABELS[status]}`;
  return (
    <span
      className={cn(
        "relative inline-flex h-5 min-w-5 items-center justify-center gap-px rounded-sm px-0.5 text-[0.65rem] leading-none whitespace-nowrap",
        statusTone(status),
      )}
      title={title}
      data-testid={`condition-status-${conditionKey}`}
      data-status={status}
    >
      <span aria-hidden="true">{CONDITION_MARKS[conditionKey]}</span>
      {status === "off" ? <span aria-hidden="true" className="text-[0.6rem]">オフ</span> : <StatusIcon status={status} className="size-3" strokeWidth={2.5} />}
      <span className="sr-only">{title}</span>
    </span>
  );
}

/**
 * 条件①の注記（AC15.12。Sprint 6〜8 の AC6.12 の暫定の注記を置き換えた）。スクリーニングと銘柄詳細で同じ文言を使う。
 * 補完は通常の動作なので、注意ではなく情報の控えめな表示にする。
 */
export const CAGR_SUPPLEMENT_NOTE =
  "上場前の期は EDINET の有価証券届出書・有価証券報告書から補っています。書類から値を取れない銘柄は算出不可になることがあります。";

export function CagrSupplementNote({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 rounded-md border border-info/30 bg-info-muted px-2.5 py-2 text-xs leading-relaxed text-info-strong",
        className,
      )}
      data-testid="cagr-supplement-note"
    >
      <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span>{CAGR_SUPPLEMENT_NOTE}</span>
    </p>
  );
}
