-- Sprint 5: 財務データ（通期の決算短信）と指標（売上CAGR・営業利益率）
--
-- 3層に分ける（契約の第2章の14。算出の定義は各期の値の出典に依存しない）
--   1. 出典ごとの保存   public.financial_statements        決算短信（J-Quants /v2/fins/summary）の通期の開示
--   2. 期の選択         public.financial_periods（ビュー）  銘柄・事業年度の終了日ごとに1行（出典の優先順位 → 新しい書類）
--   3. 算出             public.financial_metrics_from_periods(jsonb)  期の配列だけを受け取る純粋な関数
-- public.recalculate_financial_metrics が 2 から 3 を呼んで public.financial_metrics に保存する。
-- financial_statements を変更すると、同じトランザクションの中でトリガーが再計算する（取り込みでも直接の投入でも同じ経路）。
-- Sprint 9（F15）は、EDINET の期のテーブルを足し、financial_periods の候補に加え、同じ再計算の関数をトリガーから呼ぶ。
--
-- public.financial_fetched_dates        取得済みの開示日（取り込み処理用）
-- public.save_financial_statements      開示日ごとの保存（service_role のみ）
-- public.financials_ingestion_state     取り込みの対象の状態（service_role のみ）
-- public.financial_metrics_summary      取り込み状況の画面の要約（authenticated。security invoker）

-- ---------------------------------------------------------------------------
-- 1. 決算短信の通期の開示
-- ---------------------------------------------------------------------------
create table public.financial_statements (
  code text not null references public.stocks (code) on delete cascade,
  disclosure_no text not null check (disclosure_no <> ''),
  disclosed_date date not null,
  disclosed_time time,
  document_type text not null,
  consolidated boolean generated always as (split_part(document_type, '_', 2) = 'Consolidated') stored,
  accounting_standard text generated always as (split_part(document_type, '_', 3)) stored,
  fiscal_year_start date not null,
  fiscal_year_end date not null,
  net_sales numeric,
  operating_profit numeric,
  run_id bigint references public.ingestion_runs (id) on delete set null,
  fetched_at timestamptz not null default now(),
  primary key (code, disclosure_no),
  -- 通期の決算短信だけ（四半期・その他四半期・業績予想の修正・REIT は入らない）
  constraint financial_statements_annual_document check (
    document_type ~ '^FYFinancialStatements_(Consolidated|NonConsolidated)_(JP|US|IFRS|JMIS|Foreign)$'
  ),
  constraint financial_statements_fiscal_year check (fiscal_year_end > fiscal_year_start)
);

comment on table public.financial_statements is
  '決算短信（J-Quants 財務情報）の通期の開示。訂正は別の開示番号の行として残す。予想・四半期の値を入れる列は無い';
comment on column public.financial_statements.net_sales is '売上高（円。Sales。非連結の短信で空なら NCSales。開示なしは NULL）';
comment on column public.financial_statements.operating_profit is '営業利益（円。OP。非連結の短信で空なら NCOP。開示なしは NULL）';

create index financial_statements_code_fiscal_year_end_idx on public.financial_statements (code, fiscal_year_end desc);

-- ---------------------------------------------------------------------------
-- 取得済みの開示日
-- ---------------------------------------------------------------------------
create table public.financial_fetched_dates (
  disclosure_date date primary key,
  fetched_at timestamptz not null default now(),
  received_count integer not null check (received_count >= 0),
  run_id bigint references public.ingestion_runs (id) on delete set null
);

comment on table public.financial_fetched_dates is
  '財務情報（/v2/fins/summary?date=）を全ページ取得して保存し終えた開示日。行を消すと次の取り込みで取り直す';

-- ---------------------------------------------------------------------------
-- 2. 期の選択（出典の優先順位 → 同じ出典の中で新しい書類）
-- ---------------------------------------------------------------------------
create view public.financial_periods
with (security_invoker = true)
as
with candidates as (
  -- 出典: 決算短信（優先順位 1）。Sprint 9 で EDINET（有報 = 2、届出書 = 3）の候補を union all で加える
  select s.code,
         'tdnet_summary'::text as source,
         1 as source_priority,
         s.disclosure_no as source_document_id,
         s.disclosed_date as source_document_date,
         s.disclosed_time as source_document_time,
         s.document_type,
         s.consolidated,
         s.accounting_standard,
         s.fiscal_year_start,
         s.fiscal_year_end,
         s.net_sales,
         s.operating_profit
    from public.financial_statements s
),
ranked as (
  select c.*,
         row_number() over (
           partition by c.code, c.fiscal_year_end
           order by c.source_priority, c.source_document_date desc, c.source_document_time desc nulls last,
                    c.source_document_id desc
         ) as rn,
         count(*) over (partition by c.code, c.fiscal_year_end, c.source) as same_source_count,
         -- 訂正の開示で一部の項目が空欄になることがある（実データで確認）。項目ごとに、同じ出典・同じ期の開示のうち
         -- 値のある最新のものを使う
         first_value(c.net_sales) over (
           partition by c.code, c.fiscal_year_end, c.source
           order by c.net_sales is null, c.source_document_date desc, c.source_document_time desc nulls last,
                    c.source_document_id desc
         ) as filled_net_sales,
         first_value(c.operating_profit) over (
           partition by c.code, c.fiscal_year_end, c.source
           order by c.operating_profit is null, c.source_document_date desc, c.source_document_time desc nulls last,
                    c.source_document_id desc
         ) as filled_operating_profit
    from candidates c
)
select r.code,
       r.fiscal_year_start,
       r.fiscal_year_end,
       (r.fiscal_year_end - r.fiscal_year_start + 1) as period_days,
       round((r.fiscal_year_end - r.fiscal_year_start + 1) / 30.4375)::integer as period_months,
       not ((r.fiscal_year_end - r.fiscal_year_start + 1) between 358 and 371) as is_irregular,
       r.filled_net_sales as net_sales,
       r.filled_operating_profit as operating_profit,
       r.consolidated,
       r.accounting_standard,
       r.document_type,
       r.source,
       r.source_priority,
       r.source_document_id,
       r.source_document_date,
       case when r.source = 'tdnet_summary' then r.source_document_id end as disclosure_no,
       case when r.source = 'tdnet_summary' then r.source_document_date end as disclosed_date,
       r.same_source_count::integer as disclosure_count
  from ranked r
 where r.rn = 1;

comment on view public.financial_periods is
  '銘柄・事業年度の終了日ごとの通期実績（出典の優先順位 → 同じ出典の中で新しい書類の1行）。売上高・営業利益は、同じ出典・同じ期の開示のうち値のある最新のもの（訂正で空欄になる項目があるため）。is_irregular は 358〜371 日の外（変則決算）';

revoke all on public.financial_periods from public, anon, authenticated;
grant select on public.financial_periods to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. 算出（純粋な関数。データを読まない）
-- ---------------------------------------------------------------------------
/**
 * 期の配列（jsonb の配列。各要素の fiscal_year_start, fiscal_year_end, net_sales, operating_profit, consolidated,
 * accounting_standard だけを読み、ほかの項目（出典など）は無視する）から指標を返す。期は事業年度の終了日で一意とする。
 *
 * 売上CAGR: FY0（終了日が最も新しい期）から連続する期を最大5期さかのぼり（新しい期の開始日の前日 = 1つ古い期の終了日）、
 *   次の順に最初に当てはまった理由で算出不可にする。どれでもなければ (FY0/FY-4)^(1/4) - 1 を小数点以下10桁に丸める。
 *   1 irregular_period         対象の期に変則決算（358〜371 日の外）がある
 *   2 insufficient_periods     対象の期が5期未満で、途切れた先に古い期が無い
 *   3 non_consecutive_periods  対象の期が5期未満で、途切れた先に古い期がある（欠けている・重なっている）
 *   4 revenue_not_disclosed    対象の5期のどれかで売上高が NULL
 *   5 base_revenue_not_positive FY-4 の売上高が0以下
 *   6 latest_revenue_negative  FY0 の売上高が負
 * 営業利益率: FY0 だけで算出する。operating_profit_not_disclosed → revenue_not_disclosed → revenue_not_positive の順。
 */
create function public.financial_metrics_from_periods(p_periods jsonb)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_starts date[];
  v_ends date[];
  v_sales numeric[];
  v_ops numeric[];
  v_cons boolean[];
  v_std text[];
  n integer;
  chain integer := 1;
  broke_with_older boolean := false;
  i integer;
  v_cagr numeric;
  v_cagr_reason text;
  v_mixed boolean;
  v_margin numeric;
  v_margin_reason text;
begin
  select array_agg(e.fiscal_year_start order by e.fiscal_year_end desc),
         array_agg(e.fiscal_year_end order by e.fiscal_year_end desc),
         array_agg(e.net_sales order by e.fiscal_year_end desc),
         array_agg(e.operating_profit order by e.fiscal_year_end desc),
         array_agg(e.consolidated order by e.fiscal_year_end desc),
         array_agg(e.accounting_standard order by e.fiscal_year_end desc)
    into v_starts, v_ends, v_sales, v_ops, v_cons, v_std
    from jsonb_to_recordset(coalesce(p_periods, '[]'::jsonb)) as e(
      fiscal_year_start date, fiscal_year_end date, net_sales numeric, operating_profit numeric,
      consolidated boolean, accounting_standard text
    );

  n := coalesce(array_length(v_ends, 1), 0);
  if n = 0 then
    return null;
  end if;

  -- FY0 から連続する期（最大5期）
  while chain < 5 and chain < n loop
    if v_ends[chain + 1] = v_starts[chain] - 1 then
      chain := chain + 1;
    else
      broke_with_older := true;
      exit;
    end if;
  end loop;

  -- 売上CAGR
  for i in 1..chain loop
    if not ((v_ends[i] - v_starts[i] + 1) between 358 and 371) then
      v_cagr_reason := 'irregular_period';
      exit;
    end if;
  end loop;
  if v_cagr_reason is null and chain < 5 then
    v_cagr_reason := case when broke_with_older then 'non_consecutive_periods' else 'insufficient_periods' end;
  end if;
  if v_cagr_reason is null then
    for i in 1..5 loop
      if v_sales[i] is null then
        v_cagr_reason := 'revenue_not_disclosed';
        exit;
      end if;
    end loop;
  end if;
  if v_cagr_reason is null and v_sales[5] <= 0 then
    v_cagr_reason := 'base_revenue_not_positive';
  end if;
  if v_cagr_reason is null and v_sales[1] < 0 then
    v_cagr_reason := 'latest_revenue_negative';
  end if;
  if v_cagr_reason is null then
    v_cagr := round(power(v_sales[1] / v_sales[5], 0.25::numeric) - 1, 10);
    v_mixed := (select count(distinct c) > 1 from unnest(v_cons[1:5]) as c)
            or (select count(distinct s) > 1 from unnest(v_std[1:5]) as s);
  end if;

  -- 営業利益率（FY0）
  if v_ops[1] is null then
    v_margin_reason := 'operating_profit_not_disclosed';
  elsif v_sales[1] is null then
    v_margin_reason := 'revenue_not_disclosed';
  elsif v_sales[1] <= 0 then
    v_margin_reason := 'revenue_not_positive';
  else
    v_margin := round(v_ops[1] / v_sales[1], 10);
  end if;

  return jsonb_build_object(
    'revenue_cagr', v_cagr,
    'revenue_cagr_unavailable_reason', v_cagr_reason,
    'revenue_cagr_base_fiscal_year_end', case when v_cagr_reason is null then v_ends[5] end,
    'revenue_cagr_period_count', chain,
    'revenue_cagr_mixed_basis', v_mixed,
    'operating_margin', v_margin,
    'operating_margin_unavailable_reason', v_margin_reason,
    'latest_fiscal_year_end', v_ends[1],
    'annual_period_count', n
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 指標の表（Sprint 2 の表を拡張する）
-- ---------------------------------------------------------------------------
alter table public.financial_metrics
  add column revenue_cagr_display_pct numeric(16, 1)
    generated always as ((floor(revenue_cagr * 1000) / 10)::numeric(16, 1)) stored,
  add column revenue_cagr_base_fiscal_year_end date,
  add column revenue_cagr_period_count integer not null default 0
    check (revenue_cagr_period_count between 0 and 5),
  add column revenue_cagr_mixed_basis boolean,
  add column operating_margin_display_pct numeric(16, 1)
    generated always as ((floor(operating_margin * 1000) / 10)::numeric(16, 1)) stored,
  add column latest_fiscal_year_end date not null,
  add column annual_period_count integer not null default 0 check (annual_period_count >= 0),
  add constraint financial_metrics_revenue_cagr_reason check (
    revenue_cagr_unavailable_reason in (
      'irregular_period', 'insufficient_periods', 'non_consecutive_periods',
      'revenue_not_disclosed', 'base_revenue_not_positive', 'latest_revenue_negative'
    )
  ),
  add constraint financial_metrics_operating_margin_reason check (
    operating_margin_unavailable_reason in ('operating_profit_not_disclosed', 'revenue_not_disclosed', 'revenue_not_positive')
  );

comment on table public.financial_metrics is
  '銘柄ごとの財務指標（比率。小数点以下10桁）と算出不可の理由コード。financial_statements の変更でトリガーが再計算する（直接書き換えない）。'
  '表示は *_display_pct（百分率の小数点以下1桁に切り捨て）、絞り込み・並べ替えは revenue_cagr・operating_margin を使う';

create index financial_metrics_revenue_cagr_idx on public.financial_metrics (revenue_cagr) where revenue_cagr is not null;
create index financial_metrics_operating_margin_idx on public.financial_metrics (operating_margin)
  where operating_margin is not null;

-- ---------------------------------------------------------------------------
-- 再計算（financial_periods から期を集めて算出の核を呼ぶ）
-- ---------------------------------------------------------------------------
create function public.recalculate_financial_metrics(p_codes text[])
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- 通期実績が1件も無くなった銘柄の行は消す
  delete from public.financial_metrics m
   where m.code = any(p_codes)
     and not exists (select 1 from public.financial_periods p where p.code = m.code);

  insert into public.financial_metrics as m (
    code, revenue_cagr, revenue_cagr_unavailable_reason, revenue_cagr_base_fiscal_year_end, revenue_cagr_period_count,
    revenue_cagr_mixed_basis, operating_margin, operating_margin_unavailable_reason, latest_fiscal_year_end,
    annual_period_count, calculated_at
  )
  select g.code,
         (g.r ->> 'revenue_cagr')::numeric,
         g.r ->> 'revenue_cagr_unavailable_reason',
         (g.r ->> 'revenue_cagr_base_fiscal_year_end')::date,
         (g.r ->> 'revenue_cagr_period_count')::integer,
         (g.r ->> 'revenue_cagr_mixed_basis')::boolean,
         (g.r ->> 'operating_margin')::numeric,
         g.r ->> 'operating_margin_unavailable_reason',
         (g.r ->> 'latest_fiscal_year_end')::date,
         (g.r ->> 'annual_period_count')::integer,
         now()
    from (
      select p.code,
             public.financial_metrics_from_periods(
               jsonb_agg(jsonb_build_object(
                 'fiscal_year_start', p.fiscal_year_start,
                 'fiscal_year_end', p.fiscal_year_end,
                 'net_sales', p.net_sales,
                 'operating_profit', p.operating_profit,
                 'consolidated', p.consolidated,
                 'accounting_standard', p.accounting_standard
               ))
             ) as r
        from public.financial_periods p
       where p.code = any(p_codes)
         and exists (select 1 from public.stocks s where s.code = p.code)
       group by p.code
    ) g
  on conflict (code) do update
     set revenue_cagr = excluded.revenue_cagr,
         revenue_cagr_unavailable_reason = excluded.revenue_cagr_unavailable_reason,
         revenue_cagr_base_fiscal_year_end = excluded.revenue_cagr_base_fiscal_year_end,
         revenue_cagr_period_count = excluded.revenue_cagr_period_count,
         revenue_cagr_mixed_basis = excluded.revenue_cagr_mixed_basis,
         operating_margin = excluded.operating_margin,
         operating_margin_unavailable_reason = excluded.operating_margin_unavailable_reason,
         latest_fiscal_year_end = excluded.latest_fiscal_year_end,
         annual_period_count = excluded.annual_period_count,
         calculated_at = excluded.calculated_at;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

/** financial_statements の変更（投入・更新・削除。stocks の削除による連鎖を含む）で、変更された銘柄の指標を再計算する。 */
create function public.financial_statements_recalculate()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.recalculate_financial_metrics(array(select distinct n.code from new_rows n));
  elsif tg_op = 'UPDATE' then
    perform public.recalculate_financial_metrics(
      array(select n.code from new_rows n union select o.code from old_rows o)
    );
  else
    perform public.recalculate_financial_metrics(array(select distinct o.code from old_rows o));
  end if;
  return null;
end;
$$;

create trigger financial_statements_recalculate_insert
  after insert on public.financial_statements
  referencing new table as new_rows
  for each statement execute function public.financial_statements_recalculate();
create trigger financial_statements_recalculate_update
  after update on public.financial_statements
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.financial_statements_recalculate();
create trigger financial_statements_recalculate_delete
  after delete on public.financial_statements
  referencing old table as old_rows
  for each statement execute function public.financial_statements_recalculate();

-- ---------------------------------------------------------------------------
-- 取り込み処理用（service_role のみ）
-- ---------------------------------------------------------------------------
/** 銘柄マスタの件数と、期間の中の取得済みの開示日。行数の上限（max_rows）を受けないよう jsonb で返す。 */
create function public.financials_ingestion_state(p_from date, p_to date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'stockCount', (select count(*) from public.stocks),
    'fetchedDates', coalesce(
      (select jsonb_agg(d.disclosure_date order by d.disclosure_date)
         from public.financial_fetched_dates d
        where d.disclosure_date between p_from and p_to),
      '[]'::jsonb
    )
  );
$$;

/**
 * 1つの開示日の通期の開示を保存し、その開示日を取得済みにする（1つのトランザクション）。
 * 実行が「実行中」のときだけ保存する。銘柄マスタに無いコードは保存しない。
 * 同じ（銘柄コード、開示番号）の行は、値が違うときだけ上書きする。追加と上書きの行数を実行の processed_count に足す。
 */
create function public.save_financial_statements(
  p_run_id bigint,
  p_disclosure_date date,
  p_rows jsonb,
  p_received_count integer
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_saved integer;
  v_known integer;
  v_total integer;
begin
  select status into v_status from public.ingestion_runs where id = p_run_id for update;
  if v_status is distinct from 'running' then
    return jsonb_build_object('saved', false);
  end if;

  with input as (
    select distinct on (r.code, r.disclosure_no) r.*
      from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
        code text, disclosure_no text, disclosed_date date, disclosed_time time, document_type text,
        fiscal_year_start date, fiscal_year_end date, net_sales numeric, operating_profit numeric
      )
     order by r.code, r.disclosure_no
  ),
  known as (
    select i.* from input i where exists (select 1 from public.stocks s where s.code = i.code)
  ),
  upserted as (
    insert into public.financial_statements as f (
      code, disclosure_no, disclosed_date, disclosed_time, document_type, fiscal_year_start, fiscal_year_end,
      net_sales, operating_profit, run_id
    )
    select k.code, k.disclosure_no, k.disclosed_date, k.disclosed_time, k.document_type, k.fiscal_year_start,
           k.fiscal_year_end, k.net_sales, k.operating_profit, p_run_id
      from known k
    on conflict (code, disclosure_no) do update
       set disclosed_date = excluded.disclosed_date,
           disclosed_time = excluded.disclosed_time,
           document_type = excluded.document_type,
           fiscal_year_start = excluded.fiscal_year_start,
           fiscal_year_end = excluded.fiscal_year_end,
           net_sales = excluded.net_sales,
           operating_profit = excluded.operating_profit,
           run_id = excluded.run_id,
           fetched_at = now()
     where (f.disclosed_date, f.disclosed_time, f.document_type, f.fiscal_year_start, f.fiscal_year_end, f.net_sales,
            f.operating_profit)
           is distinct from
           (excluded.disclosed_date, excluded.disclosed_time, excluded.document_type, excluded.fiscal_year_start,
            excluded.fiscal_year_end, excluded.net_sales, excluded.operating_profit)
    returning 1
  )
  select (select count(*) from input), (select count(*) from known), (select count(*) from upserted)
    into v_total, v_known, v_saved;

  insert into public.financial_fetched_dates (disclosure_date, fetched_at, received_count, run_id)
  values (p_disclosure_date, now(), greatest(coalesce(p_received_count, 0), 0), p_run_id)
  on conflict (disclosure_date) do update
     set fetched_at = excluded.fetched_at,
         received_count = excluded.received_count,
         run_id = excluded.run_id;

  update public.ingestion_runs
     set processed_count = processed_count + v_saved
   where id = p_run_id;

  return jsonb_build_object('saved', true, 'savedCount', v_saved, 'unknownCodeCount', v_total - v_known);
end;
$$;

-- ---------------------------------------------------------------------------
-- 取り込み状況の画面の要約（authenticated。security invoker で RLS が効く）
-- ---------------------------------------------------------------------------
create function public.financial_metrics_summary()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'stockCount', (select count(*) from public.stocks),
    'withStatementsCount', (select count(*) from public.financial_metrics),
    'revenueCagrCount', (select count(*) from public.financial_metrics m where m.revenue_cagr is not null),
    'operatingMarginCount', (select count(*) from public.financial_metrics m where m.operating_margin is not null),
    'latestDisclosedDate', (select max(s.disclosed_date) from public.financial_statements s),
    'revenueCagrReasons', coalesce((
      select jsonb_object_agg(x.reason, x.n)
        from (select m.revenue_cagr_unavailable_reason as reason, count(*) as n
                from public.financial_metrics m
               where m.revenue_cagr_unavailable_reason is not null
               group by 1) x
    ), '{}'::jsonb),
    'operatingMarginReasons', coalesce((
      select jsonb_object_agg(x.reason, x.n)
        from (select m.operating_margin_unavailable_reason as reason, count(*) as n
                from public.financial_metrics m
               where m.operating_margin_unavailable_reason is not null
               group by 1) x
    ), '{}'::jsonb),
    'lastRun', (
      select jsonb_build_object(
        'finishedAt', r.finished_at,
        'windowStart', r.details ->> 'windowStart',
        'windowEnd', r.details ->> 'windowEnd',
        'datesInWindow', r.details -> 'datesInWindow',
        'datesRemaining', r.details -> 'datesRemaining'
      )
        from public.ingestion_runs r
       where r.target = 'financials' and r.status in ('succeeded', 'partial')
       order by r.finished_at desc, r.id desc
       limit 1
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- 権限と RLS（public.stocks と同じ方針）
-- ---------------------------------------------------------------------------
alter table public.financial_statements enable row level security;
alter table public.financial_fetched_dates enable row level security;

revoke all on public.financial_statements, public.financial_fetched_dates from public, anon, authenticated;
grant select on public.financial_statements to authenticated;
grant all on public.financial_statements, public.financial_fetched_dates to service_role;

create policy "許可ユーザーのみ参照可" on public.financial_statements
  for select to authenticated using ((select public.current_user_is_allowed()));

revoke execute on function public.financial_metrics_from_periods(jsonb) from public, anon, authenticated;
revoke execute on function public.recalculate_financial_metrics(text[]) from public, anon, authenticated;
revoke execute on function public.financial_statements_recalculate() from public, anon, authenticated;
revoke execute on function public.financials_ingestion_state(date, date) from public, anon, authenticated;
revoke execute on function public.save_financial_statements(bigint, date, jsonb, integer) from public, anon, authenticated;
revoke execute on function public.financial_metrics_summary() from public, anon, authenticated;

grant execute on function public.financial_metrics_from_periods(jsonb) to service_role;
grant execute on function public.recalculate_financial_metrics(text[]) to service_role;
grant execute on function public.financial_statements_recalculate() to service_role;
grant execute on function public.financials_ingestion_state(date, date) to service_role;
grant execute on function public.save_financial_statements(bigint, date, jsonb, integer) to service_role;
grant execute on function public.financial_metrics_summary() to authenticated, service_role;

-- 既存の行を計算し直す（通常は0件）
select public.recalculate_financial_metrics(array(select distinct code from public.financial_statements));
