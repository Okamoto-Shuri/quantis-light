import type { FetchProgress } from "@/lib/financials/display";
import type { FinancialEntry } from "@/lib/financials/queries";
import type { ListingAge } from "@/lib/listing/ages";
import type { Result, StockBasics } from "@/lib/listing/queries";

import { CodeLookupForm } from "./code-lookup-form";
import { FinancialCard } from "./financial-card";
import { ListingCard } from "./listing-dates-panel";

/** 銘柄コードで確認した結果（ページが検索パラメーターから作る）。 */
export type CodeLookup =
  | { kind: "none" }
  | { kind: "invalid"; input: string }
  | { kind: "not_found"; code: string }
  | { kind: "error" }
  | { kind: "found"; stock: StockBasics; age: ListingAge; financial: Result<FinancialEntry> };

function Message({ lookup }: { lookup: Exclude<CodeLookup, { kind: "found" } | { kind: "none" }> }) {
  switch (lookup.kind) {
    case "invalid":
      return (
        <p id="lookup-code-error" className="text-sm text-destructive-strong" data-testid="listing-lookup-message">
          銘柄コードは4桁または5桁の英数字で入力してください
        </p>
      );
    case "not_found":
      return (
        <p className="text-sm text-muted-foreground" data-testid="listing-lookup-message">
          銘柄コード <span className="tabular font-mono text-foreground">{lookup.code}</span> は銘柄マスタにありません
        </p>
      );
    case "error":
      return (
        <p className="text-sm text-destructive-strong" data-testid="listing-lookup-message">
          銘柄を取得できませんでした。時間をおいて再読み込みしてください。
        </p>
      );
  }
}

/**
 * 取り込み状況の画面の「銘柄コードで確認」。1つの入力で、推定上場年数と財務指標のカードを並べる。
 * 値はすべて保存済みデータ（DB のビュー・表）から作る。描画中に例外は投げない。
 */
export function CodeLookupSection({ lookup, progress }: { lookup: CodeLookup; progress: FetchProgress | null }) {
  const defaultValue =
    lookup.kind === "invalid" ? lookup.input : lookup.kind === "not_found" ? lookup.code : lookup.kind === "found" ? lookup.stock.code : "";
  return (
    <section aria-labelledby="lookup-heading" className="space-y-3" data-testid="code-lookup">
      <div className="space-y-1">
        <h2 id="lookup-heading" className="text-sm font-medium">
          銘柄コードで確認
        </h2>
        <p className="text-sm text-muted-foreground">保存済みの推定上場年数と財務指標を、1銘柄ずつ確認できます。</p>
      </div>
      <div className="space-y-3 rounded-lg border bg-card px-4 py-4">
        <CodeLookupForm key={defaultValue} defaultValue={defaultValue} invalid={lookup.kind === "invalid"} />
        <p id="lookup-code-hint" className="text-xs text-muted-foreground">
          4桁のコードは末尾に 0 を付けた5桁として探します（8697 → 86970）。
        </p>
        {lookup.kind !== "none" && lookup.kind !== "found" && <Message lookup={lookup} />}
        {lookup.kind === "found" && (
          <div className="space-y-3" data-testid="lookup-result">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="tabular font-mono text-sm">{lookup.stock.code}</span>
              <h3 className="text-sm font-medium">{lookup.stock.company_name}</h3>
              <span className="text-xs text-muted-foreground">{lookup.stock.market_name ?? "市場区分なし"}</span>
            </div>
            <div className="grid grid-cols-1 gap-3">
              <ListingCard age={lookup.age} />
              {lookup.financial.ok ? (
                <FinancialCard entry={lookup.financial.value} progress={progress} />
              ) : (
                <p className="rounded-lg border bg-card px-4 py-3 text-sm text-destructive-strong" data-testid="financial-card-error">
                  財務指標を取得できませんでした。時間をおいて再読み込みしてください。
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
