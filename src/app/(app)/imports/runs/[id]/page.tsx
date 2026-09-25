import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { RunBreadcrumb, RunDetailView } from "@/components/imports/run-detail-view";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requireAllowedUser } from "@/lib/auth/guard";
import { formatDateTimeJst } from "@/lib/format";
import { fetchRunDetail, parseRunId } from "@/lib/ingestion/run-detail";
import { RUN_TARGET_LABELS } from "@/lib/ingestion/runs";
import { createClient } from "@/lib/supabase/server";

type Props = { params: Promise<{ id: string }> };

const NOT_FOUND_TITLE = "実行が見つかりません";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const id = parseRunId((await params).id);
  if (id === null) return { title: NOT_FOUND_TITLE };
  const result = await fetchRunDetail(await createClient(), id);
  if (!result.ok || result.value === null) return { title: NOT_FOUND_TITLE };
  const { run } = result.value;
  return { title: `実行の詳細（${RUN_TARGET_LABELS[run.target]}・${formatDateTimeJst(run.started_at)}）` };
}

/**
 * 実行の詳細（Sprint 12。AC11.1・AC11.2・AC11.4）。取り込み状況の実行履歴の「開始」の日時から開く。
 * id の形が違う・実行が無ければ notFound()（保護画面の枠の中の 404）。
 */
export default async function RunDetailPage({ params }: Props) {
  await requireAllowedUser();
  const id = parseRunId((await params).id);
  if (id === null) notFound();
  const result = await fetchRunDetail(await createClient(), id);
  if (!result.ok) {
    return (
      <div className="space-y-5">
        <RunBreadcrumb current="実行の詳細" />
        <Alert variant="destructive" className="max-w-2xl">
          <AlertTitle>実行の詳細を取得できませんでした</AlertTitle>
          <AlertDescription>時間をおいて再読み込みしてください。</AlertDescription>
        </Alert>
      </div>
    );
  }
  if (result.value === null) notFound();

  return (
    <div className="space-y-5">
      <RunBreadcrumb current="実行の詳細" />
      <PageHeader title="実行の詳細" description="取り込みの1回の実行の結果、残り、失敗した対象" />
      <RunDetailView detail={result.value} now={new Date()} />
    </div>
  );
}
