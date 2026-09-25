delete from public.edinet_documents where doc_id like 'S9TEST%';   -- 抽出の結果・期の行も連鎖して消える
delete from public.edinet_filers where edinet_code like 'E99V%';
delete from public.stocks where code like '9V%';                   -- 決算短信・指標・初出日も連鎖して消える
delete from public.ingestion_runs;
