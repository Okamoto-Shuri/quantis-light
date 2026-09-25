-- Sprint 10: 条件④ オーナー企業／社長筆頭株主の自動判定と、保有状態の内訳（F9）
--
-- 方針（契約 docs/harness/sprints/sprint-10/contract.md の第2章）
-- - 分類と内訳は閾値に依存しないので、銘柄ごとに1回求めて保存する（ownership_judgments・ownership_holder_classifications）。
--   モード・閾値に依存する判定結果は、検索のたびに screening_evaluate で求める（判定の式はここだけ）。
-- - 分類の規則は純粋な関数 ownership_judgment_from_sections の1か所（大株主と役員の配列だけを受け取る。姓の読みの辞書だけを参照する）。
-- - 保存は recalculate_ownership_judgments。使う書類は Sprint 8 の区画の選び方（annual_report_sections_for。銘柄で絞れる形）で決め、
--   区画が取り込み待ちなら、処理済みの直前の有報で判定する（ユーザーの決定）。
-- - 有報の抽出・大株主・役員・書類・銘柄の変更で、同じトランザクションの中でトリガーが再計算する。
-- - 権限は public.stocks と同じ（RLS 有効、anon の権限なし、authenticated は許可ユーザーだけ select、書き込みは service_role のみ）。

-- ---------------------------------------------------------------------------
-- 1. テーブル
-- ---------------------------------------------------------------------------
-- Sprint 2 で先に作った最小の表（status・judged_at）に、根拠の列を加える。行が無い銘柄は「有報が未取得」（no_annual_report）
alter table public.ownership_judgments
  add column undeterminable_reason text
    check (undeterminable_reason in ('annual_report_pending', 'shareholders_not_extracted', 'officers_not_extracted', 'president_not_found')),
  add column undeterminable_detail jsonb,
  add column president_is_top_holder boolean,
  add column owner_total_pct numeric,
  add column president_pct numeric,
  add column officer_pct numeric,
  add column family_pct numeric,
  add column asset_company_pct numeric,
  add column other_pct numeric,
  add column top_holders jsonb,
  add column presidents jsonb,
  add column shareholders_doc_id text,
  add column officers_doc_id text,
  add column shareholders_pending_doc_id text,
  add column officers_pending_doc_id text,
  add constraint ownership_judgments_determined check (
    (status = 'determined' and undeterminable_reason is null and owner_total_pct is not null and president_is_top_holder is not null)
    or (status = 'undeterminable' and undeterminable_reason is not null)
  );

comment on table public.ownership_judgments is
  '銘柄ごとの条件④の判定の根拠（閾値に依存しない分類と内訳）。有報の区画から自動で保存する（直接書かない）。行が無い銘柄は有報が未取得';
comment on column public.ownership_judgments.owner_total_pct is 'オーナー系合計（区分1〜4）の持株比率（百分率。有報の記載の十進の値の合計。丸めない）';
comment on column public.ownership_judgments.top_holders is '筆頭株主（持株比率が最大の株主。同率なら全員。順位の順）';
comment on column public.ownership_judgments.presidents is '社長候補（氏名・役職名・特定の根拠 title／representative／title_without_representative・姓）';
comment on column public.ownership_judgments.shareholders_pending_doc_id is
  '大株主の区画が取り込み待ちの書類（処理済みの直前の有報で判定したとき、または判定不能 annual_report_pending のとき）';

create table public.ownership_holder_classifications (
  code text not null references public.ownership_judgments (code) on delete cascade,
  rank integer not null,
  name text not null,
  ratio_pct numeric not null,
  ratio_decimals smallint not null,
  category text not null check (category in ('president', 'officer', 'family', 'asset_company', 'other')),
  reason_code text not null check (reason_code in (
    'president_name', 'officer_name', 'president_surname', 'president_full_name', 'surname_reading', 'surname_romaji',
    'financial_or_association', 'unrelated_corporation', 'unrelated_individual'
  )),
  reason jsonb not null default '{}'::jsonb,
  primary key (code, rank)
);

comment on table public.ownership_holder_classifications is
  '大株主ごとのオーナー系の区分と分類理由（reason は一致した社長・役員の氏名と役職名、姓、読みなど。文の組み立ては画面側）';

-- ---------------------------------------------------------------------------
-- 2. 名前の正規化（比較の鍵）。契約の第2章の2・4
-- 小さな immutable の SQL 関数は、呼び出し側に展開（インライン化）されるよう set search_path を付けない
-- （付けると展開されず、4,000 銘柄の再計算で関数呼び出しの負担が大きくなる）。組み込みの関数は pg_catalog が常に先に探される。
-- ---------------------------------------------------------------------------
/**
 * 氏名・名称の比較の鍵: NFKC → 括弧とその中身を除く（閉じていない括弧は末尾まで）→ 空白を除く → 異体字を新字体に →
 * 英字を大文字に → ひらがなをカタカナに。
 */
create function public.ownership_name_key(p_name text)
returns text
language sql
immutable
parallel safe
as $$
  select translate(
           upper(translate(
             regexp_replace(
               regexp_replace(normalize(coalesce(p_name, ''), NFKC), '\([^)]*(\)|$)|\[[^]]*(\]|$)', '', 'g'),
               '\s+', '', 'g'),
             '髙﨑嵜邊邉濵濱齋齊澤櫻廣國德惠榮眞冨嶋嶌槗瀨證',
             '高崎崎辺辺浜浜斎斉沢桜広国徳恵栄真富島島橋瀬証')),
           'ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをんゔゕゖ',
           'ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴヵヶ');
$$;

/**
 * 役職名の比較の形: NFKC → 空白・改行を除く → 異体字 → 大文字（括弧は残す。「取締役頭取（代表取締役）」の代表を見るため）→
 * 「社長」「頭取」「CEO」が別の職の名の一部になっている語を除く（R1。副社長・副頭取・社長補佐・社長室・社長付・社長代行・社長代理・
 * 副CEO・CEO補佐。語を増やすのはよい）。
 */
create function public.ownership_title_key(p_title text)
returns text
language sql
immutable
parallel safe
as $$
  select regexp_replace(
           upper(translate(
             regexp_replace(normalize(coalesce(p_title, ''), NFKC), '\s+', '', 'g'),
             '髙﨑嵜邊邉濵濱齋齊澤櫻廣國德惠榮眞冨嶋嶌槗瀨證',
             '高崎崎辺辺浜浜斎斉沢桜広国徳恵栄真富島島橋瀬証')),
           '副社長|副頭取|社長補佐|社長室|社長付|社長代行|社長代理|副CEO|CEO補佐', '', 'g');
$$;

/**
 * 法人かどうか・除く語の判定に使う文字列: NFKC → 「常任代理人」で始まる括弧を中身ごと除く（R2）→ 異体字 → 大文字。
 * ほかの括弧（「（信託口）」など）は残す。空白も残す（ローマ字を単語として探すため）。
 */
create function public.ownership_corporate_text(p_name text)
returns text
language sql
immutable
parallel safe
as $$
  select upper(translate(
           regexp_replace(normalize(coalesce(p_name, ''), NFKC), '\(\s*常任代理人[^)]*(\)|$)', '', 'g'),
           '髙﨑嵜邊邉濵濱齋齊澤櫻廣國德惠榮眞冨嶋嶌槗瀨證',
           '高崎崎辺辺浜浜斎斉沢桜広国徳恵栄真富島島橋瀬証'));
$$;

/** 法人等か（第2章の4の語を含む）。引数は ownership_corporate_text の値。 */
create function public.ownership_is_corporate(p_text text)
returns boolean
language sql
immutable
parallel safe
as $$
  select p_text ~ '株式会社|有限会社|合同会社|合資会社|合名会社|\(株\)|\(有\)|法人|組合|基金|信託|銀行|証券|保険|生命|共済|金庫|公庫|持株会|ファンド|ホールディングス|政府|大臣'
      or p_text ~ '(^|[^A-Z])(LIMITED|LTD|INC|CORP|CORPORATION|COMPANY|CO|LLC|LLP|LP|PLC|FUND|TRUST|BANK|SECURITIES|HOLDINGS|CAPITAL|PARTNERS|INVESTMENT|INVESTMENTS|MANAGEMENT|ACCOUNT|NOMINEES|NOMINEE|AG|SA|NV|BV|GMBH|MELLON)([^A-Z]|$)';
$$;

/** 資産管理会社（区分4）の候補から除く法人等（金融機関・信託口・持株会・公的機関）。引数は ownership_corporate_text の値。 */
create function public.ownership_is_excluded_corporate(p_text text)
returns boolean
language sql
immutable
parallel safe
as $$
  select p_text ~ '信託|銀行|証券|保険|生命|共済|金庫|公庫|組合|基金|持株会|ファンド|政府|大臣'
      or p_text ~ '(^|[^A-Z])(TRUST|BANK|SECURITIES|FUND|NOMINEE|NOMINEES|ACCOUNT|MELLON)([^A-Z]|$)';
$$;

/** 氏名の部分（NFKC → 括弧を除く → 連続した空白を1つの区切りにする） */
create function public.ownership_name_parts(p_name text)
returns text[]
language sql
immutable
parallel safe
as $$
  select string_to_array(
           btrim(regexp_replace(
             regexp_replace(normalize(coalesce(p_name, ''), NFKC), '\([^)]*(\)|$)|\[[^]]*(\]|$)', '', 'g'),
             '\s+', ' ', 'g')),
           ' ');
$$;

/**
 * 氏名の元の記載から姓（表示の形。NFKC 後）を取る: 最初の部分。
 * 空白が無い、または3つ以上の部分がすべて1文字（「山 田 太 郎」。S2）のときは NULL（決めない）。
 */
create function public.ownership_surname_of(p_name text)
returns text
language sql
immutable
parallel safe
as $$
  select case
           when coalesce(cardinality(a), 0) < 2 or a[1] = '' then null
           when cardinality(a) >= 3 and char_length(array_to_string(a, '')) = cardinality(a) then null
           else a[1]
         end
    from (select public.ownership_name_parts(p_name) as a) x;
$$;

-- ---------------------------------------------------------------------------
-- 3. 分類の規則（純粋な関数）。契約の第2章の3〜7
-- ---------------------------------------------------------------------------
/**
 * 大株主（[{rank, name, ratio_pct, ratio_decimals}]）と役員（[{seq, name, title}]）から、社長・筆頭株主・株主ごとの区分と理由・内訳を求める。
 * 書類・銘柄の情報は読まない（参照するのは姓の読みの辞書だけ）。1つの問い合わせで、名前の正規化は株主・役員ごとに1回だけ行う。
 * 返り値: {status: 'determined', basis, presidents, holders, totals, top_holders, president_is_top_holder}
 *         または {status: 'undeterminable', reason: 'president_not_found' | 'shareholders_not_extracted', detail}
 * 社長: 除く語を取り除いた役職名で ① 代表（代表取締役・代表執行役）＋ 社長等（社長・CEO・最高経営責任者・頭取）→
 *       ② 代表者による補い → ③「社長」等による補い。姓は役員の記載 → 区分1で一致した大株主の記載（個人）の順。
 * 区分は上から順に最初に当たるもの（社長本人 → その他の役員本人 → 同姓の親族（推定）→ 資産管理会社（推定）→ オーナー系以外）。
 * 資産管理会社の理由は、社長の氏名 → 姓 → 読み（3文字以上）→ ローマ字（4文字以上、単語として）の順に最初に満たしたもの。
 */
create function public.ownership_judgment_from_sections(p_shareholders jsonb, p_officers jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with o as (
    select x.seq, x.name, x.title, public.ownership_name_key(x.name) as name_key, public.ownership_title_key(x.title) as t,
           public.ownership_surname_of(x.name) as own_surname
      from jsonb_to_recordset(case when jsonb_typeof(p_officers) = 'array' then p_officers else '[]'::jsonb end)
        as x(seq integer, name text, title text)
  ),
  f as (
    select o.*, o.t ~ '代表取締役|代表執行役' as rep, o.t ~ '社長|CEO|最高経営責任者|頭取' as pres from o
  ),
  b as (
    select case when bool_or(f.rep and f.pres) then 'title'
                when bool_or(f.rep) then 'representative'
                when bool_or(f.pres) then 'title_without_representative' end as basis
      from f
  ),
  sh as (
    select x.rank, x.name, x.ratio_pct, coalesce(x.ratio_decimals, 2) as ratio_decimals,
           public.ownership_name_key(x.name) as k,
           public.ownership_corporate_text(x.name) as ct,
           public.ownership_surname_of(x.name) as hs
      from jsonb_to_recordset(case when jsonb_typeof(p_shareholders) = 'array' then p_shareholders else '[]'::jsonb end)
        as x(rank integer, name text, ratio_pct numeric, ratio_decimals integer)
  ),
  sh2 as (
    select sh.*,
           public.ownership_is_corporate(sh.ct) as corp,
           public.ownership_is_excluded_corporate(sh.ct) as excl,
           public.ownership_name_key(sh.hs) as hk,
           regexp_replace(sh.k, '^(株式会社|有限会社|合同会社|合資会社|合名会社)+', '') as core
      from sh
  ),
  p as (
    select f.seq, f.name, f.title, f.name_key, b.basis,
           coalesce(f.own_surname,
                    (select s.hs from sh2 s where s.k = f.name_key and not s.corp and s.hs is not null order by s.rank limit 1)) as surname,
           f.own_surname is not null as surname_from_officer
      from f, b
     where case b.basis when 'title' then f.rep and f.pres when 'representative' then f.rep else f.pres end
  ),
  pk as (
    select p.*, case when p.surname is null then null else public.ownership_name_key(p.surname) end as surname_key from p
  ),
  rd as (
    select pk.seq, r.reading, r.romaji from pk join public.surname_readings r on r.surname = pk.surname_key
  ),
  offs as (
    select f.seq, f.name, f.title, f.name_key from f where not exists (select 1 from p where p.seq = f.seq)
  ),
  m as (
    select s.*,
           case when not s.corp then (
             select jsonb_build_object('president_name', p.name, 'president_title', p.title)
               from pk p where p.name_key = s.k order by p.seq limit 1) end as m_president,
           case when not s.corp then (
             select jsonb_build_object('officer_name', o.name, 'officer_title', o.title)
               from offs o where o.name_key = s.k order by o.seq limit 1) end as m_officer,
           case when not s.corp then (
             select jsonb_build_object('president_name', p.name, 'surname', p.surname)
               from pk p
              where case when s.hs is not null then p.surname_key = s.hk
                         else char_length(p.surname_key) >= 2
                              and left(s.k, char_length(p.surname_key)) = p.surname_key
                              and char_length(s.k) > char_length(p.surname_key) end
              order by p.seq limit 1) end as m_family,
           case when s.corp and not s.excl then (
             select jsonb_build_object('code', c.code, 'reason', c.reason)
               from (
                 select 1 as ord, p.seq, 'president_full_name' as code, jsonb_build_object('president_name', p.name) as reason
                   from pk p where p.name_key <> '' and position(p.name_key in s.k) > 0
                 union all
                 select 2, p.seq, 'president_surname', jsonb_build_object('president_name', p.name, 'surname', p.surname)
                   from pk p
                  where (char_length(p.surname_key) >= 2 and position(p.surname_key in s.k) > 0)
                     or (char_length(p.surname_key) = 1 and left(s.core, 1) = p.surname_key)
                 union all
                 select 3, p.seq, 'surname_reading', jsonb_build_object('president_name', p.name, 'surname', p.surname, 'reading', r.reading)
                   from pk p join rd r on r.seq = p.seq
                  where char_length(r.reading) >= 3 and position(r.reading in s.k) > 0
                 union all
                 select 4, p.seq, 'surname_romaji', jsonb_build_object('president_name', p.name, 'surname', p.surname, 'reading', rm)
                   from pk p join rd r on r.seq = p.seq, unnest(r.romaji) rm
                  where char_length(rm) >= 4 and s.ct ~ ('(^|[^A-Z])' || rm || '([^A-Z]|$)')
               ) c
              order by c.ord, c.seq
              limit 1) end as m_asset
      from sh2 s
  ),
  cls as (
    select m.rank, m.name, m.ratio_pct, m.ratio_decimals,
           case when m.m_president is not null then 'president'
                when m.m_officer is not null then 'officer'
                when m.m_family is not null then 'family'
                when m.m_asset is not null then 'asset_company'
                else 'other' end as category,
           case when m.m_president is not null then 'president_name'
                when m.m_officer is not null then 'officer_name'
                when m.m_family is not null then 'president_surname'
                when m.m_asset is not null then m.m_asset ->> 'code'
                when not m.corp then 'unrelated_individual'
                when m.excl then 'financial_or_association'
                else 'unrelated_corporation' end as reason_code,
           coalesce(m.m_president, m.m_officer, m.m_family, m.m_asset -> 'reason', '{}'::jsonb) as reason
      from m
  ),
  tops as (
    select c.* from cls c where c.ratio_pct = (select max(x.ratio_pct) from cls x)
  )
  select case
    when (select count(*) from sh) = 0 then
      jsonb_build_object('status', 'undeterminable', 'reason', 'shareholders_not_extracted', 'detail', 'no_rows')
    when (select basis from b) is null then
      jsonb_build_object('status', 'undeterminable', 'reason', 'president_not_found')
    else jsonb_build_object(
      'status', 'determined',
      'basis', (select basis from b),
      'presidents', (select jsonb_agg(jsonb_build_object(
                       'seq', p.seq, 'name', p.name, 'title', p.title, 'basis', p.basis,
                       'surname', p.surname, 'surname_key', p.surname_key,
                       'surname_source', case when p.surname is null then null when p.surname_from_officer then 'officer' else 'shareholder' end
                     ) order by p.seq) from pk p),
      'holders', (select jsonb_agg(jsonb_build_object(
                    'rank', c.rank, 'name', c.name, 'ratio_pct', c.ratio_pct::text, 'ratio_decimals', c.ratio_decimals,
                    'category', c.category, 'reason_code', c.reason_code, 'reason', c.reason) order by c.rank) from cls c),
      'totals', (select jsonb_build_object(
                   'president', coalesce(sum(c.ratio_pct) filter (where c.category = 'president'), 0),
                   'officer', coalesce(sum(c.ratio_pct) filter (where c.category = 'officer'), 0),
                   'family', coalesce(sum(c.ratio_pct) filter (where c.category = 'family'), 0),
                   'asset_company', coalesce(sum(c.ratio_pct) filter (where c.category = 'asset_company'), 0),
                   'other', coalesce(sum(c.ratio_pct) filter (where c.category = 'other'), 0),
                   'owner_total', coalesce(sum(c.ratio_pct) filter (where c.category <> 'other'), 0)) from cls c),
      'top_holders', (select jsonb_agg(jsonb_build_object('rank', t.rank, 'name', t.name, 'ratio_pct', t.ratio_pct::text,
                                                          'ratio_decimals', t.ratio_decimals, 'category', t.category) order by t.rank)
                        from tops t),
      'president_is_top_holder', exists (select 1 from tops t where t.category = 'president')
    )
  end;
$$;

comment on function public.ownership_judgment_from_sections(jsonb, jsonb) is
  '条件④の分類の規則の1か所（純粋な関数。大株主と役員の配列だけを受け取る。姓の読みの辞書だけを参照する）';

-- ---------------------------------------------------------------------------
-- 4. 使う書類の選び方（Sprint 8 のビューを、銘柄で絞れる関数にする。Sprint 8 の m5）
-- ---------------------------------------------------------------------------
/** 銘柄ごとの有報の候補の列（annual_report_candidates と同じ規則）。p_codes が NULL なら全銘柄。 */
create function public.annual_report_candidates_for(p_codes text[])
returns table (
  code text, doc_id text, doc_type_code text, submitted_at timestamptz, xbrl_available boolean,
  fiscal_period_end date, fiscal_period_start date, "position" integer, candidate_count integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with docs as (
    select d.doc_id, d.sec_code as code, d.doc_type_code, d.submitted_at, d.xbrl_available,
           coalesce(d.period_end, p.period_end) as fiscal_period_end,
           coalesce(d.period_start, case when d.period_end is null then p.period_start end) as fiscal_period_start
      from public.edinet_documents d
      left join public.edinet_documents p on p.doc_id = d.parent_doc_id
     where d.doc_type_code in ('120', '130')
       and not d.withdrawn and not d.withheld
       and d.sec_code is not null
       and (p_codes is null or d.sec_code = any (p_codes))
  ),
  dated as (
    select docs.* from docs
     where docs.fiscal_period_end is not null
       and exists (select 1 from public.stocks s where s.code = docs.code)
  ),
  target as (
    select dated.code, max(dated.fiscal_period_end) as fiscal_period_end from dated group by dated.code
  )
  select d.code, d.doc_id, d.doc_type_code, d.submitted_at, d.xbrl_available, d.fiscal_period_end, d.fiscal_period_start,
         row_number() over (partition by d.code order by d.submitted_at desc, d.doc_id desc)::integer,
         count(*) over (partition by d.code)::integer
    from dated d
    join target t on t.code = d.code and t.fiscal_period_end = d.fiscal_period_end;
$$;

/** 銘柄ごとの区画の書類と結果（annual_report_sections と同じ規則）。p_codes が NULL なら全銘柄。 */
create function public.annual_report_sections_for(p_codes text[])
returns table (
  code text, latest_doc_id text, latest_doc_type_code text, latest_submitted_at timestamptz,
  fiscal_period_start date, fiscal_period_end date, latest_processed boolean, candidate_count integer,
  shareholders_doc_id text, shareholders_status text, shareholders_detail text,
  officers_doc_id text, officers_status text, officers_detail text, officers_basis text, officers_has_post_agm_table boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with c as (
    select c.*, e.doc_id is not null as processed,
           e.shareholders_status, e.shareholders_detail, e.officers_status, e.officers_detail,
           e.officers_basis, e.officers_has_post_agm_table
      from public.annual_report_candidates_for(p_codes) c
      left join public.annual_report_extractions e on e.doc_id = c.doc_id
  ),
  latest as (select * from c where c."position" = 1),
  sh as (
    select distinct on (c.code) c.code, c.doc_id,
           case when c.processed then c.shareholders_status else 'pending' end as status,
           c.shareholders_detail as detail
      from c
     where not c.processed or c.shareholders_status in ('ok', 'invalid_values')
     order by c.code, c."position"
  ),
  off as (
    select distinct on (c.code) c.code, c.doc_id,
           case when c.processed then c.officers_status else 'pending' end as status,
           c.officers_detail as detail, c.officers_basis as basis, c.officers_has_post_agm_table as has_post_agm_table
      from c
     where not c.processed or c.officers_status in ('ok', 'invalid_values')
     order by c.code, c."position"
  )
  select l.code,
         l.doc_id,
         l.doc_type_code,
         l.submitted_at,
         l.fiscal_period_start,
         l.fiscal_period_end,
         l.processed,
         l.candidate_count,
         coalesce(sh.doc_id, l.doc_id),
         coalesce(sh.status, l.shareholders_status),
         case when sh.doc_id is not null then sh.detail else l.shareholders_detail end,
         coalesce(off.doc_id, l.doc_id),
         coalesce(off.status, l.officers_status),
         case when off.doc_id is not null then off.detail else l.officers_detail end,
         case when off.doc_id is not null then off.basis else l.officers_basis end,
         coalesce(case when off.doc_id is not null then off.has_post_agm_table else l.officers_has_post_agm_table end, false)
    from latest l
    left join sh on sh.code = l.code
    left join off on off.code = l.code;
$$;

create or replace view public.annual_report_candidates
with (security_invoker = true)
as
select * from public.annual_report_candidates_for(null);

create or replace view public.annual_report_sections
with (security_invoker = true)
as
select * from public.annual_report_sections_for(null);

/** 銘柄詳細の有報（Sprint 8 の関数。出力は変えない。銘柄で絞った区画だけを計算する。m5） */
create or replace function public.annual_report_detail(p_code text)
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
  left join public.annual_report_sections_for(array[p_code]) s on s.code = p_code;
$$;

-- ---------------------------------------------------------------------------
-- 5. 保存（銘柄ごと）
-- ---------------------------------------------------------------------------
/**
 * 指定した銘柄の判定を求め直して保存する（1つの文で、銘柄ごとに純粋な関数を1回呼ぶ）。
 * 区画の書類は annual_report_sections_for（銘柄で絞る）で決め、区画が取り込み待ち（pending）なら、処理済みの直前の有報
 * （事業年度を問わない。事業年度 → 提出日時の新しい順で、その区画が ok・invalid_values の最初の書類）で判定する（ユーザーの決定）。
 * 置き換えた区画は *_pending_doc_id に記録する。有報の候補が無い銘柄は行を作らない（有報が未取得）。
 */
create function public.recalculate_ownership_judgments(p_codes text[])
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_codes is null or cardinality(p_codes) = 0 then
    return 0;
  end if;

  delete from public.ownership_judgments j where j.code = any (p_codes);

  with s as (
    select * from public.annual_report_sections_for(p_codes)
  ),
  resolved as (
    select s.code,
           case when s.shareholders_status = 'pending' then s.shareholders_doc_id end as sh_pending,
           case when s.officers_status = 'pending' then s.officers_doc_id end as of_pending,
           coalesce(fs.doc_id, s.shareholders_doc_id) as sh_doc,
           coalesce(fs.shareholders_status, s.shareholders_status) as sh_status,
           case when fs.doc_id is not null then fs.shareholders_detail else s.shareholders_detail end as sh_detail,
           coalesce(fo.doc_id, s.officers_doc_id) as of_doc,
           coalesce(fo.officers_status, s.officers_status) as of_status,
           case when fo.doc_id is not null then fo.officers_detail else s.officers_detail end as of_detail
      from s
      left join lateral (
        select d.doc_id, e.shareholders_status, e.shareholders_detail
          from public.edinet_documents d
          left join public.edinet_documents p on p.doc_id = d.parent_doc_id
          join public.annual_report_extractions e on e.doc_id = d.doc_id
         where s.shareholders_status = 'pending'
           and d.sec_code = s.code and d.doc_type_code in ('120', '130') and not d.withdrawn and not d.withheld
           and coalesce(d.period_end, p.period_end) is not null
           and e.shareholders_status in ('ok', 'invalid_values')
         order by coalesce(d.period_end, p.period_end) desc, d.submitted_at desc, d.doc_id desc
         limit 1
      ) fs on true
      left join lateral (
        select d.doc_id, e.officers_status, e.officers_detail
          from public.edinet_documents d
          left join public.edinet_documents p on p.doc_id = d.parent_doc_id
          join public.annual_report_extractions e on e.doc_id = d.doc_id
         where s.officers_status = 'pending'
           and d.sec_code = s.code and d.doc_type_code in ('120', '130') and not d.withdrawn and not d.withheld
           and coalesce(d.period_end, p.period_end) is not null
           and e.officers_status in ('ok', 'invalid_values')
         order by coalesce(d.period_end, p.period_end) desc, d.submitted_at desc, d.doc_id desc
         limit 1
      ) fo on true
  ),
  judged as materialized (
    select r.*,
           case
             when r.sh_status = 'pending' or r.of_status = 'pending' then
               jsonb_build_object('status', 'undeterminable', 'reason', 'annual_report_pending',
                                  'detail', jsonb_build_object('doc_id', coalesce(r.sh_pending, r.of_pending)))
             when r.sh_status <> 'ok' then
               jsonb_build_object('status', 'undeterminable', 'reason', 'shareholders_not_extracted',
                                  'detail', jsonb_build_object('status', r.sh_status, 'detail', r.sh_detail, 'doc_id', r.sh_doc))
             when r.of_status <> 'ok' then
               jsonb_build_object('status', 'undeterminable', 'reason', 'officers_not_extracted',
                                  'detail', jsonb_build_object('status', r.of_status, 'detail', r.of_detail, 'doc_id', r.of_doc))
             else public.ownership_judgment_from_sections(
               (select coalesce(jsonb_agg(jsonb_build_object('rank', h.rank, 'name', h.name, 'ratio_pct', h.ratio_pct::text,
                                                             'ratio_decimals', h.ratio_decimals) order by h.rank), '[]'::jsonb)
                  from public.annual_report_shareholders h where h.doc_id = r.sh_doc),
               (select coalesce(jsonb_agg(jsonb_build_object('seq', o.seq, 'name', o.name, 'title', o.title) order by o.seq), '[]'::jsonb)
                  from public.annual_report_officers o where o.doc_id = r.of_doc)
             )
           end as j
      from resolved r
  ),
  inserted as (
    insert into public.ownership_judgments (
      code, status, judged_at, undeterminable_reason, undeterminable_detail, president_is_top_holder, owner_total_pct,
      president_pct, officer_pct, family_pct, asset_company_pct, other_pct,
      top_holders, presidents, shareholders_doc_id, officers_doc_id, shareholders_pending_doc_id, officers_pending_doc_id
    )
    select g.code,
           g.j ->> 'status',
           now(),
           g.j ->> 'reason',
           case when g.j ->> 'status' = 'undeterminable' then
             case when jsonb_typeof(g.j -> 'detail') = 'object' then g.j -> 'detail'
                  else jsonb_build_object('status', 'ok', 'detail', g.j ->> 'detail', 'doc_id', g.sh_doc) end
           end,
           (g.j ->> 'president_is_top_holder')::boolean,
           (g.j -> 'totals' ->> 'owner_total')::numeric,
           (g.j -> 'totals' ->> 'president')::numeric,
           (g.j -> 'totals' ->> 'officer')::numeric,
           (g.j -> 'totals' ->> 'family')::numeric,
           (g.j -> 'totals' ->> 'asset_company')::numeric,
           (g.j -> 'totals' ->> 'other')::numeric,
           g.j -> 'top_holders',
           g.j -> 'presidents',
           g.sh_doc, g.of_doc, g.sh_pending, g.of_pending
      from judged g
    returning 1
  ),
  holders as (
    insert into public.ownership_holder_classifications (code, rank, name, ratio_pct, ratio_decimals, category, reason_code, reason)
    select g.code, (x ->> 'rank')::integer, x ->> 'name', (x ->> 'ratio_pct')::numeric, (x ->> 'ratio_decimals')::smallint,
           x ->> 'category', x ->> 'reason_code', x -> 'reason'
      from judged g, jsonb_array_elements(g.j -> 'holders') x
     where g.j ->> 'status' = 'determined'
    returning 1
  )
  select (select count(*) from inserted) + 0 * (select count(*) from holders) into v_count;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. 再計算のトリガー（同じトランザクションの中で。契約の第2章の1の表）
-- ---------------------------------------------------------------------------
/** 書類（有報・訂正有報）の銘柄を再計算する。 */
create function public.recalculate_ownership_for_documents(p_doc_ids text[])
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$
  select public.recalculate_ownership_judgments(array(
    select distinct d.sec_code from public.edinet_documents d
     where d.doc_id = any (p_doc_ids) and d.doc_type_code in ('120', '130') and d.sec_code is not null
  ));
$$;

/** annual_report_extractions・annual_report_shareholders・annual_report_officers の変更（書類の行が消えた連鎖は書類の削除のトリガーに任せる）。 */
create function public.annual_report_rows_recalculate_ownership()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.recalculate_ownership_for_documents(array(select distinct n.doc_id from new_rows n));
  elsif tg_op = 'UPDATE' then
    perform public.recalculate_ownership_for_documents(array(select n.doc_id from new_rows n union select o.doc_id from old_rows o));
  else
    perform public.recalculate_ownership_for_documents(array(select distinct o.doc_id from old_rows o));
  end if;
  return null;
end;
$$;

create trigger annual_report_extractions_ownership_insert
  after insert on public.annual_report_extractions
  referencing new table as new_rows
  for each statement execute function public.annual_report_rows_recalculate_ownership();
create trigger annual_report_extractions_ownership_update
  after update on public.annual_report_extractions
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.annual_report_rows_recalculate_ownership();
create trigger annual_report_extractions_ownership_delete
  after delete on public.annual_report_extractions
  referencing old table as old_rows
  for each statement execute function public.annual_report_rows_recalculate_ownership();
create trigger annual_report_shareholders_ownership_insert
  after insert on public.annual_report_shareholders
  referencing new table as new_rows
  for each statement execute function public.annual_report_rows_recalculate_ownership();
create trigger annual_report_shareholders_ownership_update
  after update on public.annual_report_shareholders
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.annual_report_rows_recalculate_ownership();
create trigger annual_report_shareholders_ownership_delete
  after delete on public.annual_report_shareholders
  referencing old table as old_rows
  for each statement execute function public.annual_report_rows_recalculate_ownership();
create trigger annual_report_officers_ownership_insert
  after insert on public.annual_report_officers
  referencing new table as new_rows
  for each statement execute function public.annual_report_rows_recalculate_ownership();
create trigger annual_report_officers_ownership_update
  after update on public.annual_report_officers
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.annual_report_rows_recalculate_ownership();
create trigger annual_report_officers_ownership_delete
  after delete on public.annual_report_officers
  referencing old table as old_rows
  for each statement execute function public.annual_report_rows_recalculate_ownership();

/**
 * edinet_documents の変更。insert は新しい有報の銘柄。update は選び方に関わる列（取り下げ・不開示・証券コード・期間・提出日時・
 * 元の書類・種類）が変わった書類の、変更の前後の銘柄。delete は消えた書類の OLD の銘柄（連鎖で抽出の行も消えた後に動く）。
 */
create function public.edinet_documents_recalculate_ownership()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.recalculate_ownership_judgments(array(
      select distinct n.sec_code from new_rows n where n.doc_type_code in ('120', '130') and n.sec_code is not null
    ));
  elsif tg_op = 'UPDATE' then
    perform public.recalculate_ownership_judgments(array(
      select x.code from (
        select o.sec_code as code from old_rows o join new_rows n on n.doc_id = o.doc_id
         where (o.withdrawn, o.withheld, o.sec_code, o.period_start, o.period_end, o.submitted_at, o.parent_doc_id, o.doc_type_code)
               is distinct from (n.withdrawn, n.withheld, n.sec_code, n.period_start, n.period_end, n.submitted_at, n.parent_doc_id, n.doc_type_code)
           and (o.doc_type_code in ('120', '130') or n.doc_type_code in ('120', '130'))
        union
        select n.sec_code from old_rows o join new_rows n on n.doc_id = o.doc_id
         where (o.withdrawn, o.withheld, o.sec_code, o.period_start, o.period_end, o.submitted_at, o.parent_doc_id, o.doc_type_code)
               is distinct from (n.withdrawn, n.withheld, n.sec_code, n.period_start, n.period_end, n.submitted_at, n.parent_doc_id, n.doc_type_code)
           and (o.doc_type_code in ('120', '130') or n.doc_type_code in ('120', '130'))
      ) x
      where x.code is not null
    ));
  else
    perform public.recalculate_ownership_judgments(array(
      select distinct o.sec_code from old_rows o where o.doc_type_code in ('120', '130') and o.sec_code is not null
    ));
  end if;
  return null;
end;
$$;

create trigger edinet_documents_ownership_insert
  after insert on public.edinet_documents
  referencing new table as new_rows
  for each statement execute function public.edinet_documents_recalculate_ownership();
create trigger edinet_documents_ownership_update
  after update on public.edinet_documents
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.edinet_documents_recalculate_ownership();
create trigger edinet_documents_ownership_delete
  after delete on public.edinet_documents
  referencing old table as old_rows
  for each statement execute function public.edinet_documents_recalculate_ownership();

/** stocks の追加（有報は銘柄マスタへの外部キーを持たないため、銘柄マスタに入った時点で保存済みの有報で判定する）。 */
create function public.stocks_recalculate_ownership()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.recalculate_ownership_judgments(array(
    select n.code from new_rows n
     where exists (select 1 from public.edinet_documents d where d.sec_code = n.code and d.doc_type_code in ('120', '130'))
  ));
  return null;
end;
$$;

create trigger stocks_recalculate_ownership_insert
  after insert on public.stocks
  referencing new table as new_rows
  for each statement execute function public.stocks_recalculate_ownership();

-- ---------------------------------------------------------------------------
-- 7. 表示用の要約（一覧・詳細・API の ownership。数値は十進の文字列）
-- ---------------------------------------------------------------------------
/**
 * 1銘柄の判定の要約。p_result は screening_evaluate が現在のモード・閾値で求めた結果。
 * 比率は丸めない十進の文字列（*_pct）と、百分率の小数点以下1桁に切り捨てた表示（owner_total_display_pct）。
 */
create function public.ownership_summary(p_code text, p_result text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select case when j.code is null or j.status = 'undeterminable' then jsonb_build_object(
           'status', 'undeterminable',
           'undeterminable_reason', coalesce(j.undeterminable_reason, 'no_annual_report'),
           'undeterminable_detail', j.undeterminable_detail,
           'result', 'undeterminable',
           'president_is_top_holder', null,
           'owner_total_pct', null,
           'owner_total_display_pct', null,
           'category_pct', null,
           'top_holders', '[]'::jsonb,
           'presidents', '[]'::jsonb,
           'pending_doc_id', coalesce(j.shareholders_pending_doc_id, j.officers_pending_doc_id)
         ) else jsonb_build_object(
           'status', 'determined',
           'undeterminable_reason', null,
           'undeterminable_detail', null,
           'result', p_result,
           'president_is_top_holder', j.president_is_top_holder,
           'owner_total_pct', j.owner_total_pct::text,
           'owner_total_display_pct', trunc(j.owner_total_pct, 1)::text,
           'category_pct', jsonb_build_object(
             'president', j.president_pct::text, 'officer', j.officer_pct::text, 'family', j.family_pct::text,
             'asset_company', j.asset_company_pct::text, 'other', j.other_pct::text
           ),
           'top_holders', coalesce(j.top_holders, '[]'::jsonb),
           'presidents', coalesce(j.presidents, '[]'::jsonb),
           'pending_doc_id', coalesce(j.shareholders_pending_doc_id, j.officers_pending_doc_id)
         ) end
    from (select 1) as one
    left join public.ownership_judgments j on j.code = p_code;
$$;

-- ---------------------------------------------------------------------------
-- 8. 判定の式（条件①〜④）。screen_stocks と stock_detail が共有する唯一の判定の式
-- ---------------------------------------------------------------------------
drop function public.screening_evaluate(jsonb, text[]);

/**
 * p_codes が NULL なら全銘柄、配列ならその銘柄だけ。
 * 条件④: owner（閾値 %、既定 20）・ownerMode（any = オーナー企業または社長が筆頭株主、president = 社長が筆頭株主のみ）・ownerOn。
 *   owner_result は現在のモード・閾値での結果（条件がオフでも求める）: 判定不能 → undeterminable、社長が筆頭株主 → president_top、
 *   any で合計 ≥ 閾値 → owner_company、そのほか → not_matched。
 */
create function public.screening_evaluate(p_params jsonb, p_codes text[] default null)
returns table (code text, s_cagr text, s_margin text, s_years text, s_owner text, owner_result text, matches_filters boolean)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_cagr numeric := (p_params ->> 'cagr')::numeric / 100;
  v_margin numeric := (p_params ->> 'margin')::numeric / 100;
  v_years numeric := (p_params ->> 'years')::numeric;
  v_owner numeric := coalesce((p_params ->> 'owner')::numeric, 20);
  v_owner_mode text := coalesce(p_params ->> 'ownerMode', 'any');
  v_cagr_on boolean := coalesce((p_params ->> 'cagrOn')::boolean, true);
  v_margin_on boolean := coalesce((p_params ->> 'marginOn')::boolean, true);
  v_years_on boolean := coalesce((p_params ->> 'yearsOn')::boolean, true);
  v_owner_on boolean := coalesce((p_params ->> 'ownerOn')::boolean, true);
  v_markets text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_params -> 'markets', '[]')) x), '{}');
  v_sectors text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_params -> 'sectors', '[]')) x), '{}');
  v_reference date;
  v_cutoff date;
begin
  if v_cagr is null or v_margin is null or v_years is null then
    raise exception 'screening_evaluate: thresholds are required' using errcode = '22023';
  end if;
  if v_owner_mode not in ('any', 'president') then
    raise exception 'screening_evaluate: invalid ownerMode %', v_owner_mode using errcode = '22023';
  end if;

  select r.reference_date into v_reference from public.listing_reference_date r;
  if v_years_on then
    v_cutoff := public.listing_first_date_cutoff(v_reference, v_years);
  end if;

  return query
    with base as (
      select s.code,
             case when not v_cagr_on then 'off'
                  when m.revenue_cagr is null then 'unavailable'
                  when m.revenue_cagr >= v_cagr then 'met' else 'unmet' end as s_cagr,
             case when not v_margin_on then 'off'
                  when m.operating_margin is null then 'unavailable'
                  when m.operating_margin >= v_margin then 'met' else 'unmet' end as s_margin,
             case when not v_years_on then 'off'
                  when d.code is null or v_reference is null then 'unavailable'
                  when d.first_price_date = d.data_start_date then 'unmet'
                  when v_cutoff is not null and d.first_price_date >= v_cutoff then 'met' else 'unmet' end as s_years,
             case when j.code is null or j.status <> 'determined' then 'undeterminable'
                  when j.president_is_top_holder then 'president_top'
                  when v_owner_mode = 'any' and j.owner_total_pct >= v_owner then 'owner_company'
                  else 'not_matched' end as owner_result,
             (cardinality(v_markets) = 0 or s.market_code = any (v_markets))
               and (cardinality(v_sectors) = 0 or s.sector33_code = any (v_sectors)) as matches_filters
        from public.stocks s
        left join public.financial_metrics m on m.code = s.code
        left join public.stock_listing_dates d on d.code = s.code
        left join public.ownership_judgments j on j.code = s.code
       where p_codes is null or s.code = any (p_codes)
    )
    select b.code, b.s_cagr, b.s_margin, b.s_years,
           case when not v_owner_on then 'off'
                when b.owner_result = 'undeterminable' then 'unavailable'
                when b.owner_result in ('president_top', 'owner_company') then 'met' else 'unmet' end,
           b.owner_result,
           b.matches_filters
      from base b;
end;
$$;

comment on function public.screening_evaluate(jsonb, text[]) is
  '条件①〜④の状態と市場・業種の絞り込みの判定。screen_stocks と stock_detail が共有する唯一の判定の式。security invoker（RLS が効く）';

/**
 * スクリーニング（Sprint 6 の契約の第2章に、条件④を加えた）。
 * 含める行: オンの条件に unmet が無く、①〜③の unavailable は includeUnavailable のときだけ、④の unavailable は
 * includeUndeterminable のときだけ（独立）。除外の件数は ①〜③（excludedUnavailable）と ④だけの理由（excludedUndeterminable）に分ける。
 * 並べ替え owner: 保存したオーナー系合計（丸める前）。判定不能は常に最後。
 */
create or replace function public.screen_stocks(p_params jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_include boolean := coalesce((p_params ->> 'includeUnavailable')::boolean, false);
  v_include_undet boolean := coalesce((p_params ->> 'includeUndeterminable')::boolean, false);
  v_sort text := coalesce(p_params ->> 'sort', 'cagr');
  v_asc boolean := coalesce(p_params ->> 'order', 'desc') = 'asc';
  v_page integer := greatest(coalesce((p_params ->> 'page')::integer, 1), 1);
  v_page_size integer := least(greatest(coalesce((p_params ->> 'pageSize')::integer, 100), 1), 500);
  v_clamp boolean := coalesce((p_params ->> 'clampPage')::boolean, false);
  v_reference date;
  v_total integer;
  v_excl_unavailable integer;
  v_excl_undet integer;
  v_total_pages integer;
  v_rows jsonb;
begin
  if v_sort not in ('cagr', 'margin', 'years', 'owner', 'code', 'name', 'market', 'sector') then
    raise exception 'screen_stocks: invalid sort %', v_sort using errcode = '22023';
  end if;
  if (p_params ->> 'cagr') is null or (p_params ->> 'margin') is null or (p_params ->> 'years') is null then
    raise exception 'screen_stocks: thresholds are required' using errcode = '22023';
  end if;

  select r.reference_date into v_reference from public.listing_reference_date r;

  with cand as materialized (
    select e.code, e.s_cagr, e.s_margin, e.s_years, e.s_owner, e.owner_result,
           case v_sort
             when 'cagr' then m.revenue_cagr
             when 'margin' then m.operating_margin
             when 'years' then
               case when d.code is null then null
                    when d.first_price_date = d.data_start_date then 100000 - (d.data_start_date - date '1970-01-01')
                    else -(d.first_price_date - date '1970-01-01') end
             when 'owner' then case when j.status = 'determined' then j.owner_total_pct end
           end as num_key,
           case v_sort
             when 'code' then s.code
             when 'name' then s.company_name
             when 'market' then s.market_code
             when 'sector' then s.sector33_code
           end as txt_key
      from public.screening_evaluate(p_params, null) e
      join public.stocks s on s.code = e.code
      left join public.financial_metrics m on m.code = e.code
      left join public.stock_listing_dates d on d.code = e.code
      left join public.ownership_judgments j on j.code = e.code
     where e.matches_filters
  ),
  passed as (
    select c.*,
           (c.s_cagr <> 'unavailable' and c.s_margin <> 'unavailable' and c.s_years <> 'unavailable') as ok_a,
           (c.s_owner <> 'unavailable') as ok_b
      from cand c
     where c.s_cagr <> 'unmet' and c.s_margin <> 'unmet' and c.s_years <> 'unmet' and c.s_owner <> 'unmet'
  ),
  flagged as (
    select p.*, (v_include or p.ok_a) and (v_include_undet or p.ok_b) as included from passed p
  ),
  counts as (
    select (count(*) filter (where f.included))::integer as total,
           (count(*) filter (where not v_include and not f.ok_a))::integer as excl_unavailable,
           (count(*) filter (where not v_include_undet and (v_include or f.ok_a) and not f.ok_b))::integer as excl_undet
      from flagged f
  ),
  paging as (
    select n.*, greatest(ceil(n.total::numeric / v_page_size)::integer, 1) as total_pages from counts n
  ),
  page_no as (
    select g.*, case when v_clamp and v_page > g.total_pages then g.total_pages else v_page end as page
      from paging g
  ),
  ordered as (
    select f.code, f.s_cagr, f.s_margin, f.s_years, f.s_owner, f.owner_result,
           row_number() over (
             order by ((f.num_key is null) and (f.txt_key is null)),
                      case when v_asc then f.num_key end asc,
                      case when not v_asc then f.num_key end desc,
                      case when v_asc then f.txt_key end asc,
                      case when not v_asc then f.txt_key end desc,
                      f.code asc
           ) as ord
      from flagged f
     where f.included
  ),
  page as materialized (
    select o.*
      from ordered o, page_no n
     where o.ord > (n.page - 1) * v_page_size and o.ord <= n.page * v_page_size
  )
  select n.total, n.excl_unavailable, n.excl_undet, n.total_pages, n.page,
         (select coalesce(jsonb_agg(
            jsonb_build_object(
              'code', s.code,
              'company_name', s.company_name,
              'market_code', s.market_code,
              'market_name', s.market_name,
              'sector33_code', s.sector33_code,
              'sector33_name', s.sector33_name,
              'revenue_cagr', m.revenue_cagr,
              'revenue_cagr_display_pct', m.revenue_cagr_display_pct,
              'revenue_cagr_unavailable_reason', m.revenue_cagr_unavailable_reason,
              'revenue_cagr_supplemented', coalesce(m.revenue_cagr_supplemented, false),
              'revenue_cagr_supplement', coalesce((
                select jsonb_agg(x.value order by x.ordinality)
                  from jsonb_array_elements(m.revenue_cagr_period_sources) with ordinality x
                 where x.value ->> 'source' <> 'tdnet_summary'
              ), '[]'::jsonb),
              'revenue_cagr_mixed_consolidation', coalesce(m.revenue_cagr_mixed_consolidation, false),
              'revenue_cagr_mixed_standard', coalesce(m.revenue_cagr_mixed_standard, false),
              'operating_margin', m.operating_margin,
              'operating_margin_display_pct', m.operating_margin_display_pct,
              'operating_margin_unavailable_reason', m.operating_margin_unavailable_reason,
              'latest_period_source', m.latest_period_source,
              'has_financials', m.code is not null,
              'first_price_date', d.first_price_date,
              'data_start_date', d.data_start_date,
              'listed_before_data_start', case when d.code is null then null else d.first_price_date = d.data_start_date end,
              'listing_years_exact', case when d.first_price_date > d.data_start_date then y.exact_years end,
              'estimated_listing_years', case when d.first_price_date > d.data_start_date then y.rounded_up_years end,
              'listing_years_lower_bound', case when d.first_price_date = d.data_start_date then y.whole_years end,
              'ownership', public.ownership_summary(p.code, p.owner_result),
              'status', jsonb_build_object('cagr', p.s_cagr, 'margin', p.s_margin, 'years', p.s_years, 'owner', p.s_owner)
            ) order by p.ord), '[]'::jsonb)
            from page p
            join public.stocks s on s.code = p.code
            left join public.financial_metrics m on m.code = p.code
            left join public.stock_listing_dates d on d.code = p.code
            left join lateral public.listing_years_between(
              case when d.first_price_date = d.data_start_date then d.data_start_date else d.first_price_date end,
              v_reference
            ) y on true)
    into v_total, v_excl_unavailable, v_excl_undet, v_total_pages, v_page, v_rows
    from page_no n;

  return jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'page', v_page,
    'pageSize', v_page_size,
    'totalPages', v_total_pages,
    'excludedUnavailable', v_excl_unavailable,
    'excludedUndeterminable', v_excl_undet,
    'referenceDate', v_reference,
    'stockCount', (select count(*) from public.stocks),
    'metricsCount', (select count(*) from public.financial_metrics),
    'listingDatesCount', (select count(*) from public.stock_listing_dates),
    'ownershipDeterminedCount', (select count(*) from public.ownership_judgments j where j.status = 'determined')
  );
end;
$$;

/**
 * 銘柄詳細（Sprint 7 に条件④を加えた）。included は screen_stocks の含める規則と同じ。
 * ownership は一覧と同じ要約に、株主ごとの明細（holders）と使った書類（documents）を加える。
 */
create or replace function public.stock_detail(p_code text, p_params jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_include boolean := coalesce((p_params ->> 'includeUnavailable')::boolean, false);
  v_include_undet boolean := coalesce((p_params ->> 'includeUndeterminable')::boolean, false);
  v_reference date;
  v_result jsonb;
begin
  select r.reference_date into v_reference from public.listing_reference_date r;

  select jsonb_build_object(
           'stock', jsonb_build_object(
             'code', s.code,
             'company_name', s.company_name,
             'market_code', s.market_code,
             'market_name', s.market_name,
             'sector33_code', s.sector33_code,
             'sector33_name', s.sector33_name
           ),
           'referenceDate', v_reference,
           'listing', case when d.code is null then null else jsonb_build_object(
             'first_price_date', d.first_price_date,
             'data_start_date', d.data_start_date,
             'listed_before_data_start', d.first_price_date = d.data_start_date,
             'listing_years_exact', case when d.first_price_date > d.data_start_date then y.exact_years end,
             'estimated_listing_years', case when d.first_price_date > d.data_start_date then y.rounded_up_years end,
             'listing_years_lower_bound', case when d.first_price_date = d.data_start_date then y.whole_years end
           ) end,
           'evaluation', jsonb_build_object(
             'status', jsonb_build_object('cagr', e.s_cagr, 'margin', e.s_margin, 'years', e.s_years, 'owner', e.s_owner),
             'ownerResult', e.owner_result,
             'matchesFilters', e.matches_filters,
             'included', e.matches_filters
               and e.s_cagr <> 'unmet' and e.s_margin <> 'unmet' and e.s_years <> 'unmet' and e.s_owner <> 'unmet'
               and (v_include or (e.s_cagr <> 'unavailable' and e.s_margin <> 'unavailable' and e.s_years <> 'unavailable'))
               and (v_include_undet or e.s_owner <> 'unavailable')
           ),
           'ownership', public.ownership_summary(s.code, e.owner_result) || jsonb_build_object(
             'holders', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'rank', h.rank, 'name', h.name, 'ratio_pct', h.ratio_pct::text, 'ratio_decimals', h.ratio_decimals,
                        'category', h.category, 'reason_code', h.reason_code, 'reason', h.reason
                      ) order by h.rank)
                 from public.ownership_holder_classifications h where h.code = s.code
             ), '[]'::jsonb),
             'documents', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'role', x.role, 'doc_id', doc.doc_id, 'doc_type_code', doc.doc_type_code, 'submitted_at', doc.submitted_at
                      ) order by x.ord)
                 from (values (1, 'shareholders', j.shareholders_doc_id), (2, 'officers', j.officers_doc_id),
                              (3, 'shareholders_pending', j.shareholders_pending_doc_id), (4, 'officers_pending', j.officers_pending_doc_id)) as x(ord, role, doc_id)
                 join public.edinet_documents doc on doc.doc_id = x.doc_id
             ), '[]'::jsonb)
           )
         )
    into v_result
    from public.stocks s
    join public.screening_evaluate(p_params, array[p_code]) e on e.code = s.code
    left join public.stock_listing_dates d on d.code = s.code
    left join public.ownership_judgments j on j.code = s.code
    left join lateral public.listing_years_between(
      case when d.first_price_date = d.data_start_date then d.data_start_date else d.first_price_date end,
      v_reference
    ) y on true
   where s.code = p_code;

  return v_result;
end;
$$;

comment on function public.stock_detail(text, jsonb) is
  '銘柄詳細: 基本情報・初出日と表示用の年数・条件①〜④の判定と結果に含まれるか・条件④の根拠。判定は screening_evaluate。security invoker（RLS が効く）';

-- ---------------------------------------------------------------------------
-- 9. 取り込み状況の画面の要約（Sprint 8 の関数に ownership を加える）
-- ---------------------------------------------------------------------------
create or replace function public.annual_reports_summary()
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
    ),
    'ownership', (
      select jsonb_build_object(
        'determinedCount', count(*) filter (where j.status = 'determined'),
        'noAnnualReportCount', (select count(*) from public.stocks) - count(*),
        'annualReportPendingCount', count(*) filter (where j.undeterminable_reason = 'annual_report_pending'),
        'shareholdersNotExtractedCount', count(*) filter (where j.undeterminable_reason = 'shareholders_not_extracted'),
        'officersNotExtractedCount', count(*) filter (where j.undeterminable_reason = 'officers_not_extracted'),
        'presidentNotFoundCount', count(*) filter (where j.undeterminable_reason = 'president_not_found'),
        'previousReportCount', count(*) filter (
          where j.status = 'determined' and (j.shareholders_pending_doc_id is not null or j.officers_pending_doc_id is not null))
      )
        from public.ownership_judgments j
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- 10. 権限と RLS（public.stocks と同じ方針）
-- ---------------------------------------------------------------------------
alter table public.ownership_holder_classifications enable row level security;
revoke all on public.ownership_holder_classifications from public, anon, authenticated;
grant select on public.ownership_holder_classifications to authenticated;
grant all on public.ownership_holder_classifications to service_role;
create policy "許可ユーザーのみ参照可" on public.ownership_holder_classifications
  for select to authenticated using ((select public.current_user_is_allowed()));

revoke all on public.annual_report_candidates, public.annual_report_sections from public, anon, authenticated;
grant select on public.annual_report_candidates, public.annual_report_sections to authenticated, service_role;

-- 正規化・分類・保存・トリガーの関数は service_role だけ（画面は保存した値を読む）
revoke execute on function public.ownership_name_key(text) from public, anon, authenticated;
revoke execute on function public.ownership_title_key(text) from public, anon, authenticated;
revoke execute on function public.ownership_corporate_text(text) from public, anon, authenticated;
revoke execute on function public.ownership_is_corporate(text) from public, anon, authenticated;
revoke execute on function public.ownership_is_excluded_corporate(text) from public, anon, authenticated;
revoke execute on function public.ownership_surname_of(text) from public, anon, authenticated;
revoke execute on function public.ownership_name_parts(text) from public, anon, authenticated;
revoke execute on function public.ownership_judgment_from_sections(jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.recalculate_ownership_judgments(text[]) from public, anon, authenticated;
revoke execute on function public.recalculate_ownership_for_documents(text[]) from public, anon, authenticated;
revoke execute on function public.annual_report_rows_recalculate_ownership() from public, anon, authenticated;
revoke execute on function public.edinet_documents_recalculate_ownership() from public, anon, authenticated;
revoke execute on function public.stocks_recalculate_ownership() from public, anon, authenticated;
grant execute on function public.ownership_name_key(text) to service_role;
grant execute on function public.ownership_title_key(text) to service_role;
grant execute on function public.ownership_corporate_text(text) to service_role;
grant execute on function public.ownership_is_corporate(text) to service_role;
grant execute on function public.ownership_is_excluded_corporate(text) to service_role;
grant execute on function public.ownership_surname_of(text) to service_role;
grant execute on function public.ownership_name_parts(text) to service_role;
grant execute on function public.ownership_judgment_from_sections(jsonb, jsonb) to service_role;
grant execute on function public.recalculate_ownership_judgments(text[]) to service_role;
grant execute on function public.recalculate_ownership_for_documents(text[]) to service_role;
grant execute on function public.annual_report_rows_recalculate_ownership() to service_role;
grant execute on function public.edinet_documents_recalculate_ownership() to service_role;
grant execute on function public.stocks_recalculate_ownership() to service_role;

-- 読み出し（security invoker。RLS が効く）: 区画の選び方（ビューの本体）・要約・判定の式
revoke execute on function public.annual_report_candidates_for(text[]) from public, anon, authenticated;
revoke execute on function public.annual_report_sections_for(text[]) from public, anon, authenticated;
revoke execute on function public.ownership_summary(text, text) from public, anon, authenticated;
revoke execute on function public.screening_evaluate(jsonb, text[]) from public, anon, authenticated;
grant execute on function public.annual_report_candidates_for(text[]) to authenticated, service_role;
grant execute on function public.annual_report_sections_for(text[]) to authenticated, service_role;
grant execute on function public.ownership_summary(text, text) to authenticated, service_role;
grant execute on function public.screening_evaluate(jsonb, text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 11. 導入時: 既存の有報の銘柄を判定する
-- ---------------------------------------------------------------------------
select public.recalculate_ownership_judgments(array(
  select distinct d.sec_code from public.edinet_documents d where d.doc_type_code in ('120', '130') and d.sec_code is not null
));
