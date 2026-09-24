import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { ScreeningView } from "@/components/screening/screening-view";
import { requireAllowedUser } from "@/lib/auth/guard";
import { parseScreeningParams, serializeScreeningParams } from "@/lib/screening/params";
import { fetchFilterOptions, runScreening } from "@/lib/screening/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "スクリーニング" };

/**
 * スクリーニング（条件①〜③）。状態はすべて URL に持ち、この画面は URL から描画する（保存済みデータだけを検索し、外部 API は呼ばない）。
 * 不正な URL の値は、その項目だけ既定値に置き換えて注記する。描画中に例外を投げない。
 */
export default async function ScreeningPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAllowedUser();
  const supabase = await createClient();
  const { conditions, invalidFields } = parseScreeningParams(await searchParams);
  const [result, options] = await Promise.all([
    runScreening(supabase, conditions, { clampPage: true }),
    fetchFilterOptions(supabase),
  ]);
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
      <ScreeningView
        conditions={effective}
        queryKey={serializeScreeningParams(effective)}
        result={result.ok ? result.value : null}
        options={options.ok ? options.value : null}
        invalidFields={invalidFields}
      />
    </div>
  );
}
