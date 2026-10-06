-- 有報の役員の抽出の修正（annual-report.ts）: 指名委員会等設置会社の「執行役の状況」の表
-- （jpcrp_cor:NameInformationAboutExecutiveDirectors・OfficialTitleOrPositionInformationAboutExecutiveDirectors）も読む。
-- 今までは取締役の表だけを読んだので、「代表執行役社長」が見つからず、条件④が判定不能（president_not_found）になっていた
-- （実データ スカラ S100Z4CX・スマートバリュー S100Z4H1）。
-- 社長が見つからなかった銘柄の、判定に使った有報の抽出の行を消して取り直す（次の EDINET の取り込みで本文を取得し直す。
-- 主要な経営指標等の行は残るので、その処理はしない）。抽出の行の削除で、条件④の判定は同じトランザクションで再計算される。
-- 執行役の表の無い会社の書類も取り直すことになるが、件数は少なく、結果は変わらない。
delete from public.annual_report_extractions e
 using public.ownership_judgments j
 where j.undeterminable_reason = 'president_not_found'
   and e.doc_id = j.officers_doc_id;
