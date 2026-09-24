-- Sprint 1 修正R1: 権限の既定値の強化と、Auth からのメール送信の停止
--
-- 1. Supabase の既定では、public スキーマに新しく作ったテーブル・関数・シーケンスに
--    anon / authenticated の権限が自動で付く。市場データは anon に一切見せない方針なので、
--    既定の付与を外し、テーブルごとに必要な権限だけを明示的に grant する。
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;
-- 関数の実行権限は Postgres の既定で PUBLIC に付く（スキーマ単位では外せない）ため、全体の既定から外す。
-- 以後、関数を作るときは実行してよいロールに明示的に grant する。
alter default privileges for role postgres
  revoke execute on functions from public;

-- 2. このアプリはメールを使わない（ユーザーは管理コマンドで作成し、パスワードでログインする）。
--    Auth のメール送信（OTP／マジックリンク、パスワードリセット等）をすべて拒否し、
--    許可リスト外のアドレスにメールが送られる経路を無くす。
create function private.block_auth_email_hook(event jsonb)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'このアプリではメールによる認証を利用できません'
    )
  );
$$;

revoke execute on function private.block_auth_email_hook(jsonb) from public, anon, authenticated;
grant execute on function private.block_auth_email_hook(jsonb) to supabase_auth_admin;
