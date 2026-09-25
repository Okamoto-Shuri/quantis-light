"use client";

import { ChevronDown, RotateCcw, X } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { formatCount } from "@/lib/format";
import type { ConditionKey, ScreeningConditions } from "@/lib/screening/params";
import type { FilterOptions } from "@/lib/screening/result";
import { MARKETS, SECTOR33_NAMES, type MarketCode } from "@/lib/screening/sectors";

import { CagrSupplementNote } from "./status-mark";
import { ThresholdField } from "./threshold-field";

export type PanelHandlers = {
  setEnabled: (key: ConditionKey, enabled: boolean) => void;
  draftThreshold: (key: ConditionKey, value: string) => void;
  commitThreshold: (key: ConditionKey, value: string, debounceMs: number) => void;
  setIncludeUnavailable: (include: boolean) => void;
  toggleMarket: (code: MarketCode, checked: boolean) => void;
  toggleSector: (code: string, checked: boolean) => void;
  reset: () => void;
};

/** 条件パネル（条件①〜③、算出不可を含める、市場区分、業種、既定に戻す）。デスクトップの左の列と、狭い画面のシートで共有する。 */
export function ConditionPanel({
  conditions,
  options,
  handlers,
}: {
  conditions: ScreeningConditions;
  options: FilterOptions | null;
  handlers: PanelHandlers;
}) {
  const includeId = useId();
  const on = (key: ConditionKey) => !conditions.off.includes(key);

  return (
    <div className="space-y-5" data-testid="screening-conditions">
      {/* 対象の絞り込み（市場区分・業種）は上に置き、1280×800 でもスクロールなしで見えるようにする（Sprint 6 評価の m4） */}
      <fieldset className="space-y-2" data-testid="market-filter">
        <legend className="flex w-full items-baseline justify-between text-sm font-medium">
          市場区分
          {conditions.market.length === 0 && <span className="text-xs font-normal text-muted-foreground">すべて</span>}
        </legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
          {MARKETS.map((market) => {
            const checkboxId = `${includeId}-market-${market.code}`;
            return (
              <div key={market.code} className="flex items-center gap-1.5">
                <Checkbox
                  id={checkboxId}
                  checked={conditions.market.includes(market.code)}
                  onCheckedChange={(checked) => handlers.toggleMarket(market.code, checked === true)}
                />
                <label htmlFor={checkboxId} className="text-sm">
                  {market.name}
                  {options && (
                    <span className="tabular ml-1 font-mono text-xs text-muted-foreground">
                      {formatCount(options.markets[market.code] ?? 0)}
                    </span>
                  )}
                </label>
              </div>
            );
          })}
        </div>
      </fieldset>

      <SectorFilter idPrefix={includeId} conditions={conditions} options={options} onToggle={handlers.toggleSector} />

      <div className="space-y-5 border-t pt-4">
      <ThresholdField
        conditionKey="cagr"
        title="条件① 売上CAGR"
        switchLabel="条件① 売上CAGR を使う"
        prefix="売上CAGR ≥"
        suffix="%"
        inputLabel="売上CAGR の閾値（%）"
        slider={{ min: 0, max: 100, step: 1 }}
        value={conditions.cagr}
        enabled={on("cagr")}
        onToggle={(enabled) => handlers.setEnabled("cagr", enabled)}
        onDraft={(value) => handlers.draftThreshold("cagr", value)}
        onCommit={(value, ms) => handlers.commitThreshold("cagr", value, ms)}
      >
        <p className="text-xs text-muted-foreground">直近5期の通期実績から算出（成長4年分）</p>
        <CagrSupplementNote className="hidden lg:flex" />
      </ThresholdField>

      <ThresholdField
        conditionKey="margin"
        title="条件② 営業利益率"
        switchLabel="条件② 営業利益率 を使う"
        prefix="営業利益率 ≥"
        suffix="%"
        inputLabel="営業利益率 の閾値（%）"
        slider={{ min: 0, max: 50, step: 1 }}
        value={conditions.margin}
        enabled={on("margin")}
        onToggle={(enabled) => handlers.setEnabled("margin", enabled)}
        onDraft={(value) => handlers.draftThreshold("margin", value)}
        onCommit={(value, ms) => handlers.commitThreshold("margin", value, ms)}
      >
        <p className="text-xs text-muted-foreground">直近の通期実績の営業利益 ÷ 売上高</p>
      </ThresholdField>

      <ThresholdField
        conditionKey="years"
        title="条件③ 上場年数"
        switchLabel="条件③ 上場年数 を使う"
        prefix="上場"
        suffix="年以内"
        inputLabel="上場年数 の閾値（年）"
        slider={{ min: 0.5, max: 10, step: 0.5 }}
        value={conditions.years}
        enabled={on("years")}
        onToggle={(enabled) => handlers.setEnabled("years", enabled)}
        onDraft={(value) => handlers.draftThreshold("years", value)}
        onCommit={(value, ms) => handlers.commitThreshold("years", value, ms)}
      >
        <p className="text-xs text-muted-foreground">
          株価データの初出日からの推定。データ期間開始以前から上場している銘柄は満たしません
        </p>
      </ThresholdField>

      </div>

      <div className="space-y-1.5 border-t pt-4">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={includeId} className="text-sm font-medium">
            算出不可を含める
          </label>
          <Switch
            id={includeId}
            size="sm"
            checked={conditions.includeUnavailable}
            onCheckedChange={handlers.setIncludeUnavailable}
            data-testid="include-unavailable"
          />
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          オンにすると、値を算出できない銘柄（通期実績が5期未満、営業利益の開示なし、財務データなし、初出日が未確定など）も、その条件を除いて判定して表示します。銀行など営業利益を開示しない会社は、営業利益率が算出不可になります。
        </p>
      </div>


      <div className="border-t pt-4">
        <Button variant="outline" size="sm" onClick={handlers.reset} className="w-full">
          <RotateCcw aria-hidden="true" />
          既定の条件に戻す
        </Button>
      </div>
    </div>
  );
}

function SectorFilter({
  idPrefix,
  conditions,
  options,
  onToggle,
}: {
  idPrefix: string;
  conditions: ScreeningConditions;
  options: FilterOptions | null;
  onToggle: (code: string, checked: boolean) => void;
}) {
  const selected = conditions.sector;
  const available = options?.sectors ?? [];
  // DB に銘柄の無い業種は、URL で選ばれているときだけ一覧に加える（外せるようにするため）
  const extra = selected
    .filter((code) => !available.some((sector) => sector.code === code))
    .map((code) => ({ code, name: SECTOR33_NAMES.get(code) ?? code, count: 0 }));
  const items = [...available.map((s) => ({ ...s, name: s.name ?? SECTOR33_NAMES.get(s.code) ?? s.code })), ...extra].sort((a, b) =>
    a.code.localeCompare(b.code),
  );
  const nameOf = (code: string) => items.find((item) => item.code === code)?.name ?? SECTOR33_NAMES.get(code) ?? code;
  const missing = (code: string) => !available.some((sector) => sector.code === code);

  return (
    <fieldset className="space-y-2" data-testid="sector-filter">
      <legend className="flex w-full items-baseline justify-between text-sm font-medium">
        業種
        {selected.length === 0 && <span className="text-xs font-normal text-muted-foreground">すべて</span>}
      </legend>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="mt-1 w-full justify-between">
            業種を選ぶ
            <ChevronDown aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="max-h-80 w-72 overflow-y-auto p-1" data-testid="sector-options">
          {items.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">銘柄が取り込まれていないため、業種はありません</p>
          ) : (
            <ul role="list" aria-label="業種">
              {items.map((item) => {
                const checkboxId = `${idPrefix}-sector-${item.code}`;
                return (
                  <li key={item.code} className="flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-muted">
                    <Checkbox
                      id={checkboxId}
                      checked={selected.includes(item.code)}
                      onCheckedChange={(checked) => onToggle(item.code, checked === true)}
                    />
                    <label htmlFor={checkboxId} className="flex flex-1 items-baseline justify-between gap-2 text-sm">
                      <span>{item.name}</span>
                      <span className="tabular font-mono text-xs text-muted-foreground">{formatCount(item.count)}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </PopoverContent>
      </Popover>
      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="選んだ業種" data-testid="sector-chips">
          {selected.map((code) => (
            <li
              key={code}
              className="inline-flex items-center gap-1 rounded-md border bg-secondary py-0.5 pr-0.5 pl-2 text-xs"
              data-sector={code}
            >
              {nameOf(code)}
              {missing(code) && <span className="text-muted-foreground">（該当銘柄なし）</span>}
              <button
                type="button"
                onClick={() => onToggle(code, false)}
                aria-label={`${nameOf(code)} を外す`}
                className="rounded-sm p-0.5 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <X aria-hidden="true" className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
