-- Sprint 2: ダッシュボードの集計元（取り込みの実行履歴、財務指標、条件④の判定）
--
-- 方針
-- - いずれも市場データ（または市場データの取り込み状況）なので、public.stocks と同じ権限にする。
--   RLS を有効にし、anon には権限なし。許可リストに入った authenticated だけが select できる。書き込みは service_role のみ。
-- - 列はダッシュボードの集計に必要な最小限だけにする。取り込み・算出・判定の処理を作るスプリント
--   （Sprint 3・5・9）で、マイグレーションにより列を追加する。

-- ---------------------------------------------------------------------------
-- 取り込みの実行履歴
-- ---------------------------------------------------------------------------
create table public.ingestion_runs (
  id bigint generated always as identity primary key,
  target text not null check (target in ('stock_master', 'daily_quotes', 'financials', 'edinet_reports')),
  trigger text not null check (trigger in ('cron', 'manual')),
  status text not null check (status in ('running', 'succeeded', 'partial', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  processed_count integer not null default 0 check (processed_count >= 0),
  error_message text,
  constraint ingestion_runs_finished_matches_status check ((status = 'running') = (finished_at is null)),
  constraint ingestion_runs_finished_after_started check (finished_at is null or finished_at >= started_at)
);

comment on table public.ingestion_runs is '取り込み処理の実行履歴。1回の実行（対象ごと）を1行で記録する。';

create index ingestion_runs_started_at_idx on public.ingestion_runs (started_at desc);
create index ingestion_runs_completed_idx on public.ingestion_runs (finished_at desc)
  where status in ('succeeded', 'partial');

-- ---------------------------------------------------------------------------
-- 銘柄ごとの財務指標（Sprint 5 で算出処理と列を追加する）
-- ---------------------------------------------------------------------------
create table public.financial_metrics (
  code text primary key references public.stocks (code) on delete cascade,
  revenue_cagr numeric,
  revenue_cagr_unavailable_reason text check (revenue_cagr_unavailable_reason <> ''),
  operating_margin numeric,
  operating_margin_unavailable_reason text check (operating_margin_unavailable_reason <> ''),
  calculated_at timestamptz not null default now(),
  -- 値と「算出不可の理由」は、どちらか一方だけを持つ
  constraint financial_metrics_revenue_cagr_xor check ((revenue_cagr is null) <> (revenue_cagr_unavailable_reason is null)),
  constraint financial_metrics_operating_margin_xor check (
    (operating_margin is null) <> (operating_margin_unavailable_reason is null)
  )
);

comment on table public.financial_metrics is '銘柄ごとの財務指標（売上CAGR、営業利益率。比率で保存）と、算出できない場合の理由。';

-- ---------------------------------------------------------------------------
-- 銘柄ごとの条件④の判定（Sprint 9 で判定処理と列を追加する）
-- ---------------------------------------------------------------------------
create table public.ownership_judgments (
  code text primary key references public.stocks (code) on delete cascade,
  status text not null check (status in ('determined', 'undeterminable')),
  judged_at timestamptz not null default now()
);

comment on table public.ownership_judgments is '銘柄ごとの条件④（オーナー企業／社長筆頭株主）の判定。';

-- ---------------------------------------------------------------------------
-- 権限と RLS（public.stocks と同じ）
-- ---------------------------------------------------------------------------
alter table public.ingestion_runs enable row level security;
alter table public.financial_metrics enable row level security;
alter table public.ownership_judgments enable row level security;

revoke all on public.ingestion_runs, public.financial_metrics, public.ownership_judgments
  from public, anon, authenticated;
grant select on public.ingestion_runs, public.financial_metrics, public.ownership_judgments to authenticated;
grant all on public.ingestion_runs, public.financial_metrics, public.ownership_judgments to service_role;

create policy "許可ユーザーのみ参照可" on public.ingestion_runs
  for select to authenticated using ((select public.current_user_is_allowed()));
create policy "許可ユーザーのみ参照可" on public.financial_metrics
  for select to authenticated using ((select public.current_user_is_allowed()));
create policy "許可ユーザーのみ参照可" on public.ownership_judgments
  for select to authenticated using ((select public.current_user_is_allowed()));

-- ---------------------------------------------------------------------------
-- ダッシュボードの集計。呼び出したユーザーの権限で実行する（security invoker。RLS が効く）。
-- 1回の問い合わせで、同じスナップショットから全件数を返す。
-- ---------------------------------------------------------------------------
create function public.dashboard_summary()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'stockCount', (select count(*) from public.stocks),
    'financialMetrics', (
      select jsonb_build_object(
        'anyCount', count(*) filter (where m.revenue_cagr is not null or m.operating_margin is not null),
        'revenueCagrCount', count(*) filter (where m.revenue_cagr is not null),
        'operatingMarginCount', count(*) filter (where m.operating_margin is not null)
      )
      from public.financial_metrics m
    ),
    'ownershipDeterminedCount', (
      select count(*) from public.ownership_judgments j where j.status = 'determined'
    ),
    'lastCompletedRun', (
      select jsonb_build_object('target', r.target, 'status', r.status, 'finishedAt', r.finished_at)
        from public.ingestion_runs r
       where r.status in ('succeeded', 'partial')
       order by r.finished_at desc, r.id desc
       limit 1
    ),
    'latestRun', (
      select jsonb_build_object(
        'target', r.target,
        'status', r.status,
        'startedAt', r.started_at,
        'finishedAt', r.finished_at,
        'errorMessage', r.error_message
      )
        from public.ingestion_runs r
       order by r.started_at desc, r.id desc
       limit 1
    )
  );
$$;

revoke execute on function public.dashboard_summary() from public, anon, authenticated;
grant execute on function public.dashboard_summary() to authenticated, service_role;
