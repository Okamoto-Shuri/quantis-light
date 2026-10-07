-- 契約（Sprint 16）の第5章: 取り込み待ちだった S16TEST51（9R006）の事業の内容を入れる（AC16.9）。
insert into public.business_description_extractions (doc_id, processed_at, status, detail, paragraph)
values ('S16TEST51', now(), 'ok', null, '取り込み待ちだった有報の段落です。');
