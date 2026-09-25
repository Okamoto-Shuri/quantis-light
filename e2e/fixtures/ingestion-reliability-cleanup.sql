-- ingestion-reliability-example.sql の後片付け（自分の目印だけを消す）。失敗の行は実行の削除で連鎖して消える。
delete from public.ingestion_runs where details ->> 'fixture' = 'sprint-12';
delete from public.edinet_documents where doc_id like 'S12N%';
delete from public.stocks where code like '9N%';
