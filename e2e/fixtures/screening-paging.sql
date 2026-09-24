-- 契約の第5章のページ送りの確認用（120 銘柄。9Z001〜9Z120）。
insert into public.stocks (code, company_name, market_code, market_name, sector33_code, sector33_name, product_category)
select '9Z' || lpad(g::text, 3, '0'), '検証用ページ送り' || g || '株式会社', '0113', 'グロース', '5250', '情報・通信業', '011'
  from generate_series(1, 120) g;
insert into public.stock_listing_dates (code, first_price_date, data_start_date)
select '9Z' || lpad(g::text, 3, '0'), '2023-09-24', '2016-09-26' from generate_series(1, 120) g;
insert into public.financial_statements
  (code, disclosure_no, disclosed_date, disclosed_time, document_type, fiscal_year_start, fiscal_year_end, net_sales, operating_profit)
select '9Z' || lpad(g::text, 3, '0'), 'S6P' || g || '-' || t.i, make_date(2020 + t.i::int, 5, 14), '15:00:00',
       'FYFinancialStatements_Consolidated_JP', make_date(2019 + t.i::int, 4, 1), make_date(2020 + t.i::int, 3, 31),
       t.sales * 100000000, t.sales * 0.10 * 100000000
  from generate_series(1, 120) g
 cross join lateral unnest(array[100, 120, 144, 172.8, 207.36]::numeric[]) with ordinality as t(sales, i);
