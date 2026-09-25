import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { IngestionRemainingNote, IngestionRunningNote } from "@/components/imports/ingestion-notes";
import { PageHeader } from "@/components/page-header";
import { ScreeningView, type NewMarks } from "@/components/screening/screening-view";
import { requireAllowedUser } from "@/lib/auth/guard";
import { fetchDataFreshness, remainingTargets } from "@/lib/ingestion/freshness";
import { fetchActiveRun } from "@/lib/ingestion/history";
import { parseScreeningParams, serializeScreeningParams } from "@/lib/screening/params";
import { fetchScreeningChanges } from "@/lib/screening/change-queries";
import { defaultConditionsFromList } from "@/lib/screening/default-conditions";
import { fetchPresets } from "@/lib/screening/preset-queries";
import { fetchWatchlistItems } from "@/lib/watchlist/queries";
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
  // 既定の条件の解決は1か所（Sprint 14）。リダイレクト先は保存したクエリそのまま
  const redirectQuery = presetsFirst ? defaultConditionsFromList(presetsFirst).redirectQuery : null;
  if (redirectQuery) redirect(`/screening?${redirectQuery}`);

  const { conditions, invalidFields } = parseScreeningParams(raw);
  const [result, options, active, freshness, presets, changes] = await Promise.all([
    runScreening(supabase, conditions, { clampPage: true }),
    fetchFilterOptions(supabase),
    fetchActiveRun(supabase),
    fetchDataFreshness(supabase),
    presetsFirst ?? fetchPresets(supabase),
    fetchScreeningChanges(supabase, conditions),
  ]);
  // Sprint 14: 星（ページの行の登録）と NEW（表示中の条件で新たに該当）。結果の検索とは別の問い合わせ（片方の失敗で表を失わない）
  const watchlist = result.ok ? await fetchWatchlistItems(supabase, result.value.rows.map((row) => row.code)) : ({ ok: true, value: new Map() } as const);
  const newMarks: NewMarks = !changes.ok
    ? { status: "error" }
    : changes.value.status !== "ok"
      ? { status: changes.value.status }
      : {
          status: "ok",
          capturedAt: changes.value.capturedAt,
          count: changes.value.added.length,
          items: Object.fromEntries(
            (result.ok ? result.value.rows : [])
              .map((row) => [row.code, changes.value.added.find((change) => change.code === row.code)?.reasons] as const)
              .filter((entry): entry is readonly [string, NonNullable<(typeof entry)[1]>] => entry[1] !== undefined),
          ),
        };
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
        watchlist={
          watchlist.ok
            ? Object.fromEntries([...watchlist.value].map(([code, item]) => [code, { addedAt: item.created_at, hasMemo: item.memo !== null }]))
            : null
        }
        newMarks={newMarks}
      />
    </div>
  );
}
