-- 契約（docs/harness/sprints/sprint-12/contract.md）の第5章の投入例。E2E と評価者が使う（postgres ユーザーで実行）。
-- 銘柄 9N001〜9N004（9N003 は上場廃止）、書類 S12NTST1、実行 A〜E（details の fixture = 'sprint-12'）。
-- 日時は now() からの相対（A〜E はすべて 3 時間以内に終わっているので、この投入例だけでは鮮度の警告は出ない）。
-- 後片付けは ingestion-reliability-cleanup.sql。

insert into public.stocks (code, company_name, market_code, market_name, sector33_code, sector33_name, product_category, delisted_on)
values ('9N001', '検証用株価失敗一株式会社', '0113', 'グロース', '5250', '情報・通信業', '011', null),
       ('9N002', '検証用株価失敗二株式会社', '0113', 'グロース', '5250', '情報・通信業', '011', null),
       ('9N003', '検証用上場廃止株式会社',   '0113', 'グロース', '5250', '情報・通信業', '011', '2026-09-18'),
       ('9N004', '検証用書類失敗株式会社',   '0113', 'グロース', '5250', '情報・通信業', '011', null);

insert into public.edinet_documents
  (doc_id, sec_code, edinet_code, filer_name, doc_type_code, ordinance_code, form_code,
   period_start, period_end, submitted_at, parent_doc_id, doc_description, withdrawn, withheld, xbrl_available, list_date)
values ('S12NTST1', '9N004', 'E12N01', '検証用書類失敗株式会社', '120', '010', '030000',
        '2025-04-01', '2026-03-31', '2026-06-25 15:00+09', null, '有価証券報告書－第5期', false, false, true, '2026-06-25');

with a as (
  insert into public.ingestion_runs (target, trigger, status, started_at, finished_at, last_progress_at, processed_count, error_message,
                                     details, stopped_reason, remaining_count, remaining_unit, failed_count)
  values ('daily_quotes', 'cron', 'partial', now() - interval '3 hours', now() - interval '3 hours' + interval '210 seconds',
          now() - interval '3 hours' + interval '205 seconds', 350,
          '時間内に処理しきれなかったため、残り 3,512 銘柄は次回の取り込みで処理します',
          '{"fixture":"sprint-12","run":"A","apiCalls":362,"rateLimit":{"hits":0,"retries":0,"waitedMs":0,"exhausted":false},"stoppedReason":"time_budget","remaining":3512}',
          'time_budget', 3512, 'stocks', 0)
  returning id
),
b as (
  insert into public.ingestion_runs (target, trigger, status, started_at, finished_at, last_progress_at, processed_count, error_message,
                                     details, stopped_reason, remaining_count, remaining_unit, failed_count)
  values ('daily_quotes', 'manual', 'partial', now() - interval '2 hours', now() - interval '2 hours' + interval '95 seconds',
          now() - interval '2 hours' + interval '90 seconds', 120,
          '2 銘柄で株価を取得できませんでした。次回の取り込みで再試行します',
          '{"fixture":"sprint-12","run":"B","apiCalls":124,"rateLimit":{"hits":0,"retries":0,"waitedMs":0,"exhausted":false},"stoppedReason":null,"remaining":0,"failed":2}',
          null, 0, 'stocks', 2)
  returning id
),
c as (
  insert into public.ingestion_runs (target, trigger, status, started_at, finished_at, last_progress_at, processed_count, error_message,
                                     details, stopped_reason, remaining_count, remaining_unit, failed_count)
  values ('financials', 'cron', 'partial', now() - interval '1 hour', now() - interval '1 hour' + interval '200 seconds',
          now() - interval '1 hour' + interval '80 seconds', 812,
          'J-Quants の呼び出し回数の上限に達しました（HTTP 429）。3 回待って再試行しましたが解消しなかったため中断しました。残り 20 日分の開示日は次回の取り込みで処理します。1 日分の開示日で財務情報を取得できませんでした。次回の取り込みで再試行します',
          '{"fixture":"sprint-12","run":"C","apiCalls":58,"rateLimit":{"hits":4,"retries":3,"waitedMs":105000,"exhausted":true},"stoppedReason":"rate_limited","datesRemaining":20,"datesFailed":1}',
          'rate_limited', 20, 'disclosure_dates', 1)
  returning id
),
d as (
  insert into public.ingestion_runs (target, trigger, status, started_at, finished_at, last_progress_at, processed_count, error_message,
                                     details, stopped_reason, remaining_count, remaining_unit, failed_count)
  values ('edinet_reports', 'cron', 'partial', now() - interval '30 minutes', now() - interval '30 minutes' + interval '211 seconds',
          now() - interval '30 minutes' + interval '208 seconds', 40,
          '時間内に処理しきれなかったため、残り 15 件の書類は次回の取り込みで処理します。1 日分の書類一覧を取得できませんでした。次回の取り込みで再試行します。1 件の書類を取得できませんでした。次回の取り込みで再試行します',
          '{"fixture":"sprint-12","run":"D","apiCalls":61,"rateLimit":{"hits":0,"retries":0,"waitedMs":0,"exhausted":false},"stoppedReason":"time_budget","documentsRemaining":15}',
          'time_budget', 15, 'documents', 2)
  returning id
),
e as (
  insert into public.ingestion_runs (target, trigger, status, started_at, finished_at, last_progress_at, processed_count, error_message,
                                     details, stopped_reason, remaining_count, remaining_unit, failed_count)
  values ('stock_master', 'cron', 'succeeded', now() - interval '20 minutes', now() - interval '20 minutes' + interval '4 seconds',
          now() - interval '20 minutes' + interval '4 seconds', 3861, null,
          '{"fixture":"sprint-12","run":"E","apiCalls":1,"rateLimit":{"hits":0,"retries":0,"waitedMs":0,"exhausted":false},"delistedDetected":0,"relisted":0,"delistingHeld":0}',
          null, null, null, 0)
  returning id
)
insert into public.ingestion_run_failures (run_id, item_type, item_key, code, reason, http_status, network_error)
select b.id, 'stock', '9N001', '9N001', 'http_error', 500, null from b
union all select b.id, 'stock', '9N002', '9N002', 'unreachable', null, 'timeout' from b
union all select c.id, 'disclosure_date', '2026-09-01', null, 'http_error', 500, null from c
union all select d.id, 'document', 'S12NTST1', '9N004', 'not_found', 404, null from d
union all select d.id, 'list_date', '2026-09-20', null, 'invalid_format', null, null from d;
