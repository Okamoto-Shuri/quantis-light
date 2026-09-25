insert into public.edinet_documents
  (doc_id, sec_code, edinet_code, filer_name, doc_type_code, ordinance_code, form_code,
   period_start, period_end, submitted_at, parent_doc_id, doc_description, withdrawn, withheld, xbrl_available, list_date)
values ('S9TEST51', '9V005', 'E99V05', '検証用後から補完株式会社', '030', '010', '020000', null, null, '2023-02-20 15:00+09', null, '有価証券届出書（新規公開時）', false, false, true, '2023-02-20');
insert into public.business_results_extractions (doc_id, processed_at, status, detail, period_count)
values ('S9TEST51', now(), 'ok', null, 2);
insert into public.business_results_periods
  (doc_id, fiscal_year_start, fiscal_year_end, consolidated, accounting_standard, net_sales, operating_profit, revenue_element, operating_profit_element)
values ('S9TEST51', '2020-04-01', '2021-03-31', true, 'JP', 12000000000, null, 'NetSalesSummaryOfBusinessResults', null),
       ('S9TEST51', '2021-04-01', '2022-03-31', true, 'JP', 15000000000, null, 'NetSalesSummaryOfBusinessResults', null);
