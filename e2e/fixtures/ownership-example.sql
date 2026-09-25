-- 契約（docs/harness/sprints/sprint-10/contract.md）の第5章の投入例。E2E と pnpm test:db が共有する。
-- 銘柄コード 9U001〜9U014、書類ID SXTEST…、提出者 E99U…。後片付けは ownership-cleanup.sql。判定はトリガーで保存される。
-- 基準日（株価の取り込みの成功）
insert into public.ingestion_runs (target, trigger, status, started_at, finished_at, processed_count)
values ('daily_quotes', 'manual', 'succeeded', '2026-09-24 20:00:00+09', '2026-09-24 20:03:00+09', 0);

insert into public.stocks (code, company_name, market_code, market_name, sector33_code, sector33_name, product_category)
values ('9U001', '検証用社長筆頭株式会社',     '0113', 'グロース',     '5250', '情報・通信業', '011'),
       ('9U002', '検証用オーナー企業株式会社', '0113', 'グロース',     '5250', '情報・通信業', '011'),
       ('9U003', '検証用非該当株式会社',       '0112', 'スタンダード', '3050', '食料品',       '011'),
       ('9U004', '検証用有報未取得株式会社',   '0113', 'グロース',     '5250', '情報・通信業', '011'),
       ('9U005', '検証用抽出失敗株式会社',     '0113', 'グロース',     '9050', 'サービス業',   '011'),
       ('9U006', '検証用内訳株式会社',         '0111', 'プライム',     '5250', '情報・通信業', '011'),
       ('9U007', '検証用役員保有株式会社',     '0112', 'スタンダード', '9050', 'サービス業',   '011'),
       ('9U008', '検証用共同社長株式会社',     '0113', 'グロース',     '5250', '情報・通信業', '011'),
       ('9U009', '検証用異体字株式会社',       '0113', 'グロース',     '3050', '食料品',       '011'),
       ('9U010', '検証用代表者株式会社',       '0113', 'グロース',     '5250', '情報・通信業', '011'),
       ('9U011', '検証用低成長株式会社',       '0112', 'スタンダード', '5250', '情報・通信業', '011'),
       ('9U012', '検証用上場八年株式会社',     '0111', 'プライム',     '5250', '情報・通信業', '011'),
       ('9U013', '検証用取り込み待ち株式会社', '0113', 'グロース',     '5250', '情報・通信業', '011'),
       ('9U014', '検証用新有報待ち株式会社',   '0113', 'グロース',     '5250', '情報・通信業', '011');

-- 条件③: 3.0年（9U012 だけ 8.0年）
insert into public.stock_listing_dates (code, first_price_date, data_start_date)
select code, case when code = '9U012' then date '2018-09-24' else date '2023-09-24' end, date '2016-09-26'
  from public.stocks where code like '9U0%';

-- 条件①②: 売上CAGR 25.0%・営業利益率 15.0%（9U011 だけ CAGR 10.0%）。2022/03〜2026/03期、決算短信
insert into public.financial_statements
  (code, disclosure_no, disclosed_date, disclosed_time, document_type,
   fiscal_year_start, fiscal_year_end, net_sales, operating_profit)
select s.code, 'SX' || s.code || t.i, make_date(2021 + t.i::int, 5, 14), '15:00:00',
       'FYFinancialStatements_Consolidated_JP',
       make_date(2020 + t.i::int, 4, 1), make_date(2021 + t.i::int, 3, 31),
       t.sales * 100000000, t.sales * 0.15 * 100000000
  from public.stocks s
  cross join lateral unnest(case when s.code = '9U011'
                                 then array[100, 110, 121, 133.1, 146.41]::numeric[]
                                 else array[100, 125, 156.25, 195.3125, 244.140625]::numeric[] end)
       with ordinality as t(sales, i)
 where s.code like '9U0%';

-- 有報（9U004 は無し）。9U014 以外は 2026/03期、2026-06-25 提出
insert into public.edinet_documents
  (doc_id, sec_code, edinet_code, filer_name, doc_type_code, ordinance_code, form_code,
   period_start, period_end, submitted_at, parent_doc_id, doc_description, withdrawn, withheld, xbrl_available, list_date)
select 'SXTEST' || right(s.code, 2), s.code, 'E99U' || right(s.code, 2), s.company_name, '120', '010', '030000',
       '2025-04-01', '2026-03-31', '2026-06-25 15:00+09', null, '有価証券報告書－第10期', false, false, true, '2026-06-25'
  from public.stocks s
 where s.code like '9U0%' and s.code not in ('9U004', '9U014');

-- 9U014（取り込み待ちの間は直前の有報で判定する）: 2025/03期の有報（処理済み）と、2026/03期の有報（未処理）
insert into public.edinet_documents
  (doc_id, sec_code, edinet_code, filer_name, doc_type_code, ordinance_code, form_code,
   period_start, period_end, submitted_at, parent_doc_id, doc_description, withdrawn, withheld, xbrl_available, list_date)
values ('SXTEST14', '9U014', 'E99U14', '検証用新有報待ち株式会社', '120', '010', '030000',
        '2024-04-01', '2025-03-31', '2025-06-25 15:00+09', null, '有価証券報告書－第9期', false, false, true, '2025-06-25'),
       ('SXTEST15', '9U014', 'E99U14', '検証用新有報待ち株式会社', '120', '010', '030000',
        '2025-04-01', '2026-03-31', '2026-06-25 15:00+09', null, '有価証券報告書－第10期', false, false, true, '2026-06-25');

-- 抽出の結果（9U005 は大株主の抽出に失敗、9U013・SXTEST15 は未処理 = 行なし）
insert into public.annual_report_extractions
  (doc_id, processed_at, shareholders_status, officers_status, shareholders_detail, officers_detail,
   officers_basis, officers_has_post_agm_table, officers_order_source)
select d.doc_id, now(),
       case when d.doc_id = 'SXTEST05' then 'invalid_values' else 'ok' end, 'ok',
       case when d.doc_id = 'SXTEST05' then 'ratio_not_numeric' end, null,
       'filing_date', false, 'inline_document'
  from public.edinet_documents d
 where d.doc_id like 'SXTEST%' and d.doc_id not in ('SXTEST13', 'SXTEST15');

insert into public.annual_report_shareholders (doc_id, rank, name, address, shares_held, ratio_pct, ratio_decimals)
values
  -- 9U001（AC9.1）: 筆頭株主「山田 太郎」（半角空白）と、役員「山田太郎」（空白なし）
  ('SXTEST01', 1, '山田 太郎', '東京都港区', 3000000, 30.00, 2),
  ('SXTEST01', 2, '日本マスタートラスト信託銀行株式会社（信託口）', '東京都港区', 1000000, 10.00, 2),
  ('SXTEST01', 3, 'ＳＭＢＣ日興証券株式会社', '東京都千代田区', 300000, 3.00, 2),
  -- 9U002（AC9.2）: 筆頭は信託口。社長本人 8% ＋ ヤマダホールディングス 15% = 23%。持株会は区分5
  ('SXTEST02', 1, '日本マスタートラスト信託銀行株式会社（信託口）', '東京都港区', 2500000, 25.00, 2),
  ('SXTEST02', 2, '株式会社ヤマダホールディングス', '東京都港区', 1500000, 15.00, 2),
  ('SXTEST02', 3, '山田　一郎', '東京都港区', 800000, 8.00, 2),
  ('SXTEST02', 4, '株式会社日本カストディ銀行（信託口）', '東京都中央区', 600000, 6.00, 2),
  ('SXTEST02', 5, '鈴木　次郎', '神奈川県横浜市', 200000, 2.00, 2),
  ('SXTEST02', 6, '山田工業取引先持株会', '東京都港区', 150000, 1.50, 2),
  -- 9U003（AC9.3・AC9.11）: 関係者なし
  ('SXTEST03', 1, '株式会社日本カストディ銀行（信託口）', '東京都中央区', 1200000, 12.00, 2),
  ('SXTEST03', 2, '株式会社検証商事', '大阪府大阪市', 800000, 8.00, 2),
  ('SXTEST03', 3, '伊藤　花子', '東京都世田谷区', 300000, 3.00, 2),
  ('SXTEST03', 4, 'THE BANK OF NEW YORK MELLON 140044', 'NEW YORK, U.S.A.', 250000, 2.50, 2),
  -- 9U005: 抽出失敗（行なし）
  -- 9U006（AC9.10・AC9.13・AC9.15・AC9.16）: 35.0%、筆頭は有限会社山田興産
  ('SXTEST06', 1, '有限会社山田興産', '東京都港区', 1800000, 18.00, 2),
  ('SXTEST06', 2, '山田　太郎', '東京都港区', 1200000, 12.00, 2),
  ('SXTEST06', 3, '日本マスタートラスト信託銀行株式会社（信託口）', '東京都港区', 900000, 9.00, 2),
  ('SXTEST06', 4, '山田　花子', '東京都港区', 500000, 5.00, 2),
  -- 9U007（AC9.14）: 取締役 佐藤一郎 4.0%
  ('SXTEST07', 1, '日本マスタートラスト信託銀行株式会社（信託口）', '東京都港区', 1100000, 11.00, 2),
  ('SXTEST07', 2, '株式会社検証物産', '東京都千代田区', 600000, 6.00, 2),
  ('SXTEST07', 3, '佐藤　一郎', '埼玉県さいたま市', 400000, 4.00, 2),
  -- 9U008（AC9.9 社長が複数・髙／高）: 筆頭「高橋 二郎」＝ 社長候補の「髙橋 二郎」
  ('SXTEST08', 1, '高橋　二郎', '東京都港区', 2000000, 20.00, 2),
  ('SXTEST08', 2, '鈴木　一郎', '東京都港区', 1000000, 10.00, 2),
  ('SXTEST08', 3, '株式会社日本カストディ銀行（信託口）', '東京都中央区', 500000, 5.00, 2),
  -- 9U009（AC9.9 﨑／崎・読みによる資産管理会社）
  ('SXTEST09', 1, '山崎　健', '福岡県福岡市', 1500000, 15.00, 2),
  ('SXTEST09', 2, '株式会社ヤマザキ・エステート', '福岡県福岡市', 1000000, 10.00, 2),
  ('SXTEST09', 3, '山崎　美香', '福岡県福岡市', 300000, 3.00, 2),
  -- 9U010（代表者による補い）: 役職名に社長が無い代表取締役が筆頭
  ('SXTEST10', 1, '小川　大輔', '東京都渋谷区', 4000000, 40.00, 2),
  ('SXTEST10', 2, '日本マスタートラスト信託銀行株式会社（信託口）', '東京都港区', 800000, 8.00, 2),
  -- 9U011・9U012（AC9.8 の見せ球。④は社長が筆頭株主）
  ('SXTEST11', 1, '木村　修', '東京都港区', 3500000, 35.00, 2),
  ('SXTEST12', 1, '清水　隆', '東京都港区', 5000000, 50.00, 2),
  -- 9U014: 直前の有報（SXTEST14）の大株主
  ('SXTEST14', 1, '松本　浩', '東京都港区', 2500000, 25.00, 2),
  ('SXTEST14', 2, '日本マスタートラスト信託銀行株式会社（信託口）', '東京都港区', 700000, 7.00, 2);

insert into public.annual_report_officers (doc_id, seq, name, title)
values
  ('SXTEST01', 1, '山田太郎', '代表取締役社長'),
  ('SXTEST01', 2, '佐藤　花子', '取締役'),
  ('SXTEST02', 1, '山田　一郎', '代表取締役社長'),
  ('SXTEST02', 2, '田中　三郎', '取締役'),
  ('SXTEST03', 1, '渡辺　健一', '代表取締役社長'),
  ('SXTEST03', 2, '小林　直美', '取締役'),
  ('SXTEST05', 1, '検証　五郎', '代表取締役社長'),
  ('SXTEST06', 1, '山田　太郎', '代表取締役社長'),
  ('SXTEST06', 2, '中村　健', '取締役'),
  ('SXTEST07', 1, '田中　誠', '代表取締役社長'),
  ('SXTEST07', 2, '佐藤　一郎', '取締役CFO'),
  ('SXTEST08', 1, '鈴木　一郎', '代表取締役社長'),
  ('SXTEST08', 2, '髙橋　二郎', E'代表取締役\n社長執行役員'),
  ('SXTEST09', 1, '山﨑　健', '代表取締役 CEO'),
  ('SXTEST10', 1, '小川　大輔', '代表取締役'),
  ('SXTEST10', 2, '森　由美', '取締役'),
  ('SXTEST11', 1, '木村　修', '代表取締役社長'),
  ('SXTEST12', 1, '清水　隆', '代表取締役社長'),
  ('SXTEST14', 1, '松本　浩', '代表取締役社長');
