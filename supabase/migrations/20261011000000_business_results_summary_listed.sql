-- 取り込み状況の「上場前の期の補完（EDINET）」の「取り込み待ちの書類」（business_results_summary の pendingDocumentCount）を、
-- 上場中の銘柄の書類だけで数える。
-- EDINET の取り込み（edinet_ingestion_state）は上場廃止の銘柄の書類の本文を取得しないので、今までは取り込みを終えても
-- 上場廃止の銘柄の書類の数（本番で 14 件。2026-10-07）が残り続け、有報の区画（annual_reports_summary。上場中だけで数える）とも
-- 食い違っていた。ほかの項目は変えない（本文は 20261007000000 の定義と同じ）。
create or replace function public.business_results_summary()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with listed as materialized (select st.code from public.stocks st where st.delisted_on is null),
  supplemented as (
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
    'stockCount', (select count(*) from listed),
    'supplementedStockCount', (select count(*) from supplemented s join listed l on l.code = s.code),
    'supplementedCagrCount', (select count(*) from public.financial_metrics m join listed l on l.code = m.code
                               where m.revenue_cagr_supplemented),
    'processedAnnualReports', (select count(*) from processed p where p.doc_type_code in ('120', '130')),
    'processedRegistrationStatements', (select count(*) from processed p where p.doc_type_code in ('030', '040')),
    'statusCounts', coalesce((select jsonb_object_agg(x.status, x.n)
                                from (select p.status, count(*) as n from processed p group by p.status) x), '{}'::jsonb),
    'pendingDocumentCount', (select count(*) from public.business_results_targets t join listed l on l.code = t.code),
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
