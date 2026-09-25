-- annual-report-example.sql の後片付け（抽出の結果・大株主・役員は連鎖して消える）
delete from public.edinet_documents where doc_id like 'S8TEST%';
delete from public.stocks where code like '9W%';
