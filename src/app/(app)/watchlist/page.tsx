import { ArrowRight, CircleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { DefaultPresetNote } from "@/components/screening/default-preset-note";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { WatchlistEmpty, WatchlistView, type WatchlistChanges } from "@/components/watchlist/watchlist-view";
import { requireAllowedUser } from "@/lib/auth/guard";
import { fetchReferenceDate } from "@/lib/listing/queries";
import { fetchScreeningChanges } from "@/lib/screening/change-queries";
import { DEFAULT_PRESET_LOAD_ERROR, defaultConditionsFrom, defaultPresetNote } from "@/lib/screening/default-conditions";
import { fetchDefaultPreset } from "@/lib/screening/preset-queries";
import { createClient } from "@/lib/supabase/server";
import { fetchWatchlist } from "@/lib/watchlist/queries";

export const metadata: Metadata = { title: "ウォッチリスト" };

/**
 * ウォッチリスト（Sprint 14。F13・AC13.2）。登録した銘柄の最新の指標、条件④の判定、既定の条件での該当、メモ、追加日。
 * 既定の条件（既定のプリセット、無ければ標準の条件）で判定する。保存済みデータだけを表示し、外部 API は呼ばない。
 * 読めないときは空状態を出さずにエラーを出す。
 */
export default async function WatchlistPage() {
  await requireAllowedUser();
  const supabase = await createClient();
  const dc = defaultConditionsFrom(await fetchDefaultPreset(supabase));
  const [entries, changes, reference] = await Promise.all([
    fetchWatchlist(supabase, dc.conditions),
    fetchScreeningChanges(supabase, dc.conditions),
    fetchReferenceDate(supabase),
  ]);

  let changeMarks: WatchlistChanges = null;
  if (changes.ok && changes.value.status === "ok") {
    changeMarks = {};
    for (const change of changes.value.added) changeMarks[change.code] = { change: "new", reasons: change.reasons };
    for (const change of changes.value.removed) changeMarks[change.code] = { change: "removed", reasons: change.reasons };
  }

  return (
    <div className="space-y-5">
      <PageHeader title="ウォッチリスト" description="登録した銘柄の最新の指標とメモ（既定の条件で判定）" />

      {!entries.ok ? (
        <Alert variant="destructive" data-testid="watchlist-error">
          <AlertTitle>ウォッチリストを読み込めませんでした。時間をおいて再読み込みしてください</AlertTitle>
          <AlertDescription>解消しない場合は、データベースの状態を確認してください。</AlertDescription>
        </Alert>
      ) : entries.value.length === 0 ? (
        <WatchlistEmpty />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="text-xs text-muted-foreground" data-testid="watchlist-conditions" data-source={dc.source}>
              {dc.source === "preset" ? `既定のプリセット『${dc.presetName}』の条件で判定しています` : "既定の条件で判定しています"}
            </p>
            <Link
              href={`/screening?${dc.query}`}
              className="inline-flex items-center gap-1 text-sm text-signal-strong underline-offset-4 hover:underline"
              data-testid="watchlist-open-screening"
            >
              スクリーニングで開く
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </Link>
          </div>
          {dc.loadError && <DefaultPresetNote note={DEFAULT_PRESET_LOAD_ERROR} testId="preset-load-error" />}
          <DefaultPresetNote note={defaultPresetNote(dc)} />
          {!changes.ok && (
            <p className="flex items-center gap-1.5 text-xs text-caution-strong" data-testid="watchlist-change-error">
              <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
              前回の取り込みとの比較を取得できませんでした
            </p>
          )}
          <WatchlistView
            entries={entries.value}
            referenceDate={reference.ok ? reference.value : null}
            ownerMode={dc.conditions.ownerMode}
            ownerThreshold={dc.conditions.owner}
            changes={changeMarks}
          />
        </div>
      )}
    </div>
  );
}
