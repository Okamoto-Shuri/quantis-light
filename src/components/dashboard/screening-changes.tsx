import { ArrowRight, CircleAlert, CircleMinus, CirclePlus, Loader2, Star } from "lucide-react";
import Link from "next/link";

import { DefaultPresetNote } from "@/components/screening/default-preset-note";
import { fetchActiveRun } from "@/lib/ingestion/history";
import { formatCount } from "@/lib/format";
import { fetchCycleRuns, fetchScreeningChanges } from "@/lib/screening/change-queries";
import {
  changeReasonKey,
  changeReasonText,
  capturedAtText,
  cycleCaption,
  incompleteTargets,
  incompleteTargetsText,
  type StockChange,
} from "@/lib/screening/changes";
import { DEFAULT_PRESET_LOAD_ERROR, defaultConditionsFrom, defaultPresetNote } from "@/lib/screening/default-conditions";
import { fetchDefaultPreset } from "@/lib/screening/preset-queries";
import { presetSummary } from "@/lib/screening/presets";
import type { createClient } from "@/lib/supabase/server";
import { fetchWatchlistItems } from "@/lib/watchlist/queries";
import { cn } from "@/lib/utils";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/** 各一覧に表示する行の上限（それを超える分は「ほか N 銘柄」。API は全件を返す） */
export const CHANGES_DISPLAY_LIMIT = 50;

/**
 * ダッシュボードの「前回の取り込みからの変化」（Sprint 14。AC13.3）。既定の条件（既定のプリセット、無ければ標準の条件）で、
 * 比較の基準の記録（定期実行の日次の取り込みの開始時点）と今のデータを比べた、新たに該当・該当から外れた銘柄。
 * 比較・理由は DB（screening_changes）の値で、ここは表示だけ。読めないときは 0 件として扱わずにエラーを出す。
 */
export async function ScreeningChangesSection({ supabase }: { supabase: SupabaseServerClient }) {
  const dc = defaultConditionsFrom(await fetchDefaultPreset(supabase));
  const [changes, active] = await Promise.all([fetchScreeningChanges(supabase, dc.conditions), fetchActiveRun(supabase)]);
  const codes = changes.ok ? [...changes.value.added, ...changes.value.removed].map((change) => change.code) : [];
  const [watchlist, runs] = await Promise.all([
    fetchWatchlistItems(supabase, codes),
    changes.ok && changes.value.capturedAt ? fetchCycleRuns(supabase, changes.value.capturedAt) : Promise.resolve(null),
  ]);
  const watched = watchlist.ok ? watchlist.value : null;
  const incomplete = runs?.ok ? incompleteTargets(runs.value) : [];
  const running = active.ok && active.activeRun !== null;
  const note = defaultPresetNote(dc, "比較");

  return (
    <section aria-labelledby="changes-heading" className="space-y-3 rounded-lg border bg-card p-4" data-testid="screening-changes">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="changes-heading" className="text-sm font-medium">
          前回の取り込みからの変化
        </h2>
        <Link
          href={`/screening?${dc.query}`}
          className="inline-flex items-center gap-1 rounded-sm text-sm text-signal-strong underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          data-testid="changes-open-screening"
        >
          スクリーニングで開く
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      </div>

      <div className="space-y-1 text-xs text-muted-foreground">
        {changes.ok && changes.value.status !== "no_snapshot" && (
          <p data-testid="changes-cycle">
            {cycleCaption(changes.value)}。その開始時点のデータと、現在のデータを比べています
          </p>
        )}
        <p data-testid="changes-conditions" data-source={dc.source}>
          判定の条件: {dc.source === "preset" ? `既定のプリセット『${dc.presetName}』` : "既定の条件"}
          <span className="block text-[0.7rem]" data-testid="changes-conditions-summary">
            {presetSummary(dc.conditions)}
          </span>
        </p>
      </div>
      {dc.loadError && <DefaultPresetNote note={DEFAULT_PRESET_LOAD_ERROR.replace("判定", "比較")} testId="changes-preset-load-error" />}
      <DefaultPresetNote note={note} />

      {running && (
        <p className="flex items-start gap-2 text-xs text-muted-foreground" data-testid="changes-running-note">
          <Loader2 aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 animate-spin" />
          取り込み中です。一覧は途中の状態です（保存が済んだ銘柄から反映されます）
        </p>
      )}
      {incomplete.length > 0 && (
        <p className="flex flex-wrap items-start gap-x-2 gap-y-0.5 text-xs text-caution-strong" data-testid="changes-incomplete-note">
          <span>
            今回の取り込みで完了していない対象があります（{incompleteTargetsText(incomplete)}）。残りの変化は次回以降の取り込みで反映されます
          </span>
          <Link href="/imports" className="underline underline-offset-2">
            取り込み状況を見る
          </Link>
        </p>
      )}

      {!changes.ok ? (
        <p className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-muted px-3 py-2 text-sm text-destructive-strong" data-testid="changes-error" role="alert">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          新たに該当・外れた銘柄を取得できませんでした。時間をおいて再読み込みしてください
        </p>
      ) : changes.value.status === "no_snapshot" ? (
        <p className="rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground" data-testid="changes-no-snapshot">
          比較の基準がまだありません。毎日 20:00（日本時間）の定期実行が始まると、その時点のデータを記録し、以降の変化をここに表示します
        </p>
      ) : changes.value.status === "empty_snapshot" ? (
        <p className="rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground" data-testid="changes-empty-snapshot">
          前回の取り込みの開始時点（<span className="tabular font-mono">{capturedAtText(changes.value.capturedAt)}</span>
          ）には銘柄データが無かったため、比較できません。次の定期実行から表示します
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <ChangeList
            kind="added"
            title="新たに該当"
            changes={changes.value.added}
            watched={watched}
            moreLink={`/screening?${dc.query}`}
          />
          <ChangeList kind="removed" title="該当から外れた" changes={changes.value.removed} watched={watched} />
        </div>
      )}
    </section>
  );
}

function ChangeList({
  kind,
  title,
  changes,
  watched,
  moreLink,
}: {
  kind: "added" | "removed";
  title: string;
  changes: StockChange[];
  watched: Map<string, unknown> | null;
  moreLink?: string;
}) {
  const shown = changes.slice(0, CHANGES_DISPLAY_LIMIT);
  const rest = changes.length - shown.length;
  const Icon = kind === "added" ? CirclePlus : CircleMinus;
  return (
    <div className="min-w-0 space-y-1.5" data-testid={`changes-${kind}`}>
      <h3 className={cn("flex items-center gap-1.5 text-sm font-medium", kind === "added" ? "text-signal-strong" : "text-muted-foreground")}>
        <Icon aria-hidden="true" className="size-4" />
        {title}
        <span className="tabular font-mono text-foreground" data-testid={`changes-${kind}-count`}>
          {formatCount(changes.length)}
        </span>
        <span className="text-xs font-normal text-muted-foreground">銘柄</span>
      </h3>
      {changes.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground" data-testid="changes-none">
          変化はありません
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {shown.map((change) => (
            <li key={change.code} className="space-y-1 px-3 py-1.5" data-testid="change-row" data-code={change.code} data-change={kind}>
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <Link
                  href={`/stocks/${change.code}`}
                  className="tabular font-mono text-sm text-signal-strong underline-offset-2 hover:underline"
                  data-testid="change-link"
                >
                  {change.code}
                </Link>
                <span className="min-w-0 text-sm break-all">{change.company_name}</span>
                <span className="text-xs text-muted-foreground">{change.market_name ?? "—"}</span>
                {watched?.has(change.code) && (
                  <span className="inline-flex items-center gap-0.5 text-xs text-caution-strong" data-testid="change-watchlisted">
                    <Star aria-hidden="true" className="size-3 fill-caution-strong" />
                    <span className="sr-only">ウォッチリストに登録済み</span>
                  </span>
                )}
              </div>
              <ul className="flex flex-wrap gap-1">
                {change.reasons.map((reason) => (
                  <li
                    key={changeReasonKey(reason)}
                    className="rounded-sm border bg-surface px-1.5 py-px text-[0.7rem] text-foreground"
                    data-testid="change-reason"
                    data-reason={changeReasonKey(reason)}
                  >
                    {changeReasonText(reason)}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {rest > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="changes-more">
          ほか <span className="tabular font-mono">{formatCount(rest)}</span> 銘柄
          {moreLink && (
            <>
              {" "}
              <Link href={moreLink} className="text-signal-strong underline underline-offset-2">
                スクリーニングで NEW を確認できます
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}
