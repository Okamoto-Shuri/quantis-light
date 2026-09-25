-- ownership-example.sql の後片付け（自分の接頭辞だけを消す）
delete from public.edinet_documents where doc_id like 'SXTEST%';   -- 抽出の結果・大株主・役員も連鎖して消える（判定はトリガーで消える）
delete from public.stocks where code like '9U%';                   -- 決算短信・指標・初出日・判定も連鎖して消える
delete from public.ingestion_runs;
