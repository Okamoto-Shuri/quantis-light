import { formatCount, formatShare } from "@/lib/format";

/** 件数のタイル。total を渡すと「n / total 銘柄（xx.x%）」と割合のメーターを表示する。 */
export function StatTile({
  label,
  value,
  total,
  children,
  testId,
}: {
  label: string;
  value: number;
  total?: number;
  children?: React.ReactNode;
  testId?: string;
}) {
  const share = total === undefined ? null : formatShare(value, total);

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card px-4 py-4" data-testid={testId}>
      <h3 className="text-xs text-muted-foreground">{label}</h3>
      <p className="whitespace-nowrap">
        <span className="tabular font-mono text-3xl font-medium tracking-tight">{formatCount(value)}</span>
        <span className="text-sm text-muted-foreground">
          {total === undefined ? " 銘柄" : ` / ${formatCount(total)} 銘柄`}
          {share && `（${share}）`}
        </span>
      </p>
      {total !== undefined && total > 0 && (
        <div aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-signal" style={{ width: `${Math.min(100, (value / total) * 100)}%` }} />
        </div>
      )}
      {children}
    </div>
  );
}

/** タイルの下の内訳（右揃えの件数）。 */
export function StatBreakdown({ items }: { items: { label: string; value: number }[] }) {
  return (
    <dl className="mt-auto divide-y border-t text-sm">
      {items.map((item) => (
        <div key={item.label} className="flex items-center justify-between gap-3 py-1.5 first:pt-2.5 last:pb-0">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="tabular font-mono">{formatCount(item.value)}</dd>
        </div>
      ))}
    </dl>
  );
}
