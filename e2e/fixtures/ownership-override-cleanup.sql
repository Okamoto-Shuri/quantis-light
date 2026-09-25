-- ownership-override-add.sql・ownership-override-add-9u004.sql の後片付け（自分の接頭辞だけを消す）。
-- 抽出の結果・大株主・役員は連鎖して消え、判定はトリガーで元の書類に戻る。補正の行は銘柄の削除（ownership-cleanup.sql）で連鎖して消える。
delete from public.edinet_documents where doc_id like 'SYTEST%';
