-- 契約（Sprint 16）の投入例の後片付け。書類（S16TEST…）を消すと、事業の内容・大株主・役員の行は連鎖して消える。
delete from public.edinet_documents where doc_id like 'S16TEST%';
delete from public.stocks where code like '9R0%';
