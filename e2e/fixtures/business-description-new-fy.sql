-- 契約（Sprint 16）の第5章: 9R001 に新しい事業年度の有報と、その事業の内容を入れる（AC16.7）。
insert into public.edinet_documents
  (doc_id, sec_code, edinet_code, filer_name, doc_type_code, ordinance_code, form_code,
   period_start, period_end, submitted_at, parent_doc_id, doc_description, withdrawn, withheld, xbrl_available, list_date)
values ('S16TEST02', '9R001', 'E99R01', '検証用事業内容株式会社', '120', '010', '030000', '2025-04-01', '2026-03-31', '2026-06-25 15:00+09', null, '有価証券報告書－第11期', false, false, true, '2026-06-25');
insert into public.business_description_extractions (doc_id, processed_at, status, detail, paragraph)
values ('S16TEST02', now(), 'ok', null, '新しい事業年度の段落です。');
