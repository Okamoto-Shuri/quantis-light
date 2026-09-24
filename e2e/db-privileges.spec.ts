import { expect, test } from "@playwright/test";

import { sql } from "./support";

/**
 * AC1.7（公開キーだけでは市場データを読めない）を、今後テーブルや関数を追加しても保つための検査。
 * 以後のスプリントで public スキーマに追加したテーブル・関数も自動で対象になる。
 */
test.describe("DB の権限", () => {
  test("public スキーマのテーブル・ビューに anon の権限が1つも無い", async () => {
    const { rows } = await sql(
      `select table_name, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and grantee in ('anon', 'PUBLIC')`,
    );
    expect(rows).toEqual([]);
  });

  test("public スキーマのテーブルはすべて RLS が有効", async () => {
    const { rows } = await sql(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`,
    );
    expect(rows).toEqual([]);
  });

  test("authenticated は public のテーブルに書き込めない（書き込みは service_role のみ）", async () => {
    const { rows } = await sql(
      `select table_name, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and grantee = 'authenticated'
          and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')`,
    );
    expect(rows).toEqual([]);
  });

  test("public・private の関数は anon から実行できない", async () => {
    const { rows } = await sql(
      `select n.nspname || '.' || p.proname as fn
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute')`,
    );
    expect(rows).toEqual([]);
  });

  test("新しく作ったテーブル・関数にも anon の権限が自動で付かない（既定の権限）", async () => {
    const { rows } = await sql(`
      do $$
      begin
        create table public.__privilege_probe (id int);
        create function public.__privilege_probe_fn() returns int language sql as 'select 1';
        if has_table_privilege('anon', 'public.__privilege_probe', 'select')
           or has_table_privilege('authenticated', 'public.__privilege_probe', 'select')
           or has_function_privilege('anon', 'public.__privilege_probe_fn()', 'execute') then
          raise exception 'default privileges leaked';
        end if;
        raise exception 'rollback probe' using errcode = 'P0001', hint = 'ok';
      end $$;
    `).then(
      () => ({ rows: ["unexpected commit"] }),
      (error: { message: string; hint?: string }) => ({ rows: error.hint === "ok" ? [] : [error.message] }),
    );
    expect(rows).toEqual([]);
  });
});
