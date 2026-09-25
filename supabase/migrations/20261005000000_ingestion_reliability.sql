-- Sprint 12: 日次取り込みの信頼性（F11）
--
-- 方針（契約 docs/harness/sprints/sprint-12/contract.md の第2章）
-- - 実行の行に、打ち切りの理由・残りの件数と単位・失敗の件数・最後に保存した時刻を加える。表示の「一部完了」「一部失敗」は
--   アプリの1か所（src/lib/ingestion/runs.ts の partialKind）で、これらの列から決める。status は4値のまま。
-- - 失敗した対象（銘柄・開示日・書類一覧の日・書類）は ingestion_run_failures に、実行の終了時に保存する（1実行 1,000 行まで）。
--   エラーは理由のコードで保存し、文言はアプリの1か所（src/lib/ingestion/failures.ts）で作る。応答の本文・URL・キーは保存しない。
-- - 応答の無くなった実行の後片付け: 保存済みがあれば partial（stopped_reason = stale）、無ければ今までどおり failed と旧い文言。
-- - 最後に保存した時刻（last_progress_at）: 保存の関数が書く行（run_id を持つ表）の文単位のトリガーで、実行中の行に now() を入れる。
--   鮮度（data_freshness）は stale の行だけこの時刻を使う（後片付けの時刻は実際の保存より新しいため）。
-- - 上場廃止: stocks.delisted_on。行は消さない（補正とメモが連鎖して消えるため）。銘柄マスタの成功で対象の行に無かった銘柄に付け、
--   再び現れたら NULL に戻す。1回で 100 を超える銘柄が消えたら反映を保留する（partial、stopped_reason = delisting_held）。
--   判定は screening_evaluate の1か所（is_delisted）。スクリーニングは常に除く。

-- ---------------------------------------------------------------------------
-- 1. 実行履歴の列
-- ---------------------------------------------------------------------------
alter table public.ingestion_runs
  add column stopped_reason text check (stopped_reason in (
    'time_budget', 'stale', 'rate_limited', 'unauthorized', 'redirect', 'consecutive_failures', 'save_failed', 'delisting_held'
  )),
  add column remaining_count integer check (remaining_count >= 0),
  add column remaining_unit text check (remaining_unit in ('stocks', 'disclosure_dates', 'list_dates', 'documents')),
  add column failed_count integer not null default 0 check (failed_count >= 0),
  add column last_progress_at timestamptz;

comment on column public.ingestion_runs.stopped_reason is '打ち切りの理由（NULL = 最後まで処理した）';
comment on column public.ingestion_runs.remaining_count is '残りの件数（単位は remaining_unit）。残りが無い・数えられないときは NULL';
comment on column public.ingestion_runs.failed_count is '失敗した対象の数（上限で打ち切らない全数。行は ingestion_run_failures に 1,000 行まで）';
comment on column public.ingestion_runs.last_progress_at is '最後に保存した時刻（保存の関数が書く表のトリガーで更新する）';

-- 鮮度・残りの判定（target ごとの最新の実行）
create index ingestion_runs_target_finished_idx on public.ingestion_runs (target, finished_at desc, id desc)
  where status <> 'running';

-- ---------------------------------------------------------------------------
-- 2. 失敗した対象
-- ---------------------------------------------------------------------------
create table public.ingestion_run_failures (
  id bigint generated always as identity primary key,
  run_id bigint not null references public.ingestion_runs (id) on delete cascade,
  item_type text not null check (item_type in ('stock', 'disclosure_date', 'list_date', 'document')),
  item_key text not null check (item_key <> ''),
  -- 銘柄コード（分かるときだけ）。参照にしない（銘柄が消えても行は残す）
  code text,
  reason text not null check (reason in (
    'http_error', 'not_found', 'unreachable', 'invalid_format', 'row_mismatch', 'pdf_returned', 'invalid_archive'
  )),
  http_status integer,
  network_error text check (network_error in ('timeout', 'network')),
  created_at timestamptz not null default now(),
  unique (run_id, item_type, item_key)
);

comment on table public.ingestion_run_failures is
  '取り込みで失敗した対象（実行ごと。1実行 1,000 行まで）。応答の本文・URL・キーは保存しない。文言はアプリで理由のコードから作る';

create index ingestion_run_failures_run_idx on public.ingestion_run_failures (run_id, id);

alter table public.ingestion_run_failures enable row level security;
revoke all on public.ingestion_run_failures from public, anon, authenticated;
grant select on public.ingestion_run_failures to authenticated;
grant all on public.ingestion_run_failures to service_role;
create policy "許可ユーザーのみ参照可" on public.ingestion_run_failures
  for select to authenticated using ((select public.current_user_is_allowed()));

-- ---------------------------------------------------------------------------
-- 3. 上場廃止
-- ---------------------------------------------------------------------------
alter table public.stocks add column delisted_on date;

comment on column public.stocks.delisted_on is
  '上場廃止を確認した銘柄マスタの日付（J-Quants の Date）。NULL = 上場中。行は消さない（手動補正が連鎖して消えるため）';

create index stocks_delisted_idx on public.stocks (code) where delisted_on is not null;

-- ---------------------------------------------------------------------------
-- 4. 最後に保存した時刻（保存の関数が書く表の文単位のトリガー）
-- ---------------------------------------------------------------------------
create function private.touch_ingestion_progress()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.ingestion_runs r
     set last_progress_at = now()
   where r.status = 'running'
     and r.id in (select distinct n.run_id from new_rows n where n.run_id is not null);
  return null;
end;
$$;

revoke execute on function private.touch_ingestion_progress() from public, anon, authenticated;

create trigger stock_listing_dates_progress after insert on public.stock_listing_dates
  referencing new table as new_rows for each statement execute function private.touch_ingestion_progress();
create trigger financial_fetched_dates_progress_ins after insert on public.financial_fetched_dates
  referencing new table as new_rows for each statement execute function private.touch_ingestion_progress();
create trigger financial_fetched_dates_progress_upd after update on public.financial_fetched_dates
  referencing new table as new_rows for each statement execute function private.touch_ingestion_progress();
create trigger edinet_list_fetched_dates_progress_ins after insert on public.edinet_list_fetched_dates
  referencing new table as new_rows for each statement execute function private.touch_ingestion_progress();
create trigger edinet_list_fetched_dates_progress_upd after update on public.edinet_list_fetched_dates
  referencing new table as new_rows for each statement execute function private.touch_ingestion_progress();
create trigger annual_report_extractions_progress after insert on public.annual_report_extractions
  referencing new table as new_rows for each statement execute function private.touch_ingestion_progress();
create trigger business_results_extractions_progress after insert on public.business_results_extractions
  referencing new table as new_rows for each statement execute function private.touch_ingestion_progress();

-- ---------------------------------------------------------------------------
-- 5. 実行の開始（応答の無くなった実行の後片付け）と終了
-- ---------------------------------------------------------------------------
create or replace function public.start_ingestion_run(p_target text, p_trigger text)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_run_id bigint;
  v_active jsonb;
begin
  -- 保存済みがあれば「一部完了」（stale）、無ければ今までどおり「失敗」と旧い文言
  update public.ingestion_runs
     set status = case when processed_count > 0 then 'partial' else 'failed' end,
         stopped_reason = case when processed_count > 0 then 'stale' end,
         finished_at = now(),
         error_message = case
           when processed_count > 0 then
             '応答が無くなったため中断されたものとみなしました（15 分以上）。保存済みの分は残っています。残りは次回の取り込みで処理します'
           else '15 分以上応答が無かったため、中断されたものとみなしました'
         end
   where status = 'running'
     and started_at < now() - interval '15 minutes';

  begin
    insert into public.ingestion_runs (target, trigger, status)
    values (p_target, p_trigger, 'running')
    returning id into v_run_id;
  exception when unique_violation then
    select jsonb_build_object(
             'id', r.id, 'target', r.target, 'trigger', r.trigger, 'status', r.status,
             'startedAt', r.started_at, 'finishedAt', r.finished_at,
             'processedCount', r.processed_count, 'errorMessage', r.error_message)
      into v_active
      from public.ingestion_runs r
     where r.status = 'running'
     limit 1;
    return jsonb_build_object('started', false, 'activeRun', v_active);
  end;

  return jsonb_build_object('started', true, 'runId', v_run_id);
end;
$$;

/**
 * 実行の終了（Sprint 4 の関数に p_outcome を加えた）。p_outcome:
 *   { stoppedReason, remainingCount, remainingUnit, failedCount,
 *     failures: [{ itemType, itemKey, code, reason, httpStatus, networkError }] }（1,000 行まで保存する）
 */
drop function public.finish_ingestion_run(bigint, text, integer, text, jsonb);

create function public.finish_ingestion_run(
  p_run_id bigint,
  p_status text,
  p_processed_count integer,
  p_error_message text,
  p_details jsonb,
  p_outcome jsonb default null
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
         details = coalesce(p_details, details),
         stopped_reason = p_outcome ->> 'stoppedReason',
         remaining_count = (p_outcome ->> 'remainingCount')::integer,
         remaining_unit = p_outcome ->> 'remainingUnit',
         failed_count = coalesce((p_outcome ->> 'failedCount')::integer, 0)
   where id = p_run_id
     and status = 'running';
  if not found then
    return false;
  end if;

  insert into public.ingestion_run_failures (run_id, item_type, item_key, code, reason, http_status, network_error)
  select p_run_id, f.item_type, f.item_key, f.code, f.reason, f.http_status, f.network_error
    from (
      select x.value ->> 'itemType' as item_type, x.value ->> 'itemKey' as item_key, x.value ->> 'code' as code,
             x.value ->> 'reason' as reason, (x.value ->> 'httpStatus')::integer as http_status,
             x.value ->> 'networkError' as network_error, x.ordinality
        from jsonb_array_elements(coalesce(p_outcome -> 'failures', '[]'::jsonb)) with ordinality x
       order by x.ordinality
       limit 1000
    ) f
   order by f.ordinality
  on conflict (run_id, item_type, item_key) do nothing;

  return true;
end;
$$;

revoke execute on function public.finish_ingestion_run(bigint, text, integer, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.finish_ingestion_run(bigint, text, integer, text, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 6. 銘柄マスタの保存（上場廃止の確認と保護）
-- ---------------------------------------------------------------------------
/**
 * 銘柄マスタの保存と実行の終了を1つのトランザクションで行う（Sprint 3 の関数に上場廃止を加えた）。
 * - 対象の行（p_rows）に無い、上場中の保存済みの銘柄は上場廃止（delisted_on = 一覧の日付）。再び現れたら NULL に戻す。
 * - 新たに消えた銘柄が 100 を超えたら反映しない（J-Quants の一時的な欠落とみなす）。実行は partial（delisting_held）。
 * 戻り値: {"completed": true, "processedCount", "delistedCount", "relistedCount", "delistingHeld"} または {"completed": false}
 */
create or replace function public.complete_stock_master_run(p_run_id bigint, p_rows jsonb, p_details jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_count integer;
  v_codes text[];
  v_list_date date;
  v_relisted integer;
  v_missing integer;
  v_delisted integer := 0;
  v_held boolean := false;
begin
  select status into v_status from public.ingestion_runs where id = p_run_id for update;
  if v_status is distinct from 'running' then
    return jsonb_build_object('completed', false);
  end if;

  select coalesce(array_agg(r ->> 'code'), '{}'), max((r ->> 'listed_info_date')::date)
    into v_codes, v_list_date
    from jsonb_array_elements(p_rows) r;

  select count(*) into v_relisted from public.stocks s where s.delisted_on is not null and s.code = any (v_codes);

  insert into public.stocks as s (
    code, company_name, company_name_en, market_code, market_name,
    sector17_code, sector17_name, sector33_code, sector33_name,
    scale_category, product_category, listed_info_date, updated_at, delisted_on
  )
  select r.code, r.company_name, r.company_name_en, r.market_code, r.market_name,
         r.sector17_code, r.sector17_name, r.sector33_code, r.sector33_name,
         r.scale_category, r.product_category, r.listed_info_date, now(), null
    from jsonb_to_recordset(p_rows) as r(
      code text, company_name text, company_name_en text, market_code text, market_name text,
      sector17_code text, sector17_name text, sector33_code text, sector33_name text,
      scale_category text, product_category text, listed_info_date date
    )
  on conflict (code) do update set
    company_name = excluded.company_name,
    company_name_en = excluded.company_name_en,
    market_code = excluded.market_code,
    market_name = excluded.market_name,
    sector17_code = excluded.sector17_code,
    sector17_name = excluded.sector17_name,
    sector33_code = excluded.sector33_code,
    sector33_name = excluded.sector33_name,
    scale_category = excluded.scale_category,
    product_category = excluded.product_category,
    listed_info_date = excluded.listed_info_date,
    updated_at = excluded.updated_at,
    delisted_on = null;

  get diagnostics v_count = row_count;

  select count(*) into v_missing from public.stocks s where s.delisted_on is null and not (s.code = any (v_codes));
  if v_missing > 100 then
    v_held := true;
  elsif v_missing > 0 then
    update public.stocks s
       set delisted_on = coalesce(v_list_date, (now() at time zone 'Asia/Tokyo')::date)
     where s.delisted_on is null and not (s.code = any (v_codes));
    get diagnostics v_delisted = row_count;
  end if;

  update public.ingestion_runs
     set status = case when v_held then 'partial' else 'succeeded' end,
         stopped_reason = case when v_held then 'delisting_held' end,
         finished_at = greatest(now(), started_at),
         last_progress_at = now(),
         processed_count = v_count,
         error_message = case when v_held then
           '銘柄マスタから一度に ' || to_char(v_missing, 'FM999,999,999') || ' 銘柄が消えたため、上場廃止の反映を保留しました'
         end,
         details = coalesce(p_details, '{}'::jsonb) || jsonb_build_object(
           'delistedDetected', v_delisted, 'relisted', v_relisted, 'delistingHeld', case when v_held then v_missing else 0 end)
   where id = p_run_id;

  return jsonb_build_object('completed', true, 'processedCount', v_count, 'delistedCount', v_delisted,
                            'relistedCount', v_relisted, 'delistingHeld', v_held);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. 取り込みの対象から上場廃止の銘柄を除く
-- ---------------------------------------------------------------------------
create or replace function public.listing_dates_pending()
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
        where s.delisted_on is null
          and not exists (select 1 from public.stock_listing_dates d where d.code = s.code)),
      '[]'::jsonb
    )
  );
$$;

-- 本文の対象から、上場廃止の銘柄に結び付く書類を除く（Sprint 12）
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
         from targets t
        where t.code is null or not exists (select 1 from public.stocks x where x.code = t.code and x.delisted_on is not null)),
      '[]'::jsonb
    )
  );
$$;


-- ---------------------------------------------------------------------------
-- 8. スクリーニング・銘柄詳細（上場廃止）
-- ---------------------------------------------------------------------------
drop function public.screening_evaluate(jsonb, text[]);

/**
 * Sprint 11 の判定に is_delisted（上場廃止）を加えた。上場廃止の銘柄は、スクリーニングの結果に常に含めない（screen_stocks・stock_detail）。
 */
create function public.screening_evaluate(p_params jsonb, p_codes text[] default null)
returns table (code text, s_cagr text, s_margin text, s_years text, s_owner text, owner_result text,
               owner_auto_result text, owner_override text, matches_filters boolean, is_delisted boolean)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_cagr numeric := (p_params ->> 'cagr')::numeric / 100;
  v_margin numeric := (p_params ->> 'margin')::numeric / 100;
  v_years numeric := (p_params ->> 'years')::numeric;
  v_owner numeric := coalesce((p_params ->> 'owner')::numeric, 20);
  v_owner_mode text := coalesce(p_params ->> 'ownerMode', 'any');
  v_cagr_on boolean := coalesce((p_params ->> 'cagrOn')::boolean, true);
  v_margin_on boolean := coalesce((p_params ->> 'marginOn')::boolean, true);
  v_years_on boolean := coalesce((p_params ->> 'yearsOn')::boolean, true);
  v_owner_on boolean := coalesce((p_params ->> 'ownerOn')::boolean, true);
  v_markets text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_params -> 'markets', '[]')) x), '{}');
  v_sectors text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_params -> 'sectors', '[]')) x), '{}');
  v_uid uuid := auth.uid();
  v_reference date;
  v_cutoff date;
begin
  if v_cagr is null or v_margin is null or v_years is null then
    raise exception 'screening_evaluate: thresholds are required' using errcode = '22023';
  end if;
  if v_owner_mode not in ('any', 'president') then
    raise exception 'screening_evaluate: invalid ownerMode %', v_owner_mode using errcode = '22023';
  end if;

  select r.reference_date into v_reference from public.listing_reference_date r;
  if v_years_on then
    v_cutoff := public.listing_first_date_cutoff(v_reference, v_years);
  end if;

  return query
    with base as (
      select s.code,
             case when not v_cagr_on then 'off'
                  when m.revenue_cagr is null then 'unavailable'
                  when m.revenue_cagr >= v_cagr then 'met' else 'unmet' end as s_cagr,
             case when not v_margin_on then 'off'
                  when m.operating_margin is null then 'unavailable'
                  when m.operating_margin >= v_margin then 'met' else 'unmet' end as s_margin,
             case when not v_years_on then 'off'
                  when d.code is null or v_reference is null then 'unavailable'
                  when d.first_price_date = d.data_start_date then 'unmet'
                  when v_cutoff is not null and d.first_price_date >= v_cutoff then 'met' else 'unmet' end as s_years,
             public.owner_result_of(j.status, j.president_is_top_holder, j.owner_total_pct, v_owner_mode, v_owner) as auto_result,
             o.verdict as override,
             (cardinality(v_markets) = 0 or s.market_code = any (v_markets))
               and (cardinality(v_sectors) = 0 or s.sector33_code = any (v_sectors)) as matches_filters,
             s.delisted_on is not null as is_delisted
        from public.stocks s
        left join public.financial_metrics m on m.code = s.code
        left join public.stock_listing_dates d on d.code = s.code
        left join public.ownership_judgments j on j.code = s.code
        left join public.ownership_overrides o on o.code = s.code and o.user_id = v_uid
       where p_codes is null or s.code = any (p_codes)
    )
    select b.code, b.s_cagr, b.s_margin, b.s_years,
           case when not v_owner_on then 'off'
                else public.owner_status_of(coalesce(b.override, b.auto_result), v_owner_mode) end,
           coalesce(b.override, b.auto_result),
           b.auto_result,
           b.override,
           b.matches_filters,
           b.is_delisted
      from base b;
end;
$$;


comment on function public.screening_evaluate(jsonb, text[]) is
  '条件①〜④の状態と市場・業種の絞り込みの判定（条件④は呼び出したユーザーの手動補正を含む）と上場廃止。screen_stocks と stock_detail が共有する唯一の判定の式。security invoker（RLS が効く）';

/**
 * スクリーニング（Sprint 11 に上場廃止の除外を加えた）。上場廃止の銘柄は条件・含める設定に関係なく結果に出さず、件数にも数えない。
 */
create or replace function public.screen_stocks(p_params jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_include boolean := coalesce((p_params ->> 'includeUnavailable')::boolean, false);
  v_include_undet boolean := coalesce((p_params ->> 'includeUndeterminable')::boolean, false);
  v_sort text := coalesce(p_params ->> 'sort', 'cagr');
  v_asc boolean := coalesce(p_params ->> 'order', 'desc') = 'asc';
  v_page integer := greatest(coalesce((p_params ->> 'page')::integer, 1), 1);
  v_page_size integer := least(greatest(coalesce((p_params ->> 'pageSize')::integer, 100), 1), 500);
  v_clamp boolean := coalesce((p_params ->> 'clampPage')::boolean, false);
  v_reference date;
  v_total integer;
  v_excl_unavailable integer;
  v_excl_undet integer;
  v_total_pages integer;
  v_rows jsonb;
begin
  if v_sort not in ('cagr', 'margin', 'years', 'owner', 'code', 'name', 'market', 'sector') then
    raise exception 'screen_stocks: invalid sort %', v_sort using errcode = '22023';
  end if;
  if (p_params ->> 'cagr') is null or (p_params ->> 'margin') is null or (p_params ->> 'years') is null then
    raise exception 'screen_stocks: thresholds are required' using errcode = '22023';
  end if;

  select r.reference_date into v_reference from public.listing_reference_date r;

  with cand as materialized (
    select e.code, e.s_cagr, e.s_margin, e.s_years, e.s_owner, e.owner_result, e.owner_auto_result,
           case v_sort
             when 'cagr' then m.revenue_cagr
             when 'margin' then m.operating_margin
             when 'years' then
               case when d.code is null then null
                    when d.first_price_date = d.data_start_date then 100000 - (d.data_start_date - date '1970-01-01')
                    else -(d.first_price_date - date '1970-01-01') end
             when 'owner' then case when j.status = 'determined' then j.owner_total_pct end
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
      left join public.ownership_judgments j on j.code = e.code
     where e.matches_filters and not e.is_delisted
  ),
  passed as (
    select c.*,
           (c.s_cagr <> 'unavailable' and c.s_margin <> 'unavailable' and c.s_years <> 'unavailable') as ok_a,
           (c.s_owner <> 'unavailable') as ok_b
      from cand c
     where c.s_cagr <> 'unmet' and c.s_margin <> 'unmet' and c.s_years <> 'unmet' and c.s_owner <> 'unmet'
  ),
  flagged as (
    select p.*, (v_include or p.ok_a) and (v_include_undet or p.ok_b) as included from passed p
  ),
  counts as (
    select (count(*) filter (where f.included))::integer as total,
           (count(*) filter (where not v_include and not f.ok_a))::integer as excl_unavailable,
           (count(*) filter (where not v_include_undet and (v_include or f.ok_a) and not f.ok_b))::integer as excl_undet
      from flagged f
  ),
  paging as (
    select n.*, greatest(ceil(n.total::numeric / v_page_size)::integer, 1) as total_pages from counts n
  ),
  page_no as (
    select g.*, case when v_clamp and v_page > g.total_pages then g.total_pages else v_page end as page
      from paging g
  ),
  ordered as (
    select f.code, f.s_cagr, f.s_margin, f.s_years, f.s_owner, f.owner_result, f.owner_auto_result,
           row_number() over (
             order by ((f.num_key is null) and (f.txt_key is null)),
                      case when v_asc then f.num_key end asc,
                      case when not v_asc then f.num_key end desc,
                      case when v_asc then f.txt_key end asc,
                      case when not v_asc then f.txt_key end desc,
                      f.code asc
           ) as ord
      from flagged f
     where f.included
  ),
  page as materialized (
    select o.*
      from ordered o, page_no n
     where o.ord > (n.page - 1) * v_page_size and o.ord <= n.page * v_page_size
  )
  select n.total, n.excl_unavailable, n.excl_undet, n.total_pages, n.page,
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
              'ownership', public.ownership_summary(p.code, p.owner_result, p.owner_auto_result, p_params),
              'status', jsonb_build_object('cagr', p.s_cagr, 'margin', p.s_margin, 'years', p.s_years, 'owner', p.s_owner)
            ) order by p.ord), '[]'::jsonb)
            from page p
            join public.stocks s on s.code = p.code
            left join public.financial_metrics m on m.code = p.code
            left join public.stock_listing_dates d on d.code = p.code
            left join lateral public.listing_years_between(
              case when d.first_price_date = d.data_start_date then d.data_start_date else d.first_price_date end,
              v_reference
            ) y on true)
    into v_total, v_excl_unavailable, v_excl_undet, v_total_pages, v_page, v_rows
    from page_no n;

  return jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'page', v_page,
    'pageSize', v_page_size,
    'totalPages', v_total_pages,
    'excludedUnavailable', v_excl_unavailable,
    'excludedUndeterminable', v_excl_undet,
    'referenceDate', v_reference,
    'stockCount', (select count(*) from public.stocks s where s.delisted_on is null),
    'delistedCount', (select count(*) from public.stocks s where s.delisted_on is not null),
    'metricsCount', (select count(*) from public.financial_metrics),
    'listingDatesCount', (select count(*) from public.stock_listing_dates),
    'ownershipDeterminedCount', (select count(*) from public.ownership_judgments j where j.status = 'determined')
  );
end;
$$;

/**
 * 銘柄詳細（Sprint 11 に上場廃止を加えた）。上場廃止の銘柄は 404 にせず、included は常に false。
 */
create or replace function public.stock_detail(p_code text, p_params jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_include boolean := coalesce((p_params ->> 'includeUnavailable')::boolean, false);
  v_include_undet boolean := coalesce((p_params ->> 'includeUndeterminable')::boolean, false);
  v_reference date;
  v_result jsonb;
begin
  select r.reference_date into v_reference from public.listing_reference_date r;

  select jsonb_build_object(
           'stock', jsonb_build_object(
             'code', s.code,
             'company_name', s.company_name,
             'market_code', s.market_code,
             'market_name', s.market_name,
             'sector33_code', s.sector33_code,
             'sector33_name', s.sector33_name,
             'delisted_on', s.delisted_on
           ),
           'referenceDate', v_reference,
           'listing', case when d.code is null then null else jsonb_build_object(
             'first_price_date', d.first_price_date,
             'data_start_date', d.data_start_date,
             'listed_before_data_start', d.first_price_date = d.data_start_date,
             'listing_years_exact', case when d.first_price_date > d.data_start_date then y.exact_years end,
             'estimated_listing_years', case when d.first_price_date > d.data_start_date then y.rounded_up_years end,
             'listing_years_lower_bound', case when d.first_price_date = d.data_start_date then y.whole_years end
           ) end,
           'evaluation', jsonb_build_object(
             'status', jsonb_build_object('cagr', e.s_cagr, 'margin', e.s_margin, 'years', e.s_years, 'owner', e.s_owner),
             'ownerResult', e.owner_result,
             'ownerAutoResult', e.owner_auto_result,
             'ownerOverride', e.owner_override,
             'matchesFilters', e.matches_filters,
             'delisted', e.is_delisted,
             'included', not e.is_delisted and e.matches_filters
               and e.s_cagr <> 'unmet' and e.s_margin <> 'unmet' and e.s_years <> 'unmet' and e.s_owner <> 'unmet'
               and (v_include or (e.s_cagr <> 'unavailable' and e.s_margin <> 'unavailable' and e.s_years <> 'unavailable'))
               and (v_include_undet or e.s_owner <> 'unavailable')
           ),
           'ownership', public.ownership_summary(s.code, e.owner_result, e.owner_auto_result, p_params) || jsonb_build_object(
             'holders', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'rank', h.rank, 'name', h.name, 'ratio_pct', h.ratio_pct::text, 'ratio_decimals', h.ratio_decimals,
                        'category', h.category, 'reason_code', h.reason_code, 'reason', h.reason
                      ) order by h.rank)
                 from public.ownership_holder_classifications h where h.code = s.code
             ), '[]'::jsonb),
             'documents', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'role', x.role, 'doc_id', doc.doc_id, 'doc_type_code', doc.doc_type_code, 'submitted_at', doc.submitted_at
                      ) order by x.ord)
                 from (values (1, 'shareholders', j.shareholders_doc_id), (2, 'officers', j.officers_doc_id),
                              (3, 'shareholders_pending', j.shareholders_pending_doc_id), (4, 'officers_pending', j.officers_pending_doc_id)) as x(ord, role, doc_id)
                 join public.edinet_documents doc on doc.doc_id = x.doc_id
             ), '[]'::jsonb)
           )
         )
    into v_result
    from public.stocks s
    join public.screening_evaluate(p_params, array[p_code]) e on e.code = s.code
    left join public.stock_listing_dates d on d.code = s.code
    left join public.ownership_judgments j on j.code = s.code
    left join lateral public.listing_years_between(
      case when d.first_price_date = d.data_start_date then d.data_start_date else d.first_price_date end,
      v_reference
    ) y on true
   where s.code = p_code;

  return v_result;
end;
$$;


-- ---------------------------------------------------------------------------
-- 9. ダッシュボード（上場廃止の数）
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_summary()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'stockCount', (select count(*) from public.stocks),
    'delistedCount', (select count(*) from public.stocks s where s.delisted_on is not null),
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

-- 絞り込みの選択肢の銘柄数からも、上場廃止の銘柄を除く（検索の対象と数をそろえる）
create or replace function public.screening_filter_options()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'sectors', coalesce((
      select jsonb_agg(jsonb_build_object('code', x.code, 'name', x.name, 'count', x.n) order by x.code)
        from (select s.sector33_code as code, min(s.sector33_name) as name, count(*) as n
                from public.stocks s
               where s.sector33_code is not null and s.delisted_on is null
               group by s.sector33_code) x
    ), '[]'::jsonb),
    'markets', coalesce((
      select jsonb_object_agg(x.code, x.n)
        from (select s.market_code as code, count(*) as n
                from public.stocks s
               where s.market_code is not null and s.delisted_on is null
               group by s.market_code) x
    ), '{}'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- 10. データの鮮度と未取得の残り（target ごと。判定の1か所）
-- ---------------------------------------------------------------------------
/**
 * target ごとの最終更新（succeeded・partial の最新の終了。stale の行は last_progress_at）と、古いか（p_now − 最終更新 ≥ 48 時間）。
 * 一度も更新していない target は古いとしない。残りは、最新の終了済みの実行（failed で残りが NULL の実行は除く）の remaining_count。
 * 戻り値: { stale, lastUpdatedAt（古い target のうち最も古い日時。古くなければ NULL）,
 *           targets: [{ target, lastUpdatedAt, stale, remainingCount, remainingUnit }] }（定期実行の順）
 */
create function public.data_freshness(p_now timestamptz default now())
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with t(target, ord) as (
    values ('stock_master', 1), ('daily_quotes', 2), ('financials', 3), ('edinet_reports', 4)
  ),
  per_target as (
    select t.target, t.ord,
           (select max(case when r.stopped_reason = 'stale' then r.last_progress_at else r.finished_at end)
              from public.ingestion_runs r
             where r.target = t.target and r.status in ('succeeded', 'partial')) as last_at,
           (select jsonb_build_object('count', r.remaining_count, 'unit', r.remaining_unit)
              from public.ingestion_runs r
             where r.target = t.target and r.status <> 'running'
               and not (r.status = 'failed' and r.remaining_count is null)
             order by r.finished_at desc, r.id desc
             limit 1) as remaining
      from t
  ),
  flagged as (
    select p.*, (p.last_at is not null and p_now - p.last_at >= interval '48 hours') as is_stale from per_target p
  )
  select jsonb_build_object(
    'stale', coalesce(bool_or(f.is_stale), false),
    'lastUpdatedAt', min(f.last_at) filter (where f.is_stale),
    'targets', jsonb_agg(jsonb_build_object(
      'target', f.target,
      'lastUpdatedAt', f.last_at,
      'stale', f.is_stale,
      'remainingCount', case when (f.remaining ->> 'count')::integer > 0 then (f.remaining ->> 'count')::integer end,
      'remainingUnit', case when (f.remaining ->> 'count')::integer > 0 then f.remaining ->> 'unit' end
    ) order by f.ord)
  )
  from flagged f;
$$;

-- ---------------------------------------------------------------------------
-- 11. 権限
-- ---------------------------------------------------------------------------
revoke execute on function public.start_ingestion_run(text, text) from public, anon, authenticated;
revoke execute on function public.complete_stock_master_run(bigint, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.listing_dates_pending() from public, anon, authenticated;
revoke execute on function public.edinet_ingestion_state(date, date) from public, anon, authenticated;
revoke execute on function public.screening_evaluate(jsonb, text[]) from public, anon, authenticated;
revoke execute on function public.screen_stocks(jsonb) from public, anon, authenticated;
revoke execute on function public.stock_detail(text, jsonb) from public, anon, authenticated;
revoke execute on function public.dashboard_summary() from public, anon, authenticated;
revoke execute on function public.screening_filter_options() from public, anon, authenticated;
revoke execute on function public.data_freshness(timestamptz) from public, anon, authenticated;
grant execute on function public.start_ingestion_run(text, text) to service_role;
grant execute on function public.complete_stock_master_run(bigint, jsonb, jsonb) to service_role;
grant execute on function public.listing_dates_pending() to service_role;
grant execute on function public.edinet_ingestion_state(date, date) to service_role;
grant execute on function public.screening_evaluate(jsonb, text[]) to authenticated, service_role;
grant execute on function public.screen_stocks(jsonb) to authenticated, service_role;
grant execute on function public.stock_detail(text, jsonb) to authenticated, service_role;
grant execute on function public.dashboard_summary() to authenticated, service_role;
grant execute on function public.screening_filter_options() to authenticated, service_role;
grant execute on function public.data_freshness(timestamptz) to authenticated, service_role;
