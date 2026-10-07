-- Sprint 16（F16）: 事業の内容（有価証券報告書の「第1 企業の概況 › 3 事業の内容」の最初の段落）
-- 契約: docs/harness/sprints/sprint-16/contract.md
--
-- - EDINET の取り込み（target edinet_reports）の書類ごとの処理の3つ目。大株主・役員（annual_report_extractions）、
--   主要な経営指標等（business_results_extractions）と同じ ZIP から読み、1トランザクションで保存する（save_edinet_extractions）。
-- - 使う書類の選び方は、大株主・役員の区画（annual_report_sections_for）と同じ規則の1か所（business_description_sections_for）。
--   annual_report_sections_for・annual_report_candidates_for・annual_report_detail は変えない（条件④・大株主・役員の表示に影響させない）。
-- - 指標・判定には使わないので、再計算のトリガーは付けない。
-- - 既存のテーブルの行は変えない（このマイグレーションに既存のテーブルへの insert・update・delete は無い。AC16.8）。
--   導入後の EDINET の取り込みが、事業の内容が未処理の有報を1回ずつ取得して、事業の内容だけを保存する。

-- ---------------------------------------------------------------------------
-- 1. 抽出の結果
-- ---------------------------------------------------------------------------
create table public.business_description_extractions (
  doc_id text primary key references public.edinet_documents (doc_id) on delete cascade,
  processed_at timestamptz not null default now(),
  status text not null check (status in ('ok', 'no_xbrl', 'section_not_found', 'invalid_values')),
  detail text,
  paragraph text,
  run_id bigint references public.ingestion_runs (id) on delete set null,
  -- 段落は ok のときだけ。1〜20,000 コードポイント、前後に空白（JavaScript の \s と同じ集合。lib/text/whitespace.ts）が無い
  constraint business_description_extractions_paragraph check (
    (status = 'ok') = (paragraph is not null)
    and (
      paragraph is null
      or (
        char_length(paragraph) between 1 and 20000
        and paragraph !~ '^[\t\n\v\f\r    -     　﻿]'
        and paragraph !~ '[\t\n\v\f\r    -     　﻿]$'
      )
    )
  )
);

comment on table public.business_description_extractions is
  '有報・訂正有報の本文から「事業の内容」の最初の段落を抽出した結果（Sprint 16）。行があれば処理済み（取り直さない）。取り直すときは行を消す。';
comment on column public.business_description_extractions.paragraph is
  '最初の段落（原文のまま。前後の空白だけを除く。改行は U+000A）。status が ok のときだけ';

alter table public.business_description_extractions enable row level security;
revoke all on public.business_description_extractions from public, anon, authenticated;
grant select on public.business_description_extractions to authenticated;
grant all on public.business_description_extractions to service_role;
create policy "許可ユーザーのみ参照可" on public.business_description_extractions
  for select to authenticated using ((select public.current_user_is_allowed()));

-- 最後に保存した時刻（Sprint 12）
create trigger business_description_extractions_progress after insert on public.business_description_extractions
  referencing new table as new_rows for each statement execute function private.touch_ingestion_progress();

-- ---------------------------------------------------------------------------
-- 2. 使う書類の選び方（1か所）
-- ---------------------------------------------------------------------------
/**
 * 銘柄ごとの事業の内容の区画の書類と結果。規則は annual_report_sections_for の大株主の列と同じ:
 * 候補（annual_report_candidates_for。対象の事業年度の有報・訂正有報、提出日時の新しい順。取り下げ・不開示・事業年度不明を除く）を
 * 新しい順に見て、未処理（pending）か ok・invalid_values の書類で止まる。section_not_found・no_xbrl は飛ばして古い書類へ。
 * どこでも止まらなければ最新の候補の結果。候補の無い銘柄は行を返さない。p_codes が NULL なら全銘柄。
 */
create function public.business_description_sections_for(p_codes text[])
returns table (
  code text,
  latest_doc_id text, latest_doc_type_code text, latest_submitted_at timestamptz, latest_status text,
  doc_id text, doc_type_code text, submitted_at timestamptz,
  fiscal_period_start date, fiscal_period_end date,
  status text, detail text, fallback boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with c as (
    select c.*, e.doc_id is not null as processed,
           case when e.doc_id is null then 'pending' else e.status end as status, e.detail
      from public.annual_report_candidates_for(p_codes) c
      left join public.business_description_extractions e on e.doc_id = c.doc_id
  ),
  latest as (select * from c where c."position" = 1),
  chosen as (
    select distinct on (c.code) c.*
      from c
     where c.status in ('pending', 'ok', 'invalid_values')
     order by c.code, c."position"
  )
  select l.code,
         l.doc_id, l.doc_type_code, l.submitted_at, l.status,
         coalesce(ch.doc_id, l.doc_id),
         coalesce(ch.doc_type_code, l.doc_type_code),
         coalesce(ch.submitted_at, l.submitted_at),
         l.fiscal_period_start,
         l.fiscal_period_end,
         coalesce(ch.status, l.status),
         case when ch.doc_id is not null then ch.detail else l.detail end,
         coalesce(ch.doc_id, l.doc_id) <> l.doc_id
    from latest l
    left join chosen ch on ch.code = l.code;
$$;

comment on function public.business_description_sections_for(text[]) is
  '事業の内容の区画の書類の選び方（Sprint 16。大株主・役員の区画と同じ規則）。画面・取り込み状況・取り込みの対象が使う1か所';

/** 銘柄詳細の事業の内容（Sprint 16）。候補が無ければ NULL。 */
create function public.business_description_detail(p_code text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
           'status', s.status,
           'detail', s.detail,
           'paragraph', case when s.status = 'ok' then e.paragraph end,
           'document', jsonb_build_object(
             'doc_id', s.doc_id,
             'doc_type_code', s.doc_type_code,
             'submitted_at', s.submitted_at,
             'period_start', s.fiscal_period_start,
             'period_end', s.fiscal_period_end
           ),
           'fallback', s.fallback,
           'latest', jsonb_build_object(
             'doc_id', s.latest_doc_id,
             'doc_type_code', s.latest_doc_type_code,
             'submitted_at', s.latest_submitted_at,
             'status', s.latest_status
           )
         )
    from public.business_description_sections_for(array[p_code]) s
    left join public.business_description_extractions e on e.doc_id = s.doc_id
   where s.code = p_code;
$$;

-- ---------------------------------------------------------------------------
-- 3. 1書類の保存（大株主・役員、主要な経営指標等、事業の内容）
-- ---------------------------------------------------------------------------
drop function public.save_edinet_extractions(bigint, text, jsonb, jsonb);

/**
 * 1書類の抽出の結果を1トランザクションで保存する。NULL の処理は触らない（行を消さず、書き換えず、再計算のトリガーも起こさない）。
 * 処理件数は書類ごとに1。実行が running でなければ何も保存しない。
 */
create function public.save_edinet_extractions(
  p_run_id bigint,
  p_doc_id text,
  p_annual_report jsonb,
  p_business_results jsonb,
  p_business_description jsonb
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

  if p_business_description is not null then
    delete from public.business_description_extractions where doc_id = p_doc_id;
    insert into public.business_description_extractions (doc_id, processed_at, status, detail, paragraph, run_id)
    values (
      p_doc_id, now(), p_business_description ->> 'status', p_business_description ->> 'detail',
      p_business_description ->> 'paragraph', p_run_id
    );
  end if;

  update public.ingestion_runs set processed_count = processed_count + 1 where id = p_run_id;

  return jsonb_build_object('saved', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. 取り込みの対象（事業の内容が取り込み待ちの書類を加える）
-- ---------------------------------------------------------------------------
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
  description_pending as (
    select b.doc_id from public.business_description_sections_for(null) b where b.status = 'pending'
  ),
  business as (select t.doc_id, t.priority from public.business_results_targets t),
  targets as (
    select d.doc_id, d.sec_code, d.xbrl_available, d.doc_type_code, d.submitted_at,
           (d.doc_type_code in ('120', '130')
             and not exists (select 1 from public.annual_report_extractions e where e.doc_id = d.doc_id)) as needs_annual,
           b.doc_id is not null as needs_business,
           (d.doc_type_code in ('120', '130')
             and not exists (select 1 from public.business_description_extractions e where e.doc_id = d.doc_id)) as needs_description,
           coalesce(b.priority, 1) as priority,
           (select c.code from public.edinet_document_codes c where c.doc_id = d.doc_id) as code
      from public.edinet_documents d
      left join business b on b.doc_id = d.doc_id
     where d.doc_id in (select doc_id from annual_pending)
        or d.doc_id in (select doc_id from description_pending)
        or b.doc_id is not null
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
                'needsAnnualReport', t.needs_annual, 'needsBusinessResults', t.needs_business,
                'needsBusinessDescription', t.needs_description)
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
-- 5. 取り込み状況の要約（事業の内容の件数を加える。既存のキーと値は変えない）
-- ---------------------------------------------------------------------------
create or replace function public.annual_reports_summary()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with listed as materialized (select st.code from public.stocks st where st.delisted_on is null),
  s as (select a.* from public.annual_report_sections a join listed l on l.code = a.code),
  pending_docs as (
    select shareholders_doc_id as doc_id from s where shareholders_status = 'pending'
    union
    select officers_doc_id from s where officers_status = 'pending'
  ),
  bd as materialized (
    select b.* from public.business_description_sections_for(null) b join listed l on l.code = b.code
  ),
  last_run as (
    select r.id, r.status, r.finished_at, r.processed_count, r.details
      from public.ingestion_runs r
     where r.target = 'edinet_reports' and r.status <> 'running'
     order by r.finished_at desc nulls last, r.id desc
     limit 1
  )
  select jsonb_build_object(
    'stockCount', (select count(*) from listed),
    'documentCount', (select count(*) from public.edinet_documents),
    'fetchedStockCount', (select count(*) from s where s.latest_processed),
    'bothExtractedCount', (select count(*) from s where s.shareholders_status = 'ok' and s.officers_status = 'ok'),
    'notExtractedCount', (
      select count(*) from s
       where (s.shareholders_status not in ('ok', 'pending') or s.officers_status not in ('ok', 'pending'))
    ),
    'pendingDocumentCount', (select count(*) from pending_docs),
    'listDatesFetched', (select count(*) from public.edinet_list_fetched_dates),
    'lastRun', (
      select jsonb_build_object('status', l.status, 'finishedAt', l.finished_at, 'processedCount', l.processed_count,
                                'details', l.details)
        from last_run l
    ),
    'ownership', (
      select jsonb_build_object(
        'determinedCount', count(*) filter (where j.status = 'determined'),
        'noAnnualReportCount', (select count(*) from listed) - count(*),
        'annualReportPendingCount', count(*) filter (where j.undeterminable_reason = 'annual_report_pending'),
        'shareholdersNotExtractedCount', count(*) filter (where j.undeterminable_reason = 'shareholders_not_extracted'),
        'officersNotExtractedCount', count(*) filter (where j.undeterminable_reason = 'officers_not_extracted'),
        'presidentNotFoundCount', count(*) filter (where j.undeterminable_reason = 'president_not_found'),
        'previousReportCount', count(*) filter (
          where j.status = 'determined' and (j.shareholders_pending_doc_id is not null or j.officers_pending_doc_id is not null))
      )
        from public.ownership_judgments j join listed l on l.code = j.code
    ),
    -- Sprint 16: 事業の内容（上場中の銘柄だけで数える。取り込み待ちの書類も上場中の銘柄の書類だけ）
    'businessDescription', jsonb_build_object(
      'stockCount', (select count(*) from listed),
      'extractedStockCount', (select count(*) from bd where bd.status = 'ok'),
      'pendingDocumentCount', (select count(distinct bd.doc_id) from bd where bd.status = 'pending'),
      'notFoundStockCount', (select count(*) from bd where bd.status = 'section_not_found'),
      'failedStockCount', (select count(*) from bd where bd.status in ('no_xbrl', 'invalid_values'))
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- 6. 権限
-- ---------------------------------------------------------------------------
revoke execute on function public.business_description_sections_for(text[]) from public, anon, authenticated;
revoke execute on function public.business_description_detail(text) from public, anon, authenticated;
revoke execute on function public.save_edinet_extractions(bigint, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.business_description_sections_for(text[]) to authenticated, service_role;
grant execute on function public.business_description_detail(text) to authenticated, service_role;
grant execute on function public.save_edinet_extractions(bigint, text, jsonb, jsonb, jsonb) to service_role;
