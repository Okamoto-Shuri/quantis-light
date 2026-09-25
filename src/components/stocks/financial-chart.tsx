import { fiscalPeriodLabel, formatMillionYen, type FinancialPeriod } from "@/lib/financials/display";
import { formatCount } from "@/lib/format";
import type { FiscalSlot } from "@/lib/stocks/slots";
import { cn } from "@/lib/utils";

/**
 * 5期の売上高・営業利益の棒グラフ（AC7.2）。HTML と CSS だけで描く（サーバーで描画でき、JavaScript が無くても棒が出る）。
 * 幅に合わせて縮み、文字は拡大縮小しない。数値の読み取りは表で行う（グラフは role="img" と要約の aria-label）。
 * 棒の data-value は表と同じ百万円の表示値。ホバーで期・系列・値を出す（CSS だけ）。
 */

const SERIES = [
  { key: "net_sales", label: "売上高", bar: "bg-primary", swatch: "bg-primary" },
  { key: "operating_profit", label: "営業利益", bar: "bg-signal", swatch: "bg-signal" },
] as const;

const PLOT_HEIGHT = "h-52";

/** 目盛りの間隔（1・2・5 × 10^k）。 */
function niceStep(range: number): number {
  const raw = range / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  const nice = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10;
  return nice * power;
}

function scale(values: number[]) {
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const step = niceStep(max - min || 1);
  const top = Math.ceil(max / step) * step || step;
  const bottom = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = bottom; v <= top + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  /** 値の位置（上端からの割合 %） */
  const y = (v: number) => ((top - v) / (top - bottom)) * 100;
  return { ticks, y };
}

const millions = (yen: number) => yen / 1_000_000;

export function FinancialChart({ slots }: { slots: FiscalSlot<FinancialPeriod>[] }) {
  const values = slots.flatMap((slot) =>
    slot.period ? SERIES.map((s) => slot.period![s.key]).filter((v): v is number => v !== null).map(millions) : [],
  );
  const { ticks, y } = scale(values);
  const zero = y(0);

  const summary = slots
    .map((slot) => {
      const label = `${slot.position} ${fiscalPeriodLabel(slot.fiscalYearEnd)}`;
      if (!slot.period) return `${label} データなし`;
      return `${label} ${SERIES.map((s) => `${s.label} ${slot.period![s.key] === null ? "開示なし" : formatMillionYen(slot.period![s.key]!)}`).join("、")}`;
    })
    .join("。");

  return (
    <figure className="space-y-2" data-testid="financial-chart">
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>単位: 百万円</span>
        <ul className="flex items-center gap-3" aria-label="凡例" data-testid="chart-legend">
          {SERIES.map((s) => (
            <li key={s.key} className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className={cn("size-2.5 rounded-[2px]", s.swatch)} />
              {s.label}
            </li>
          ))}
        </ul>
      </div>

      <div role="img" aria-label={`売上高と営業利益の推移（百万円）: ${summary}`} className="flex gap-2 pt-2">
        {/* 縦軸の目盛り */}
        <div aria-hidden="true" className={cn("relative w-12 shrink-0 sm:w-14", PLOT_HEIGHT)} data-testid="chart-y-axis">
          {ticks.map((tick) => (
            <span
              key={tick}
              className="tabular absolute right-0 -translate-y-1/2 font-mono text-[0.7rem] leading-none text-muted-foreground"
              style={{ top: `${y(tick)}%` }}
            >
              {formatCount(tick)}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div className={cn("relative", PLOT_HEIGHT)}>
            {ticks.map((tick) => (
              <div
                key={tick}
                aria-hidden="true"
                className={cn("absolute inset-x-0 border-t", tick === 0 ? "border-foreground/50" : "border-dashed border-border")}
                style={{ top: `${y(tick)}%` }}
                data-testid={tick === 0 ? "chart-zero-line" : undefined}
              />
            ))}
            <div className="absolute inset-0 grid grid-cols-5">
              {slots.map((slot, slotIndex) => (
                <div key={slot.position} className="relative" data-slot={slot.position} data-testid="chart-slot" data-missing={!slot.period || undefined}>
                  {!slot.period ? (
                    <span
                      className="absolute inset-x-1 top-1/2 -translate-y-1/2 rounded-sm border border-dashed bg-card/80 px-1 py-1 text-center text-[0.7rem] text-muted-foreground"
                      data-testid="chart-missing"
                    >
                      データなし
                    </span>
                  ) : (
                    SERIES.map((s, index) => {
                      const raw = slot.period![s.key];
                      const left = index === 0 ? "left-[14%]" : "left-[52%]";
                      if (raw === null) {
                        return (
                          <span
                            key={s.key}
                            className={cn(
                              "absolute w-[34%] -translate-y-full pb-0.5 text-center text-[0.6rem] leading-tight text-muted-foreground",
                              left,
                            )}
                            style={{ top: `${zero}%` }}
                            data-series={s.key}
                            data-testid="chart-not-disclosed"
                          >
                            開示なし
                          </span>
                        );
                      }
                      const v = millions(raw);
                      const top = Math.min(y(v), zero);
                      const height = Math.abs(y(v) - zero);
                      const text = formatMillionYen(raw);
                      return (
                        <div
                          key={s.key}
                          className={cn("group/bar absolute w-[34%]", left)}
                          style={{ top: `${top}%`, height: `max(${height}%, 1px)` }}
                          data-series={s.key}
                          data-value={text}
                          data-negative={v < 0 || undefined}
                          data-testid="chart-bar"
                        >
                          <div className={cn("size-full", s.bar, v < 0 ? "rounded-b-[2px] opacity-80" : "rounded-t-[2px]")} />
                          <span
                            className={cn(
                              "pointer-events-none absolute z-10 hidden rounded-md border bg-popover px-2 py-1 text-[0.7rem] whitespace-nowrap text-popover-foreground shadow-sm group-hover/bar:block",
                              // 端の枠では画面の内側に寄せる（375px で切れないように。Sprint 7 評価の m1）
                              slotIndex === 0 ? "left-0" : slotIndex === slots.length - 1 ? "right-0" : "left-1/2 -translate-x-1/2",
                              v < 0 ? "top-full mt-1" : "bottom-full mb-1",
                            )}
                            data-testid="chart-tooltip"
                          >
                            {slot.position} {fiscalPeriodLabel(slot.fiscalYearEnd)} {s.label}{" "}
                            <span className="tabular font-mono">{text}</span>
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              ))}
            </div>
          </div>
          {/* 横軸（位置と決算期） */}
          <div aria-hidden="true" className="mt-1.5 grid grid-cols-5 text-center">
            {slots.map((slot) => (
              <div key={slot.position} className="min-w-0 leading-tight">
                <p className="tabular font-mono text-[0.7rem] text-muted-foreground">{slot.position}</p>
                <p className="tabular font-mono text-[0.7rem] text-foreground sm:text-xs">
                  {/* 狭い画面では年を2桁にする（「21/03期」） */}
                  <span className="sm:hidden">{fiscalPeriodLabel(slot.fiscalYearEnd).slice(2)}</span>
                  <span className="hidden sm:inline">{fiscalPeriodLabel(slot.fiscalYearEnd)}</span>
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}
