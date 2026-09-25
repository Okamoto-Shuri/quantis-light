import { TriangleAlert } from "lucide-react";

import { AppLink } from "@/components/shell/app-link";
import { formatDateTimeJst } from "@/lib/format";
import { fetchDataFreshness, type DataFreshness } from "@/lib/ingestion/freshness";
import { RUN_TARGET_LONG_LABELS } from "@/lib/ingestion/runs";
import { createClient } from "@/lib/supabase/server";

import { StaleDataTargets } from "./stale-data-targets";

/**
 * データの鮮度の警告（AC11.3）。ログイン後のすべての画面の上部（ヘッダーの直下）に出す。
 * 判定は DB 関数 data_freshness() の1か所。取得に失敗したら警告を出さずに描画を続ける（ログは fetchDataFreshness が残す）。
 * レイアウトに置くので、クライアント遷移では更新されない（リロード・router.refresh() で更新される）。
 */
export async function StaleDataWarning() {
  let freshness: DataFreshness | null = null;
  try {
    freshness = await fetchDataFreshness(await createClient());
  } catch (error) {
    console.error("[freshness] 鮮度の警告を描画できませんでした", error instanceof Error ? error.message : "不明");
    return null;
  }
  if (!freshness?.stale || !freshness.lastUpdatedAt) return null;
  return <StaleDataWarningView freshness={freshness} />;
}

export function StaleDataWarningView({ freshness }: { freshness: DataFreshness }) {
  const stale = freshness.targets.filter((target) => target.stale && target.lastUpdatedAt);
  return (
    <section
      aria-label="データの鮮度の警告"
      data-testid="stale-data-warning"
      className="border-b border-caution/35 bg-caution-muted text-caution-strong"
    >
      <div className="mx-auto max-w-6xl px-4 py-2 text-sm sm:px-6 [body:has([data-layout=wide])_&]:max-w-7xl">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-0.5">
          <p className="flex min-w-0 items-start gap-1.5 font-medium" data-testid="stale-data-warning-latest">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              データが古くなっています（最終更新:{" "}
              <span className="tabular font-mono">{formatDateTimeJst(freshness.lastUpdatedAt)}</span>）
            </span>
          </p>
          <AppLink
            href="/imports#history"
            className="rounded-sm text-sm underline underline-offset-4 outline-none hover:no-underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            実行履歴を確認
          </AppLink>
        </div>
        <StaleDataTargets count={stale.length}>
          <ul className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
            {stale.map((target) => (
              <li key={target.target} data-testid="stale-data-target" data-target={target.target}>
                {RUN_TARGET_LONG_LABELS[target.target]}{" "}
                <span className="tabular font-mono">{formatDateTimeJst(target.lastUpdatedAt)}</span>
              </li>
            ))}
          </ul>
        </StaleDataTargets>
      </div>
    </section>
  );
}
