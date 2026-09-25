-- Sprint 11: 条件④の判定の手動補正（F10）
--
-- 方針（契約 docs/harness/sprints/sprint-11/contract.md の第2章）
-- - 補正は利用者のデータ（市場データではない）。ownership_overrides に、ユーザー・銘柄ごとに1行。
--   書き込みは利用者自身のセッション（RLS）で行う。「市場データのテーブルは service_role だけが書く」方針の例外として、
--   authenticated に select・insert・update・delete だけを許す（行は RLS で「自分の行、かつ許可リストに登録済み」に限る）。
--   サービスロールで書くと user_id の決定をアプリのコードに任せることになるため、あえて利用者のセッションで書く。
-- - 利用者は公開キーと自分の JWT で PostgREST から直接書けるので、行の中身は DB が決める（BEFORE INSERT OR UPDATE のトリガー）:
--   補正時の自動判定の記録（auto_*）は常に ownership_judgments から求め直す、created_at は固定、updated_at は now()、
--   user_id・code の変更は拒否、メモの前後の空白（JavaScript の \s と同じ集合）を除く。
-- - 補正後の判定の式は screening_evaluate の1か所（結果の式 owner_result_of と状態の式 owner_status_of を、
--   現在の自動判定と補正時の記録の両方に使う）。閾値は補正に当てない。モードは当てる（「社長が筆頭株主のみ」では
--   「該当（オーナー企業）」の補正は満たさない）。
-- - 銘柄（stocks）の削除で補正は連鎖して消える。上場廃止で stocks の行を消さないこと（Sprint 12）。

-- ---------------------------------------------------------------------------
-- 1. テーブル
-- ---------------------------------------------------------------------------
-- 空白の文字集合（JavaScript の正規表現 \s と同じ。src/lib/ownership/memo.ts の MEMO_WHITESPACE と一致させる）:
--   U+0009〜000D、0020、00A0、1680、2000〜200A、2028、2029、202F、205F、3000、FEFF
create table public.ownership_overrides (
  user_id uuid not null references auth.users (id) on delete cascade,
  code text not null references public.stocks (code) on delete cascade,
  verdict text not null check (verdict in ('president_top', 'owner_company', 'not_matched')),
  memo text not null check (
    char_length(memo) between 1 and 1000
    and memo !~ '^[\t\n\v\f\r    -     　﻿]'
    and memo !~ '[\t\n\v\f\r    -     　﻿]$'
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 補正時（新規・編集・確認済みの時点）の自動判定の記録。行が無ければ「有報が未取得」
  auto_status text not null check (auto_status in ('determined', 'undeterminable')),
  auto_undeterminable_reason text,
  auto_president_is_top_holder boolean,
  auto_owner_total_pct numeric,
  auto_shareholders_doc_id text,
  auto_officers_doc_id text,
  primary key (user_id, code)
);

create index ownership_overrides_code_idx on public.ownership_overrides (code);

comment on table public.ownership_overrides is
  '条件④の判定の手動補正（利用者のデータ）。ユーザー・銘柄ごとに1行。RLS で本人の行だけ。行の日時・記録はトリガーが決める';
comment on column public.ownership_overrides.verdict is '補正後の判定（president_top／owner_company／not_matched。閾値は当てず、モードは当てる）';
comment on column public.ownership_overrides.memo is '理由のメモ（前後の空白を除いた値。1〜1,000 コードポイント）';
comment on column public.ownership_overrides.auto_status is
  '補正時の自動判定の記録（トリガーが ownership_judgments から求める。現在の値と比べて「補正後に自動判定が更新されました」を出す）';

/**
 * 行の中身を DB が決める（直接の書き込みへの防御。契約の R1）。security invoker（ownership_judgments は RLS で読む）。
 * - insert: user_id が NULL のときだけ auth.uid() を入れる（違う値が渡されたら、そのまま残して RLS の with check で拒否させる）。
 *   created_at・updated_at は now()。
 * - update: user_id・code の変更は拒否。created_at は元の値、updated_at は now()。
 * - どちらでも: メモの前後の空白を除き、記録（auto_*）を現在の自動判定で置き換える（受け取った値は使わない）。
 * トリガー関数の EXECUTE の権限は発火に関係しない（PostgreSQL は発火時に確かめない）。
 */
create function public.ownership_overrides_before_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_found boolean;
begin
  if tg_op = 'INSERT' then
    if new.user_id is null then
      new.user_id := auth.uid();
    end if;
    new.created_at := now();
  else
    if new.user_id is distinct from old.user_id or new.code is distinct from old.code then
      raise exception 'ownership_overrides: user_id and code cannot be changed' using errcode = '42501';
    end if;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  new.memo := regexp_replace(
    new.memo,
    '^[\t\n\v\f\r    -     　﻿]+|[\t\n\v\f\r    -     　﻿]+$',
    '', 'g');

  select j.status, j.undeterminable_reason, j.president_is_top_holder, j.owner_total_pct, j.shareholders_doc_id, j.officers_doc_id, true
    into new.auto_status, new.auto_undeterminable_reason, new.auto_president_is_top_holder, new.auto_owner_total_pct,
         new.auto_shareholders_doc_id, new.auto_officers_doc_id, v_found
    from public.ownership_judgments j
   where j.code = new.code;
  if not coalesce(v_found, false) then
    new.auto_status := 'undeterminable';
    new.auto_undeterminable_reason := 'no_annual_report';
    new.auto_president_is_top_holder := null;
    new.auto_owner_total_pct := null;
    new.auto_shareholders_doc_id := null;
    new.auto_officers_doc_id := null;
  end if;
  return new;
end;
$$;

create trigger ownership_overrides_before_write
  before insert or update on public.ownership_overrides
  for each row execute function public.ownership_overrides_before_write();

alter table public.ownership_overrides enable row level security;
revoke all on public.ownership_overrides from public, anon, authenticated;
grant select, insert, update, delete on public.ownership_overrides to authenticated;
grant all on public.ownership_overrides to service_role;

create policy "本人の補正のみ参照可" on public.ownership_overrides
  for select to authenticated
  using (user_id = (select auth.uid()) and (select public.current_user_is_allowed()));
create policy "本人の補正のみ追加可" on public.ownership_overrides
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.current_user_is_allowed()));
create policy "本人の補正のみ更新可" on public.ownership_overrides
  for update to authenticated
  using (user_id = (select auth.uid()) and (select public.current_user_is_allowed()))
  with check (user_id = (select auth.uid()) and (select public.current_user_is_allowed()));
create policy "本人の補正のみ削除可" on public.ownership_overrides
  for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.current_user_is_allowed()));

revoke execute on function public.ownership_overrides_before_write() from public, anon, authenticated;
grant execute on function public.ownership_overrides_before_write() to service_role;

-- ---------------------------------------------------------------------------
-- 2. 判定の式（結果と状態）。現在の自動判定・補正時の記録・補正後の判定のすべてがこの2つを通る
-- ---------------------------------------------------------------------------
-- インライン展開されるよう、set search_path を付けない SQL 関数にする（組み込みの演算子だけを使い、表を読まない）。

/** 自動判定の結果（現在のモード・閾値）: 判定不能 → undeterminable、社長が筆頭株主 → president_top、any で合計 ≥ 閾値 → owner_company、そのほか → not_matched */
create function public.owner_result_of(p_status text, p_president_is_top_holder boolean, p_owner_total_pct numeric, p_mode text, p_threshold numeric)
returns text
language sql
immutable
as $$
  select case when p_status is distinct from 'determined' then 'undeterminable'
              when p_president_is_top_holder then 'president_top'
              when p_mode = 'any' and p_owner_total_pct >= p_threshold then 'owner_company'
              else 'not_matched' end;
$$;

/** 条件④の状態（結果とモードから）: president_top は満たす、owner_company は any のときだけ満たす、判定不能は unavailable */
create function public.owner_status_of(p_result text, p_mode text)
returns text
language sql
immutable
as $$
  select case when p_result = 'undeterminable' then 'unavailable'
              when p_result = 'president_top' then 'met'
              when p_result = 'owner_company' and p_mode = 'any' then 'met'
              else 'unmet' end;
$$;

-- ---------------------------------------------------------------------------
-- 3. 補正の要約（一覧・詳細・API）
-- ---------------------------------------------------------------------------
/**
 * 呼び出したユーザーの補正（無ければ NULL）。auto_changed は、補正時の記録と現在の自動判定の項目（状態・判定不能の理由・
 * 社長が筆頭株主か・オーナー系合計・大株主と役員の書類ID）のどれかが違うか（is distinct from。judged_at・取り込み待ちの書類は比べない）。
 * auto_at_override.result は、記録の値に現在のモード・閾値（p_params）を当てた結果。
 */
create function public.owner_override_summary(p_code text, p_params jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select coalesce(p_params ->> 'ownerMode', 'any') as mode, coalesce((p_params ->> 'owner')::numeric, 20) as threshold
  )
  select jsonb_build_object(
           'verdict', o.verdict,
           'memo', o.memo,
           'created_at', o.created_at,
           'updated_at', o.updated_at,
           'auto_changed', (cur.status, cur.reason, cur.is_top, cur.total, cur.shareholders_doc_id, cur.officers_doc_id)
                           is distinct from
                           (o.auto_status, o.auto_undeterminable_reason, o.auto_president_is_top_holder, o.auto_owner_total_pct,
                            o.auto_shareholders_doc_id, o.auto_officers_doc_id),
           'auto_at_override', jsonb_build_object(
             'status', o.auto_status,
             'undeterminable_reason', o.auto_undeterminable_reason,
             'president_is_top_holder', o.auto_president_is_top_holder,
             'owner_total_pct', o.auto_owner_total_pct::text,
             'shareholders_doc_id', o.auto_shareholders_doc_id,
             'officers_doc_id', o.auto_officers_doc_id,
             'result', public.owner_result_of(o.auto_status, o.auto_president_is_top_holder, o.auto_owner_total_pct, pr.mode, pr.threshold)
           ),
           'auto_current', jsonb_build_object(
             'status', cur.status,
             'undeterminable_reason', cur.reason,
             'president_is_top_holder', cur.is_top,
             'owner_total_pct', cur.total::text,
             'shareholders_doc_id', cur.shareholders_doc_id,
             'officers_doc_id', cur.officers_doc_id,
             'result', public.owner_result_of(cur.status, cur.is_top, cur.total, pr.mode, pr.threshold)
           )
         )
    from public.ownership_overrides o
    cross join params pr
    cross join lateral (
      select coalesce(j.status, 'undeterminable') as status,
             case when j.code is null then 'no_annual_report' else j.undeterminable_reason end as reason,
             j.president_is_top_holder as is_top,
             j.owner_total_pct as total,
             j.shareholders_doc_id,
             j.officers_doc_id
        from (select 1) as one
        left join public.ownership_judgments j on j.code = o.code
    ) cur
   where o.user_id = (select auth.uid()) and o.code = p_code;
$$;

/**
 * 1銘柄の判定の要約（Sprint 10 の形に auto_result・override を加えた）。p_result は補正後の結果、p_auto_result は自動判定の結果
 * （どちらも screening_evaluate が現在のモード・閾値で求めたもの）。status・根拠の項目は自動判定のまま。
 */
drop function public.ownership_summary(text, text);

create function public.ownership_summary(p_code text, p_result text, p_auto_result text, p_params jsonb)
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
           'result', p_result,
           'auto_result', p_auto_result,
           'president_is_top_holder', null,
           'owner_total_pct', null,
           'owner_total_display_pct', null,
           'category_pct', null,
           'top_holders', '[]'::jsonb,
           'presidents', '[]'::jsonb,
           'pending_doc_id', coalesce(j.shareholders_pending_doc_id, j.officers_pending_doc_id),
           'override', public.owner_override_summary(p_code, p_params)
         ) else jsonb_build_object(
           'status', 'determined',
           'undeterminable_reason', null,
           'undeterminable_detail', null,
           'result', p_result,
           'auto_result', p_auto_result,
           'president_is_top_holder', j.president_is_top_holder,
           'owner_total_pct', j.owner_total_pct::text,
           'owner_total_display_pct', trunc(j.owner_total_pct, 1)::text,
           'category_pct', jsonb_build_object(
             'president', j.president_pct::text, 'officer', j.officer_pct::text, 'family', j.family_pct::text,
             'asset_company', j.asset_company_pct::text, 'other', j.other_pct::text
           ),
           'top_holders', coalesce(j.top_holders, '[]'::jsonb),
           'presidents', coalesce(j.presidents, '[]'::jsonb),
           'pending_doc_id', coalesce(j.shareholders_pending_doc_id, j.officers_pending_doc_id),
           'override', public.owner_override_summary(p_code, p_params)
         ) end
    from (select 1) as one
    left join public.ownership_judgments j on j.code = p_code;
$$;

-- ---------------------------------------------------------------------------
-- 4. 補正の保存・確認済み・取り消し（security invoker。RLS が本人の行に限る。行の中身はトリガーが決める）
-- ---------------------------------------------------------------------------
/** 新規・編集（記録は現在の自動判定で置き換わる）。銘柄マスタに無ければ NULL。検証は check 制約（違反は 23514） */
create function public.owner_override_save(p_code text, p_verdict text, p_memo text)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if not exists (select 1 from public.stocks s where s.code = p_code) then
    return null;
  end if;
  insert into public.ownership_overrides (user_id, code, verdict, memo, auto_status)
  values ((select auth.uid()), p_code, p_verdict, p_memo, 'undeterminable')
  on conflict (user_id, code) do update set verdict = excluded.verdict, memo = excluded.memo;
  return public.owner_override_summary(p_code, '{}'::jsonb);
end;
$$;

/** 確認済みにする（選択肢とメモはそのまま、記録だけを現在の自動判定で置き換える）。補正が無ければ NULL */
create function public.owner_override_acknowledge(p_code text)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  update public.ownership_overrides o set verdict = o.verdict
   where o.user_id = (select auth.uid()) and o.code = p_code;
  if not found then
    return null;
  end if;
  return public.owner_override_summary(p_code, '{}'::jsonb);
end;
$$;

/** 取り消し。消した行があれば true */
create function public.owner_override_delete(p_code text)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  delete from public.ownership_overrides o where o.user_id = (select auth.uid()) and o.code = p_code;
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. 判定の式（条件①〜④）。補正を加えた
-- ---------------------------------------------------------------------------
drop function public.screening_evaluate(jsonb, text[]);

/**
 * p_codes が NULL なら全銘柄、配列ならその銘柄だけ。
 * 条件④: owner_auto_result は自動判定の結果（現在のモード・閾値）、owner_override は呼び出したユーザーの補正（無ければ NULL）、
 *   owner_result は補正があれば補正、無ければ自動判定（実際に使う結果）、s_owner はそれとモードから求める（閾値は補正に当てない）。
 */
create function public.screening_evaluate(p_params jsonb, p_codes text[] default null)
returns table (code text, s_cagr text, s_margin text, s_years text, s_owner text, owner_result text,
               owner_auto_result text, owner_override text, matches_filters boolean)
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
  v_uid uuid := auth.uid();
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
             public.owner_result_of(j.status, j.president_is_top_holder, j.owner_total_pct, v_owner_mode, v_owner) as auto_result,
             o.verdict as override,
             (cardinality(v_markets) = 0 or s.market_code = any (v_markets))
               and (cardinality(v_sectors) = 0 or s.sector33_code = any (v_sectors)) as matches_filters
        from public.stocks s
        left join public.financial_metrics m on m.code = s.code
        left join public.stock_listing_dates d on d.code = s.code
        left join public.ownership_judgments j on j.code = s.code
        left join public.ownership_overrides o on o.code = s.code and o.user_id = v_uid
       where p_codes is null or s.code = any (p_codes)
    )
    select b.code, b.s_cagr, b.s_margin, b.s_years,
           case when not v_owner_on then 'off'
                else public.owner_status_of(coalesce(b.override, b.auto_result), v_owner_mode) end,
           coalesce(b.override, b.auto_result),
           b.auto_result,
           b.override,
           b.matches_filters
      from base b;
end;
$$;

comment on function public.screening_evaluate(jsonb, text[]) is
  '条件①〜④の状態と市場・業種の絞り込みの判定（条件④は呼び出したユーザーの手動補正を含む）。screen_stocks と stock_detail が共有する唯一の判定の式。security invoker（RLS が効く）';

/**
 * スクリーニング（Sprint 10 に、条件④の手動補正を加えた）。含める規則・除外の件数は s_owner（補正後）で数える。
 * 並べ替え owner は自動判定のオーナー系合計（補正は合計を持たない。判定不能は補正があっても値が無いので最後）。
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
    select e.code, e.s_cagr, e.s_margin, e.s_years, e.s_owner, e.owner_result, e.owner_auto_result,
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
    select f.code, f.s_cagr, f.s_margin, f.s_years, f.s_owner, f.owner_result, f.owner_auto_result,
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
              'ownership', public.ownership_summary(p.code, p.owner_result, p.owner_auto_result, p_params),
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
 * 銘柄詳細（Sprint 10 に、条件④の手動補正を加えた）。included は screen_stocks の含める規則と同じ（補正後の s_owner）。
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
             'ownerAutoResult', e.owner_auto_result,
             'ownerOverride', e.owner_override,
             'matchesFilters', e.matches_filters,
             'included', e.matches_filters
               and e.s_cagr <> 'unmet' and e.s_margin <> 'unmet' and e.s_years <> 'unmet' and e.s_owner <> 'unmet'
               and (v_include or (e.s_cagr <> 'unavailable' and e.s_margin <> 'unavailable' and e.s_years <> 'unavailable'))
               and (v_include_undet or e.s_owner <> 'unavailable')
           ),
           'ownership', public.ownership_summary(s.code, e.owner_result, e.owner_auto_result, p_params) || jsonb_build_object(
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

-- ---------------------------------------------------------------------------
-- 6. 権限（読み出し・補正の関数は security invoker。authenticated に明示的に許す）
-- ---------------------------------------------------------------------------
revoke execute on function public.owner_result_of(text, boolean, numeric, text, numeric) from public, anon, authenticated;
revoke execute on function public.owner_status_of(text, text) from public, anon, authenticated;
revoke execute on function public.owner_override_summary(text, jsonb) from public, anon, authenticated;
revoke execute on function public.ownership_summary(text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.owner_override_save(text, text, text) from public, anon, authenticated;
revoke execute on function public.owner_override_acknowledge(text) from public, anon, authenticated;
revoke execute on function public.owner_override_delete(text) from public, anon, authenticated;
revoke execute on function public.screening_evaluate(jsonb, text[]) from public, anon, authenticated;
grant execute on function public.owner_result_of(text, boolean, numeric, text, numeric) to authenticated, service_role;
grant execute on function public.owner_status_of(text, text) to authenticated, service_role;
grant execute on function public.owner_override_summary(text, jsonb) to authenticated, service_role;
grant execute on function public.ownership_summary(text, text, text, jsonb) to authenticated, service_role;
grant execute on function public.owner_override_save(text, text, text) to authenticated, service_role;
grant execute on function public.owner_override_acknowledge(text) to authenticated, service_role;
grant execute on function public.owner_override_delete(text) to authenticated, service_role;
grant execute on function public.screening_evaluate(jsonb, text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. 姓の読みの辞書の追加（Sprint 10 評価の m3。別の読みの抜け）と、判定の再計算
-- ---------------------------------------------------------------------------
-- 20261003000000_surname_readings.sql は scripts/data/surname-readings.txt からの生成物で、適用済みのため書き換えない。
insert into public.surname_readings (surname, reading, romaji) values
  ('岩崎', 'イワザキ', array['IWAZAKI']),
  ('宮崎', 'ミヤサキ', array['MIYASAKI']),
  ('中沢', 'ナカサワ', array['NAKASAWA']),
  ('小島', 'オジマ', array['OJIMA']),
  ('小島', 'コシマ', array['KOSHIMA']),
  ('塩谷', 'シオタニ', array['SHIOTANI']),
  ('塩谷', 'エンヤ', array['ENYA']),
  ('清野', 'キヨノ', array['KIYONO'])
on conflict do nothing;

select public.recalculate_ownership_judgments(array(
  select distinct d.sec_code from public.edinet_documents d where d.doc_type_code in ('120', '130') and d.sec_code is not null
));
