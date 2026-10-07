-- 契約（docs/harness/sprints/sprint-16/contract.md）の第5章の投入例。E2E と pnpm test:db が共有する。
-- 銘柄コード 9R001〜9R012、書類ID S16TEST…、提出者 E99R…。後片付けは business-description-cleanup.sql。
insert into public.stocks (code, company_name, market_code, market_name, sector33_code, sector33_name, product_category, delisted_on)
values ('9R001', '検証用事業内容株式会社',     '0113', 'グロース',     '5250', '情報・通信業', '011', null),
       ('9R002', '検証用長文株式会社',         '0111', 'プライム',     '3050', '食料品',       '011', null),
       ('9R003', '検証用部分訂正株式会社',     '0112', 'スタンダード', '9050', 'サービス業',   '011', null),
       ('9R004', '検証用全部訂正株式会社',     '0112', 'スタンダード', '9050', 'サービス業',   '011', null),
       ('9R005', '検証用有報なし株式会社',     '0113', 'グロース',     '5250', '情報・通信業', '011', null),
       ('9R006', '検証用取り込み待ち株式会社', '0113', 'グロース',     '5250', '情報・通信業', '011', null),
       ('9R007', '検証用記載なし株式会社',     '0111', 'プライム',     '3050', '食料品',       '011', null),
       ('9R008', '検証用段落なし株式会社',     '0112', 'スタンダード', '9050', 'サービス業',   '011', null),
       ('9R009', '検証用XBRLなし株式会社',     '0113', 'グロース',     '5250', '情報・通信業', '011', null),
       ('9R010', '検証用特殊文字株式会社',     '0113', 'グロース',     '5250', '情報・通信業', '011', null),
       ('9R011', '検証用取り下げ株式会社',     '0111', 'プライム',     '3050', '食料品',       '011', null),
       ('9R012', '検証用上場廃止株式会社',     '0112', 'スタンダード', '9050', 'サービス業',   '011', '2025-09-01');

insert into public.edinet_documents
  (doc_id, sec_code, edinet_code, filer_name, doc_type_code, ordinance_code, form_code,
   period_start, period_end, submitted_at, parent_doc_id, doc_description, withdrawn, withheld, xbrl_available, list_date)
values
  ('S16TEST00', '9R001', 'E99R01', '検証用事業内容株式会社', '120', '010', '030000', '2023-04-01', '2024-03-31', '2024-06-25 15:00+09', null, '有価証券報告書－第9期', false, false, true, '2024-06-25'),
  ('S16TEST01', '9R001', 'E99R01', '検証用事業内容株式会社', '120', '010', '030000', '2024-04-01', '2025-03-31', '2025-06-25 15:00+09', null, '有価証券報告書－第10期', false, false, true, '2025-06-25'),
  ('S16TEST11', '9R002', 'E99R02', '検証用長文株式会社', '120', '010', '030000', '2024-04-01', '2025-03-31', '2025-06-25 15:00+09', null, '有価証券報告書－第5期', false, false, true, '2025-06-25'),
  ('S16TEST21', '9R003', 'E99R03', '検証用部分訂正株式会社', '120', '010', '030000', '2024-04-01', '2025-03-31', '2025-06-26 15:00+09', null, '有価証券報告書－第30期', false, false, true, '2025-06-26'),
  ('S16TEST22', '9R003', 'E99R03', '検証用部分訂正株式会社', '130', '010', '030001', null, null, '2025-08-05 15:00+09', 'S16TEST21', '訂正有価証券報告書－第30期', false, false, true, '2025-08-05'),
  ('S16TEST31', '9R004', 'E99R04', '検証用全部訂正株式会社', '120', '010', '030000', '2024-04-01', '2025-03-31', '2025-06-26 15:00+09', null, '有価証券報告書－第8期', false, false, true, '2025-06-26'),
  ('S16TEST32', '9R004', 'E99R04', '検証用全部訂正株式会社', '130', '010', '030001', null, null, '2025-08-06 15:00+09', 'S16TEST31', '訂正有価証券報告書－第8期', false, false, true, '2025-08-06'),
  ('S16TEST51', '9R006', 'E99R06', '検証用取り込み待ち株式会社', '120', '010', '030000', '2024-04-01', '2025-03-31', '2025-06-27 15:00+09', null, '有価証券報告書－第3期', false, false, true, '2025-06-27'),
  ('S16TEST61', '9R007', 'E99R07', '検証用記載なし株式会社', '120', '010', '030000', '2024-04-01', '2025-03-31', '2025-06-27 15:00+09', null, '有価証券報告書－第12期', false, false, true, '2025-06-27'),
  ('S16TEST71', '9R008', 'E99R08', '検証用段落なし株式会社', '120', '010', '030000', '2024-04-01', '2025-03-31', '2025-06-27 15:00+09', null, '有価証券報告書－第7期', false, false, true, '2025-06-27'),
  ('S16TEST81', '9R009', 'E99R09', '検証用XBRLなし株式会社', '120', '010', '030000', '2024-04-01', '2025-03-31', '2025-06-27 15:00+09', null, '有価証券報告書－第4期', false, false, false, '2025-06-27'),
  ('S16TEST91', '9R010', 'E99R10', '検証用特殊文字株式会社', '120', '010', '030000', '2024-04-01', '2025-03-31', '2025-06-27 15:00+09', null, '有価証券報告書－第2期', false, false, true, '2025-06-27'),
  ('S16TESTA1', '9R011', 'E99R11', '検証用取り下げ株式会社', '120', '010', '030000', '2024-04-01', '2025-03-31', '2025-06-24 15:00+09', null, '有価証券報告書－第50期', false, false, true, '2025-06-24'),
  ('S16TESTA2', '9R011', 'E99R11', '検証用取り下げ株式会社', '130', '010', '030001', null, null, '2025-07-15 15:00+09', 'S16TESTA1', '訂正有価証券報告書－第50期', false, false, true, '2025-07-15'),
  ('S16TESTB1', '9R012', 'E99R12', '検証用上場廃止株式会社', '120', '010', '030000', '2024-04-01', '2025-03-31', '2025-06-27 15:00+09', null, '有価証券報告書－第6期', false, false, true, '2025-06-27');

-- 大株主・役員（9R001 は事業の内容と同じ有報。9R006 は導入前に大株主・役員を処理済みの形）
insert into public.annual_report_extractions
  (doc_id, processed_at, shareholders_status, officers_status, shareholders_detail, officers_detail,
   officers_basis, officers_has_post_agm_table, officers_order_source)
values ('S16TEST01', now(), 'ok', 'ok', null, null, 'filing_date', false, 'inline_document'),
       ('S16TEST51', now(), 'ok', 'ok', null, null, 'filing_date', false, 'inline_document');
insert into public.annual_report_shareholders (doc_id, rank, name, address, shares_held, ratio_pct, ratio_decimals)
values ('S16TEST01', 1, '事業　太郎', '東京都港区', 3000000, 30.00, 2),
       ('S16TEST51', 1, '待ち　花子', '大阪府大阪市', 2000000, 20.00, 2);
insert into public.annual_report_officers (doc_id, seq, name, title)
values ('S16TEST01', 1, '事業　太郎', '代表取締役社長'),
       ('S16TEST51', 1, '待ち　花子', '代表取締役社長');

insert into public.business_description_extractions (doc_id, processed_at, status, detail, paragraph)
values
  ('S16TEST00', now(), 'ok', null, '旧年度の段落です。'),
  ('S16TEST01', now(), 'ok', null, '当社グループは、当社及び連結子会社3社で構成されており、中小企業向けのクラウド会計ソフトの開発・販売を主な事業としております。'),
  ('S16TEST11', now(), 'ok', null, '当社は、' || repeat('検証用の長い段落の文です。', 35) || 'https://example.com/' || repeat('a', 120) || '。'),
  ('S16TEST21', now(), 'ok', null, '元の有報の段落です。'),
  ('S16TEST22', now(), 'section_not_found', null, null),
  ('S16TEST31', now(), 'ok', null, '訂正前の段落です。'),
  ('S16TEST32', now(), 'ok', null, '訂正後の段落です。'),
  ('S16TEST61', now(), 'section_not_found', null, null),
  ('S16TEST71', now(), 'invalid_values', 'no_paragraph', null),
  ('S16TEST81', now(), 'no_xbrl', 'xbrl_flag_off', null),
  ('S16TEST91', now(), 'ok', null, '当社は「<b>太字</b>」と &amp; と <script>alert(1)</script> を含む記載の検証用の会社であります。'),
  ('S16TESTA1', now(), 'ok', null, '取り下げ前の元の段落です。'),
  ('S16TESTA2', now(), 'ok', null, '取り下げられる訂正の段落です。'),
  ('S16TESTB1', now(), 'ok', null, '上場廃止の会社の段落です。');
