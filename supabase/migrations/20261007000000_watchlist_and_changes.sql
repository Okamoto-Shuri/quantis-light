-- Sprint 14: ウォッチリストと新規該当銘柄の通知（F13）
--
-- 方針（契約 docs/harness/sprints/sprint-14/contract.md の第2章）
-- - ウォッチリスト（watchlist_items）は利用者のデータ。ownership_overrides・screening_presets と同じく、書き込みは利用者自身の
--   セッション（RLS）で行う（「市場データは service_role だけが書く」の3つ目の例外）。行の中身は BEFORE トリガーと check 制約で守る。
-- - 「新たに該当・外れた」は、定期実行の日次の取り込み（/api/cron/daily の銘柄マスタ）の開始時に記録する「判定の入力」のスナップショット
--   （screening_snapshots・screening_snapshot_stocks）と、今のデータを、同じ条件・同じ（今の）手動補正で判定して比べる。
--   記録は市場データなので public.stocks と同じ RLS・権限（authenticated は select だけ、書き込みは service_role）。
-- - 「該当」と除外の分類（included・exclusion・blocking）は screening_evaluate の1か所だけで決める。screen_stocks の件数・stock_detail・
--   比較の理由・ウォッチリストはこの分類を使う。記録の判定も同じ関数で、入力の行の取り出し元と基準日だけを切り替える。
-- - 記録の失敗で取り込みを止めない（start_ingestion_run の中のセーブポイント。details.snapshot）。終了の関数は snapshot のキーを残す。
-- - ダッシュボード・取り込み状況の件数は上場中の銘柄だけで数える（Sprint 12 評価の持ち越し）。

-- ---------------------------------------------------------------------------
-- 1. ウォッチリスト
-- ---------------------------------------------------------------------------
-- メモの空白の文字集合は Sprint 11・13 と同じ（JavaScript の \s。src/lib/text/whitespace.ts）
create table public.watchlist_items (
  user_id uuid not null references auth.users (id) on delete cascade,
  code text not null references public.stocks (code) on delete cascade,
  memo text constraint watchlist_items_memo_check check (
    memo is null or (
      char_length(memo) between 1 and 1000
      and memo !~ '^[\t\n\v\f\r    -     　﻿]'
      and memo !~ '[\t\n\v\f\r    -     　﻿]$'
    )
  ),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, code)
);

create index watchlist_items_user_created_idx on public.watchlist_items (user_id, created_at desc, code);
create index watchlist_items_code_idx on public.watchlist_items (code);

comment on table public.watchlist_items is 'ウォッチリスト（利用者のデータ）。RLS で本人の行だけ。1人 500 件まで';
comment on column public.watchlist_items.created_at is '追加日時（メモの編集では変わらない）';
comment on column public.watchlist_items.updated_at is 'メモを最後に変えた日時（追加時は created_at と同じ）';

/**
 * 行の中身を DB が決める（直接の書き込みへの防御）。security invoker・VOLATILE（ロックの後に確定した行を見るため。STABLE にしない）。
 * - insert: user_id が NULL のときだけ auth.uid()（違う値は残して RLS の with check で拒否させる）。
 *   ユーザーごとのロックを取り、同じ (user_id, code) の行が既にあれば上限の確認を飛ばす（ON CONFLICT DO NOTHING の冪等な追加。R1）。
 *   無ければ、そのユーザーの行が 500 件あれば拒否する（SQLSTATE QW500）。created_at・updated_at は clock_timestamp()。
 * - update: user_id・code の変更は拒否（42501）。created_at は元の値。updated_at はメモが変わったときだけ新しくする。
 * - どちらでも: メモの前後の空白を除き、空なら NULL。
 */
create function public.watchlist_items_before_write()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if new.memo is not null then
    new.memo := regexp_replace(
      new.memo,
      '^[\t\n\v\f\r    -     　﻿]+|[\t\n\v\f\r    -     　﻿]+$',
      '', 'g');
    if new.memo = '' then
      new.memo := null;
    end if;
  end if;
  if tg_op = 'INSERT' then
    if new.user_id is null then
      new.user_id := auth.uid();
    end if;
    if new.user_id is not null then
      perform pg_advisory_xact_lock(hashtextextended('watchlist_items:' || new.user_id::text, 0));
      if not exists (select 1 from public.watchlist_items w where w.user_id = new.user_id and w.code = new.code) then
        select count(*) into v_count from public.watchlist_items w where w.user_id = new.user_id;
        if v_count >= 500 then
          raise exception 'watchlist_items: limit of 500 items per user' using errcode = 'QW500';
        end if;
      end if;
    end if;
    new.created_at := clock_timestamp();
    new.updated_at := new.created_at;
  else
    if new.user_id is distinct from old.user_id or new.code is distinct from old.code then
      raise exception 'watchlist_items: user_id and code cannot be changed' using errcode = '42501';
    end if;
    new.created_at := old.created_at;
    if new.memo is distinct from old.memo then
      new.updated_at := clock_timestamp();
    else
      new.updated_at := old.updated_at;
    end if;
  end if;
  return new;
end;
$$;

create trigger watchlist_items_before_write
  before insert or update on public.watchlist_items
  for each row execute function public.watchlist_items_before_write();

alter table public.watchlist_items enable row level security;
revoke all on public.watchlist_items from public, anon, authenticated;
grant select, insert, update, delete on public.watchlist_items to authenticated;
grant all on public.watchlist_items to service_role;

create policy "本人のウォッチリストのみ参照可" on public.watchlist_items
  for select to authenticated
  using (user_id = (select auth.uid()) and (select public.current_user_is_allowed()));
create policy "本人のウォッチリストのみ追加可" on public.watchlist_items
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.current_user_is_allowed()));
create policy "本人のウォッチリストのみ更新可" on public.watchlist_items
  for update to authenticated
  using (user_id = (select auth.uid()) and (select public.current_user_is_allowed()))
  with check (user_id = (select auth.uid()) and (select public.current_user_is_allowed()));
create policy "本人のウォッチリストのみ削除可" on public.watchlist_items
  for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.current_user_is_allowed()));

revoke execute on function public.watchlist_items_before_write() from public, anon, authenticated;
grant execute on function public.watchlist_items_before_write() to service_role;

-- ---------------------------------------------------------------------------
-- 2. 比較の基準の記録（判定の入力のスナップショット）
-- ---------------------------------------------------------------------------
create table public.screening_snapshots (
  id bigint generated always as identity primary key,
  captured_at timestamptz not null default clock_timestamp(),
  cycle_date date not null,
  reference_date date,
  run_id bigint references public.ingestion_runs (id) on delete set null,
  stock_count integer not null default 0 check (stock_count >= 0)
);

comment on table public.screening_snapshots is
  '比較の基準の記録（定期実行の日次の取り込みの開始時点の、判定の入力）。最新 7 回だけを残す。比較に使うのは最新の1回';
comment on column public.screening_snapshots.cycle_date is '直近の取り込み日（記録の日時の日本時間の日付）';
comment on column public.screening_snapshots.reference_date is '記録の時点の基準日（listing_reference_date）。記録の側の条件③はこの日で判定する';
comment on column public.screening_snapshots.stock_count is '記録の時点の上場中の銘柄の数（0 なら比較しない）';

create table public.screening_snapshot_stocks (
  snapshot_id bigint not null references public.screening_snapshots (id) on delete cascade,
  code text not null,
  company_name text not null,
  market_code text,
  market_name text,
  sector33_code text,
  is_delisted boolean not null,
  revenue_cagr numeric,
  operating_margin numeric,
  first_price_date date,
  data_start_date date,
  owner_status text,
  president_is_top_holder boolean,
  owner_total_pct numeric,
  primary key (snapshot_id, code)
);

comment on table public.screening_snapshot_stocks is
  '記録の銘柄ごとの判定の入力（条件①〜④・市場・業種・上場廃止）。行が無い入力は NULL（算出不可・判定不能を再現する）';

alter table public.screening_snapshots enable row level security;
alter table public.screening_snapshot_stocks enable row level security;
revoke all on public.screening_snapshots, public.screening_snapshot_stocks from public, anon, authenticated;
grant select on public.screening_snapshots, public.screening_snapshot_stocks to authenticated;
grant all on public.screening_snapshots, public.screening_snapshot_stocks to service_role;
create policy "許可ユーザーのみ参照可" on public.screening_snapshots
  for select to authenticated using ((select public.current_user_is_allowed()));
create policy "許可ユーザーのみ参照可" on public.screening_snapshot_stocks
  for select to authenticated using ((select public.current_user_is_allowed()));

/**
 * 今の判定の入力を記録し、最新 7 回だけを残す。記録の id を返す。service_role だけ（定期実行の start_ingestion_run と、評価・テストの補助）。
 */
create function public.capture_screening_snapshot(p_run_id bigint default null)
returns bigint
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_id bigint;
  v_count integer;
begin
  insert into public.screening_snapshots (captured_at, cycle_date, reference_date, run_id)
  -- 記録の日時は now()（トランザクションの開始）。定期実行の銘柄マスタの実行の started_at と同じ値になり、
  -- 「記録の後に始まった実行」（started_at >= captured_at）にその実行を含められる
  values (now(), (now() at time zone 'Asia/Tokyo')::date,
          (select r.reference_date from public.listing_reference_date r), p_run_id)
  returning id into v_id;

  insert into public.screening_snapshot_stocks (
    snapshot_id, code, company_name, market_code, market_name, sector33_code, is_delisted,
    revenue_cagr, operating_margin, first_price_date, data_start_date,
    owner_status, president_is_top_holder, owner_total_pct
  )
  select v_id, s.code, s.company_name, s.market_code, s.market_name, s.sector33_code, s.delisted_on is not null,
         m.revenue_cagr, m.operating_margin, d.first_price_date, d.data_start_date,
         j.status, j.president_is_top_holder, j.owner_total_pct
    from public.stocks s
    left join public.financial_metrics m on m.code = s.code
    left join public.stock_listing_dates d on d.code = s.code
    left join public.ownership_judgments j on j.code = s.code;

  select count(*) into v_count from public.screening_snapshot_stocks x where x.snapshot_id = v_id and not x.is_delisted;
  update public.screening_snapshots set stock_count = v_count where id = v_id;

  delete from public.screening_snapshots x
   where x.id in (select y.id from public.screening_snapshots y order by y.id desc offset 7);

  return v_id;
end;
$$;

revoke execute on function public.capture_screening_snapshot(bigint) from public, anon, authenticated;
grant execute on function public.capture_screening_snapshot(bigint) to service_role;

-- ---------------------------------------------------------------------------
-- 3. 実行の開始（記録）と終了（snapshot のキーを残す）
-- ---------------------------------------------------------------------------
/**
 * Sprint 12 の関数に、定期実行の銘柄マスタの開始での記録を加えた。
 * 記録は実行の行の insert に成功した後、内側のブロック（セーブポイント）で行う。失敗したら記録の変更だけを巻き戻し、実行は始める。
 * details への書き込みは、巻き戻る内側のブロックの外で行う。when others は query_canceled を捕まえない（開始ごと失敗する。受け入れる）。
 */
create or replace function public.start_ingestion_run(p_target text, p_trigger text)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_run_id bigint;
  v_active jsonb;
  v_snapshot_id bigint;
  v_snapshot text;
begin
  -- 保存済みがあれば「一部完了」（stale）、無ければ今までどおり「失敗」と旧い文言
  update public.ingestion_runs
     set status = case when processed_count > 0 then 'partial' else 'failed' end,
         stopped_reason = case when processed_count > 0 then 'stale' end,
         finished_at = now(),
         error_message = case
           when processed_count > 0 then
             '応答が無くなったため中断されたものとみなしました（15 分以上）。保存済みの分は残っています。残りは次回の取り込みで処理します'
           else '15 分以上応答が無かったため、中断されたものとみなしました'
         end
   where status = 'running'
     and started_at < now() - interval '15 minutes';

  begin
    insert into public.ingestion_runs (target, trigger, status)
    values (p_target, p_trigger, 'running')
    returning id into v_run_id;
  exception when unique_violation then
    select jsonb_build_object(
             'id', r.id, 'target', r.target, 'trigger', r.trigger, 'status', r.status,
             'startedAt', r.started_at, 'finishedAt', r.finished_at,
             'processedCount', r.processed_count, 'errorMessage', r.error_message)
      into v_active
      from public.ingestion_runs r
     where r.status = 'running'
     limit 1;
    return jsonb_build_object('started', false, 'activeRun', v_active);
  end;

  -- 比較の基準の記録（定期実行の銘柄マスタの開始だけ）
  if p_target = 'stock_master' and p_trigger = 'cron' then
    begin
      v_snapshot_id := public.capture_screening_snapshot(v_run_id);
      v_snapshot := 'captured';
    exception when others then
      v_snapshot_id := null;
      v_snapshot := 'failed';
      raise warning 'start_ingestion_run: 比較の基準を記録できませんでした (SQLSTATE %)', sqlstate;
    end;
    update public.ingestion_runs
       set details = coalesce(details, '{}'::jsonb)
                     || jsonb_strip_nulls(jsonb_build_object('snapshot', v_snapshot, 'snapshotId', v_snapshot_id))
     where id = v_run_id;
  end if;

  return jsonb_build_object('started', true, 'runId', v_run_id);
end;
$$;

/** details の置き換えで残す、開始時のキー（snapshot・snapshotId）。無ければ空のオブジェクト */
create function public.ingestion_run_kept_details(p_details jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_strip_nulls(jsonb_build_object('snapshot', p_details -> 'snapshot', 'snapshotId', p_details -> 'snapshotId'))
$$;

revoke execute on function public.ingestion_run_kept_details(jsonb) from public, anon, authenticated;
grant execute on function public.ingestion_run_kept_details(jsonb) to service_role;

create or replace function public.finish_ingestion_run(
  p_run_id bigint,
  p_status text,
  p_processed_count integer,
  p_error_message text,
  p_details jsonb,
  p_outcome jsonb default null
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if p_status not in ('succeeded', 'partial', 'failed') then
    raise exception 'finish_ingestion_run: invalid status %', p_status using errcode = '22023';
  end if;

  update public.ingestion_runs
     set status = p_status,
         finished_at = greatest(now(), started_at),
         processed_count = coalesce(p_processed_count, processed_count),
         error_message = p_error_message,
         -- p_details が NULL なら変えない。置き換えるときは開始時の snapshot のキーを残す（開始時の値が勝つ。R5）
         details = case when p_details is null then details
                        else p_details || public.ingestion_run_kept_details(details) end,
         stopped_reason = p_outcome ->> 'stoppedReason',
         remaining_count = (p_outcome ->> 'remainingCount')::integer,
         remaining_unit = p_outcome ->> 'remainingUnit',
         failed_count = coalesce((p_outcome ->> 'failedCount')::integer, 0)
   where id = p_run_id
     and status = 'running';
  if not found then
    return false;
  end if;

  insert into public.ingestion_run_failures (run_id, item_type, item_key, code, reason, http_status, network_error)
  select p_run_id, f.item_type, f.item_key, f.code, f.reason, f.http_status, f.network_error
    from (
      select x.value ->> 'itemType' as item_type, x.value ->> 'itemKey' as item_key, x.value ->> 'code' as code,
             x.value ->> 'reason' as reason, (x.value ->> 'httpStatus')::integer as http_status,
             x.value ->> 'networkError' as network_error, x.ordinality
        from jsonb_array_elements(coalesce(p_outcome -> 'failures', '[]'::jsonb)) with ordinality x
       order by x.ordinality
       limit 1000
    ) f
   order by f.ordinality
  on conflict (run_id, item_type, item_key) do nothing;

  return true;
end;
$$;

create or replace function public.complete_stock_master_run(p_run_id bigint, p_rows jsonb, p_details jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_details jsonb;
  v_count integer;
  v_codes text[];
  v_list_date date;
  v_relisted integer;
  v_missing integer;
  v_delisted integer := 0;
  v_held boolean := false;
begin
  select status, details into v_status, v_details from public.ingestion_runs where id = p_run_id for update;
  if v_status is distinct from 'running' then
    return jsonb_build_object('completed', false);
  end if;

  select coalesce(array_agg(r ->> 'code'), '{}'), max((r ->> 'listed_info_date')::date)
    into v_codes, v_list_date
    from jsonb_array_elements(p_rows) r;

  select count(*) into v_relisted from public.stocks s where s.delisted_on is not null and s.code = any (v_codes);

  insert into public.stocks as s (
    code, company_name, company_name_en, market_code, market_name,
    sector17_code, sector17_name, sector33_code, sector33_name,
    scale_category, product_category, listed_info_date, updated_at, delisted_on
  )
  select r.code, r.company_name, r.company_name_en, r.market_code, r.market_name,
         r.sector17_code, r.sector17_name, r.sector33_code, r.sector33_name,
         r.scale_category, r.product_category, r.listed_info_date, now(), null
    from jsonb_to_recordset(p_rows) as r(
      code text, company_name text, company_name_en text, market_code text, market_name text,
      sector17_code text, sector17_name text, sector33_code text, sector33_name text,
      scale_category text, product_category text, listed_info_date date
    )
  on conflict (code) do update set
    company_name = excluded.company_name,
    company_name_en = excluded.company_name_en,
    market_code = excluded.market_code,
    market_name = excluded.market_name,
    sector17_code = excluded.sector17_code,
    sector17_name = excluded.sector17_name,
    sector33_code = excluded.sector33_code,
    sector33_name = excluded.sector33_name,
    scale_category = excluded.scale_category,
    product_category = excluded.product_category,
    listed_info_date = excluded.listed_info_date,
    updated_at = excluded.updated_at,
    delisted_on = null;

  get diagnostics v_count = row_count;

  select count(*) into v_missing from public.stocks s where s.delisted_on is null and not (s.code = any (v_codes));
  if v_missing > 100 then
    v_held := true;
  elsif v_missing > 0 then
    update public.stocks s
       set delisted_on = coalesce(v_list_date, (now() at time zone 'Asia/Tokyo')::date)
     where s.delisted_on is null and not (s.code = any (v_codes));
    get diagnostics v_delisted = row_count;
  end if;

  update public.ingestion_runs
     set status = case when v_held then 'partial' else 'succeeded' end,
         stopped_reason = case when v_held then 'delisting_held' end,
         finished_at = greatest(now(), started_at),
         last_progress_at = now(),
         processed_count = v_count,
         error_message = case when v_held then
           '銘柄マスタから一度に ' || to_char(v_missing, 'FM999,999,999') || ' 銘柄が消えたため、上場廃止の反映を保留しました'
         end,
         details = coalesce(p_details, '{}'::jsonb) || jsonb_build_object(
           'delistedDetected', v_delisted, 'relisted', v_relisted, 'delistingHeld', case when v_held then v_missing else 0 end)
           || public.ingestion_run_kept_details(v_details)
   where id = p_run_id;

  return jsonb_build_object('completed', true, 'processedCount', v_count, 'delistedCount', v_delisted,
                            'relistedCount', v_relisted, 'delistingHeld', v_held);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. 判定の1か所（screening_evaluate）: 状態・④の結果・included・exclusion・blocking
-- ---------------------------------------------------------------------------
drop function public.screening_evaluate(jsonb, text[]);

/**
 * 判定の入力の行（銘柄ごと）。p_snapshot_id が NULL なら今の表、渡せば記録（screening_snapshot_stocks）から取り出す。
 * 取り出し元の切り替えだけを行い、判定の式は持たない（screening_evaluate の1か所）。分岐した方の表だけを読むので、
 * 記録を読めない（権限の取り消しなど）ときも、今の表の判定（スクリーニング・詳細）は影響を受けない。
 */
create function public.screening_evaluate_input(p_codes text[], p_snapshot_id bigint)
returns table (code text, market_code text, sector33_code text, is_delisted boolean,
               revenue_cagr numeric, operating_margin numeric, first_price_date date, data_start_date date,
               owner_status text, president_is_top_holder boolean, owner_total_pct numeric)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_snapshot_id is null then
    return query
      select s.code, s.market_code, s.sector33_code, s.delisted_on is not null,
             m.revenue_cagr, m.operating_margin, d.first_price_date, d.data_start_date,
             j.status, j.president_is_top_holder, j.owner_total_pct
        from public.stocks s
        left join public.financial_metrics m on m.code = s.code
        left join public.stock_listing_dates d on d.code = s.code
        left join public.ownership_judgments j on j.code = s.code
       where p_codes is null or s.code = any (p_codes);
  else
    return query
      select x.code, x.market_code, x.sector33_code, x.is_delisted,
             x.revenue_cagr, x.operating_margin, x.first_price_date, x.data_start_date,
             x.owner_status, x.president_is_top_holder, x.owner_total_pct
        from public.screening_snapshot_stocks x
       where x.snapshot_id = p_snapshot_id and (p_codes is null or x.code = any (p_codes));
  end if;
end;
$$;

/**
 * 条件①〜④の状態、市場・業種、上場廃止と、「該当」（included）・除外の種類（exclusion）・妨げている条件（blocking）の唯一の判定の式。
 * p_snapshot_id を渡すと、入力の行の取り出し元を記録（screening_snapshot_stocks）に、基準日を記録の基準日に切り替える
 * （状態の式・④の結果・補正の当て方・分類は同じ1つの式。補正は今の呼び出したユーザーの補正）。
 * exclusion の優先順位: delisted → filters → unmet → unavailable（①〜③。算出不可を含めないとき）→ undeterminable（④。判定不能を含めないとき）。
 * blocking: ①〜④ の順で、状態が unmet か、含める設定がオフのときの unavailable の条件 [{condition, status}]。
 */
create function public.screening_evaluate(p_params jsonb, p_codes text[] default null, p_snapshot_id bigint default null)
returns table (code text, s_cagr text, s_margin text, s_years text, s_owner text, owner_result text,
               owner_auto_result text, owner_override text, matches_filters boolean, is_delisted boolean,
               included boolean, exclusion text, blocking jsonb)
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
  v_include boolean := coalesce((p_params ->> 'includeUnavailable')::boolean, false);
  v_include_undet boolean := coalesce((p_params ->> 'includeUndeterminable')::boolean, false);
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

  if p_snapshot_id is not null then
    select x.reference_date into v_reference from public.screening_snapshots x where x.id = p_snapshot_id;
  else
    select r.reference_date into v_reference from public.listing_reference_date r;
  end if;
  if v_years_on then
    v_cutoff := public.listing_first_date_cutoff(v_reference, v_years);
  end if;

  return query
    with input as (
      select * from public.screening_evaluate_input(p_codes, p_snapshot_id)
    ),
    base as (
      select i.code,
             case when not v_cagr_on then 'off'
                  when i.revenue_cagr is null then 'unavailable'
                  when i.revenue_cagr >= v_cagr then 'met' else 'unmet' end as s_cagr,
             case when not v_margin_on then 'off'
                  when i.operating_margin is null then 'unavailable'
                  when i.operating_margin >= v_margin then 'met' else 'unmet' end as s_margin,
             case when not v_years_on then 'off'
                  when i.first_price_date is null or v_reference is null then 'unavailable'
                  when i.first_price_date = i.data_start_date then 'unmet'
                  when v_cutoff is not null and i.first_price_date >= v_cutoff then 'met' else 'unmet' end as s_years,
             public.owner_result_of(i.owner_status, i.president_is_top_holder, i.owner_total_pct, v_owner_mode, v_owner) as auto_result,
             o.verdict as override,
             (cardinality(v_markets) = 0 or i.market_code = any (v_markets))
               and (cardinality(v_sectors) = 0 or i.sector33_code = any (v_sectors)) as matches_filters,
             i.is_delisted
        from input i
        left join public.ownership_overrides o on o.code = i.code and o.user_id = v_uid
    ),
    st as (
      select b.*,
             case when not v_owner_on then 'off'
                  else public.owner_status_of(coalesce(b.override, b.auto_result), v_owner_mode) end as s_owner
        from base b
    ),
    blk as (
      select t.*,
             (t.s_cagr = 'unmet' or (t.s_cagr = 'unavailable' and not v_include)) as b_cagr,
             (t.s_margin = 'unmet' or (t.s_margin = 'unavailable' and not v_include)) as b_margin,
             (t.s_years = 'unmet' or (t.s_years = 'unavailable' and not v_include)) as b_years,
             (t.s_owner = 'unmet' or (t.s_owner = 'unavailable' and not v_include_undet)) as b_owner
        from st t
    ),
    cls as (
      select k.*,
             case when k.is_delisted then 'delisted'
                  when not k.matches_filters then 'filters'
                  when 'unmet' in (k.s_cagr, k.s_margin, k.s_years, k.s_owner) then 'unmet'
                  when k.b_cagr or k.b_margin or k.b_years then 'unavailable'
                  when k.b_owner then 'undeterminable'
             end as exclusion
        from blk k
    )
    select c.code, c.s_cagr, c.s_margin, c.s_years, c.s_owner,
           coalesce(c.override, c.auto_result),
           c.auto_result,
           c.override,
           c.matches_filters,
           c.is_delisted,
           c.exclusion is null,
           c.exclusion,
           (case when c.b_cagr then jsonb_build_array(jsonb_build_object('condition', 'cagr', 'status', c.s_cagr)) else '[]'::jsonb end)
             || (case when c.b_margin then jsonb_build_array(jsonb_build_object('condition', 'margin', 'status', c.s_margin)) else '[]'::jsonb end)
             || (case when c.b_years then jsonb_build_array(jsonb_build_object('condition', 'years', 'status', c.s_years)) else '[]'::jsonb end)
             || (case when c.b_owner then jsonb_build_array(jsonb_build_object('condition', 'owner', 'status', c.s_owner)) else '[]'::jsonb end)
      from cls c;
end;
$$;

comment on function public.screening_evaluate(jsonb, text[], bigint) is
  '条件①〜④の状態・市場・業種・上場廃止と、該当（included）・除外の種類（exclusion）・妨げている条件（blocking）の唯一の判定の式。'
  'p_snapshot_id で入力を記録に切り替える。security invoker（RLS が効く。条件④は呼び出したユーザーの今の手動補正を含む）';

-- ---------------------------------------------------------------------------
-- 5. スクリーニングの行（表示の値）と screen_stocks・stock_detail
-- ---------------------------------------------------------------------------
/**
 * スクリーニングの行の形（一覧・ウォッチリストで共有する表示の値）と判定の分類。判定は screening_evaluate の値だけを使う。
 */
create function public.screening_rows(p_params jsonb, p_codes text[])
returns table (code text, row_json jsonb, included boolean, exclusion text, blocking jsonb, is_delisted boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  with ref as (select r.reference_date from public.listing_reference_date r)
  select e.code,
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
           'ownership', public.ownership_summary(e.code, e.owner_result, e.owner_auto_result, p_params),
           'status', jsonb_build_object('cagr', e.s_cagr, 'margin', e.s_margin, 'years', e.s_years, 'owner', e.s_owner)
         ),
         e.included, e.exclusion, e.blocking, e.is_delisted
    from public.screening_evaluate(p_params, p_codes) e
    join public.stocks s on s.code = e.code
    left join public.financial_metrics m on m.code = e.code
    left join public.stock_listing_dates d on d.code = e.code
    cross join ref
    left join lateral public.listing_years_between(
      case when d.first_price_date = d.data_start_date then d.data_start_date else d.first_price_date end,
      ref.reference_date
    ) y on true
$$;

/**
 * スクリーニング（Sprint 12 の関数を、判定の分類（screening_evaluate の included・exclusion）を使う形にした）。
 * 除外の件数: excludedUnavailable = exclusion が unavailable、excludedUndeterminable = exclusion が undeterminable の数（今までと同じ値）。
 */
create or replace function public.screen_stocks(p_params jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
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
  v_codes text[];
  v_rows jsonb;
begin
  if v_sort not in ('cagr', 'margin', 'years', 'owner', 'code', 'name', 'market', 'sector') then
    raise exception 'screen_stocks: invalid sort %', v_sort using errcode = '22023';
  end if;
  if (p_params ->> 'cagr') is null or (p_params ->> 'margin') is null or (p_params ->> 'years') is null then
    raise exception 'screen_stocks: thresholds are required' using errcode = '22023';
  end if;

  select r.reference_date into v_reference from public.listing_reference_date r;

  with ev as materialized (
    select e.code, e.included, e.exclusion from public.screening_evaluate(p_params, null) e
  ),
  counts as (
    select (count(*) filter (where v.included))::integer as total,
           (count(*) filter (where v.exclusion = 'unavailable'))::integer as excl_unavailable,
           (count(*) filter (where v.exclusion = 'undeterminable'))::integer as excl_undet
      from ev v
  ),
  paging as (
    select n.*, greatest(ceil(n.total::numeric / v_page_size)::integer, 1) as total_pages from counts n
  ),
  page_no as (
    select g.*, case when v_clamp and v_page > g.total_pages then g.total_pages else v_page end as page
      from paging g
  ),
  keyed as (
    select v.code,
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
      from ev v
      join public.stocks s on s.code = v.code
      left join public.financial_metrics m on m.code = v.code
      left join public.stock_listing_dates d on d.code = v.code
      left join public.ownership_judgments j on j.code = v.code
     where v.included
  ),
  ordered as (
    select k.code,
           row_number() over (
             order by ((k.num_key is null) and (k.txt_key is null)),
                      case when v_asc then k.num_key end asc,
                      case when not v_asc then k.num_key end desc,
                      case when v_asc then k.txt_key end asc,
                      case when not v_asc then k.txt_key end desc,
                      k.code asc
           ) as ord
      from keyed k
  )
  select n.total, n.excl_unavailable, n.excl_undet, n.total_pages, n.page,
         (select coalesce(array_agg(o.code order by o.ord), '{}')
            from ordered o
           where o.ord > (n.page - 1) * v_page_size and o.ord <= n.page * v_page_size)
    into v_total, v_excl_unavailable, v_excl_undet, v_total_pages, v_page, v_codes
    from page_no n;

  select coalesce(jsonb_agg(r.row_json order by array_position(v_codes, r.code)), '[]'::jsonb)
    into v_rows
    from public.screening_rows(p_params, v_codes) r;

  return jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'page', v_page,
    'pageSize', v_page_size,
    'totalPages', v_total_pages,
    'excludedUnavailable', v_excl_unavailable,
    'excludedUndeterminable', v_excl_undet,
    'referenceDate', v_reference,
    'stockCount', (select count(*) from public.stocks s where s.delisted_on is null),
    'delistedCount', (select count(*) from public.stocks s where s.delisted_on is not null),
    'metricsCount', (select count(*) from public.financial_metrics),
    'listingDatesCount', (select count(*) from public.stock_listing_dates),
    'ownershipDeterminedCount', (select count(*) from public.ownership_judgments j where j.status = 'determined')
  );
end;
$$;

/**
 * 銘柄詳細（Sprint 12 の関数を、判定の分類（included・exclusion・blocking）を使う形にした）。
 */
create or replace function public.stock_detail(p_code text, p_params jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
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
             'sector33_name', s.sector33_name,
             'delisted_on', s.delisted_on
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
             'delisted', e.is_delisted,
             'included', e.included,
             'exclusion', e.exclusion,
             'blocking', e.blocking
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
-- 6. 新たに該当・外れた（比較）
-- ---------------------------------------------------------------------------
/**
 * 最新の記録（前回の取り込み時点）と今のデータを、同じ条件（p_params）・今の手動補正で判定して比べる。
 * 戻り値: { status: ok | no_snapshot | empty_snapshot, snapshotId, capturedAt, cycleDate, referenceDate, previousReferenceDate,
 *           added: [{code, company_name, market_code, market_name, reasons}], removed: [...] }（コード順）
 * 理由（reasons）: new_stock・relisted・delisted・missing はそれだけ。ほかは filters と、片方の blocking にだけある条件
 *   {kind: condition, condition, from, to}（①〜④ の順）。
 */
create function public.screening_changes(p_params jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_snap public.screening_snapshots;
  v_reference date;
  v_head jsonb;
  v_added jsonb;
  v_removed jsonb;
begin
  select * into v_snap from public.screening_snapshots x order by x.id desc limit 1;
  select r.reference_date into v_reference from public.listing_reference_date r;
  if v_snap.id is null then
    return jsonb_build_object('status', 'no_snapshot', 'snapshotId', null, 'capturedAt', null, 'cycleDate', null,
                              'referenceDate', v_reference, 'previousReferenceDate', null,
                              'added', '[]'::jsonb, 'removed', '[]'::jsonb);
  end if;
  v_head := jsonb_build_object('snapshotId', v_snap.id, 'capturedAt', v_snap.captured_at, 'cycleDate', v_snap.cycle_date,
                               'referenceDate', v_reference, 'previousReferenceDate', v_snap.reference_date);
  if v_snap.stock_count = 0 then
    return v_head || jsonb_build_object('status', 'empty_snapshot', 'added', '[]'::jsonb, 'removed', '[]'::jsonb);
  end if;

  with cur as materialized (select * from public.screening_evaluate(p_params, null, null)),
  prev as materialized (select * from public.screening_evaluate(p_params, null, v_snap.id)),
  j as (
    select coalesce(c.code, p.code) as code,
           c.code is not null as has_c, p.code is not null as has_p,
           coalesce(c.included, false) as c_in,
           c.is_delisted as c_delisted, p.is_delisted as p_delisted,
           c.matches_filters as c_filters, p.matches_filters as p_filters,
           c.s_cagr as c_cagr, c.s_margin as c_margin, c.s_years as c_years, c.s_owner as c_owner,
           p.s_cagr as p_cagr, p.s_margin as p_margin, p.s_years as p_years, p.s_owner as p_owner,
           coalesce(c.blocking, '[]'::jsonb) as c_blocking, coalesce(p.blocking, '[]'::jsonb) as p_blocking
      from cur c
      full join prev p on p.code = c.code
     where coalesce(c.included, false) <> coalesce(p.included, false)
  ),
  reasoned as (
    select x.code, x.c_in as added,
           case
             when x.c_in and not x.has_p then jsonb_build_array(jsonb_build_object('kind', 'new_stock'))
             when x.c_in and x.p_delisted then jsonb_build_array(jsonb_build_object('kind', 'relisted'))
             when not x.c_in and not x.has_c then jsonb_build_array(jsonb_build_object('kind', 'missing'))
             when not x.c_in and x.c_delisted then jsonb_build_array(jsonb_build_object('kind', 'delisted'))
             else
               case when x.c_filters is distinct from x.p_filters
                    then jsonb_build_array(jsonb_build_object('kind', 'filters')) else '[]'::jsonb end
               || coalesce((
                 select jsonb_agg(jsonb_build_object('kind', 'condition', 'condition', v.k, 'from', v.ps, 'to', v.cs) order by v.ord)
                   from (values (1, 'cagr', x.p_cagr, x.c_cagr), (2, 'margin', x.p_margin, x.c_margin),
                                (3, 'years', x.p_years, x.c_years), (4, 'owner', x.p_owner, x.c_owner)) as v(ord, k, ps, cs)
                  where (x.p_blocking @> jsonb_build_array(jsonb_build_object('condition', v.k)))
                        <> (x.c_blocking @> jsonb_build_array(jsonb_build_object('condition', v.k)))
               ), '[]'::jsonb)
           end as reasons
      from j x
  ),
  named as (
    select r.code, r.added, r.reasons,
           coalesce(s.company_name, xs.company_name) as company_name,
           coalesce(s.market_code, xs.market_code) as market_code,
           coalesce(s.market_name, xs.market_name) as market_name
      from reasoned r
      left join public.stocks s on s.code = r.code
      left join public.screening_snapshot_stocks xs on xs.snapshot_id = v_snap.id and xs.code = r.code
  )
  select coalesce(jsonb_agg(jsonb_build_object('code', n.code, 'company_name', n.company_name, 'market_code', n.market_code,
                                               'market_name', n.market_name, 'reasons', n.reasons) order by n.code)
                    filter (where n.added), '[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('code', n.code, 'company_name', n.company_name, 'market_code', n.market_code,
                                               'market_name', n.market_name, 'reasons', n.reasons) order by n.code)
                    filter (where not n.added), '[]'::jsonb)
    into v_added, v_removed
    from named n;

  return v_head || jsonb_build_object('status', 'ok', 'added', v_added, 'removed', v_removed);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. ウォッチリストの読み出し（行・指標・判定）
-- ---------------------------------------------------------------------------
/**
 * 自分のウォッチリスト（RLS で本人の行だけ。追加日時の新しい順）と、各銘柄の表示の値・判定（p_params の条件）。
 * 日時は UTC の ISO（API が日本時間にする）。
 */
create function public.watchlist_entries(p_params jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with w as materialized (
    select wi.code, wi.memo, wi.created_at, wi.updated_at from public.watchlist_items wi
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'code', w.code,
           'memo', w.memo,
           'created_at', w.created_at,
           'updated_at', w.updated_at,
           'delisted_on', s.delisted_on,
           'row', r.row_json,
           'included', r.included,
           'exclusion', r.exclusion,
           'blocking', r.blocking
         ) order by w.created_at desc, w.code), '[]'::jsonb)
    from w
    join public.stocks s on s.code = w.code
    join public.screening_rows(p_params, (select coalesce(array_agg(x.code), '{}') from w x)) r on r.code = w.code
$$;

-- ---------------------------------------------------------------------------
-- 8. ダッシュボード・取り込み状況の件数を上場中の銘柄だけで数える（Sprint 12 評価の持ち越し）
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_summary()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with listed as materialized (select s.code from public.stocks s where s.delisted_on is null)
  select jsonb_build_object(
    'stockCount', (select count(*) from listed),
    'delistedCount', (select count(*) from public.stocks s where s.delisted_on is not null),
    'financialMetrics', (
      select jsonb_build_object(
        'anyCount', count(*) filter (where m.revenue_cagr is not null or m.operating_margin is not null),
        'revenueCagrCount', count(*) filter (where m.revenue_cagr is not null),
        'operatingMarginCount', count(*) filter (where m.operating_margin is not null)
      )
      from public.financial_metrics m join listed l on l.code = m.code
    ),
    'ownershipDeterminedCount', (
      select count(*) from public.ownership_judgments j join listed l on l.code = j.code where j.status = 'determined'
    ),
    'lastCompletedRun', (
      select jsonb_build_object('target', r.target, 'status', r.status, 'finishedAt', r.finished_at)
        from public.ingestion_runs r
       where r.status in ('succeeded', 'partial')
       order by r.finished_at desc, r.id desc
       limit 1
    ),
    'latestRun', (
      select jsonb_build_object(
        'target', r.target,
        'status', r.status,
        'startedAt', r.started_at,
        'finishedAt', r.finished_at,
        'errorMessage', r.error_message
      )
        from public.ingestion_runs r
       order by r.started_at desc, r.id desc
       limit 1
    )
  );
$$;

create or replace function public.financial_metrics_summary()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with listed as materialized (select s.code from public.stocks s where s.delisted_on is null),
  lm as materialized (select m.* from public.financial_metrics m join listed l on l.code = m.code)
  select jsonb_build_object(
    'stockCount', (select count(*) from listed),
    'withStatementsCount', (select count(*) from lm),
    'revenueCagrCount', (select count(*) from lm m where m.revenue_cagr is not null),
    'operatingMarginCount', (select count(*) from lm m where m.operating_margin is not null),
    'latestDisclosedDate', (select max(s.disclosed_date) from public.financial_statements s),
    'revenueCagrReasons', coalesce((
      select jsonb_object_agg(x.reason, x.n)
        from (select m.revenue_cagr_unavailable_reason as reason, count(*) as n
                from lm m
               where m.revenue_cagr_unavailable_reason is not null
               group by 1) x
    ), '{}'::jsonb),
    'operatingMarginReasons', coalesce((
      select jsonb_object_agg(x.reason, x.n)
        from (select m.operating_margin_unavailable_reason as reason, count(*) as n
                from lm m
               where m.operating_margin_unavailable_reason is not null
               group by 1) x
    ), '{}'::jsonb),
    'lastRun', (
      select jsonb_build_object(
        'finishedAt', r.finished_at,
        'windowStart', r.details ->> 'windowStart',
        'windowEnd', r.details ->> 'windowEnd',
        'datesInWindow', r.details -> 'datesInWindow',
        'datesRemaining', r.details -> 'datesRemaining'
      )
        from public.ingestion_runs r
       where r.target = 'financials' and r.status in ('succeeded', 'partial')
       order by r.finished_at desc, r.id desc
       limit 1
    )
  );
$$;

create or replace function public.annual_reports_summary()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with listed as materialized (select st.code from public.stocks st where st.delisted_on is null),
  s as (select a.* from public.annual_report_sections a join listed l on l.code = a.code),
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
    'stockCount', (select count(*) from listed),
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
        'noAnnualReportCount', (select count(*) from listed) - count(*),
        'annualReportPendingCount', count(*) filter (where j.undeterminable_reason = 'annual_report_pending'),
        'shareholdersNotExtractedCount', count(*) filter (where j.undeterminable_reason = 'shareholders_not_extracted'),
        'officersNotExtractedCount', count(*) filter (where j.undeterminable_reason = 'officers_not_extracted'),
        'presidentNotFoundCount', count(*) filter (where j.undeterminable_reason = 'president_not_found'),
        'previousReportCount', count(*) filter (
          where j.status = 'determined' and (j.shareholders_pending_doc_id is not null or j.officers_pending_doc_id is not null))
      )
        from public.ownership_judgments j join listed l on l.code = j.code
    )
  );
$$;

create or replace function public.business_results_summary()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with listed as materialized (select st.code from public.stocks st where st.delisted_on is null),
  supplemented as (
    select distinct p.code from public.financial_periods p where p.source <> 'tdnet_summary'
  ),
  processed as (
    select e.status, d.doc_type_code
      from public.business_results_extractions e
      join public.edinet_documents d on d.doc_id = e.doc_id
  ),
  last_run as (
    select r.id, r.status, r.finished_at, r.processed_count, r.details
      from public.ingestion_runs r
     where r.target = 'edinet_reports' and r.status <> 'running'
     order by r.finished_at desc nulls last, r.id desc
     limit 1
  )
  select jsonb_build_object(
    'stockCount', (select count(*) from listed),
    'supplementedStockCount', (select count(*) from supplemented s join listed l on l.code = s.code),
    'supplementedCagrCount', (select count(*) from public.financial_metrics m join listed l on l.code = m.code
                               where m.revenue_cagr_supplemented),
    'processedAnnualReports', (select count(*) from processed p where p.doc_type_code in ('120', '130')),
    'processedRegistrationStatements', (select count(*) from processed p where p.doc_type_code in ('030', '040')),
    'statusCounts', coalesce((select jsonb_object_agg(x.status, x.n)
                                from (select p.status, count(*) as n from processed p group by p.status) x), '{}'::jsonb),
    'pendingDocumentCount', (select count(*) from public.business_results_targets),
    'unlinkedRegistrationStatements', (
      select count(*) from public.edinet_documents d
       where d.doc_type_code in ('030', '040') and not d.withdrawn and not d.withheld
         and d.sec_code is null
         and not exists (select 1 from public.edinet_filers f where f.edinet_code = d.edinet_code)
    ),
    'lastRun', (
      select jsonb_build_object('status', l.status, 'finishedAt', l.finished_at, 'processedCount', l.processed_count,
                                'details', l.details)
        from last_run l
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- 9. 権限
-- ---------------------------------------------------------------------------
revoke execute on function public.screening_evaluate_input(text[], bigint) from public, anon, authenticated;
revoke execute on function public.screening_evaluate(jsonb, text[], bigint) from public, anon, authenticated;
revoke execute on function public.screening_rows(jsonb, text[]) from public, anon, authenticated;
revoke execute on function public.screening_changes(jsonb) from public, anon, authenticated;
revoke execute on function public.watchlist_entries(jsonb) from public, anon, authenticated;
revoke execute on function public.screen_stocks(jsonb) from public, anon, authenticated;
revoke execute on function public.stock_detail(text, jsonb) from public, anon, authenticated;
revoke execute on function public.dashboard_summary() from public, anon, authenticated;
revoke execute on function public.financial_metrics_summary() from public, anon, authenticated;
revoke execute on function public.annual_reports_summary() from public, anon, authenticated;
revoke execute on function public.business_results_summary() from public, anon, authenticated;
revoke execute on function public.start_ingestion_run(text, text) from public, anon, authenticated;
revoke execute on function public.finish_ingestion_run(bigint, text, integer, text, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.complete_stock_master_run(bigint, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.screening_evaluate_input(text[], bigint) to authenticated, service_role;
grant execute on function public.screening_evaluate(jsonb, text[], bigint) to authenticated, service_role;
grant execute on function public.screening_rows(jsonb, text[]) to authenticated, service_role;
grant execute on function public.screening_changes(jsonb) to authenticated, service_role;
grant execute on function public.watchlist_entries(jsonb) to authenticated, service_role;
grant execute on function public.screen_stocks(jsonb) to authenticated, service_role;
grant execute on function public.stock_detail(text, jsonb) to authenticated, service_role;
grant execute on function public.dashboard_summary() to authenticated, service_role;
grant execute on function public.financial_metrics_summary() to authenticated, service_role;
grant execute on function public.annual_reports_summary() to authenticated, service_role;
grant execute on function public.business_results_summary() to authenticated, service_role;
grant execute on function public.start_ingestion_run(text, text) to service_role;
grant execute on function public.finish_ingestion_run(bigint, text, integer, text, jsonb, jsonb) to service_role;
grant execute on function public.complete_stock_master_run(bigint, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 10. 性能: 補正の要約（Sprint 11）を plpgsql にする（本文は同じ）
-- ---------------------------------------------------------------------------
/**
 * ownership_summary（language sql）の中から行ごとに呼ぶと、language sql の本文は呼び出しのたびに計画し直される（外側の関数の
 * 実行の状態が1回ごとに作り直されるため）。ウォッチリスト（最大 500 行）で 1 行あたり約 0.15ms かかっていたので、計画を
 * セッションの中で使い回す plpgsql にした。戻り値・判定は変えない（Sprint 11 の本文をそのまま返す）。
 */
create or replace function public.owner_override_summary(p_code text, p_params jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  return (
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
   where o.user_id = (select auth.uid()) and o.code = p_code
  );
end;
$$;
