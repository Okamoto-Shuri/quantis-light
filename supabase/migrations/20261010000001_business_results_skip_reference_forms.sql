-- 組込方式（様式 022000・022001）と参照方式（023000・023001）の届出書は、主要な経営指標等を読む対象から外す。
-- 実 API での確認（2026-10-06。書類一覧 450 日分の届出書 1,180 通のうち 825 通がこの4様式）: この様式の届出書は
-- 証券情報だけで、企業情報は有報を組み込む・参照するので、本文のインライン XBRL に「主要な経営指標等の推移」が無い
-- （処理した 68 通すべてが section_not_found。ZIP の提出本文書は2ファイル・事実は約 70）。
-- 取得しても補える期が無く、1通ごとに要求の間隔（1秒）と期限（210 秒）を使い、条件①を算出できない銘柄の書類として
-- 有報より先に取得されていた。新規公開時（024000・024001）・通常方式（020000・020001）・組織再編成（027000 など）は今までどおり読む。
-- 書類一覧には今までどおり保存する（提出者と証券コードの対応・取り下げの反映に使う）。様式の無い行は読む。

create or replace view public.business_results_targets
with (security_invoker = true)
as
with docs as (
  select c.doc_id, c.code from public.annual_report_candidates c
  union
  select dc.doc_id, dc.code
    from public.edinet_document_codes dc
    join public.edinet_documents d on d.doc_id = dc.doc_id
   where d.doc_type_code in ('030', '040') and not d.withdrawn and not d.withheld
     and coalesce(d.form_code, '') !~ '^02[23]'
)
select x.doc_id, x.code, d.doc_type_code, d.submitted_at, d.xbrl_available,
       case when m.code is null or m.revenue_cagr_unavailable_reason in ('insufficient_periods', 'non_consecutive_periods')
            then 0 else 1 end as priority
  from docs x
  join public.edinet_documents d on d.doc_id = x.doc_id
  left join public.financial_metrics m on m.code = x.code
 where not exists (select 1 from public.business_results_extractions e where e.doc_id = x.doc_id);

comment on view public.business_results_targets is
  '主要な経営指標等が未処理の、読む対象の書類（有報の候補の列のすべてと、銘柄に結び付く届出書。組込方式・参照方式の届出書を除く）。priority 0 が先';

-- 抽出の規則の修正（business-results.ts）: DEI で連結財務諸表を作らないとされる書類でも、同じ期に単体
-- （NonConsolidatedMember）の事実があれば、軸の無い事実は過去の連結の値として読む。今までは単体として読み、同じ期の単体の値と
-- 食い違って conflicting_facts になっていた（新規公開の届出書 S100YR8Z・S100X5MW など）。この理由で処理済みにした書類を
-- 取り直す（行を消すと、次の取り込みで対象に戻る。期の行は無いので指標は変わらない）。
delete from public.business_results_extractions where status = 'invalid_values' and detail = 'conflicting_facts';
