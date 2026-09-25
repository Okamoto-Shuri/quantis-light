-- 契約（docs/harness/sprints/sprint-09/contract.md）の第5章の投入例
insert into public.ingestion_runs (target, trigger, status, started_at, finished_at, processed_count)
values ('daily_quotes', 'manual', 'succeeded', '2026-09-24 20:00:00+09', '2026-09-24 20:03:00+09', 0);  -- 基準日 2026-09-24

insert into public.stocks (code, company_name, market_code, market_name, sector33_code, sector33_name, product_category)
values ('9V001', '検証用補完優先株式会社',   '0113', 'グロース', '5250', '情報・通信業', '011'),
       ('9V002', '検証用補完四期株式会社',   '0113', 'グロース', '5250', '情報・通信業', '011'),
       ('9V003', '検証用補完変則株式会社',   '0113', 'グロース', '9050', 'サービス業',   '011'),
       ('9V004', '検証用補完欠落株式会社',   '0113', 'グロース', '9050', 'サービス業',   '011'),
       ('9V005', '検証用後から補完株式会社', '0113', 'グロース', '5250', '情報・通信業', '011'),
       ('9V006', '検証用短信五期株式会社',   '0113', 'グロース', '5250', '情報・通信業', '011'),
       ('9V007', '検証用連結単体株式会社',   '0113', 'グロース', '3050', '食料品',       '011'),
       ('9V008', '検証用訂正届出株式会社',   '0113', 'グロース', '5250', '情報・通信業', '011'),
       ('9V009', '検証用IFRS補完株式会社',   '0111', 'プライム', '5250', '情報・通信業', '011'),
       ('9V010', '検証用未結合株式会社',     '0113', 'グロース', '5250', '情報・通信業', '011');

insert into public.stock_listing_dates (code, first_price_date, data_start_date)
select c, '2024-03-15', '2016-09-26' from unnest(array['9V001','9V002','9V003','9V004','9V005','9V006','9V007','9V008','9V009','9V010']) c;
-- 推定上場年数 2.6年（条件③の既定 5年以内を満たす）

-- 決算短信
insert into public.financial_statements
  (code, disclosure_no, disclosed_date, disclosed_time, document_type, fiscal_year_start, fiscal_year_end, net_sales, operating_profit)
select v.code, v.no, v.disclosed::date, '15:00:00', v.doc, v.fy_start::date, v.fy_end::date, v.sales * 100000000, v.op * 100000000
from (values
  ('9V001', 'S9A1', '2024-05-14', 'FYFinancialStatements_Consolidated_JP', '2023-04-01', '2024-03-31', 300::numeric, 30::numeric),
  ('9V001', 'S9A2', '2025-05-14', 'FYFinancialStatements_Consolidated_JP', '2024-04-01', '2025-03-31', 400, 48),
  ('9V002', 'S9B1', '2024-05-14', 'FYFinancialStatements_Consolidated_JP', '2023-04-01', '2024-03-31', 300, 30),
  ('9V002', 'S9B2', '2025-05-14', 'FYFinancialStatements_Consolidated_JP', '2024-04-01', '2025-03-31', 400, 48),
  ('9V003', 'S9C1', '2025-02-14', 'FYFinancialStatements_Consolidated_JP', '2024-01-01', '2024-12-31', 300, 30),
  ('9V003', 'S9C2', '2026-02-14', 'FYFinancialStatements_Consolidated_JP', '2025-01-01', '2025-12-31', 400, 48),
  ('9V004', 'S9D1', '2024-05-14', 'FYFinancialStatements_Consolidated_JP', '2023-04-01', '2024-03-31', 300, 30),
  ('9V004', 'S9D2', '2025-05-14', 'FYFinancialStatements_Consolidated_JP', '2024-04-01', '2025-03-31', 400, 48),
  ('9V005', 'S9E1', '2023-05-12', 'FYFinancialStatements_Consolidated_JP', '2022-04-01', '2023-03-31', 180, 18),
  ('9V005', 'S9E2', '2024-05-14', 'FYFinancialStatements_Consolidated_JP', '2023-04-01', '2024-03-31', 240, 24),
  ('9V005', 'S9E3', '2025-05-14', 'FYFinancialStatements_Consolidated_JP', '2024-04-01', '2025-03-31', 300, 36),
  ('9V006', 'S9F1', '2021-05-14', 'FYFinancialStatements_Consolidated_JP', '2020-04-01', '2021-03-31', 120, 12),
  ('9V006', 'S9F2', '2022-05-13', 'FYFinancialStatements_Consolidated_JP', '2021-04-01', '2022-03-31', 150, 15),
  ('9V006', 'S9F3', '2023-05-12', 'FYFinancialStatements_Consolidated_JP', '2022-04-01', '2023-03-31', 180, 18),
  ('9V006', 'S9F4', '2024-05-14', 'FYFinancialStatements_Consolidated_JP', '2023-04-01', '2024-03-31', 240, 24),
  ('9V006', 'S9F5', '2025-05-14', 'FYFinancialStatements_Consolidated_JP', '2024-04-01', '2025-03-31', 300, 36),
  ('9V007', 'S9G1', '2025-05-14', 'FYFinancialStatements_Consolidated_JP', '2024-04-01', '2025-03-31', 400, 60),
  ('9V008', 'S9H1', '2025-05-14', 'FYFinancialStatements_Consolidated_JP', '2024-04-01', '2025-03-31', 300, 36),
  ('9V009', 'S9I1', '2024-05-14', 'FYFinancialStatements_Consolidated_IFRS', '2023-04-01', '2024-03-31', 500, 60),
  ('9V009', 'S9I2', '2025-05-14', 'FYFinancialStatements_Consolidated_IFRS', '2024-04-01', '2025-03-31', 600, 75),
  ('9V010', 'S9J1', '2023-05-12', 'FYFinancialStatements_Consolidated_JP', '2022-04-01', '2023-03-31', 180, 18),
  ('9V010', 'S9J2', '2024-05-14', 'FYFinancialStatements_Consolidated_JP', '2023-04-01', '2024-03-31', 240, 24),
  ('9V010', 'S9J3', '2025-05-14', 'FYFinancialStatements_Consolidated_JP', '2024-04-01', '2025-03-31', 300, 36)
) as v(code, no, disclosed, doc, fy_start, fy_end, sales, op);

-- 提出者と証券コードの対応（9V008 の届出書は証券コードが無く、上場後の書類で結び付く）
insert into public.edinet_filers (edinet_code, sec_code, filer_name, seen_submitted_at)
values ('E99V08', '9V008', '検証用訂正届出株式会社', '2025-11-14 15:00+09');

-- EDINET の書類のメタデータ（Sprint 8 のテーブル）
insert into public.edinet_documents
  (doc_id, sec_code, edinet_code, filer_name, doc_type_code, ordinance_code, form_code,
   period_start, period_end, submitted_at, parent_doc_id, doc_description, withdrawn, withheld, xbrl_available, list_date)
values
  ('S9TEST11', '9V001', 'E99V01', '検証用補完優先株式会社', '120', '010', '030000', '2023-04-01', '2024-03-31', '2024-06-26 15:00+09', null, '有価証券報告書－第10期', false, false, true, '2024-06-26'),
  ('S9TEST12', '9V001', 'E99V01', '検証用補完優先株式会社', '030', '010', '020000', null, null, '2023-02-20 15:00+09', null, '有価証券届出書（新規公開時）', false, false, true, '2023-02-20'),
  ('S9TEST13', '9V001', 'E99V01', '検証用補完優先株式会社', '040', '010', '020001', null, null, '2023-03-01 15:00+09', 'S9TEST12', '訂正有価証券届出書（新規公開時）', true, false, true, '2023-03-01'),  -- 取り下げ（使わない）
  ('S9TEST21', '9V002', 'E99V02', '検証用補完四期株式会社', '030', '010', '020000', null, null, '2024-02-20 15:00+09', null, '有価証券届出書（新規公開時）', false, false, true, '2024-02-20'),
  ('S9TEST22', '9V002', 'E99V02', '検証用補完四期株式会社', '120', '010', '030000', '2024-04-01', '2025-03-31', '2025-06-25 15:00+09', null, '有価証券報告書－第5期', false, false, true, '2025-06-25'),
  ('S9TEST31', '9V003', 'E99V03', '検証用補完変則株式会社', '120', '010', '030000', '2023-01-01', '2023-12-31', '2024-03-28 15:00+09', null, '有価証券報告書－第8期', false, false, true, '2024-03-28'),
  ('S9TEST41', '9V004', 'E99V04', '検証用補完欠落株式会社', '030', '010', '020000', null, null, '2023-02-20 15:00+09', null, '有価証券届出書（新規公開時）', false, false, true, '2023-02-20'),
  ('S9TEST42', '9V004', 'E99V04', '検証用補完欠落株式会社', '120', '010', '030000', '2024-04-01', '2025-03-31', '2025-06-26 15:00+09', null, '有価証券報告書－第6期', false, false, true, '2025-06-26'),  -- 取り込み待ち
  ('S9TEST71', '9V007', 'E99V07', '検証用連結単体株式会社', '030', '010', '020000', null, null, '2024-12-10 15:00+09', null, '有価証券届出書（新規公開時）', false, false, true, '2024-12-10'),
  ('S9TEST81', null,    'E99V08', '検証用訂正届出株式会社', '030', '010', '020000', null, null, '2025-02-10 15:00+09', null, '有価証券届出書（新規公開時）', false, false, true, '2025-02-10'),
  ('S9TEST82', null,    'E99V08', '検証用訂正届出株式会社', '040', '010', '020001', null, null, '2025-02-25 15:00+09', 'S9TEST81', '訂正有価証券届出書（新規公開時）', false, false, true, '2025-02-25'),
  ('S9TEST91', '9V009', 'E99V09', '検証用IFRS補完株式会社', '120', '010', '030000', '2023-04-01', '2024-03-31', '2024-06-20 15:00+09', null, '有価証券報告書－第30期', false, false, true, '2024-06-20'),
  ('S9TEST99', null,    'E99V10', '検証用未結合株式会社',   '030', '010', '020000', null, null, '2023-02-20 15:00+09', null, '有価証券届出書（新規公開時）', false, false, true, '2023-02-20');  -- 結び付かない

insert into public.business_results_extractions (doc_id, processed_at, status, detail, period_count)
values ('S9TEST11', now(), 'ok', null, 3), ('S9TEST12', now(), 'ok', null, 2), ('S9TEST13', now(), 'ok', null, 1),
       ('S9TEST21', now(), 'ok', null, 2), ('S9TEST22', now(), 'section_not_found', null, 0),
       ('S9TEST31', now(), 'ok', null, 4), ('S9TEST41', now(), 'ok', null, 3), ('S9TEST71', now(), 'ok', null, 6),
       ('S9TEST81', now(), 'ok', null, 4), ('S9TEST82', now(), 'ok', null, 4), ('S9TEST91', now(), 'ok', null, 4),
       ('S9TEST99', now(), 'ok', null, 2);

insert into public.business_results_periods
  (doc_id, fiscal_year_start, fiscal_year_end, consolidated, accounting_standard, net_sales, operating_profit, revenue_element, operating_profit_element)
select v.doc, v.fy_start::date, v.fy_end::date, v.cons, v.std, v.sales * 100000000, v.op * 100000000, v.rev_el, case when v.op is null then null else v.op_el end
from (values
  -- 9V001（AC15.1）: 有報 FY-3 150・FY-2 200・FY-1 310（営業利益の記載なし）、届出書 FY-4 100・FY-3 140、取り下げの訂正届出書 FY-4 999
  ('S9TEST11', '2021-04-01', '2022-03-31', true, 'JP', 150::numeric, null::numeric, 'NetSalesSummaryOfBusinessResults', null::text),
  ('S9TEST11', '2022-04-01', '2023-03-31', true, 'JP', 200, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST11', '2023-04-01', '2024-03-31', true, 'JP', 310, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST12', '2020-04-01', '2021-03-31', true, 'JP', 100,    8, 'NetSalesSummaryOfBusinessResults', 'OperatingIncome'),
  ('S9TEST12', '2021-04-01', '2022-03-31', true, 'JP', 140,   11, 'NetSalesSummaryOfBusinessResults', 'OperatingIncome'),
  ('S9TEST13', '2020-04-01', '2021-03-31', true, 'JP', 999,   99, 'NetSalesSummaryOfBusinessResults', 'OperatingIncome'),
  -- 9V002（AC15.5）: 届出書 2022/03・2023/03（決算短信 2024/03・2025/03 と重ならない。計4期）
  ('S9TEST21', '2021-04-01', '2022-03-31', true, 'JP', 150, 15, 'NetSalesSummaryOfBusinessResults', 'OperatingIncome'),
  ('S9TEST21', '2022-04-01', '2023-03-31', true, 'JP', 200, 20, 'NetSalesSummaryOfBusinessResults', 'OperatingIncome'),
  -- 9V003（AC15.6 変則）: 3月決算 → 12月決算。2022/12期は9か月
  ('S9TEST31', '2020-04-01', '2021-03-31', true, 'JP', 100, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST31', '2021-04-01', '2022-03-31', true, 'JP', 150, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST31', '2022-04-01', '2022-12-31', true, 'JP', 160, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST31', '2023-01-01', '2023-12-31', true, 'JP', 250, null, 'NetSalesSummaryOfBusinessResults', null),
  -- 9V004（AC15.6 欠落）: 届出書 2020/03〜2022/03。2023/03期が無い
  ('S9TEST41', '2019-04-01', '2020-03-31', true, 'JP',  80, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST41', '2020-04-01', '2021-03-31', true, 'JP', 100, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST41', '2021-04-01', '2022-03-31', true, 'JP', 150, null, 'NetSalesSummaryOfBusinessResults', null),
  -- 9V007（AC15.8）: 連結は 2023/03・2024/03 だけ、単体は4期
  ('S9TEST71', '2022-04-01', '2023-03-31', true,  'JP', 250, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST71', '2023-04-01', '2024-03-31', true,  'JP', 300, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST71', '2020-04-01', '2021-03-31', false, 'JP', 100, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST71', '2021-04-01', '2022-03-31', false, 'JP', 150, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST71', '2022-04-01', '2023-03-31', false, 'JP', 200, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST71', '2023-04-01', '2024-03-31', false, 'JP', 240, null, 'NetSalesSummaryOfBusinessResults', null),
  -- 9V008（AC15.9）: 元の届出書と訂正届出書（訂正が新しい）
  ('S9TEST81', '2020-04-01', '2021-03-31', true, 'JP',  90, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST81', '2021-04-01', '2022-03-31', true, 'JP', 110, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST81', '2022-04-01', '2023-03-31', true, 'JP', 150, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST81', '2023-04-01', '2024-03-31', true, 'JP', 200, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST82', '2020-04-01', '2021-03-31', true, 'JP', 100, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST82', '2021-04-01', '2022-03-31', true, 'JP', 120, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST82', '2022-04-01', '2023-03-31', true, 'JP', 150, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST82', '2023-04-01', '2024-03-31', true, 'JP', 200, null, 'NetSalesSummaryOfBusinessResults', null),
  -- 9V009（IFRS。売上収益。営業利益の行なし）: 有報 2021/03〜2024/03。2024/03期は決算短信が優先
  ('S9TEST91', '2020-04-01', '2021-03-31', true, 'IFRS', 250, null, 'RevenueIFRSSummaryOfBusinessResults', null),
  ('S9TEST91', '2021-04-01', '2022-03-31', true, 'IFRS', 300, null, 'RevenueIFRSSummaryOfBusinessResults', null),
  ('S9TEST91', '2022-04-01', '2023-03-31', true, 'IFRS', 400, null, 'RevenueIFRSSummaryOfBusinessResults', null),
  ('S9TEST91', '2023-04-01', '2024-03-31', true, 'IFRS', 510, null, 'RevenueIFRSSummaryOfBusinessResults', null),
  -- 9V010 に結び付かない届出書（提出者の証券コードが不明。社名では結び付けない）
  ('S9TEST99', '2020-04-01', '2021-03-31', true, 'JP', 120, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST99', '2021-04-01', '2022-03-31', true, 'JP', 150, null, 'NetSalesSummaryOfBusinessResults', null)
) as v(doc, fy_start, fy_end, cons, std, sales, op, rev_el, op_el);
