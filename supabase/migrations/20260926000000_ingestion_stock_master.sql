-- Sprint 3: 取り込み基盤と銘柄マスタ
--
-- 方針
-- - 取り込み処理はサーバー（Route Handler）からサービスロールで実行する。ここで作る関数は
--   service_role だけが実行できる（anon・authenticated・PUBLIC には権限を与えない）。
-- - 同時に「実行中」でいられる実行は、対象を問わず全体で1つだけ（部分一意インデックスで保証する）。
-- - 開始から 15 分以上たった「実行中」は応答が無くなったものとみなし、次の開始時に「失敗」にする。
--   取り込みのルートの最大実行時間（maxDuration = 300 秒）より十分長い。
--   アプリ側の定数 STALE_RUN_MINUTES（src/lib/ingestion/runs.ts）と一致させる。

-- ---------------------------------------------------------------------------
-- 銘柄マスタ: J-Quants の上場銘柄一覧（/v2/equities/master）の項目
-- ---------------------------------------------------------------------------
alter table public.stocks
  add column company_name_en text,
  add column market_code text,
  add column sector17_code text,
  add column sector17_name text,
  add column sector33_code text,
  add column scale_category text,
  add column product_category text,
  add column listed_info_date date;

comment on column public.stocks.market_code is '市場区分コード（J-Quants の Mkt。0111 プライム／0112 スタンダード／0113 グロース）';
comment on column public.stocks.product_category is '商品区分コード（J-Quants の ProdCat。取り込むのは 011 内国株券だけ）';
comment on column public.stocks.listed_info_date is 'この行を確認した上場銘柄一覧の日付（J-Quants の Date）。取り込むたびに更新される';

-- ---------------------------------------------------------------------------
-- 実行履歴: 補足情報と、二重実行の防止
-- ---------------------------------------------------------------------------
alter table public.ingestion_runs add column details jsonb;

comment on column public.ingestion_runs.details is
  '取り込みの補足（件数の内訳など）。市場データそのもの（銘柄名など）は入れない';

-- status = 'running' の行は全体で1行まで（同時の要求でも、2つ目の insert は一意制約違反になる）
create unique index ingestion_runs_single_running_idx on public.ingestion_runs (status) where status = 'running';

-- ---------------------------------------------------------------------------
-- 実行の開始
-- 応答の無くなった実行を「失敗」にしてから、ほかに実行中が無ければ新しい実行を記録する。
-- 戻り値: {"started": true, "runId": n} または {"started": false, "activeRun": {...}}
-- ---------------------------------------------------------------------------
create function public.start_ingestion_run(p_target text, p_trigger text)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_run_id bigint;
  v_active jsonb;
begin
  update public.ingestion_runs
     set status = 'failed',
         finished_at = now(),
         error_message = '15 分以上応答が無かったため、中断されたものとみなしました'
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

  return jsonb_build_object('started', true, 'runId', v_run_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 実行の終了（失敗など、保存を伴わない終わり方）
-- 「実行中」の行だけを更新する。応答なしとして後片付けされた行は上書きしない。
-- 戻り値: 更新したら true
-- ---------------------------------------------------------------------------
create function public.finish_ingestion_run(
  p_run_id bigint,
  p_status text,
  p_processed_count integer,
  p_error_message text,
  p_details jsonb
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
         processed_count = coalesce(p_processed_count, 0),
         error_message = p_error_message,
         details = p_details
   where id = p_run_id
     and status = 'running';
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- 銘柄マスタの保存と、実行の成功の記録を1つのトランザクションで行う。
-- - 実行が「実行中」でなくなっていたら（応答なしとして後片付けされたなど）、何も保存しない。
-- - 行が制約に反するなどで失敗したら、関数全体が取り消される（stocks は1行も変わらない）。
-- 戻り値: {"completed": true, "processedCount": n} または {"completed": false}
-- ---------------------------------------------------------------------------
create function public.complete_stock_master_run(p_run_id bigint, p_rows jsonb, p_details jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_count integer;
begin
  select status into v_status from public.ingestion_runs where id = p_run_id for update;
  if v_status is distinct from 'running' then
    return jsonb_build_object('completed', false);
  end if;

  insert into public.stocks as s (
    code, company_name, company_name_en, market_code, market_name,
    sector17_code, sector17_name, sector33_code, sector33_name,
    scale_category, product_category, listed_info_date, updated_at
  )
  select r.code, r.company_name, r.company_name_en, r.market_code, r.market_name,
         r.sector17_code, r.sector17_name, r.sector33_code, r.sector33_name,
         r.scale_category, r.product_category, r.listed_info_date, now()
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
    updated_at = excluded.updated_at;

  get diagnostics v_count = row_count;

  update public.ingestion_runs
     set status = 'succeeded',
         finished_at = greatest(now(), started_at),
         processed_count = v_count,
         error_message = null,
         details = p_details
   where id = p_run_id;

  return jsonb_build_object('completed', true, 'processedCount', v_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- 権限: service_role だけが実行できる
-- ---------------------------------------------------------------------------
revoke execute on function public.start_ingestion_run(text, text) from public, anon, authenticated;
revoke execute on function public.finish_ingestion_run(bigint, text, integer, text, jsonb) from public, anon, authenticated;
revoke execute on function public.complete_stock_master_run(bigint, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.start_ingestion_run(text, text) to service_role;
grant execute on function public.finish_ingestion_run(bigint, text, integer, text, jsonb) to service_role;
grant execute on function public.complete_stock_master_run(bigint, jsonb, jsonb) to service_role;
