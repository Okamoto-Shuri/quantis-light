import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { IngestionRemainingNote, IngestionRunningNote } from "@/components/imports/ingestion-notes";
import { PageHeader } from "@/components/page-header";
import { ScreeningView } from "@/components/screening/screening-view";
import { requireAllowedUser } from "@/lib/auth/guard";
import { fetchDataFreshness, remainingTargets } from "@/lib/ingestion/freshness";
import { fetchActiveRun } from "@/lib/ingestion/history";
import { parseScreeningParams, serializeScreeningParams } from "@/lib/screening/params";
import { fetchPresets } from "@/lib/screening/preset-queries";
import { fetchFilterOptions, runScreening } from "@/lib/screening/queries";
import { hasScreeningParams } from "@/lib/stocks/detail";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "スクリーニング" };

/**
 * スクリーニング（条件①〜③）。状態はすべて URL に持ち、この画面は URL から描画する（保存済みデータだけを検索し、外部 API は呼ばない）。
 * 不正な URL の値は、その項目だけ既定値に置き換えて注記する。描画中に例外を投げない。
 * Sprint 13: 条件のパラメータが1つも無い URL（ナビゲーションの「スクリーニング」など）は、既定のプリセットがあればその条件の URL へ
 * リダイレクトする（URL が状態の正本のまま）。保存したクエリは DB の check で必ず cagr= から始まるので、リダイレクトは1回で終わる。
 * プリセットを読めなければリダイレクトせず、標準の条件で描画して注記する。
 */
export default async function ScreeningPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAllowedUser();
  const supabase = await createClient();
  const raw = await searchParams;
  const bare = !hasScreeningParams(raw);
  // 既定のプリセットの判定が要るのは条件のパラメータの無い URL だけ（ほかは検索と並行して読む）
  const presetsFirst = bare ? await fetchPresets(supabase) : null;
  const defaultPreset = presetsFirst?.ok ? presetsFirst.value.find((preset) => preset.is_default) : undefined;
  if (defaultPreset) redirect(`/screening?${defaultPreset.query}`);

  const { conditions, invalidFields } = parseScreeningParams(raw);
  const [result, options, active, freshness, presets] = await Promise.all([
    runScreening(supabase, conditions, { clampPage: true }),
    fetchFilterOptions(supabase),
    fetchActiveRun(supabase),
    fetchDataFreshness(supabase),
    presetsFirst ?? fetchPresets(supabase),
  ]);
  const activeRun = active.ok ? active.activeRun : null;
  const remaining = remainingTargets(freshness);
  // 最終ページを超えるページは、DB が最終ページに置き換える
  const effective = result.ok ? { ...conditions, page: result.value.page } : conditions;
  const referenceDate = result.ok ? result.value.referenceDate : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="スクリーニング"
        description={
          <>
            保存済みデータから検索します（
            {referenceDate ? (
              <>
                基準日 <span className="tabular font-mono">{referenceDate}</span>
              </>
            ) : (
              "基準日なし（株価の取り込み実績がありません）"
            )}
            。推定上場年数は株価データの初出日からの推定）
          </>
        }
      />
      {(activeRun || remaining.length > 0) && (
        <div className="space-y-2">
          {activeRun && <IngestionRunningNote run={activeRun} />}
          <IngestionRemainingNote remaining={remaining} />
        </div>
      )}
      <ScreeningView
        conditions={effective}
        queryKey={serializeScreeningParams(effective)}
        result={result.ok ? result.value : null}
        options={options.ok ? options.value : null}
        invalidFields={invalidFields}
        presets={presets.ok ? presets.value : null}
        defaultPresetLoadError={bare && !presets.ok}
      />
    </div>
  );
}
