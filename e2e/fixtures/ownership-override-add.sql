-- 契約（docs/harness/sprints/sprint-11/contract.md）の第5章: AC10.5 用の追加。ownership-example.sql の後に入れる。
-- 9U006 の有報 SXTEST06 の訂正有報（新しく取り込まれた書類）。山田興産が大株主から外れ、自動判定は 17.0%・非該当になる。
-- 後片付けは ownership-override-cleanup.sql（SYTEST… を消す）。
insert into public.edinet_documents
  (doc_id, sec_code, edinet_code, filer_name, doc_type_code, ordinance_code, form_code,
   period_start, period_end, submitted_at, parent_doc_id, doc_description, withdrawn, withheld, xbrl_available, list_date)
values ('SYTEST16', '9U006', 'E99U06', '検証用内訳株式会社', '130', '010', '030001',
        '2025-04-01', '2026-03-31', '2026-09-20 15:00+09', 'SXTEST06', '訂正有価証券報告書－第10期', false, false, true, '2026-09-20');

insert into public.annual_report_extractions
  (doc_id, processed_at, shareholders_status, officers_status, shareholders_detail, officers_detail,
   officers_basis, officers_has_post_agm_table, officers_order_source)
values ('SYTEST16', now(), 'ok', 'ok', null, null, 'filing_date', false, 'inline_document');

insert into public.annual_report_shareholders (doc_id, rank, name, address, shares_held, ratio_pct, ratio_decimals)
values ('SYTEST16', 1, '日本マスタートラスト信託銀行株式会社（信託口）', '東京都港区', 2000000, 20.00, 2),
       ('SYTEST16', 2, '山田　太郎', '東京都港区', 1200000, 12.00, 2),
       ('SYTEST16', 3, '山田　花子', '東京都港区', 500000, 5.00, 2);

insert into public.annual_report_officers (doc_id, seq, name, title)
values ('SYTEST16', 1, '山田　太郎', '代表取締役社長'),
       ('SYTEST16', 2, '中村　健', '取締役');
