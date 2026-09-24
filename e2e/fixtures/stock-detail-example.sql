-- 契約（docs/harness/sprints/sprint-07/contract.md）の第5章の投入例（銘柄詳細用の4銘柄）。E2E と pnpm test:db が使う。
-- screening-example.sql の後に入れる（基準日 2026-09-24 はそちらの実行履歴の行）。後片付けは code like '9Y%'。
insert into public.stocks (code, company_name, market_code, market_name, sector33_code, sector33_name, product_category)
values ('9Y001', '検証用六期訂正株式会社',   '0113', 'グロース',     '5250', '情報・通信業', '011'),
       ('9Y002', '検証用欠落期株式会社',     '0111', 'プライム',     '3050', '食料品',       '011'),
       ('9Y003', '検証用決算期変更株式会社', '0112', 'スタンダード', '9050', 'サービス業',   '011'),
       ('9Y004', '検証用営業赤字株式会社',   '0113', 'グロース',     '5250', '情報・通信業', '011');

insert into public.stock_listing_dates (code, first_price_date, data_start_date)
values ('9Y001', '2022-09-24', '2016-09-26'),   -- 4.0年
       ('9Y002', '2016-09-26', '2016-09-26'),   -- データ期間開始以前（9年超）
       ('9Y003', '2019-09-24', '2016-09-26'),   -- 7.0年
       ('9Y004', '2025-09-24', '2016-09-26');   -- 1.0年

insert into public.financial_statements
  (code, disclosure_no, disclosed_date, disclosed_time, document_type,
   fiscal_year_start, fiscal_year_end, net_sales, operating_profit)
select v.code, v.no, v.disclosed::date, '15:00:00', v.doc, v.fy_start::date, v.fy_end::date,
       v.sales * 100000000, v.op * 100000000
from (values
  -- 9Y001: 6期（3月決算）。FY0 は訂正あり（元の開示 390／46.8 → 訂正 400／48）。CAGR (400/100)^(1/4)-1 = 41.4%、営業利益率 12.0%
  ('9Y001', 'S7A1', '2020-05-14', 'FYFinancialStatements_Consolidated_JP', '2019-04-01', '2020-03-31',  50::numeric,  5::numeric),
  ('9Y001', 'S7A2', '2021-05-14', 'FYFinancialStatements_Consolidated_JP', '2020-04-01', '2021-03-31', 100, 10),
  ('9Y001', 'S7A3', '2022-05-14', 'FYFinancialStatements_Consolidated_JP', '2021-04-01', '2022-03-31', 150, 15),
  ('9Y001', 'S7A4', '2023-05-14', 'FYFinancialStatements_Consolidated_JP', '2022-04-01', '2023-03-31', 200, 20),
  ('9Y001', 'S7A5', '2024-05-14', 'FYFinancialStatements_Consolidated_JP', '2023-04-01', '2024-03-31', 300, 30),
  ('9Y001', 'S7A6', '2025-05-14', 'FYFinancialStatements_Consolidated_JP', '2024-04-01', '2025-03-31', 390, 46.8),
  ('9Y001', 'S7A7', '2025-05-20', 'FYFinancialStatements_Consolidated_JP', '2024-04-01', '2025-03-31', 400, 48),
  -- 9Y002: 2022/03期が欠けている（連続しない）。CAGR 算出不可（直近5期の通期実績が連続していない）、営業利益率 10.0%
  ('9Y002', 'S7B1', '2019-05-14', 'FYFinancialStatements_Consolidated_JP', '2018-04-01', '2019-03-31',  80,  8),
  ('9Y002', 'S7B2', '2020-05-14', 'FYFinancialStatements_Consolidated_JP', '2019-04-01', '2020-03-31',  90,  9),
  ('9Y002', 'S7B3', '2021-05-14', 'FYFinancialStatements_Consolidated_JP', '2020-04-01', '2021-03-31', 100, 10),
  ('9Y002', 'S7B4', '2023-05-14', 'FYFinancialStatements_Consolidated_JP', '2022-04-01', '2023-03-31', 130, 13),
  ('9Y002', 'S7B5', '2024-05-14', 'FYFinancialStatements_Consolidated_JP', '2023-04-01', '2024-03-31', 150, 15),
  ('9Y002', 'S7B6', '2025-05-14', 'FYFinancialStatements_Consolidated_JP', '2024-04-01', '2025-03-31', 170, 17),
  -- 9Y003: 3月決算 → 12月決算に変更（2022/12期は9か月）。2023/12期は営業赤字。CAGR 算出不可（変則決算）、営業利益率 10.0%
  ('9Y003', 'S7C1', '2020-05-14', 'FYFinancialStatements_Consolidated_JP', '2019-04-01', '2020-03-31', 100,  10),
  ('9Y003', 'S7C2', '2021-05-14', 'FYFinancialStatements_Consolidated_JP', '2020-04-01', '2021-03-31', 110,  11),
  ('9Y003', 'S7C3', '2022-05-14', 'FYFinancialStatements_Consolidated_JP', '2021-04-01', '2022-03-31', 120,  12),
  ('9Y003', 'S7C4', '2023-02-14', 'FYFinancialStatements_Consolidated_JP', '2022-04-01', '2022-12-31',  95, 9.5),
  ('9Y003', 'S7C5', '2024-02-14', 'FYFinancialStatements_Consolidated_JP', '2023-01-01', '2023-12-31', 140, -10),
  ('9Y003', 'S7C6', '2025-02-14', 'FYFinancialStatements_Consolidated_JP', '2024-01-01', '2024-12-31', 160,  16),
  -- 9Y004: FY-4 だけ連結、ほかは単体（日本基準）。CAGR 30.0%（連結・単体の混在）、FY0 は営業赤字で営業利益率 -5.0%
  ('9Y004', 'S7D1', '2021-05-14', 'FYFinancialStatements_Consolidated_JP',    '2020-04-01', '2021-03-31', 100,        5),
  ('9Y004', 'S7D2', '2022-05-14', 'FYFinancialStatements_NonConsolidated_JP', '2021-04-01', '2022-03-31', 130,      6.5),
  ('9Y004', 'S7D3', '2023-05-14', 'FYFinancialStatements_NonConsolidated_JP', '2022-04-01', '2023-03-31', 169,     8.45),
  ('9Y004', 'S7D4', '2024-05-14', 'FYFinancialStatements_NonConsolidated_JP', '2023-04-01', '2024-03-31', 219.7,  10.985),
  ('9Y004', 'S7D5', '2025-05-14', 'FYFinancialStatements_NonConsolidated_JP', '2024-04-01', '2025-03-31', 285.61, -14.2805)
) as v(code, no, disclosed, doc, fy_start, fy_end, sales, op);
