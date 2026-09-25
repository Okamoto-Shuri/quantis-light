-- Sprint 14: 比較の基準の記録の後のデータの変化（契約の第5章）。ownership-example.sql と記録の後に、postgres ユーザーで流す。
-- 期待値（標準の条件）: 新たに該当 9U011（①）・9U012（③）、外れた 9U002（上場廃止）・9U006（④）・9U008（②）。
-- 市場データの後片付けは ownership-cleanup.sql（9U の銘柄と書類を消す）。

-- 9U011: 売上CAGR 10.0% → 25.0%（条件①を満たすように）
update public.financial_statements f
   set net_sales = v.sales * 100000000, operating_profit = v.sales * 0.15 * 100000000
  from (values (date '2022-03-31', 100::numeric), (date '2023-03-31', 125), (date '2024-03-31', 156.25),
               (date '2025-03-31', 195.3125), (date '2026-03-31', 244.140625)) as v(fy_end, sales)
 where f.code = '9U011' and f.fiscal_year_end = v.fy_end;
-- 9U012: 初出日 2018-09-24 → 2023-09-24（条件③ 8.0年 → 3.0年）
update public.stock_listing_dates set first_price_date = date '2023-09-24' where code = '9U012';
-- 9U002: 上場廃止
update public.stocks set delisted_on = date '2026-09-25' where code = '9U002';
-- 9U008: 直近通期の営業利益率 15.0% → 5.0%（条件②を満たさなくなる）
update public.financial_statements set operating_profit = net_sales * 0.05
 where code = '9U008' and fiscal_year_end = date '2026-03-31';
-- 9U006: 山田興産 18% → 4%、山田太郎 12% → 4%（オーナー系合計 35.0% → 13.0%、筆頭は信託口 9%）
update public.annual_report_shareholders set ratio_pct = 4.00, shares_held = 400000
 where doc_id = 'SXTEST06' and rank in (1, 2);
