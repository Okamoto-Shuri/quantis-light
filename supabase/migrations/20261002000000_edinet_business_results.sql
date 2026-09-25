-- Sprint 9: EDINET による上場前の期の補完（F15）
--
-- 有報・届出書の「主要な経営指標等の推移」から読み取った各期の売上高・営業利益を保存し、
-- 決算短信に無い期を financial_periods の候補に加える（出典の優先順位: 決算短信 1 → 有報 2 → 届出書 3）。
-- 算出の定義（financial_metrics_from_periods）は出典を読まない。補完の情報（補った期・出典）は再計算の中で求める。
--
-- public.edinet_filers                  提出者（EDINET コード）と証券コードの対応（証券コードの無い届出書を銘柄に結び付ける）
-- public.business_results_extractions   書類ごとの主要な経営指標等の抽出の結果（＝この処理の処理済みの記録）
-- public.business_results_periods       書類の期の値（連結・単体ごと）
-- public.edinet_document_codes          書類ごとの銘柄コード（ビュー。結び付けの1か所）
-- public.financial_periods              EDINET の期を加えて作り直す（既存の列は変えない。列を末尾に足す）
-- 再計算のトリガー                        financial_periods の結果が変わりうる変更のすべて（契約の第2章の8）

-- ---------------------------------------------------------------------------
-- 1. テーブル
-- ---------------------------------------------------------------------------
create table public.edinet_filers (
  edinet_code text primary key check (edinet_code <> ''),
  sec_code text not null check (sec_code ~ '^[0-9A-Z]{5}$'),
  filer_name text,
  seen_submitted_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.edinet_filers is
  '提出者（EDINET コード）と証券コードの対応。書類一覧のすべての行（種類を問わない）のうち、EDINET コードと証券コードのある行から作る。'
  '同じ EDINET コードは提出日時の新しい行の値。証券コードの無い届出書（新規公開時）を、上場後の書類で銘柄に結び付けるために使う';

create index edinet_filers_sec_code_idx on public.edinet_filers (sec_code);

create table public.business_results_extractions (
  doc_id text primary key references public.edinet_documents (doc_id) on delete cascade,
  processed_at timestamptz not null default now(),
  status text not null check (status in ('ok', 'no_xbrl', 'section_not_found', 'invalid_values')),
  detail text,
  period_count integer not null default 0 check (period_count >= 0),
  run_id bigint references public.ingestion_runs (id) on delete set null
);

comment on table public.business_results_extractions is
  '書類ごとの「主要な経営指標等の推移」の抽出の結果（処理済みの記録）。行を消すと、次の取り込みでその書類を取り直す（期の行も連鎖して消える）';

create table public.business_results_periods (
  doc_id text not null references public.business_results_extractions (doc_id) on delete cascade,
  fiscal_year_start date not null,
  fiscal_year_end date not null,
  consolidated boolean not null,
  accounting_standard text not null check (accounting_standard in ('JP', 'IFRS', 'US', 'JMIS')),
  net_sales numeric,
  operating_profit numeric,
  revenue_element text,
  operating_profit_element text,
  primary key (doc_id, fiscal_year_end, consolidated),
  constraint business_results_periods_fiscal_year check (fiscal_year_end > fiscal_year_start)
);

comment on table public.business_results_periods is
  '書類の「主要な経営指標等の推移」の期の値（円）。期の開始日・終了日は事実のコンテキストの期間から取る（書類一覧の期間は使わない）。'
  'consolidated = false は提出会社（単体）。NULL は書類に記載なし';

-- ---------------------------------------------------------------------------
-- 2. 書類と銘柄の結び付け（1か所）
-- ---------------------------------------------------------------------------
-- 2つの枝の union all にする（銘柄コードの条件を、それぞれの枝の索引（sec_code・edinet_filers.sec_code）に渡せるように）
create view public.edinet_document_codes
with (security_invoker = true)
as
select d.doc_id, d.sec_code as code
  from public.edinet_documents d
 where d.sec_code is not null
   and exists (select 1 from public.stocks s where s.code = d.sec_code)
union all
select d.doc_id, f.sec_code as code
  from public.edinet_documents d
  join public.edinet_filers f on f.edinet_code = d.edinet_code
 where d.sec_code is null
   and exists (select 1 from public.stocks s where s.code = f.sec_code);

comment on view public.edinet_document_codes is
  '書類ごとの銘柄コード（書類の証券コード、無ければ提出者の証券コード）。銘柄マスタにある銘柄だけ。社名では結び付けない';

-- ---------------------------------------------------------------------------
-- 3. 期の選択（EDINET の期を候補に加える）
-- ---------------------------------------------------------------------------
create or replace view public.financial_periods
with (security_invoker = true)
as
with edinet_rows as (
  -- 同じ書類・同じ期の連結と単体から1つ（連結の売上高 → 単体の売上高 → 連結 → 単体）
  select c.code, p.doc_id, d.doc_type_code, d.submitted_at, p.fiscal_year_start, p.fiscal_year_end, p.consolidated,
         p.accounting_standard, p.net_sales, p.operating_profit, p.revenue_element,
         -- 分割に銘柄コードを含める（銘柄での絞り込みを、この窓関数より内側に渡せるように）
         row_number() over (
           partition by c.code, p.doc_id, p.fiscal_year_end
           order by (p.net_sales is not null) desc, p.consolidated desc
         ) as basis_rank
    from public.edinet_document_codes c
    join public.edinet_documents d on d.doc_id = c.doc_id and not d.withdrawn and not d.withheld
    join public.business_results_extractions e on e.doc_id = c.doc_id and e.status = 'ok'
    join public.business_results_periods p on p.doc_id = c.doc_id
),
candidates as (
  -- 出典: 決算短信（優先順位 1）
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
         s.operating_profit,
         null::text as source_document_type_code,
         null::timestamptz as source_submitted_at,
         null::text as revenue_element
    from public.financial_statements s
  union all
  -- 出典: 有価証券報告書（2）・有価証券届出書（3）の「主要な経営指標等の推移」
  select r.code,
         case when r.doc_type_code in ('120', '130') then 'edinet_annual_report' else 'edinet_registration_statement' end,
         case when r.doc_type_code in ('120', '130') then 2 else 3 end,
         r.doc_id,
         (r.submitted_at at time zone 'Asia/Tokyo')::date,
         (r.submitted_at at time zone 'Asia/Tokyo')::time,
         'EDINET_' || r.doc_type_code,
         r.consolidated,
         r.accounting_standard,
         r.fiscal_year_start,
         r.fiscal_year_end,
         r.net_sales,
         r.operating_profit,
         r.doc_type_code,
         r.submitted_at,
         r.revenue_element
    from edinet_rows r
   where r.basis_rank = 1
),
ranked as (
  select c.*,
         row_number() over (
           partition by c.code, c.fiscal_year_end
           order by c.source_priority, c.source_document_date desc, c.source_document_time desc nulls last,
                    c.source_document_id desc
         ) as rn,
         count(*) over (partition by c.code, c.fiscal_year_end, c.source) as same_source_count,
         -- 決算短信だけ: 訂正の開示で一部の項目が空欄になることがある（Sprint 5）。項目ごとに、同じ期の開示のうち値のある最新のものを使う。
         -- EDINET の期は、選んだ1通の書類の値をそのまま使う（仕様「最も新しく提出された書類の値」。書類IDと値の出どころを一致させる）
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
       case when r.source = 'tdnet_summary' then r.filled_net_sales else r.net_sales end as net_sales,
       case when r.source = 'tdnet_summary' then r.filled_operating_profit else r.operating_profit end as operating_profit,
       r.consolidated,
       r.accounting_standard,
       r.document_type,
       r.source,
       r.source_priority,
       r.source_document_id,
       r.source_document_date,
       case when r.source = 'tdnet_summary' then r.source_document_id end as disclosure_no,
       case when r.source = 'tdnet_summary' then r.source_document_date end as disclosed_date,
       r.same_source_count::integer as disclosure_count,
       r.source_document_type_code,
       r.source_submitted_at,
       r.revenue_element
  from ranked r
 where r.rn = 1;

comment on view public.financial_periods is
  '銘柄・事業年度の終了日ごとの通期実績（出典の優先順位 決算短信 1 → 有価証券報告書 2 → 有価証券届出書 3 → 同じ出典の中で新しい書類の1行）。'
  '決算短信の売上高・営業利益は、同じ期の開示のうち値のある最新のもの（訂正で空欄になる項目があるため）。EDINET の期は選んだ書類の値。'
  'is_irregular は 358〜371 日の外（変則決算）。disclosure_count はその出典の中でその期を持つ開示・書類の数';

revoke all on public.financial_periods from public, anon, authenticated;
grant select on public.financial_periods to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. 算出（純粋な関数。出典を読まない）: 混在の旗を2つに分ける
-- ---------------------------------------------------------------------------
create or replace function public.financial_metrics_from_periods(p_periods jsonb)
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
  v_mixed_cons boolean;
  v_mixed_std boolean;
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
    v_mixed_cons := (select count(distinct c) > 1 from unnest(v_cons[1:5]) as c);
    v_mixed_std := (select count(distinct s) > 1 from unnest(v_std[1:5]) as s);
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
    'revenue_cagr_mixed_basis', v_mixed_cons or v_mixed_std,
    'revenue_cagr_mixed_consolidation', v_mixed_cons,
    'revenue_cagr_mixed_standard', v_mixed_std,
    'operating_margin', v_margin,
    'operating_margin_unavailable_reason', v_margin_reason,
    'latest_fiscal_year_end', v_ends[1],
    'annual_period_count', n
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. 指標の表の列の追加と再計算
-- ---------------------------------------------------------------------------
alter table public.financial_metrics
  add column revenue_cagr_mixed_consolidation boolean,
  add column revenue_cagr_mixed_standard boolean,
  add column revenue_cagr_supplemented boolean not null default false,
  add column revenue_cagr_period_sources jsonb,
  add column latest_period_source text;

comment on column public.financial_metrics.revenue_cagr_supplemented is
  'CAGR が算出され、算出に使った5期に決算短信以外の出典の期がある（一覧の「補完」の印）';
comment on column public.financial_metrics.revenue_cagr_period_sources is
  '算出に使った5期の出典（新しい順。fiscal_year_end・source・document_id・document_type_code・document_date・consolidated）。算出不可なら NULL';
comment on column public.financial_metrics.latest_period_source is '直近通期（FY0）の出典（表示の文言の出し分けに使う。算出には使わない）';

create or replace function public.recalculate_financial_metrics(p_codes text[])
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_codes is null or cardinality(p_codes) = 0 then
    return 0;
  end if;

  -- 対象の銘柄の期を1回だけ読む（削除・算出・出典の集計で同じ結果を使う）
  if to_regclass('pg_temp.recalc_periods') is null then
    create temporary table recalc_periods (like public.financial_periods) on commit drop;
  else
    truncate pg_temp.recalc_periods;
  end if;
  insert into pg_temp.recalc_periods
  select p.* from public.financial_periods p
   where p.code = any(p_codes)
     and exists (select 1 from public.stocks s where s.code = p.code);

  -- 通期実績が1件も無くなった銘柄の行は消す
  delete from public.financial_metrics m
   where m.code = any(p_codes)
     and not exists (select 1 from pg_temp.recalc_periods p where p.code = m.code);

  insert into public.financial_metrics as m (
    code, revenue_cagr, revenue_cagr_unavailable_reason, revenue_cagr_base_fiscal_year_end, revenue_cagr_period_count,
    revenue_cagr_mixed_basis, revenue_cagr_mixed_consolidation, revenue_cagr_mixed_standard,
    revenue_cagr_supplemented, revenue_cagr_period_sources, latest_period_source,
    operating_margin, operating_margin_unavailable_reason, latest_fiscal_year_end,
    annual_period_count, calculated_at
  )
  select g.code,
         (g.r ->> 'revenue_cagr')::numeric,
         g.r ->> 'revenue_cagr_unavailable_reason',
         (g.r ->> 'revenue_cagr_base_fiscal_year_end')::date,
         (g.r ->> 'revenue_cagr_period_count')::integer,
         (g.r ->> 'revenue_cagr_mixed_basis')::boolean,
         (g.r ->> 'revenue_cagr_mixed_consolidation')::boolean,
         (g.r ->> 'revenue_cagr_mixed_standard')::boolean,
         coalesce(src.supplemented, false),
         src.sources,
         lp.source,
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
        from pg_temp.recalc_periods p
       group by p.code
    ) g
    -- 算出に使った5期の出典（算出の定義の外。CAGR が算出されたときだけ）
    left join lateral (
      select bool_or(p.source <> 'tdnet_summary') as supplemented,
             jsonb_agg(jsonb_build_object(
               'fiscal_year_end', p.fiscal_year_end,
               'source', p.source,
               'document_id', p.source_document_id,
               'document_type_code', p.source_document_type_code,
               'document_date', p.source_document_date,
               'consolidated', p.consolidated
             ) order by p.fiscal_year_end desc) as sources
        from pg_temp.recalc_periods p
       where (g.r ->> 'revenue_cagr') is not null
         and p.code = g.code
         and p.fiscal_year_end between (g.r ->> 'revenue_cagr_base_fiscal_year_end')::date
                                   and (g.r ->> 'latest_fiscal_year_end')::date
    ) src on true
    left join lateral (
      select p.source from pg_temp.recalc_periods p
       where p.code = g.code and p.fiscal_year_end = (g.r ->> 'latest_fiscal_year_end')::date
    ) lp on true
  on conflict (code) do update
     set revenue_cagr = excluded.revenue_cagr,
         revenue_cagr_unavailable_reason = excluded.revenue_cagr_unavailable_reason,
         revenue_cagr_base_fiscal_year_end = excluded.revenue_cagr_base_fiscal_year_end,
         revenue_cagr_period_count = excluded.revenue_cagr_period_count,
         revenue_cagr_mixed_basis = excluded.revenue_cagr_mixed_basis,
         revenue_cagr_mixed_consolidation = excluded.revenue_cagr_mixed_consolidation,
         revenue_cagr_mixed_standard = excluded.revenue_cagr_mixed_standard,
         revenue_cagr_supplemented = excluded.revenue_cagr_supplemented,
         revenue_cagr_period_sources = excluded.revenue_cagr_period_sources,
         latest_period_source = excluded.latest_period_source,
         operating_margin = excluded.operating_margin,
         operating_margin_unavailable_reason = excluded.operating_margin_unavailable_reason,
         latest_fiscal_year_end = excluded.latest_fiscal_year_end,
         annual_period_count = excluded.annual_period_count,
         calculated_at = excluded.calculated_at;

  get diagnostics v_count = row_count;
  truncate pg_temp.recalc_periods;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. 再計算のトリガー（financial_periods の結果が変わりうる変更のすべて。同じトランザクションの中で）
-- ---------------------------------------------------------------------------
/** 書類（まだある書類）に結び付く銘柄を再計算する。 */
create function public.recalculate_financial_metrics_for_documents(p_doc_ids text[])
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$
  select public.recalculate_financial_metrics(
    array(select distinct c.code from public.edinet_document_codes c where c.doc_id = any(p_doc_ids))
  );
$$;

/** business_results_periods・business_results_extractions の変更。書類の行が消えた場合（連鎖）は書類の削除のトリガーに任せる。 */
create function public.business_results_recalculate()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.recalculate_financial_metrics_for_documents(array(select distinct n.doc_id from new_rows n));
  elsif tg_op = 'UPDATE' then
    perform public.recalculate_financial_metrics_for_documents(
      array(select n.doc_id from new_rows n union select o.doc_id from old_rows o)
    );
  else
    perform public.recalculate_financial_metrics_for_documents(array(select distinct o.doc_id from old_rows o));
  end if;
  return null;
end;
$$;

create trigger business_results_periods_recalculate_insert
  after insert on public.business_results_periods
  referencing new table as new_rows
  for each statement execute function public.business_results_recalculate();
create trigger business_results_periods_recalculate_update
  after update on public.business_results_periods
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.business_results_recalculate();
create trigger business_results_periods_recalculate_delete
  after delete on public.business_results_periods
  referencing old table as old_rows
  for each statement execute function public.business_results_recalculate();
create trigger business_results_extractions_recalculate_update
  after update on public.business_results_extractions
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.business_results_recalculate();
create trigger business_results_extractions_recalculate_delete
  after delete on public.business_results_extractions
  referencing old table as old_rows
  for each statement execute function public.business_results_recalculate();

/**
 * edinet_documents の変更。update は、結び付き・使うかどうかに関わる列（取り下げ・不開示・証券コード・EDINET コード・提出日時・種類）が
 * 変わった書類のうち、主要な経営指標等を持つものだけ。delete は、消えた書類の OLD の証券コード、または OLD の EDINET コードから
 * edinet_filers で引いた銘柄（外部キーの連鎖で期の行も消えた後に動く）。
 */
create function public.edinet_documents_recalculate()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    perform public.recalculate_financial_metrics(array(
      select distinct x.code from (
        select coalesce(o.sec_code, (select f.sec_code from public.edinet_filers f where f.edinet_code = o.edinet_code)) as code
          from old_rows o join new_rows n on n.doc_id = o.doc_id
         where (o.withdrawn, o.withheld, o.sec_code, o.edinet_code, o.submitted_at, o.doc_type_code)
               is distinct from (n.withdrawn, n.withheld, n.sec_code, n.edinet_code, n.submitted_at, n.doc_type_code)
           and exists (select 1 from public.business_results_extractions e where e.doc_id = n.doc_id)
        union
        select coalesce(n.sec_code, (select f.sec_code from public.edinet_filers f where f.edinet_code = n.edinet_code))
          from old_rows o join new_rows n on n.doc_id = o.doc_id
         where (o.withdrawn, o.withheld, o.sec_code, o.edinet_code, o.submitted_at, o.doc_type_code)
               is distinct from (n.withdrawn, n.withheld, n.sec_code, n.edinet_code, n.submitted_at, n.doc_type_code)
           and exists (select 1 from public.business_results_extractions e where e.doc_id = n.doc_id)
      ) x
      where x.code is not null
    ));
  else
    perform public.recalculate_financial_metrics(array(
      select distinct x.code from (
        select coalesce(o.sec_code, (select f.sec_code from public.edinet_filers f where f.edinet_code = o.edinet_code)) as code
          from old_rows o
      ) x
      where x.code is not null
        and exists (select 1 from public.financial_metrics m where m.code = x.code)
    ));
  end if;
  return null;
end;
$$;

create trigger edinet_documents_recalculate_update
  after update on public.edinet_documents
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.edinet_documents_recalculate();
create trigger edinet_documents_recalculate_delete
  after delete on public.edinet_documents
  referencing old table as old_rows
  for each statement execute function public.edinet_documents_recalculate();

/** edinet_filers の変更。証券コードの無い書類を持つ提出者の、変更の前後の銘柄だけ。 */
create function public.edinet_filers_recalculate()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.recalculate_financial_metrics(array(
      select distinct n.sec_code from new_rows n
       where exists (select 1 from public.edinet_documents d where d.edinet_code = n.edinet_code and d.sec_code is null)
    ));
  elsif tg_op = 'UPDATE' then
    perform public.recalculate_financial_metrics(array(
      select x.sec_code from (
        select o.edinet_code, o.sec_code from old_rows o
        union select n.edinet_code, n.sec_code from new_rows n
      ) x
       where exists (select 1 from public.edinet_documents d where d.edinet_code = x.edinet_code and d.sec_code is null)
    ));
  else
    perform public.recalculate_financial_metrics(array(
      select distinct o.sec_code from old_rows o
       where exists (select 1 from public.edinet_documents d where d.edinet_code = o.edinet_code and d.sec_code is null)
    ));
  end if;
  return null;
end;
$$;

create trigger edinet_filers_recalculate_insert
  after insert on public.edinet_filers
  referencing new table as new_rows
  for each statement execute function public.edinet_filers_recalculate();
create trigger edinet_filers_recalculate_update
  after update on public.edinet_filers
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.edinet_filers_recalculate();
create trigger edinet_filers_recalculate_delete
  after delete on public.edinet_filers
  referencing old table as old_rows
  for each statement execute function public.edinet_filers_recalculate();

/**
 * stocks の追加（EDINET の期は銘柄マスタへの外部キーを持たないため、上場前に保存した届出書の期を、銘柄マスタに入った時点で使う）。
 * upsert（insert ... on conflict do update）の insert の遷移テーブルには、新しく入った行だけが入る。
 */
create function public.stocks_recalculate_financial_metrics()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.recalculate_financial_metrics(array(
    select n.code from new_rows n
     where exists (select 1 from public.edinet_document_codes c where c.code = n.code)
  ));
  return null;
end;
$$;

create trigger stocks_recalculate_financial_metrics_insert
  after insert on public.stocks
  referencing new table as new_rows
  for each statement execute function public.stocks_recalculate_financial_metrics();

-- ---------------------------------------------------------------------------
-- 7. 取り込み処理用（service_role のみ）
-- ---------------------------------------------------------------------------
/**
 * 導入時の準備（契約の第2章の6。R1）: 既存の書類から edinet_filers を作り、取得済みの一覧の日の記録を消す
 * （次の実行から 450 日分の書類一覧を1回だけ取り直し、半期報告書などの行から提出者の証券コードを集める）。
 */
create function public.prepare_edinet_filers_backfill()
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_filers integer;
  v_cleared integer;
begin
  with src as (
    select distinct on (d.edinet_code) d.edinet_code, d.sec_code, d.filer_name, d.submitted_at
      from public.edinet_documents d
     where d.sec_code is not null
     order by d.edinet_code, d.submitted_at desc
  ),
  upserted as (
    insert into public.edinet_filers as f (edinet_code, sec_code, filer_name, seen_submitted_at)
    select s.edinet_code, s.sec_code, s.filer_name, s.submitted_at from src s
    on conflict (edinet_code) do update
       set sec_code = excluded.sec_code, filer_name = excluded.filer_name,
           seen_submitted_at = excluded.seen_submitted_at, updated_at = now()
     where f.seen_submitted_at is null or f.seen_submitted_at < excluded.seen_submitted_at
    returning 1
  )
  select count(*) into v_filers from upserted;

  delete from public.edinet_list_fetched_dates;
  get diagnostics v_cleared = row_count;

  return jsonb_build_object('filers', v_filers, 'listDatesCleared', v_cleared);
end;
$$;

/**
 * 1日分の書類一覧の保存（Sprint 8 の関数に p_filers を加えた版）。
 * p_filers: その日の一覧のすべての行から作った提出者と証券コードの対応（edinetCode・secCode・filerName・submittedAt）。
 * 提出日時の新しい情報で、証券コード・名前が変わったときだけ更新する。
 */
drop function public.save_edinet_document_list(bigint, date, jsonb, jsonb, jsonb, integer);

create function public.save_edinet_document_list(
  p_run_id bigint,
  p_list_date date,
  p_documents jsonb,
  p_withdrawn jsonb,
  p_disclosure jsonb,
  p_filers jsonb,
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
  v_upserted integer;
  v_withdrawn integer;
  v_withheld integer;
  v_filers integer;
begin
  select status into v_status from public.ingestion_runs where id = p_run_id for update;
  if v_status is distinct from 'running' then
    return jsonb_build_object('saved', false);
  end if;

  -- 提出者と証券コードの対応（書類より先に保存する。同じ一覧の届出書を、保存した時点で銘柄に結び付けるため）
  with input as (
    select distinct on (r.edinet_code) r.*
      from jsonb_to_recordset(coalesce(p_filers, '[]'::jsonb)) as r(
        edinet_code text, sec_code text, filer_name text, submitted_at timestamptz
      )
     where r.edinet_code is not null and r.edinet_code <> '' and r.sec_code ~ '^[0-9A-Z]{5}$'
     order by r.edinet_code, r.submitted_at desc nulls last
  ),
  upserted as (
    insert into public.edinet_filers as f (edinet_code, sec_code, filer_name, seen_submitted_at)
    select i.edinet_code, i.sec_code, i.filer_name, i.submitted_at from input i
    on conflict (edinet_code) do update
       set sec_code = excluded.sec_code, filer_name = excluded.filer_name,
           seen_submitted_at = excluded.seen_submitted_at, updated_at = now()
     where (f.seen_submitted_at is null or f.seen_submitted_at < excluded.seen_submitted_at)
       and (f.sec_code, f.filer_name) is distinct from (excluded.sec_code, excluded.filer_name)
    returning 1
  )
  select count(*) into v_filers from upserted;

  -- 不開示の開始・解除（操作日時の新しい情報だけ）を先に反映する（同じ一覧の通常の行の不開示の区分で上書きしないため）
  with changes as (
    select distinct on (r.doc_id) r.*
      from jsonb_to_recordset(coalesce(p_disclosure, '[]'::jsonb)) as r(doc_id text, withheld boolean, ope_at timestamptz)
     order by r.doc_id, r.ope_at desc
  ),
  updated as (
    update public.edinet_documents d
       set withheld = c.withheld, disclosure_changed_at = c.ope_at, updated_at = now()
      from changes c
     where d.doc_id = c.doc_id
       and (d.disclosure_changed_at is null or d.disclosure_changed_at < c.ope_at)
       and d.withheld is distinct from c.withheld
    returning 1
  )
  select count(*) into v_withheld from updated;

  with input as (
    select distinct on (r.doc_id) r.*
      from jsonb_to_recordset(coalesce(p_documents, '[]'::jsonb)) as r(
        doc_id text, sec_code text, edinet_code text, filer_name text, doc_type_code text, ordinance_code text,
        form_code text, period_start date, period_end date, submitted_at timestamptz, parent_doc_id text,
        doc_description text, xbrl_available boolean, withheld boolean
      )
     order by r.doc_id
  ),
  upserted as (
    insert into public.edinet_documents as d (
      doc_id, sec_code, edinet_code, filer_name, doc_type_code, ordinance_code, form_code, period_start, period_end,
      submitted_at, parent_doc_id, doc_description, xbrl_available, withheld, list_date, run_id
    )
    select i.doc_id, i.sec_code, i.edinet_code, i.filer_name, i.doc_type_code, i.ordinance_code, i.form_code,
           i.period_start, i.period_end, i.submitted_at, i.parent_doc_id, i.doc_description,
           coalesce(i.xbrl_available, false), coalesce(i.withheld, false), p_list_date, p_run_id
      from input i
    on conflict (doc_id) do update
       set sec_code = excluded.sec_code,
           edinet_code = excluded.edinet_code,
           filer_name = excluded.filer_name,
           doc_type_code = excluded.doc_type_code,
           ordinance_code = excluded.ordinance_code,
           form_code = excluded.form_code,
           period_start = excluded.period_start,
           period_end = excluded.period_end,
           submitted_at = excluded.submitted_at,
           parent_doc_id = excluded.parent_doc_id,
           doc_description = excluded.doc_description,
           xbrl_available = excluded.xbrl_available,
           withheld = d.withheld or (excluded.withheld and d.disclosure_changed_at is null),
           run_id = excluded.run_id,
           updated_at = now()
     where (d.sec_code, d.edinet_code, d.filer_name, d.doc_type_code, d.ordinance_code, d.form_code, d.period_start,
            d.period_end, d.submitted_at, d.parent_doc_id, d.doc_description, d.xbrl_available, d.withheld)
           is distinct from
           (excluded.sec_code, excluded.edinet_code, excluded.filer_name, excluded.doc_type_code, excluded.ordinance_code,
            excluded.form_code, excluded.period_start, excluded.period_end, excluded.submitted_at, excluded.parent_doc_id,
            excluded.doc_description, excluded.xbrl_available,
            d.withheld or (excluded.withheld and d.disclosure_changed_at is null))
    returning 1
  )
  select count(*) into v_upserted from upserted;

  with ids as (
    select distinct value #>> '{}' as doc_id from jsonb_array_elements(coalesce(p_withdrawn, '[]'::jsonb))
  ),
  updated as (
    update public.edinet_documents d
       set withdrawn = true, updated_at = now()
     where not d.withdrawn
       and (d.doc_id in (select doc_id from ids) or d.parent_doc_id in (select doc_id from ids))
    returning 1
  )
  select count(*) into v_withdrawn from updated;

  insert into public.edinet_list_fetched_dates (list_date, fetched_at, document_count, run_id)
  values (p_list_date, now(), greatest(coalesce(p_received_count, 0), 0), p_run_id)
  on conflict (list_date) do update
     set fetched_at = excluded.fetched_at,
         document_count = excluded.document_count,
         run_id = excluded.run_id;

  return jsonb_build_object('saved', true, 'upserted', v_upserted, 'withdrawnUpdated', v_withdrawn,
                            'disclosureUpdated', v_withheld, 'filersUpdated', v_filers);
end;
$$;

/**
 * 主要な経営指標等を読む書類のうち未処理のもの（契約の第2章の3）。
 * 有報: 候補の列（annual_report_candidates。対象の事業年度の書類）のすべて。届出書: 銘柄に結び付く、取り下げ・不開示でないもの。
 * priority 0 = 条件①を算出できていない銘柄（指標なし・期が足りない・連続しない）の書類、1 = そのほか。
 */
create view public.business_results_targets
with (security_invoker = true)
as
with docs as (
  select c.doc_id, c.code from public.annual_report_candidates c
  union
  select dc.doc_id, dc.code
    from public.edinet_document_codes dc
    join public.edinet_documents d on d.doc_id = dc.doc_id
   where d.doc_type_code in ('030', '040') and not d.withdrawn and not d.withheld
)
select x.doc_id, x.code, d.doc_type_code, d.submitted_at, d.xbrl_available,
       case when m.code is null or m.revenue_cagr_unavailable_reason in ('insufficient_periods', 'non_consecutive_periods')
            then 0 else 1 end as priority
  from docs x
  join public.edinet_documents d on d.doc_id = x.doc_id
  left join public.financial_metrics m on m.code = x.code
 where not exists (select 1 from public.business_results_extractions e where e.doc_id = x.doc_id);

comment on view public.business_results_targets is
  '主要な経営指標等が未処理の、読む対象の書類（有報の候補の列のすべてと、銘柄に結び付く届出書）。priority 0 が先';

/**
 * 銘柄マスタの件数、期間の中の取得済みの日、本文を取得する書類（どちらかの処理が未処理の書類）。
 * 取得の順: 条件①を算出できていない銘柄の書類（届出書 → 有報、提出日時の新しい順）→ そのほか（提出日時の新しい順）。
 */
create or replace function public.edinet_ingestion_state(p_from date, p_to date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with s as (select * from public.annual_report_sections),
  annual_pending as (
    select shareholders_doc_id as doc_id from s where shareholders_status = 'pending'
    union
    select officers_doc_id from s where officers_status = 'pending'
  ),
  business as (select t.doc_id, t.priority from public.business_results_targets t),
  targets as (
    select d.doc_id, d.sec_code, d.xbrl_available, d.doc_type_code, d.submitted_at,
           (d.doc_type_code in ('120', '130')
             and not exists (select 1 from public.annual_report_extractions e where e.doc_id = d.doc_id)) as needs_annual,
           b.doc_id is not null as needs_business,
           coalesce(b.priority, 1) as priority,
           (select c.code from public.edinet_document_codes c where c.doc_id = d.doc_id) as code
      from public.edinet_documents d
      left join business b on b.doc_id = d.doc_id
     where d.doc_id in (select doc_id from annual_pending) or b.doc_id is not null
  )
  select jsonb_build_object(
    'stockCount', (select count(*) from public.stocks),
    'fetchedDates', coalesce(
      (select jsonb_agg(f.list_date order by f.list_date)
         from public.edinet_list_fetched_dates f
        where f.list_date between p_from and p_to),
      '[]'::jsonb
    ),
    'targets', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'docId', t.doc_id, 'code', coalesce(t.code, t.sec_code), 'xbrlAvailable', t.xbrl_available,
                'needsAnnualReport', t.needs_annual, 'needsBusinessResults', t.needs_business)
              order by t.priority,
                       case when t.priority = 0 and t.doc_type_code in ('030', '040') then 0 else 1 end,
                       t.submitted_at desc, t.doc_id desc)
         from targets t),
      '[]'::jsonb
    )
  );
$$;

/**
 * 1書類の抽出の結果の保存（1つのトランザクション。実行の処理件数を、書類ごとに1だけ足す）。
 * p_annual_report・p_business_results は、その処理を行ったときだけ（NULL の処理は保存しない）。実行が「実行中」のときだけ保存する。
 */
create function public.save_edinet_extractions(
  p_run_id bigint,
  p_doc_id text,
  p_annual_report jsonb,
  p_business_results jsonb
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status from public.ingestion_runs where id = p_run_id for update;
  if v_status is distinct from 'running' then
    return jsonb_build_object('saved', false, 'reason', 'not_running');
  end if;
  if not exists (select 1 from public.edinet_documents where doc_id = p_doc_id) then
    return jsonb_build_object('saved', false, 'reason', 'unknown_document');
  end if;

  if p_annual_report is not null then
    delete from public.annual_report_extractions where doc_id = p_doc_id;
    insert into public.annual_report_extractions (
      doc_id, processed_at, shareholders_status, officers_status, shareholders_detail, officers_detail,
      officers_basis, officers_has_post_agm_table, officers_order_source, run_id
    )
    values (
      p_doc_id, now(),
      p_annual_report ->> 'shareholdersStatus', p_annual_report ->> 'officersStatus',
      p_annual_report ->> 'shareholdersDetail', p_annual_report ->> 'officersDetail',
      p_annual_report ->> 'officersBasis', coalesce((p_annual_report ->> 'officersHasPostAgmTable')::boolean, false),
      p_annual_report ->> 'officersOrderSource', p_run_id
    );
    insert into public.annual_report_shareholders (doc_id, rank, name, address, shares_held, ratio_pct, ratio_decimals)
    select p_doc_id, r.rank, r.name, r.address, r.shares_held::numeric, r.ratio_pct::numeric, r.ratio_decimals
      from jsonb_to_recordset(coalesce(p_annual_report -> 'shareholders', '[]'::jsonb)) as r(
        rank integer, name text, address text, shares_held text, ratio_pct text, ratio_decimals smallint
      );
    insert into public.annual_report_officers (doc_id, seq, name, title)
    select p_doc_id, r.seq, r.name, r.title
      from jsonb_to_recordset(coalesce(p_annual_report -> 'officers', '[]'::jsonb)) as r(seq integer, name text, title text);
  end if;

  if p_business_results is not null then
    delete from public.business_results_extractions where doc_id = p_doc_id;
    insert into public.business_results_extractions (doc_id, processed_at, status, detail, period_count, run_id)
    values (
      p_doc_id, now(), p_business_results ->> 'status', p_business_results ->> 'detail',
      jsonb_array_length(coalesce(p_business_results -> 'periods', '[]'::jsonb)), p_run_id
    );
    -- 金額は十進の文字列で受け取り、numeric に直す（浮動小数点を経由しない）
    insert into public.business_results_periods (
      doc_id, fiscal_year_start, fiscal_year_end, consolidated, accounting_standard, net_sales, operating_profit,
      revenue_element, operating_profit_element
    )
    select p_doc_id, r.fiscal_year_start, r.fiscal_year_end, r.consolidated, r.accounting_standard,
           r.net_sales::numeric, r.operating_profit::numeric, r.revenue_element, r.operating_profit_element
      from jsonb_to_recordset(coalesce(p_business_results -> 'periods', '[]'::jsonb)) as r(
        fiscal_year_start date, fiscal_year_end date, consolidated boolean, accounting_standard text,
        net_sales text, operating_profit text, revenue_element text, operating_profit_element text
      );
  end if;

  update public.ingestion_runs set processed_count = processed_count + 1 where id = p_run_id;

  return jsonb_build_object('saved', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. 取り込み状況の画面の要約（authenticated。security invoker）
-- ---------------------------------------------------------------------------
create function public.business_results_summary()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with supplemented as (
    select distinct p.code from public.financial_periods p where p.source <> 'tdnet_summary'
  ),
  processed as (
    select e.status, d.doc_type_code
      from public.business_results_extractions e
      join public.edinet_documents d on d.doc_id = e.doc_id
  ),
  last_run as (
    select r.id, r.status, r.finished_at, r.processed_count, r.details
      from public.ingestion_runs r
     where r.target = 'edinet_reports' and r.status <> 'running'
     order by r.finished_at desc nulls last, r.id desc
     limit 1
  )
  select jsonb_build_object(
    'stockCount', (select count(*) from public.stocks),
    'supplementedStockCount', (select count(*) from supplemented s where exists (select 1 from public.stocks t where t.code = s.code)),
    'supplementedCagrCount', (select count(*) from public.financial_metrics m where m.revenue_cagr_supplemented),
    'processedAnnualReports', (select count(*) from processed p where p.doc_type_code in ('120', '130')),
    'processedRegistrationStatements', (select count(*) from processed p where p.doc_type_code in ('030', '040')),
    'statusCounts', coalesce((select jsonb_object_agg(x.status, x.n)
                                from (select p.status, count(*) as n from processed p group by p.status) x), '{}'::jsonb),
    'pendingDocumentCount', (select count(*) from public.business_results_targets),
    'unlinkedRegistrationStatements', (
      select count(*) from public.edinet_documents d
       where d.doc_type_code in ('030', '040') and not d.withdrawn and not d.withheld
         and d.sec_code is null
         and not exists (select 1 from public.edinet_filers f where f.edinet_code = d.edinet_code)
    ),
    'lastRun', (
      select jsonb_build_object('status', l.status, 'finishedAt', l.finished_at, 'processedCount', l.processed_count,
                                'details', l.details)
        from last_run l
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- 9. スクリーニングの行に補完の情報を加える（判定 screening_evaluate は変えない）
-- ---------------------------------------------------------------------------
create or replace function public.screen_stocks(p_params jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_include boolean := coalesce((p_params ->> 'includeUnavailable')::boolean, false);
  v_sort text := coalesce(p_params ->> 'sort', 'cagr');
  v_asc boolean := coalesce(p_params ->> 'order', 'desc') = 'asc';
  v_page integer := greatest(coalesce((p_params ->> 'page')::integer, 1), 1);
  v_page_size integer := least(greatest(coalesce((p_params ->> 'pageSize')::integer, 100), 1), 500);
  v_clamp boolean := coalesce((p_params ->> 'clampPage')::boolean, false);
  v_reference date;
  v_total integer;
  v_loose integer;
  v_strict integer;
  v_total_pages integer;
  v_rows jsonb;
begin
  if v_sort not in ('cagr', 'margin', 'years', 'code', 'name', 'market', 'sector') then
    raise exception 'screen_stocks: invalid sort %', v_sort using errcode = '22023';
  end if;
  if (p_params ->> 'cagr') is null or (p_params ->> 'margin') is null or (p_params ->> 'years') is null then
    raise exception 'screen_stocks: thresholds are required' using errcode = '22023';
  end if;

  select r.reference_date into v_reference from public.listing_reference_date r;

  with cand as materialized (
    select e.code, e.s_cagr, e.s_margin, e.s_years,
           case v_sort
             when 'cagr' then m.revenue_cagr
             when 'margin' then m.operating_margin
             when 'years' then
               case when d.code is null then null
                    when d.first_price_date = d.data_start_date then 100000 - (d.data_start_date - date '1970-01-01')
                    else -(d.first_price_date - date '1970-01-01') end
           end as num_key,
           case v_sort
             when 'code' then s.code
             when 'name' then s.company_name
             when 'market' then s.market_code
             when 'sector' then s.sector33_code
           end as txt_key
      from public.screening_evaluate(p_params, null) e
      join public.stocks s on s.code = e.code
      left join public.financial_metrics m on m.code = e.code
      left join public.stock_listing_dates d on d.code = e.code
     where e.matches_filters
  ),
  passed as (
    select c.*,
           (c.s_cagr <> 'unavailable' and c.s_margin <> 'unavailable' and c.s_years <> 'unavailable') as complete
      from cand c
     where c.s_cagr <> 'unmet' and c.s_margin <> 'unmet' and c.s_years <> 'unmet'
  ),
  counts as (
    select count(*)::integer as loose, (count(*) filter (where p.complete))::integer as strict from passed p
  ),
  paging as (
    select n.loose, n.strict,
           case when v_include then n.loose else n.strict end as total,
           greatest(ceil((case when v_include then n.loose else n.strict end)::numeric / v_page_size)::integer, 1) as total_pages
      from counts n
  ),
  page_no as (
    select g.*, case when v_clamp and v_page > g.total_pages then g.total_pages else v_page end as page
      from paging g
  ),
  ordered as (
    select p.code, p.s_cagr, p.s_margin, p.s_years,
           row_number() over (
             order by ((p.num_key is null) and (p.txt_key is null)),
                      case when v_asc then p.num_key end asc,
                      case when not v_asc then p.num_key end desc,
                      case when v_asc then p.txt_key end asc,
                      case when not v_asc then p.txt_key end desc,
                      p.code asc
           ) as ord
      from passed p
     where v_include or p.complete
  ),
  page as materialized (
    select o.*
      from ordered o, page_no n
     where o.ord > (n.page - 1) * v_page_size and o.ord <= n.page * v_page_size
  )
  select n.total, n.loose, n.strict, n.total_pages, n.page,
         (select coalesce(jsonb_agg(
            jsonb_build_object(
              'code', s.code,
              'company_name', s.company_name,
              'market_code', s.market_code,
              'market_name', s.market_name,
              'sector33_code', s.sector33_code,
              'sector33_name', s.sector33_name,
              'revenue_cagr', m.revenue_cagr,
              'revenue_cagr_display_pct', m.revenue_cagr_display_pct,
              'revenue_cagr_unavailable_reason', m.revenue_cagr_unavailable_reason,
              'revenue_cagr_supplemented', coalesce(m.revenue_cagr_supplemented, false),
              'revenue_cagr_supplement', coalesce((
                select jsonb_agg(x.value order by x.ordinality)
                  from jsonb_array_elements(m.revenue_cagr_period_sources) with ordinality x
                 where x.value ->> 'source' <> 'tdnet_summary'
              ), '[]'::jsonb),
              'revenue_cagr_mixed_consolidation', coalesce(m.revenue_cagr_mixed_consolidation, false),
              'revenue_cagr_mixed_standard', coalesce(m.revenue_cagr_mixed_standard, false),
              'operating_margin', m.operating_margin,
              'operating_margin_display_pct', m.operating_margin_display_pct,
              'operating_margin_unavailable_reason', m.operating_margin_unavailable_reason,
              'latest_period_source', m.latest_period_source,
              'has_financials', m.code is not null,
              'first_price_date', d.first_price_date,
              'data_start_date', d.data_start_date,
              'listed_before_data_start', case when d.code is null then null else d.first_price_date = d.data_start_date end,
              'listing_years_exact', case when d.first_price_date > d.data_start_date then y.exact_years end,
              'estimated_listing_years', case when d.first_price_date > d.data_start_date then y.rounded_up_years end,
              'listing_years_lower_bound', case when d.first_price_date = d.data_start_date then y.whole_years end,
              'status', jsonb_build_object('cagr', p.s_cagr, 'margin', p.s_margin, 'years', p.s_years)
            ) order by p.ord), '[]'::jsonb)
            from page p
            join public.stocks s on s.code = p.code
            left join public.financial_metrics m on m.code = p.code
            left join public.stock_listing_dates d on d.code = p.code
            left join lateral public.listing_years_between(
              case when d.first_price_date = d.data_start_date then d.data_start_date else d.first_price_date end,
              v_reference
            ) y on true)
    into v_total, v_loose, v_strict, v_total_pages, v_page, v_rows
    from page_no n;

  return jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'page', v_page,
    'pageSize', v_page_size,
    'totalPages', v_total_pages,
    'excludedUnavailable', case when v_include then 0 else v_loose - v_strict end,
    'referenceDate', v_reference,
    'stockCount', (select count(*) from public.stocks),
    'metricsCount', (select count(*) from public.financial_metrics),
    'listingDatesCount', (select count(*) from public.stock_listing_dates)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. 権限と RLS（public.stocks と同じ方針）
-- ---------------------------------------------------------------------------
alter table public.edinet_filers enable row level security;
alter table public.business_results_extractions enable row level security;
alter table public.business_results_periods enable row level security;

revoke all on public.edinet_filers, public.business_results_extractions, public.business_results_periods
  from public, anon, authenticated;
grant select on public.edinet_filers, public.business_results_extractions, public.business_results_periods to authenticated;
grant all on public.edinet_filers, public.business_results_extractions, public.business_results_periods to service_role;

create policy "許可ユーザーのみ参照可" on public.edinet_filers
  for select to authenticated using ((select public.current_user_is_allowed()));
create policy "許可ユーザーのみ参照可" on public.business_results_extractions
  for select to authenticated using ((select public.current_user_is_allowed()));
create policy "許可ユーザーのみ参照可" on public.business_results_periods
  for select to authenticated using ((select public.current_user_is_allowed()));

revoke all on public.edinet_document_codes, public.business_results_targets from public, anon, authenticated;
grant select on public.edinet_document_codes, public.business_results_targets to authenticated, service_role;

revoke execute on function public.recalculate_financial_metrics_for_documents(text[]) from public, anon, authenticated;
revoke execute on function public.business_results_recalculate() from public, anon, authenticated;
revoke execute on function public.edinet_documents_recalculate() from public, anon, authenticated;
revoke execute on function public.edinet_filers_recalculate() from public, anon, authenticated;
revoke execute on function public.stocks_recalculate_financial_metrics() from public, anon, authenticated;
revoke execute on function public.prepare_edinet_filers_backfill() from public, anon, authenticated;
revoke execute on function public.save_edinet_document_list(bigint, date, jsonb, jsonb, jsonb, jsonb, integer)
  from public, anon, authenticated;
revoke execute on function public.save_edinet_extractions(bigint, text, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.business_results_summary() from public, anon, authenticated;

grant execute on function public.recalculate_financial_metrics_for_documents(text[]) to service_role;
grant execute on function public.business_results_recalculate() to service_role;
grant execute on function public.edinet_documents_recalculate() to service_role;
grant execute on function public.edinet_filers_recalculate() to service_role;
grant execute on function public.stocks_recalculate_financial_metrics() to service_role;
grant execute on function public.prepare_edinet_filers_backfill() to service_role;
grant execute on function public.save_edinet_document_list(bigint, date, jsonb, jsonb, jsonb, jsonb, integer) to service_role;
grant execute on function public.save_edinet_extractions(bigint, text, jsonb, jsonb) to service_role;
grant execute on function public.business_results_summary() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 11. 導入時の準備（R1）と、既存の行の再計算
-- ---------------------------------------------------------------------------
select public.prepare_edinet_filers_backfill();
select public.recalculate_financial_metrics(array(select distinct code from public.financial_statements));

-- Sprint 8 の1書類の保存（大株主・役員だけ）は save_edinet_extractions に置き換えた
drop function public.save_annual_report_extraction(bigint, text, jsonb);
