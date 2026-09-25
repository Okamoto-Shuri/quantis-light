-- Sprint 13: スクリーニングの条件プリセット（F12）
--
-- 方針（契約 docs/harness/sprints/sprint-13/contract.md の第2章）
-- - プリセットは利用者のデータ（市場データではない）。screening_presets に、ユーザーごとに最大 50 行。
--   Sprint 11 の ownership_overrides と同じく、書き込みは利用者自身のセッション（RLS）で行う。
--   「市場データのテーブルは service_role だけが書く」方針の例外として、authenticated に select・insert・update・delete だけを許す。
-- - 中身は、スクリーニングの URL の正規形のクエリ文字列（serializeScreeningParams の出力から page を除いたもの）。
--   状態の正本は URL で、プリセットは「名前の付いた URL」。条件の文法・範囲の検証は TypeScript の parseScreeningParams の
--   1か所だけで、DB は形（パラメータの並び・名前・値の文字の種類と長さ）だけを確かめる。範囲外の値（cagr=99999）は通す
--   （読み出しで既定値にして注記する。利用者は同じ値を URL に直接書くこともできる）。
--   保存したクエリはそのまま「/screening?」の後ろに付けて URL にするので、文字クラスがリダイレクトの安全性の根拠になる
--   （% # / \ ? 空白 改行 非 ASCII は入らない。パスは固定なので外部へのリダイレクトにはならない）。
-- - 利用者は公開キーと自分の JWT で PostgREST から直接書けるので、行の中身は DB が守る（BEFORE INSERT OR UPDATE のトリガー、
--   check 制約、一意索引）。
-- - 同じユーザーの insert（上限の確認）と既定の切り替えは、ユーザーごとの advisory lock で直列にする。
--   既定の切り替え・既定つきの作成・PATCH の変更は security invoker の関数で1トランザクションにし、
--   対象の行を for update で先に確かめる（存在しない id・他人の行では何も変えない）。

-- ---------------------------------------------------------------------------
-- 1. テーブル
-- ---------------------------------------------------------------------------
-- 名前の空白の文字集合は Sprint 11 のメモと同じ（JavaScript の \s。src/lib/text/whitespace.ts）:
--   U+0009〜000D、0020、00A0、1680、2000〜200A、2028、2029、202F、205F、3000、FEFF
create table public.screening_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null constraint screening_presets_name_check check (
    char_length(name) between 1 and 40
    and name !~ '^[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]'
    and name !~ '[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]$'
    and name !~ '[\u0001-\u001f\u007f-\u009f\u2028\u2029]'
  ),
  -- 正規形の形（契約の第2章の2の表）。全体一致（PostgreSQL の正規表現の $ は文字列の末尾だけに当たる。末尾の改行は通らない）
  query text not null constraint screening_presets_query_check check (
    char_length(query) <= 1000
    and query ~ '^cagr=-?[0-9.]{1,8}&margin=-?[0-9.]{1,8}&years=-?[0-9.]{1,8}&owner=-?[0-9.]{1,8}&ownermode=[a-z]{1,16}(&off=[a-z,]{1,40})?(&unavailable=include)?(&undeterminable=include)?(&market=[0-9,]{1,200})?(&sector=[0-9,]{1,200})?&sort=[a-z]{1,16}&order=(asc|desc)$'
  ),
  is_default boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint screening_presets_user_name_key unique (user_id, name)
);

-- 既定は各ユーザーで0か1個
create unique index screening_presets_one_default_idx on public.screening_presets (user_id) where is_default;
create index screening_presets_user_created_idx on public.screening_presets (user_id, created_at, id);

comment on table public.screening_presets is
  'スクリーニングの条件プリセット（利用者のデータ）。RLS で本人の行だけ。中身は正規形のクエリ文字列（検証は parseScreeningParams）';
comment on column public.screening_presets.query is
  'スクリーニングの URL の正規形のクエリ（page を除く）。DB は形だけを確かめ、値の範囲は読み出しで確かめる';
comment on column public.screening_presets.updated_at is '名前かクエリを最後に変えた日時（既定の切り替えでは変わらない）';

/**
 * 行の中身を DB が決める（直接の書き込みへの防御）。security invoker。
 * - insert: user_id が NULL のときだけ auth.uid() を入れる（違う値はそのまま残し、RLS の with check で拒否させる）。
 *   ユーザーごとのロックを取ってから、そのユーザーの行が 50 件あれば拒否する（SQLSTATE QP050）。
 *   created_at・updated_at は clock_timestamp()（1文で複数行を入れても作成の順が決まる）。
 * - update: id・user_id の変更は拒否。created_at は元の値。updated_at は名前かクエリが変わったときだけ新しくする。
 * - どちらでも: 名前の前後の空白を除く。
 * ロックの式は関数を呼ばずに直接書く（トリガーの中で呼ぶ関数には、呼び出したロールの EXECUTE の権限が要るため）。
 */
create function public.screening_presets_before_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  new.name := regexp_replace(
    new.name,
    '^[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$',
    '', 'g');
  if tg_op = 'INSERT' then
    if new.user_id is null then
      new.user_id := auth.uid();
    end if;
    if new.user_id is not null then
      perform pg_advisory_xact_lock(hashtextextended('screening_presets:' || new.user_id::text, 0));
      select count(*) into v_count from public.screening_presets p where p.user_id = new.user_id;
      if v_count >= 50 then
        raise exception 'screening_presets: limit of 50 presets per user' using errcode = 'QP050';
      end if;
    end if;
    new.created_at := clock_timestamp();
    new.updated_at := new.created_at;
  else
    if new.id is distinct from old.id or new.user_id is distinct from old.user_id then
      raise exception 'screening_presets: id and user_id cannot be changed' using errcode = '42501';
    end if;
    new.created_at := old.created_at;
    if new.name is distinct from old.name or new.query is distinct from old.query then
      new.updated_at := clock_timestamp();
    else
      new.updated_at := old.updated_at;
    end if;
  end if;
  return new;
end;
$$;

create trigger screening_presets_before_write
  before insert or update on public.screening_presets
  for each row execute function public.screening_presets_before_write();

alter table public.screening_presets enable row level security;
revoke all on public.screening_presets from public, anon, authenticated;
grant select, insert, update, delete on public.screening_presets to authenticated;
grant all on public.screening_presets to service_role;

create policy "本人のプリセットのみ参照可" on public.screening_presets
  for select to authenticated
  using (user_id = (select auth.uid()) and (select public.current_user_is_allowed()));
create policy "本人のプリセットのみ追加可" on public.screening_presets
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.current_user_is_allowed()));
create policy "本人のプリセットのみ更新可" on public.screening_presets
  for update to authenticated
  using (user_id = (select auth.uid()) and (select public.current_user_is_allowed()))
  with check (user_id = (select auth.uid()) and (select public.current_user_is_allowed()));
create policy "本人のプリセットのみ削除可" on public.screening_presets
  for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.current_user_is_allowed()));

revoke execute on function public.screening_presets_before_write() from public, anon, authenticated;
grant execute on function public.screening_presets_before_write() to service_role;

-- ---------------------------------------------------------------------------
-- 2. 書き込みの関数（security invoker。RLS の下で動く）
-- ---------------------------------------------------------------------------

/** 行を API の形の jsonb にする（日時は UTC の ISO。API が日本時間にする） */
create function public.screening_preset_json(p public.screening_presets)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'query', p.query, 'is_default', p.is_default,
    'created_at', p.created_at, 'updated_at', p.updated_at)
$$;

/**
 * 変更（PATCH・既定の切り替え）。引数の NULL は「変えない」。1トランザクション。
 * 1. ユーザーごとのロック（insert の上限と同じキー）→ 2. 対象の行を for update で取る（RLS の下なので自分の行だけ）
 * → 3. 無ければ何も変えずに NULL を返す → 4. 名前・クエリを変え、既定を切り替える（ほかの行の既定を外してから、この行を既定にする）。
 */
create function public.update_screening_preset(p_id uuid, p_name text, p_query text, p_default boolean)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.screening_presets;
begin
  if v_uid is null then
    raise exception 'update_screening_preset: not authenticated' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('screening_presets:' || v_uid::text, 0));
  select * into v_row from public.screening_presets p where p.id = p_id and p.user_id = v_uid for update;
  if not found then
    return null;
  end if;
  if p_name is not null or p_query is not null then
    update public.screening_presets p
       set name = coalesce(p_name, p.name), query = coalesce(p_query, p.query)
     where p.id = p_id;
  end if;
  if p_default is true then
    update public.screening_presets p set is_default = false where p.user_id = v_uid and p.is_default and p.id <> p_id;
    update public.screening_presets p set is_default = true where p.id = p_id and not p.is_default;
  elsif p_default is false then
    update public.screening_presets p set is_default = false where p.id = p_id and p.is_default;
  end if;
  select * into v_row from public.screening_presets p where p.id = p_id;
  return public.screening_preset_json(v_row);
end;
$$;

/** 既定の切り替え（p_default = true で既定にする、false で解除）。存在しない id・他人の行なら何も変えずに NULL */
create function public.set_default_screening_preset(p_id uuid, p_default boolean default true)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select public.update_screening_preset(p_id, null, null, coalesce(p_default, true))
$$;

/** 作成（既定つきも1トランザクション）。上限・名前の重複・形の違反は例外（行も既定も残らない） */
create function public.create_screening_preset(p_name text, p_query text, p_default boolean default false)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.screening_presets;
begin
  if v_uid is null then
    raise exception 'create_screening_preset: not authenticated' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('screening_presets:' || v_uid::text, 0));
  insert into public.screening_presets (user_id, name, query) values (v_uid, p_name, p_query) returning * into v_row;
  if p_default is true then
    update public.screening_presets p set is_default = false where p.user_id = v_uid and p.is_default and p.id <> v_row.id;
    update public.screening_presets p set is_default = true where p.id = v_row.id;
    select * into v_row from public.screening_presets p where p.id = v_row.id;
  end if;
  return public.screening_preset_json(v_row);
end;
$$;

revoke execute on function public.screening_preset_json(public.screening_presets) from public, anon, authenticated;
revoke execute on function public.update_screening_preset(uuid, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.set_default_screening_preset(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.create_screening_preset(text, text, boolean) from public, anon, authenticated;
grant execute on function public.screening_preset_json(public.screening_presets) to authenticated, service_role;
grant execute on function public.update_screening_preset(uuid, text, text, boolean) to authenticated, service_role;
grant execute on function public.set_default_screening_preset(uuid, boolean) to authenticated, service_role;
grant execute on function public.create_screening_preset(text, text, boolean) to authenticated, service_role;
