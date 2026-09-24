-- Sprint 4: 株価の初出日と推定上場年数
--
-- public.stock_listing_dates   銘柄ごとの株価データの初出日と、そのときのデータ期間の開始日
-- public.listing_years_between 暦の年で数えた年数（整数部分・正確な値・小数1桁の切り上げ）
-- public.listing_reference_date 基準日（ビュー）
-- public.stock_listing_ages    推定上場年数（ビュー。security_invoker で RLS がそのまま効く）
-- public.listing_dates_pending 初出日が未確定の銘柄（取り込み処理用。service_role のみ）
-- public.save_stock_listing_dates 初出日の一括保存（取り込み処理用。service_role のみ）

create table public.stock_listing_dates (
  code text primary key references public.stocks (code) on delete cascade,
  first_price_date date not null,
  data_start_date date not null,
  determined_at timestamptz not null default now(),
  run_id bigint references public.ingestion_runs (id) on delete set null,
  constraint stock_listing_dates_first_after_start check (first_price_date >= data_start_date)
);

comment on table public.stock_listing_dates is
  '株価データ（J-Quants の株価四本値）の初出日。一度確定した行は取り込みで更新しない。first_price_date = data_start_date は「データ期間開始以前から上場」';
comment on column public.stock_listing_dates.first_price_date is '株価データの初出日（J-Quants の株価四本値に最初に現れた日）';
comment on column public.stock_listing_dates.data_start_date is '初出日を確定したときの、取得可能なデータ期間の開始日（最初の取引日）';

alter table public.stock_listing_dates enable row level security;
revoke all on public.stock_listing_dates from public, anon, authenticated;
grant select on public.stock_listing_dates to authenticated;
grant all on public.stock_listing_dates to service_role;

create policy "許可ユーザーのみ参照可" on public.stock_listing_dates
  for select to authenticated using ((select public.current_user_is_allowed()));

create index stock_listing_dates_first_price_date_idx on public.stock_listing_dates (first_price_date desc, code);

-- 基準日（最新の株価の取り込み日）の検索用
create index ingestion_runs_daily_quotes_completed_idx on public.ingestion_runs (finished_at desc)
  where target = 'daily_quotes' and status in ('succeeded', 'partial');

/**
 * p_from から p_to までの年数を、暦の年で数える。
 *   whole_years      : p_from + n 年 <= p_to となる最大の n（2月29日 + 1年 = 2月28日。Postgres の date + interval と同じ）
 *   exact_years      : n + d / L（d = p_to - (p_from + n 年)、L = (p_from + (n+1) 年) - (p_from + n 年)。numeric）
 *   rounded_up_years : 小数点以下1桁に切り上げた値。整数演算 ceil(10d / L) で求める（浮動小数点を使わない）
 * p_from >= p_to は 0。どちらかが NULL なら行を返さない。
 */
create function public.listing_years_between(p_from date, p_to date)
returns table (whole_years integer, exact_years numeric, rounded_up_years numeric)
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  n integer;
  anniversary date;
  next_anniversary date;
  d integer;
  l integer;
begin
  if p_from is null or p_to is null then
    return;
  end if;
  if p_from >= p_to then
    whole_years := 0;
    exact_years := 0;
    rounded_up_years := 0.0;
    return next;
    return;
  end if;

  n := extract(year from p_to)::integer - extract(year from p_from)::integer;
  if (p_from + make_interval(years => n))::date > p_to then
    n := n - 1;
  end if;
  anniversary := (p_from + make_interval(years => n))::date;
  next_anniversary := (p_from + make_interval(years => n + 1))::date;
  d := p_to - anniversary;
  l := next_anniversary - anniversary;

  whole_years := n;
  exact_years := n + d::numeric / l;
  rounded_up_years := (n + ((10 * d + l - 1) / l)::numeric / 10)::numeric(8, 1);
  return next;
end;
$$;

revoke execute on function public.listing_years_between(date, date) from public, anon, authenticated;
grant execute on function public.listing_years_between(date, date) to authenticated, service_role;

/** 基準日（最新の株価の取り込み日）: daily_quotes の成功・一部失敗の実行のうち、最新の終了日時の日本時間の日付。常に1行。 */
create view public.listing_reference_date
with (security_invoker = true)
as
select (max(r.finished_at) at time zone 'Asia/Tokyo')::date as reference_date
  from public.ingestion_runs r
 where r.target = 'daily_quotes'
   and r.status in ('succeeded', 'partial');

revoke all on public.listing_reference_date from public, anon, authenticated;
grant select on public.listing_reference_date to authenticated, service_role;

/**
 * 推定上場年数。行が無い・基準日が無い・データ期間開始以前の銘柄は、年数を NULL にする。
 */
create view public.stock_listing_ages
with (security_invoker = true)
as
select
  s.code,
  d.first_price_date,
  d.data_start_date,
  ref.reference_date,
  case when d.code is null then null else d.first_price_date = d.data_start_date end as listed_before_data_start,
  case when d.first_price_date > d.data_start_date then y.exact_years end as listing_years_exact,
  case when d.first_price_date > d.data_start_date then y.rounded_up_years end as estimated_listing_years,
  case when d.first_price_date = d.data_start_date then b.whole_years end as listing_years_lower_bound
from public.stocks s
cross join public.listing_reference_date ref
left join public.stock_listing_dates d on d.code = s.code
left join lateral public.listing_years_between(d.first_price_date, ref.reference_date) y on true
left join lateral public.listing_years_between(d.data_start_date, ref.reference_date) b on true;

comment on view public.stock_listing_ages is
  '銘柄ごとの推定上場年数（株価データの初出日から基準日まで）。表示は estimated_listing_years（小数1桁の切り上げ）、絞り込み・並べ替えは listing_years_exact を使う';

revoke all on public.stock_listing_ages from public, anon, authenticated;
grant select on public.stock_listing_ages to authenticated, service_role;

/** 初出日が未確定の銘柄のコード（コード順）と、銘柄マスタの件数。行数の上限（max_rows）を受けないよう jsonb で返す。 */
create function public.listing_dates_pending()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'stockCount', (select count(*) from public.stocks),
    'pending', coalesce(
      (select jsonb_agg(s.code order by s.code)
         from public.stocks s
        where not exists (select 1 from public.stock_listing_dates d where d.code = s.code)),
      '[]'::jsonb
    )
  );
$$;

/**
 * 初出日を保存する。実行が「実行中」のときだけ、既存の行は変えずに（on conflict do nothing）追加し、
 * その実行の processed_count に追加した行数を足す。銘柄マスタに無いコードは保存しない。
 */
create function public.save_stock_listing_dates(p_run_id bigint, p_rows jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_count integer;
begin
  select status into v_status from public.ingestion_runs where id = p_run_id for update;
  if v_status is distinct from 'running' then
    return jsonb_build_object('saved', false);
  end if;

  insert into public.stock_listing_dates (code, first_price_date, data_start_date, run_id)
  select r.code, r.first_price_date, r.data_start_date, p_run_id
    from jsonb_to_recordset(p_rows) as r(code text, first_price_date date, data_start_date date)
   where exists (select 1 from public.stocks s where s.code = r.code)
  on conflict (code) do nothing;

  get diagnostics v_count = row_count;

  update public.ingestion_runs
     set processed_count = processed_count + v_count
   where id = p_run_id;

  return jsonb_build_object('saved', true, 'insertedCount', v_count);
end;
$$;

revoke execute on function public.listing_dates_pending() from public, anon, authenticated;
revoke execute on function public.save_stock_listing_dates(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.listing_dates_pending() to service_role;
grant execute on function public.save_stock_listing_dates(bigint, jsonb) to service_role;

/**
 * 実行の終了（Sprint 3 の関数を置き換える）。p_processed_count が NULL なら、処理件数を変えない。
 * 株価の取り込みは保存のたびに processed_count を足すので、予期しない例外で終えるときに件数を 0 に戻さないため。
 */
create or replace function public.finish_ingestion_run(
  p_run_id bigint,
  p_status text,
  p_processed_count integer,
  p_error_message text,
  p_details jsonb
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if p_status not in ('succeeded', 'partial', 'failed') then
    raise exception 'finish_ingestion_run: invalid status %', p_status using errcode = '22023';
  end if;

  update public.ingestion_runs
     set status = p_status,
         finished_at = greatest(now(), started_at),
         processed_count = coalesce(p_processed_count, processed_count),
         error_message = p_error_message,
         details = coalesce(p_details, details)
   where id = p_run_id
     and status = 'running';
  return found;
end;
$$;

revoke execute on function public.finish_ingestion_run(bigint, text, integer, text, jsonb) from public, anon, authenticated;
grant execute on function public.finish_ingestion_run(bigint, text, integer, text, jsonb) to service_role;
