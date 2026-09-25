-- Sprint 8: EDINET 有価証券報告書の取り込み（大株主・役員）
--
-- 方針
-- - 書類一覧（/api/v2/documents.json?type=2）の書類のメタデータを edinet_documents に保存する。
--   有報（120）・訂正有報（130）は証券コードがあるものだけ、届出書（030）・訂正届出書（040）は証券コードが無くても保存する
--   （Sprint 9 の上場前の期の補完で使う。一覧の日付を取り直さずに済むように、今の一覧の取得で一緒に保存する）。
-- - 書類ごとの大株主・役員の抽出の結果（＝この処理の処理済みの記録）は annual_report_extractions。
--   Sprint 9 の「主要な経営指標等の推移」の抽出は別のテーブルに記録する（同じ書類を処理の種類ごとに管理する）。
-- - 「使う書類」の選び方は、ビュー annual_report_sections の1か所で決める（画面・API・集計・取り込みの対象が同じ規則を使う）。
-- - 権限は public.stocks と同じ（RLS 有効、anon の権限なし、authenticated は許可ユーザーだけ select、書き込みは service_role のみ）。

-- ---------------------------------------------------------------------------
-- 書類のメタデータ
-- ---------------------------------------------------------------------------
create table public.edinet_documents (
  doc_id text primary key check (doc_id ~ '^[A-Za-z0-9]{1,32}$'),
  sec_code text check (sec_code is null or sec_code ~ '^[0-9A-Z]{5}$'),
  edinet_code text not null,
  filer_name text,
  doc_type_code text not null check (doc_type_code in ('120', '130', '030', '040')),
  ordinance_code text not null,
  form_code text,
  period_start date,
  period_end date,
  submitted_at timestamptz not null,
  -- 元の書類（訂正の元）。元の書類が一覧の期間の外にあり保存されていないのは正常な状態なので、外部キーは付けない
  parent_doc_id text,
  doc_description text,
  withdrawn boolean not null default false,
  withheld boolean not null default false,
  -- 不開示の開始・解除を最後に反映した操作日時（古い情報で上書きしないため）
  disclosure_changed_at timestamptz,
  xbrl_available boolean not null default false,
  list_date date not null,
  run_id bigint references public.ingestion_runs (id) on delete set null,
  updated_at timestamptz not null default now(),
  -- 有報・訂正有報は証券コードが必須（銘柄と対応づけられない有報は使い道が無い）
  constraint edinet_documents_annual_report_sec_code check (doc_type_code in ('030', '040') or sec_code is not null)
);

comment on table public.edinet_documents is
  'EDINET の書類一覧（書類一覧 API）から保存した書類のメタデータ。本文は保存しない。';
comment on column public.edinet_documents.list_date is '最初に保存したときの書類一覧のファイル日付';
comment on column public.edinet_documents.withdrawn is '取り下げられた書類（一度 true にしたら戻さない。EDINET に取り下げの解除は無い）';
comment on column public.edinet_documents.withheld is '不開示の書類（開示不開示区分 1・2 で true、解除 3 で false。操作日時の新しい情報だけを反映する）';

create index edinet_documents_sec_code_idx on public.edinet_documents (sec_code) where sec_code is not null;
create index edinet_documents_parent_doc_id_idx on public.edinet_documents (parent_doc_id) where parent_doc_id is not null;
create index edinet_documents_edinet_code_idx on public.edinet_documents (edinet_code);

-- ---------------------------------------------------------------------------
-- 書類一覧を取得済みの日
-- ---------------------------------------------------------------------------
create table public.edinet_list_fetched_dates (
  list_date date primary key,
  fetched_at timestamptz not null default now(),
  document_count integer not null default 0 check (document_count >= 0),
  run_id bigint references public.ingestion_runs (id) on delete set null
);

comment on table public.edinet_list_fetched_dates is '書類一覧を取得して保存し終えたファイル日付（直近7日は毎回取り直す）';

-- ---------------------------------------------------------------------------
-- 大株主・役員の抽出の結果（書類ごと）
-- ---------------------------------------------------------------------------
create table public.annual_report_extractions (
  doc_id text primary key references public.edinet_documents (doc_id) on delete cascade,
  processed_at timestamptz not null default now(),
  shareholders_status text not null check (shareholders_status in ('ok', 'no_xbrl', 'section_not_found', 'invalid_values')),
  officers_status text not null check (officers_status in ('ok', 'no_xbrl', 'section_not_found', 'invalid_values')),
  shareholders_detail text,
  officers_detail text,
  officers_basis text check (officers_basis in ('filing_date')),
  officers_has_post_agm_table boolean not null default false,
  officers_order_source text check (officers_order_source in ('inline_document', 'presentation_linkbase')),
  run_id bigint references public.ingestion_runs (id) on delete set null
);

comment on table public.annual_report_extractions is
  '有報・訂正有報の本文から大株主・役員を抽出した結果。行があれば処理済み（取り直さない）。取り直すときは行を消す。';

create table public.annual_report_shareholders (
  doc_id text not null references public.annual_report_extractions (doc_id) on delete cascade,
  rank integer not null check (rank between 1 and 1000),
  name text not null check (name <> ''),
  address text,
  shares_held numeric check (shares_held is null or shares_held >= 0),
  ratio_pct numeric not null check (ratio_pct >= 0 and ratio_pct <= 100),
  ratio_decimals smallint not null check (ratio_decimals between 0 and 10),
  primary key (doc_id, rank)
);

comment on column public.annual_report_shareholders.ratio_pct is
  '発行済株式（自己株式を除く）の総数に対する所有株式数の割合（百分率。32.10 = 32.10%）。有報の記載を十進のまま保存する';
comment on column public.annual_report_shareholders.ratio_decimals is '百分率の小数点以下の記載の桁数（XBRL の decimals − 2）';

create table public.annual_report_officers (
  doc_id text not null references public.annual_report_extractions (doc_id) on delete cascade,
  seq integer not null check (seq between 1 and 1000),
  name text not null check (name <> ''),
  title text not null,
  primary key (doc_id, seq)
);

comment on table public.annual_report_officers is '有報の役員の状況（提出日現在の表）。seq は書類の記載順';

-- ---------------------------------------------------------------------------
-- 使う書類の選び方（1か所）
-- ---------------------------------------------------------------------------
/**
 * 銘柄マスタの銘柄ごとの、有報の候補の列（対象の事業年度の、取り下げ・不開示でない有報・訂正有報。提出日時の新しい順）。
 * 事業年度の終了日は書類の値、無ければ元の書類の値。決められない書類（元の書類が保存されていない訂正）は使わない。
 */
create view public.annual_report_candidates
with (security_invoker = true)
as
with docs as (
  select d.doc_id, d.sec_code as code, d.doc_type_code, d.submitted_at, d.xbrl_available,
         coalesce(d.period_end, p.period_end) as fiscal_period_end,
         coalesce(d.period_start, case when d.period_end is null then p.period_start end) as fiscal_period_start
    from public.edinet_documents d
    left join public.edinet_documents p on p.doc_id = d.parent_doc_id
   where d.doc_type_code in ('120', '130')
     and not d.withdrawn and not d.withheld
     and d.sec_code is not null
),
dated as (
  select docs.* from docs
   where docs.fiscal_period_end is not null
     and exists (select 1 from public.stocks s where s.code = docs.code)
),
target as (
  select code, max(fiscal_period_end) as fiscal_period_end from dated group by code
)
select d.code, d.doc_id, d.doc_type_code, d.submitted_at, d.xbrl_available, d.fiscal_period_end, d.fiscal_period_start,
       row_number() over (partition by d.code order by d.submitted_at desc, d.doc_id desc)::integer as position,
       count(*) over (partition by d.code)::integer as candidate_count
  from dated d
  join target t on t.code = d.code and t.fiscal_period_end = d.fiscal_period_end;

comment on view public.annual_report_candidates is
  '銘柄ごとの有報の候補の列（対象の事業年度・取り下げと不開示を除く・position 1 が最新の提出分）';

/**
 * 銘柄ごとの、大株主・役員の区画ごとに使う書類と結果。
 * 候補を新しい順に見て、未処理の書類（pending）か、その区画が ok・invalid_values の書類で止める。
 * その区画が section_not_found・no_xbrl の書類は飛ばす（訂正報告書は訂正箇所だけを記載することが多いため）。
 * 候補をすべて見ても決まらなければ、最新の提出分の結果（抽出できなかった理由）を使う。
 */
create view public.annual_report_sections
with (security_invoker = true)
as
with c as (
  select c.*, e.doc_id is not null as processed,
         e.shareholders_status, e.shareholders_detail, e.officers_status, e.officers_detail,
         e.officers_basis, e.officers_has_post_agm_table
    from public.annual_report_candidates c
    left join public.annual_report_extractions e on e.doc_id = c.doc_id
),
latest as (select * from c where c.position = 1),
sh as (
  select distinct on (c.code) c.code, c.doc_id,
         case when c.processed then c.shareholders_status else 'pending' end as status,
         c.shareholders_detail as detail
    from c
   where not c.processed or c.shareholders_status in ('ok', 'invalid_values')
   order by c.code, c.position
),
off as (
  select distinct on (c.code) c.code, c.doc_id,
         case when c.processed then c.officers_status else 'pending' end as status,
         c.officers_detail as detail, c.officers_basis as basis, c.officers_has_post_agm_table as has_post_agm_table
    from c
   where not c.processed or c.officers_status in ('ok', 'invalid_values')
   order by c.code, c.position
)
select l.code,
       l.doc_id as latest_doc_id,
       l.doc_type_code as latest_doc_type_code,
       l.submitted_at as latest_submitted_at,
       l.fiscal_period_start,
       l.fiscal_period_end,
       l.processed as latest_processed,
       l.candidate_count,
       coalesce(sh.doc_id, l.doc_id) as shareholders_doc_id,
       coalesce(sh.status, l.shareholders_status) as shareholders_status,
       case when sh.doc_id is not null then sh.detail else l.shareholders_detail end as shareholders_detail,
       coalesce(off.doc_id, l.doc_id) as officers_doc_id,
       coalesce(off.status, l.officers_status) as officers_status,
       case when off.doc_id is not null then off.detail else l.officers_detail end as officers_detail,
       case when off.doc_id is not null then off.basis else l.officers_basis end as officers_basis,
       coalesce(case when off.doc_id is not null then off.has_post_agm_table else l.officers_has_post_agm_table end, false)
         as officers_has_post_agm_table
  from latest l
  left join sh on sh.code = l.code
  left join off on off.code = l.code;

comment on view public.annual_report_sections is
  '銘柄ごとの、有報の最新の提出分と、大株主・役員の区画ごとに使う書類と結果（status の pending は本文が未処理）';

-- ---------------------------------------------------------------------------
-- 詳細画面・API の読み出し（authenticated。security invoker で RLS が効く）
-- 数値は十進の文字列で返す（PostgREST と JSON.parse で numeric が number になり、桁が落ちるのを避ける）
-- ---------------------------------------------------------------------------
create function public.annual_report_detail(p_code text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select case when s.code is null then null else jsonb_build_object(
    'document', jsonb_build_object(
      'doc_id', s.latest_doc_id,
      'doc_type_code', s.latest_doc_type_code,
      'submitted_at', s.latest_submitted_at,
      'period_start', s.fiscal_period_start,
      'period_end', s.fiscal_period_end,
      'status', case when s.latest_processed then 'processed' else 'pending' end
    ),
    'siblings', coalesce((
      select jsonb_agg(jsonb_build_object(
               'doc_id', d.doc_id, 'doc_type_code', d.doc_type_code, 'submitted_at', d.submitted_at,
               'withdrawn', d.withdrawn, 'withheld', d.withheld)
             order by d.submitted_at desc, d.doc_id desc)
        from public.edinet_documents d
        left join public.edinet_documents p on p.doc_id = d.parent_doc_id
       where d.sec_code = s.code
         and d.doc_type_code in ('120', '130')
         and d.doc_id <> s.latest_doc_id
         and coalesce(d.period_end, p.period_end) = s.fiscal_period_end
    ), '[]'::jsonb),
    'candidate_count', s.candidate_count,
    'shareholders', jsonb_build_object(
      'status', s.shareholders_status,
      'detail', s.shareholders_detail,
      'source_doc_id', s.shareholders_doc_id,
      'source_doc_type_code', (select d.doc_type_code from public.edinet_documents d where d.doc_id = s.shareholders_doc_id),
      'source_submitted_at', (select d.submitted_at from public.edinet_documents d where d.doc_id = s.shareholders_doc_id),
      'fallback', s.shareholders_doc_id <> s.latest_doc_id,
      'rows', case when s.shareholders_status = 'ok' then coalesce((
        select jsonb_agg(jsonb_build_object(
                 'rank', r.rank, 'name', r.name, 'address', r.address,
                 'shares_held', r.shares_held::text, 'ratio_pct', r.ratio_pct::text, 'ratio_decimals', r.ratio_decimals)
               order by r.rank)
          from public.annual_report_shareholders r where r.doc_id = s.shareholders_doc_id
      ), '[]'::jsonb) else '[]'::jsonb end
    ),
    'officers', jsonb_build_object(
      'status', s.officers_status,
      'detail', s.officers_detail,
      'source_doc_id', s.officers_doc_id,
      'source_doc_type_code', (select d.doc_type_code from public.edinet_documents d where d.doc_id = s.officers_doc_id),
      'source_submitted_at', (select d.submitted_at from public.edinet_documents d where d.doc_id = s.officers_doc_id),
      'fallback', s.officers_doc_id <> s.latest_doc_id,
      'basis', s.officers_basis,
      'has_post_agm_table', s.officers_has_post_agm_table,
      'rows', case when s.officers_status = 'ok' then coalesce((
        select jsonb_agg(jsonb_build_object('seq', o.seq, 'name', o.name, 'title', o.title) order by o.seq)
          from public.annual_report_officers o where o.doc_id = s.officers_doc_id
      ), '[]'::jsonb) else '[]'::jsonb end
    )
  ) end
  from (select 1) as one
  left join public.annual_report_sections s on s.code = p_code;
$$;

-- ---------------------------------------------------------------------------
-- 取り込み状況の画面の要約（authenticated。security invoker）
-- ---------------------------------------------------------------------------
create function public.annual_reports_summary()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with s as (select * from public.annual_report_sections),
  pending_docs as (
    select shareholders_doc_id as doc_id from s where shareholders_status = 'pending'
    union
    select officers_doc_id from s where officers_status = 'pending'
  ),
  last_run as (
    select r.id, r.status, r.finished_at, r.processed_count, r.details
      from public.ingestion_runs r
     where r.target = 'edinet_reports' and r.status <> 'running'
     order by r.finished_at desc nulls last, r.id desc
     limit 1
  )
  select jsonb_build_object(
    'stockCount', (select count(*) from public.stocks),
    'documentCount', (select count(*) from public.edinet_documents),
    'fetchedStockCount', (select count(*) from s where s.latest_processed),
    'bothExtractedCount', (select count(*) from s where s.shareholders_status = 'ok' and s.officers_status = 'ok'),
    'notExtractedCount', (
      select count(*) from s
       where (s.shareholders_status not in ('ok', 'pending') or s.officers_status not in ('ok', 'pending'))
    ),
    'pendingDocumentCount', (select count(*) from pending_docs),
    'listDatesFetched', (select count(*) from public.edinet_list_fetched_dates),
    'lastRun', (
      select jsonb_build_object('status', l.status, 'finishedAt', l.finished_at, 'processedCount', l.processed_count,
                                'details', l.details)
        from last_run l
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- 取り込み処理用（service_role のみ）
-- ---------------------------------------------------------------------------
/**
 * 銘柄マスタの件数、期間の中の取得済みの日、本文を取得する書類（区画のどちらかが pending の書類。提出日時の新しい順）。
 * 行数の上限（max_rows）を受けないよう jsonb で返す。
 */
create function public.edinet_ingestion_state(p_from date, p_to date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with s as (select * from public.annual_report_sections),
  pending_docs as (
    select shareholders_doc_id as doc_id from s where shareholders_status = 'pending'
    union
    select officers_doc_id from s where officers_status = 'pending'
  )
  select jsonb_build_object(
    'stockCount', (select count(*) from public.stocks),
    'fetchedDates', coalesce(
      (select jsonb_agg(f.list_date order by f.list_date)
         from public.edinet_list_fetched_dates f
        where f.list_date between p_from and p_to),
      '[]'::jsonb
    ),
    'targets', coalesce(
      (select jsonb_agg(jsonb_build_object('docId', d.doc_id, 'code', d.sec_code, 'xbrlAvailable', d.xbrl_available)
                        order by d.submitted_at desc, d.doc_id desc)
         from public.edinet_documents d
        where d.doc_id in (select doc_id from pending_docs)),
      '[]'::jsonb
    )
  );
$$;

/**
 * 1日分の書類一覧の保存（1つのトランザクション）。実行が「実行中」のときだけ保存する。
 * - p_documents: 保存する書類（条件を満たす通常の行）。既にある行は、取り下げ・不開示・最初のファイル日付を保ったまま更新する。
 * - p_withdrawn: 取り下げられた書類の doc_id（取り下げられた書類の行、取下書の親書類）。既にある行だけを更新し、
 *   その書類を親とする書類（訂正など）も取り下げにする（親書類が取り下げられると子も取り下げられる）。
 * - p_disclosure: 開示不開示区分の変更（docId、withheld、opeAt）。既にある行だけを、操作日時が新しいときに更新する。
 */
create function public.save_edinet_document_list(
  p_run_id bigint,
  p_list_date date,
  p_documents jsonb,
  p_withdrawn jsonb,
  p_disclosure jsonb,
  p_received_count integer
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_upserted integer;
  v_withdrawn integer;
  v_withheld integer;
begin
  select status into v_status from public.ingestion_runs where id = p_run_id for update;
  if v_status is distinct from 'running' then
    return jsonb_build_object('saved', false);
  end if;

  -- 不開示の開始・解除（操作日時の新しい情報だけ）を先に反映する（同じ一覧の通常の行の不開示の区分で上書きしないため）
  with changes as (
    select distinct on (r.doc_id) r.*
      from jsonb_to_recordset(coalesce(p_disclosure, '[]'::jsonb)) as r(doc_id text, withheld boolean, ope_at timestamptz)
     order by r.doc_id, r.ope_at desc
  ),
  updated as (
    update public.edinet_documents d
       set withheld = c.withheld, disclosure_changed_at = c.ope_at, updated_at = now()
      from changes c
     where d.doc_id = c.doc_id
       and (d.disclosure_changed_at is null or d.disclosure_changed_at < c.ope_at)
       and d.withheld is distinct from c.withheld
    returning 1
  )
  select count(*) into v_withheld from updated;

  with input as (
    select distinct on (r.doc_id) r.*
      from jsonb_to_recordset(coalesce(p_documents, '[]'::jsonb)) as r(
        doc_id text, sec_code text, edinet_code text, filer_name text, doc_type_code text, ordinance_code text,
        form_code text, period_start date, period_end date, submitted_at timestamptz, parent_doc_id text,
        doc_description text, xbrl_available boolean, withheld boolean
      )
     order by r.doc_id
  ),
  upserted as (
    insert into public.edinet_documents as d (
      doc_id, sec_code, edinet_code, filer_name, doc_type_code, ordinance_code, form_code, period_start, period_end,
      submitted_at, parent_doc_id, doc_description, xbrl_available, withheld, list_date, run_id
    )
    select i.doc_id, i.sec_code, i.edinet_code, i.filer_name, i.doc_type_code, i.ordinance_code, i.form_code,
           i.period_start, i.period_end, i.submitted_at, i.parent_doc_id, i.doc_description,
           coalesce(i.xbrl_available, false), coalesce(i.withheld, false), p_list_date, p_run_id
      from input i
    on conflict (doc_id) do update
       set sec_code = excluded.sec_code,
           edinet_code = excluded.edinet_code,
           filer_name = excluded.filer_name,
           doc_type_code = excluded.doc_type_code,
           ordinance_code = excluded.ordinance_code,
           form_code = excluded.form_code,
           period_start = excluded.period_start,
           period_end = excluded.period_end,
           submitted_at = excluded.submitted_at,
           parent_doc_id = excluded.parent_doc_id,
           doc_description = excluded.doc_description,
           xbrl_available = excluded.xbrl_available,
           -- 不開示は、操作日時の分かる情報（p_disclosure）で管理する。一覧の通常の行では、不開示だけを立てる
           withheld = d.withheld or (excluded.withheld and d.disclosure_changed_at is null),
           run_id = excluded.run_id,
           updated_at = now()
     where (d.sec_code, d.edinet_code, d.filer_name, d.doc_type_code, d.ordinance_code, d.form_code, d.period_start,
            d.period_end, d.submitted_at, d.parent_doc_id, d.doc_description, d.xbrl_available, d.withheld)
           is distinct from
           (excluded.sec_code, excluded.edinet_code, excluded.filer_name, excluded.doc_type_code, excluded.ordinance_code,
            excluded.form_code, excluded.period_start, excluded.period_end, excluded.submitted_at, excluded.parent_doc_id,
            excluded.doc_description, excluded.xbrl_available,
            d.withheld or (excluded.withheld and d.disclosure_changed_at is null))
    returning 1
  )
  select count(*) into v_upserted from upserted;

  with ids as (
    select distinct value #>> '{}' as doc_id from jsonb_array_elements(coalesce(p_withdrawn, '[]'::jsonb))
  ),
  updated as (
    update public.edinet_documents d
       set withdrawn = true, updated_at = now()
     where not d.withdrawn
       and (d.doc_id in (select doc_id from ids) or d.parent_doc_id in (select doc_id from ids))
    returning 1
  )
  select count(*) into v_withdrawn from updated;

  insert into public.edinet_list_fetched_dates (list_date, fetched_at, document_count, run_id)
  values (p_list_date, now(), greatest(coalesce(p_received_count, 0), 0), p_run_id)
  on conflict (list_date) do update
     set fetched_at = excluded.fetched_at,
         document_count = excluded.document_count,
         run_id = excluded.run_id;

  return jsonb_build_object('saved', true, 'upserted', v_upserted, 'withdrawnUpdated', v_withdrawn,
                            'disclosureUpdated', v_withheld);
end;
$$;

/**
 * 1書類の大株主・役員の抽出の結果を保存する（1つのトランザクション。実行の処理件数を1足す）。
 * 実行が「実行中」のときだけ保存する。書類のメタデータが無ければ保存しない。
 */
create function public.save_annual_report_extraction(p_run_id bigint, p_doc_id text, p_result jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status from public.ingestion_runs where id = p_run_id for update;
  if v_status is distinct from 'running' then
    return jsonb_build_object('saved', false, 'reason', 'not_running');
  end if;
  if not exists (select 1 from public.edinet_documents where doc_id = p_doc_id) then
    return jsonb_build_object('saved', false, 'reason', 'unknown_document');
  end if;

  delete from public.annual_report_extractions where doc_id = p_doc_id;

  insert into public.annual_report_extractions (
    doc_id, processed_at, shareholders_status, officers_status, shareholders_detail, officers_detail,
    officers_basis, officers_has_post_agm_table, officers_order_source, run_id
  )
  values (
    p_doc_id, now(),
    p_result ->> 'shareholdersStatus', p_result ->> 'officersStatus',
    p_result ->> 'shareholdersDetail', p_result ->> 'officersDetail',
    p_result ->> 'officersBasis', coalesce((p_result ->> 'officersHasPostAgmTable')::boolean, false),
    p_result ->> 'officersOrderSource', p_run_id
  );

  -- 数値は十進の文字列で受け取り、numeric に直す（浮動小数点を経由しない）
  insert into public.annual_report_shareholders (doc_id, rank, name, address, shares_held, ratio_pct, ratio_decimals)
  select p_doc_id, r.rank, r.name, r.address, r.shares_held::numeric, r.ratio_pct::numeric, r.ratio_decimals
    from jsonb_to_recordset(coalesce(p_result -> 'shareholders', '[]'::jsonb)) as r(
      rank integer, name text, address text, shares_held text, ratio_pct text, ratio_decimals smallint
    );

  insert into public.annual_report_officers (doc_id, seq, name, title)
  select p_doc_id, r.seq, r.name, r.title
    from jsonb_to_recordset(coalesce(p_result -> 'officers', '[]'::jsonb)) as r(seq integer, name text, title text);

  update public.ingestion_runs set processed_count = processed_count + 1 where id = p_run_id;

  return jsonb_build_object('saved', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 権限と RLS（public.stocks と同じ）
-- ---------------------------------------------------------------------------
alter table public.edinet_documents enable row level security;
alter table public.edinet_list_fetched_dates enable row level security;
alter table public.annual_report_extractions enable row level security;
alter table public.annual_report_shareholders enable row level security;
alter table public.annual_report_officers enable row level security;

revoke all on public.edinet_documents, public.edinet_list_fetched_dates, public.annual_report_extractions,
  public.annual_report_shareholders, public.annual_report_officers from public, anon, authenticated;
grant select on public.edinet_documents, public.edinet_list_fetched_dates, public.annual_report_extractions,
  public.annual_report_shareholders, public.annual_report_officers to authenticated;
grant all on public.edinet_documents, public.edinet_list_fetched_dates, public.annual_report_extractions,
  public.annual_report_shareholders, public.annual_report_officers to service_role;

create policy "許可ユーザーのみ参照可" on public.edinet_documents
  for select to authenticated using ((select public.current_user_is_allowed()));
create policy "許可ユーザーのみ参照可" on public.edinet_list_fetched_dates
  for select to authenticated using ((select public.current_user_is_allowed()));
create policy "許可ユーザーのみ参照可" on public.annual_report_extractions
  for select to authenticated using ((select public.current_user_is_allowed()));
create policy "許可ユーザーのみ参照可" on public.annual_report_shareholders
  for select to authenticated using ((select public.current_user_is_allowed()));
create policy "許可ユーザーのみ参照可" on public.annual_report_officers
  for select to authenticated using ((select public.current_user_is_allowed()));

revoke all on public.annual_report_candidates, public.annual_report_sections from public, anon, authenticated;
grant select on public.annual_report_candidates, public.annual_report_sections to authenticated, service_role;

revoke execute on function public.annual_report_detail(text) from public, anon, authenticated;
revoke execute on function public.annual_reports_summary() from public, anon, authenticated;
revoke execute on function public.edinet_ingestion_state(date, date) from public, anon, authenticated;
revoke execute on function public.save_edinet_document_list(bigint, date, jsonb, jsonb, jsonb, integer)
  from public, anon, authenticated;
revoke execute on function public.save_annual_report_extraction(bigint, text, jsonb) from public, anon, authenticated;

grant execute on function public.annual_report_detail(text) to authenticated, service_role;
grant execute on function public.annual_reports_summary() to authenticated, service_role;
grant execute on function public.edinet_ingestion_state(date, date) to service_role;
grant execute on function public.save_edinet_document_list(bigint, date, jsonb, jsonb, jsonb, integer) to service_role;
grant execute on function public.save_annual_report_extraction(bigint, text, jsonb) to service_role;
