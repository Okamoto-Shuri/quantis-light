import { cn } from "@/lib/utils";

/**
 * 要約の1項目。項目名と値を1行に並べ、値（数値）を右端に揃える（tabular-nums）。補足は下の行に小さく出す。
 * 取り込み状況の画面の「株価の初出日と推定上場年数」と「財務指標」の要約で共通に使う。
 */
export function SummaryTile({
  label,
  value,
  note,
  testId,
  className,
}: {
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
  testId: string;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 rounded-lg border bg-card px-4 py-3", className)} data-testid={testId}>
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
        <dd className="tabular min-w-0 text-right text-sm">{value}</dd>
      </div>
      {note && <p className="text-right text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

/** 要約の数値（3桁区切り済みの文字列）と単位。 */
export function SummaryNumber({ value, unit }: { value: string; unit?: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className="tabular font-mono text-base">{value}</span>
      {unit && <span className="text-sm"> {unit}</span>}
    </span>
  );
}
