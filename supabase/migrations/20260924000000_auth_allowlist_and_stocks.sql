-- Sprint 1: 認証の許可リストと、市場データ（銘柄マスタ）の土台
--
-- 方針
-- - 許可リストは private スキーマに置き、PostgREST には公開しない（config.toml の api.schemas に含めない）。
-- - Custom Access Token Hook で、許可リスト外のユーザーへのトークン発行を拒否する。
-- - 市場データのテーブルは RLS を有効にし、anon には一切の権限を与えない。
--   authenticated のうち許可リストに入っているユーザーだけが select できる。書き込みは service_role のみ。

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- 許可リスト
-- ---------------------------------------------------------------------------
create table private.allowed_emails (
  email text primary key check (email = lower(btrim(email)) and email <> ''),
  created_at timestamptz not null default now()
);

revoke all on private.allowed_emails from public, anon, authenticated;
grant select, insert, update, delete on private.allowed_emails to service_role;
grant select on private.allowed_emails to supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- 許可判定（内部用）
-- ---------------------------------------------------------------------------
create function private.email_is_allowed(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_email is not null
     and exists (
       select 1 from private.allowed_emails a
       where a.email = lower(btrim(p_email))
     );
$$;

revoke execute on function private.email_is_allowed(text) from public, anon, authenticated;
grant execute on function private.email_is_allowed(text) to service_role, supabase_auth_admin;

-- ログイン前の照会用（サーバーアクションがサービスロールで呼ぶ）。
-- 公開キーから許可リストの中身を推測できないよう、service_role 以外には実行させない。
create function public.is_email_allowed(email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.email_is_allowed(email);
$$;

revoke execute on function public.is_email_allowed(text) from public, anon, authenticated;
grant execute on function public.is_email_allowed(text) to service_role;

-- ログイン後の照会用。呼び出したユーザー自身のメールアドレスだけを判定する。
create function public.current_user_is_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select private.email_is_allowed(u.email)
       from auth.users u
      where u.id = auth.uid()
        and coalesce(u.is_anonymous, false) = false),
    false
  );
$$;

revoke execute on function public.current_user_is_allowed() from public, anon, authenticated;
grant execute on function public.current_user_is_allowed() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Custom Access Token Hook: 許可リスト外（メール無し・匿名を含む）にはトークンを発行しない。
-- パスワードログイン時もトークン更新時も実行される。
-- ---------------------------------------------------------------------------
create function private.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_is_anonymous boolean;
begin
  select u.email, coalesce(u.is_anonymous, false)
    into v_email, v_is_anonymous
    from auth.users u
   where u.id = (event ->> 'user_id')::uuid;

  if v_is_anonymous or not private.email_is_allowed(v_email) then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'このメールアドレスは利用が許可されていません'
      )
    );
  end if;

  return event;
end;
$$;

revoke execute on function private.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function private.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- 銘柄マスタ（Sprint 3 の取り込みで列を追加する予定）
-- ---------------------------------------------------------------------------
create table public.stocks (
  code text primary key check (code ~ '^[0-9A-Z]{4,5}$'),
  company_name text not null,
  market_name text,
  sector33_name text,
  updated_at timestamptz not null default now()
);

comment on table public.stocks is 'J-Quants 由来の銘柄マスタ。再配布禁止のため、許可ユーザー以外には読ませない。';

alter table public.stocks enable row level security;

revoke all on public.stocks from public, anon, authenticated;
grant select on public.stocks to authenticated;
grant all on public.stocks to service_role;

create policy "許可ユーザーのみ参照可"
  on public.stocks
  for select
  to authenticated
  using ((select public.current_user_is_allowed()));

-- ---------------------------------------------------------------------------
-- 運用コマンド（pnpm auth:add-user / pnpm seed:users）用。service_role のみ実行可。
-- ---------------------------------------------------------------------------
create function public.admin_allow_email(p_email text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into private.allowed_emails (email)
  values (lower(btrim(p_email)))
  on conflict (email) do nothing;
$$;

create function public.admin_disallow_email(p_email text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  delete from private.allowed_emails where email = lower(btrim(p_email));
$$;

revoke execute on function public.admin_allow_email(text) from public, anon, authenticated;
revoke execute on function public.admin_disallow_email(text) from public, anon, authenticated;
grant execute on function public.admin_allow_email(text) to service_role;
grant execute on function public.admin_disallow_email(text) to service_role;
