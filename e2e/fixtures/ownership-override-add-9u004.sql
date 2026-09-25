-- 契約（docs/harness/sprints/sprint-11/contract.md）の C5-9: 有報未取得の 9U004 に、有報が取り込まれる。ownership-example.sql の後に入れる。
-- 自動判定は「該当（社長が筆頭株主）」40.0%・SYTEST04 になる。後片付けは ownership-override-cleanup.sql（SYTEST… を消す）。
insert into public.edinet_documents
  (doc_id, sec_code, edinet_code, filer_name, doc_type_code, ordinance_code, form_code,
   period_start, period_end, submitted_at, parent_doc_id, doc_description, withdrawn, withheld, xbrl_available, list_date)
values ('SYTEST04', '9U004', 'E99U04', '検証用有報未取得株式会社', '120', '010', '030000',
        '2025-04-01', '2026-03-31', '2026-09-20 15:00+09', null, '有価証券報告書－第10期', false, false, true, '2026-09-20');

insert into public.annual_report_extractions
  (doc_id, processed_at, shareholders_status, officers_status, shareholders_detail, officers_detail,
   officers_basis, officers_has_post_agm_table, officers_order_source)
values ('SYTEST04', now(), 'ok', 'ok', null, null, 'filing_date', false, 'inline_document');

insert into public.annual_report_shareholders (doc_id, rank, name, address, shares_held, ratio_pct, ratio_decimals)
values ('SYTEST04', 1, '石井　修', '東京都港区', 4000000, 40.00, 2),
       ('SYTEST04', 2, '日本マスタートラスト信託銀行株式会社（信託口）', '東京都港区', 800000, 8.00, 2);

insert into public.annual_report_officers (doc_id, seq, name, title)
values ('SYTEST04', 1, '石井　修', '代表取締役社長');
