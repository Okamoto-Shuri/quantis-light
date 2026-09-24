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

  test("authenticated が実行できる public の関数は、明示的に許可したものだけ（拡張の関数を除く）", async () => {
    const { rows } = await sql(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
          and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
        order by p.proname`,
    );
    // listing_years_between はデータを読まない計算だけの関数（ビュー stock_listing_ages が invoker として呼ぶ）
    // financial_metrics_summary は security invoker の集計（RLS が効く）
    expect(rows.map((row) => row.proname)).toEqual([
      "current_user_is_allowed",
      "dashboard_summary",
      "financial_metrics_summary",
      "listing_years_between",
    ]);
  });

  test("dashboard_summary は security invoker（RLS が効く）で、PUBLIC に実行権限が無い", async () => {
    const { rows } = await sql(
      `select p.prosecdef, has_function_privilege('public', p.oid, 'execute') as public_exec
         from pg_proc p where p.oid = 'public.dashboard_summary()'::regprocedure`,
    );
    expect(rows).toEqual([{ prosecdef: false, public_exec: false }]);
  });

  test("取り込みの DB 関数は service_role だけが実行できる（anon・authenticated・PUBLIC には権限が無い）", async () => {
    const { rows } = await sql(
      `select p.oid::regprocedure::text as fn,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
              has_function_privilege('public', p.oid, 'execute') as public,
              has_function_privilege('service_role', p.oid, 'execute') as service_role,
              p.prosecdef as security_definer
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('start_ingestion_run', 'finish_ingestion_run', 'complete_stock_master_run',
                                                        'listing_dates_pending', 'save_stock_listing_dates',
                                                        'financial_metrics_from_periods', 'recalculate_financial_metrics',
                                                        'financial_statements_recalculate', 'financials_ingestion_state',
                                                        'save_financial_statements')
        order by p.proname`,
    );
    const denied = { anon: false, authenticated: false, public: false, service_role: true, security_definer: false };
    expect(rows).toEqual([
      { fn: "complete_stock_master_run(bigint,jsonb,jsonb)", ...denied },
      { fn: "financial_metrics_from_periods(jsonb)", ...denied },
      { fn: "financial_statements_recalculate()", ...denied },
      { fn: "financials_ingestion_state(date,date)", ...denied },
      { fn: "finish_ingestion_run(bigint,text,integer,text,jsonb)", ...denied },
      { fn: "listing_dates_pending()", ...denied },
      { fn: "recalculate_financial_metrics(text[])", ...denied },
      { fn: "save_financial_statements(bigint,date,jsonb,integer)", ...denied },
      { fn: "save_stock_listing_dates(bigint,jsonb)", ...denied },
      { fn: "start_ingestion_run(text,text)", ...denied },
    ]);
  });

  test("公開キーだけでは、取り込みの DB 関数を REST から実行できない", async ({ request }) => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    test.skip(!key, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY が E2E の環境に無い");
    const before = (await sql("select count(*)::int as n from public.ingestion_runs")).rows[0].n;
    for (const [fn, body] of [
      ["start_ingestion_run", { p_target: "stock_master", p_trigger: "manual" }],
      ["finish_ingestion_run", { p_run_id: 1, p_status: "failed", p_processed_count: 0, p_error_message: "x", p_details: null }],
      ["complete_stock_master_run", { p_run_id: 1, p_rows: [], p_details: null }],
      ["listing_dates_pending", {}],
      ["save_stock_listing_dates", { p_run_id: 1, p_rows: [] }],
      ["save_financial_statements", { p_run_id: 1, p_disclosure_date: "2026-09-24", p_rows: [], p_received_count: 0 }],
      ["financials_ingestion_state", { p_from: "2020-01-01", p_to: "2026-01-01" }],
      ["recalculate_financial_metrics", { p_codes: ["99991"] }],
      ["financial_metrics_from_periods", { p_periods: [] }],
    ] as const) {
      const res = await request.post(`${url}/rest/v1/rpc/${fn}`, {
        headers: { apikey: key!, authorization: `Bearer ${key}` },
        data: body,
      });
      expect(res.status(), fn).toBeGreaterThanOrEqual(400);
    }
    expect((await sql("select count(*)::int as n from public.ingestion_runs")).rows[0].n).toBe(before);
  });

  test("authenticated が参照できる public のテーブルは、RLS で許可ユーザーに限られるものだけ", async () => {
    const { rows } = await sql(
      `select c.relname, exists (select 1 from pg_policies pol where pol.schemaname = 'public' and pol.tablename = c.relname
                                  and pol.qual like '%current_user_is_allowed%') as guarded
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p', 'm')
          and has_table_privilege('authenticated', c.oid, 'select')
        order by c.relname`,
    );
    expect(rows).toEqual(
      ["financial_metrics", "financial_statements", "ingestion_runs", "ownership_judgments", "stock_listing_dates", "stocks"].map((relname) => ({
        relname,
        guarded: true,
      })),
    );
  });

  test("authenticated が参照できる public のビューは security_invoker（元のテーブルの RLS が効く）ものだけ", async () => {
    const { rows } = await sql(
      `select c.relname, coalesce('security_invoker=true' = any(c.reloptions), false) as invoker
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'v'
          and has_table_privilege('authenticated', c.oid, 'select')
        order by c.relname`,
    );
    expect(rows).toEqual([
      { relname: "financial_periods", invoker: true },
      { relname: "listing_reference_date", invoker: true },
      { relname: "stock_listing_ages", invoker: true },
    ]);
  });

  test("公開キーだけでは、初出日のテーブルとビューを REST から読めない", async ({ request }) => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    test.skip(!key, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY が E2E の環境に無い");
    await sql("insert into public.stocks (code, company_name) values ('99991', '権限検査用株式会社')");
    await sql("insert into public.stock_listing_dates (code, first_price_date, data_start_date) values ('99991', '2020-01-06', '2016-09-26')");
    try {
      for (const path of ["stock_listing_dates", "stock_listing_ages", "listing_reference_date"]) {
        const res = await request.get(`${url}/rest/v1/${path}?select=*`, {
          headers: { apikey: key!, authorization: `Bearer ${key}` },
        });
        const text = await res.text();
        expect(res.status() >= 400 || text === "[]", `${path}: ${res.status()} ${text}`).toBe(true);
        expect(text).not.toContain("99991");
      }
    } finally {
      await sql("delete from public.stocks where code = '99991'");
    }
  });

  test("financial_metrics_summary は security invoker（RLS が効く）で、PUBLIC に実行権限が無い。取得済みの開示日は authenticated も読めない", async () => {
    const { rows } = await sql(
      `select p.prosecdef, has_function_privilege('public', p.oid, 'execute') as public_exec
         from pg_proc p where p.oid = 'public.financial_metrics_summary()'::regprocedure`,
    );
    expect(rows).toEqual([{ prosecdef: false, public_exec: false }]);
    const { rows: grants } = await sql("select has_table_privilege('authenticated', 'public.financial_fetched_dates', 'select') as sel");
    expect(grants).toEqual([{ sel: false }]);
  });

  test("公開キーだけでは、財務のテーブル・ビュー・要約を REST から読めない", async ({ request }) => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    test.skip(!key, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY が E2E の環境に無い");
    await sql("insert into public.stocks (code, company_name) values ('99991', '権限検査用株式会社')");
    await sql(
      `insert into public.financial_statements (code, disclosure_no, disclosed_date, document_type, fiscal_year_start, fiscal_year_end, net_sales, operating_profit)
       values ('99991', 'PRIV1', '2025-05-14', 'FYFinancialStatements_Consolidated_JP', '2024-04-01', '2025-03-31', 98765, 4321)`,
    );
    await sql("insert into public.financial_fetched_dates (disclosure_date, received_count) values ('2025-05-14', 1)");
    try {
      for (const path of ["financial_statements", "financial_periods", "financial_metrics", "financial_fetched_dates"]) {
        const res = await request.get(`${url}/rest/v1/${path}?select=*`, { headers: { apikey: key!, authorization: `Bearer ${key}` } });
        const text = await res.text();
        expect(res.status() >= 400 || text === "[]", `${path}: ${res.status()} ${text}`).toBe(true);
        expect(text).not.toContain("99991");
      }
      const summary = await request.post(`${url}/rest/v1/rpc/financial_metrics_summary`, {
        headers: { apikey: key!, authorization: `Bearer ${key}` },
        data: {},
      });
      expect(summary.status()).toBeGreaterThanOrEqual(400);
      expect(await summary.text()).not.toContain("98765");
    } finally {
      await sql("delete from public.stocks where code = '99991'");
      await sql("delete from public.financial_fetched_dates");
    }
  });
});
