import { readFileSync } from "node:fs";
import { join } from "node:path";

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

  test("authenticated は public のテーブルに書き込めない（書き込みは service_role のみ。例外は利用者のデータの ownership_overrides だけ）", async () => {
    const { rows } = await sql(
      `select table_name, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and grantee = 'authenticated'
          and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
        order by table_name, privilege_type`,
    );
    // Sprint 11: 手動補正は利用者が自分のセッション（RLS で本人の行だけ）で書く。TRUNCATE・REFERENCES・TRIGGER は付けない
    expect(rows).toEqual([
      { table_name: "ownership_overrides", privilege_type: "DELETE" },
      { table_name: "ownership_overrides", privilege_type: "INSERT" },
      { table_name: "ownership_overrides", privilege_type: "UPDATE" },
    ]);
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
    // listing_first_date_cutoff はデータを読まない計算だけの関数。screen_stocks・screening_filter_options は security invoker（Sprint 6）
    // screening_evaluate・stock_detail は security invoker（Sprint 7）
    // annual_report_detail・annual_reports_summary は security invoker（Sprint 8）
    // business_results_summary は security invoker（Sprint 9）
    expect(rows.map((row) => row.proname)).toEqual([
      "annual_report_candidates_for",
      "annual_report_detail",
      "annual_report_sections_for",
      "annual_reports_summary",
      "business_results_summary",
      "current_user_is_allowed",
      "dashboard_summary",
      "financial_metrics_summary",
      "listing_first_date_cutoff",
      "listing_years_between",
      "owner_override_acknowledge",
      "owner_override_delete",
      "owner_override_save",
      "owner_override_summary",
      "owner_result_of",
      "owner_status_of",
      "ownership_summary",
      "screen_stocks",
      "screening_evaluate",
      "screening_filter_options",
      "stock_detail",
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
                                                        'save_financial_statements', 'edinet_ingestion_state',
                                                        'save_edinet_document_list', 'save_edinet_extractions',
                                                        'recalculate_financial_metrics_for_documents', 'business_results_recalculate',
                                                        'edinet_documents_recalculate', 'edinet_filers_recalculate',
                                                        'stocks_recalculate_financial_metrics', 'prepare_edinet_filers_backfill')
        order by p.proname`,
    );
    const denied = { anon: false, authenticated: false, public: false, service_role: true, security_definer: false };
    expect(rows).toEqual([
      { fn: "business_results_recalculate()", ...denied },
      { fn: "complete_stock_master_run(bigint,jsonb,jsonb)", ...denied },
      { fn: "edinet_documents_recalculate()", ...denied },
      { fn: "edinet_filers_recalculate()", ...denied },
      { fn: "edinet_ingestion_state(date,date)", ...denied },
      { fn: "financial_metrics_from_periods(jsonb)", ...denied },
      { fn: "financial_statements_recalculate()", ...denied },
      { fn: "financials_ingestion_state(date,date)", ...denied },
      { fn: "finish_ingestion_run(bigint,text,integer,text,jsonb)", ...denied },
      { fn: "listing_dates_pending()", ...denied },
      { fn: "prepare_edinet_filers_backfill()", ...denied },
      { fn: "recalculate_financial_metrics(text[])", ...denied },
      { fn: "recalculate_financial_metrics_for_documents(text[])", ...denied },
      { fn: "save_edinet_document_list(bigint,date,jsonb,jsonb,jsonb,jsonb,integer)", ...denied },
      { fn: "save_edinet_extractions(bigint,text,jsonb,jsonb)", ...denied },
      { fn: "save_financial_statements(bigint,date,jsonb,integer)", ...denied },
      { fn: "save_stock_listing_dates(bigint,jsonb)", ...denied },
      { fn: "start_ingestion_run(text,text)", ...denied },
      { fn: "stocks_recalculate_financial_metrics()", ...denied },
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
      ["edinet_ingestion_state", { p_from: "2020-01-01", p_to: "2026-01-01" }],
      ["save_edinet_document_list", { p_run_id: 1, p_list_date: "2026-09-24", p_documents: [], p_withdrawn: [], p_disclosure: [], p_filers: [], p_received_count: 0 }],
      ["save_edinet_extractions", { p_run_id: 1, p_doc_id: "S100TEST", p_annual_report: null, p_business_results: {} }],
      ["prepare_edinet_filers_backfill", {}],
      ["recalculate_financial_metrics_for_documents", { p_doc_ids: ["S100TEST"] }],
      ["business_results_summary", {}],
      ["annual_report_detail", { p_code: "99991" }],
      ["annual_reports_summary", {}],
      ["recalculate_ownership_judgments", { p_codes: ["99991"] }],
      ["ownership_judgment_from_sections", { p_shareholders: [], p_officers: [] }],
      ["ownership_summary", { p_code: "99991", p_result: "undeterminable" }],
      ["annual_report_sections_for", { p_codes: ["99991"] }],
    ] as const) {
      const res = await request.post(`${url}/rest/v1/rpc/${fn}`, {
        headers: { apikey: key!, authorization: `Bearer ${key}` },
        data: body,
      });
      expect(res.status(), fn).toBeGreaterThanOrEqual(400);
    }
    expect((await sql("select count(*)::int as n from public.ingestion_runs")).rows[0].n).toBe(before);
  });

  test("条件④の正規化・分類・保存・トリガーの関数は service_role だけが実行できる（Sprint 10。C8-3）", async () => {
    const { rows } = await sql(
      `select p.proname as fn,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
              has_function_privilege('public', p.oid, 'execute') as public,
              has_function_privilege('service_role', p.oid, 'execute') as service_role,
              p.prosecdef as security_definer
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and (p.proname like 'ownership\\_%' or p.proname like '%\\_ownership%')
          and p.proname <> 'ownership_summary'
        order by p.proname`,
    );
    const denied = { anon: false, authenticated: false, public: false, service_role: true, security_definer: false };
    expect(rows).toEqual(
      [
        "annual_report_rows_recalculate_ownership",
        "edinet_documents_recalculate_ownership",
        "ownership_corporate_text",
        "ownership_is_corporate",
        "ownership_is_excluded_corporate",
        "ownership_judgment_from_sections",
        "ownership_name_key",
        "ownership_name_parts",
        "ownership_overrides_before_write",
        "ownership_surname_of",
        "ownership_title_key",
        "recalculate_ownership_for_documents",
        "recalculate_ownership_judgments",
        "stocks_recalculate_ownership",
      ].map((fn) => ({ fn, ...denied })),
    );
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
      [
        "annual_report_extractions",
        "annual_report_officers",
        "annual_report_shareholders",
        "business_results_extractions",
        "business_results_periods",
        "edinet_documents",
        "edinet_filers",
        "edinet_list_fetched_dates",
        "financial_metrics",
        "financial_statements",
        "ingestion_runs",
        "ownership_holder_classifications",
        "ownership_judgments",
        "ownership_overrides",
        "stock_listing_dates",
        "stocks",
        "surname_readings",
      ].map((relname) => ({
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
      { relname: "annual_report_candidates", invoker: true },
      { relname: "annual_report_sections", invoker: true },
      { relname: "business_results_targets", invoker: true },
      { relname: "edinet_document_codes", invoker: true },
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

  test("スクリーニングの関数は security invoker（RLS が効く）で、PUBLIC・anon に実行権限が無い", async () => {
    const { rows } = await sql(
      `select p.proname, p.prosecdef, has_function_privilege('public', p.oid, 'execute') as public_exec,
              has_function_privilege('anon', p.oid, 'execute') as anon_exec, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('screen_stocks', 'screening_filter_options', 'listing_first_date_cutoff',
                                                        'screening_evaluate', 'stock_detail')
        order by p.proname`,
    );
    const expected = { prosecdef: false, public_exec: false, anon_exec: false, auth_exec: true };
    expect(rows).toEqual([
      { proname: "listing_first_date_cutoff", ...expected },
      { proname: "screen_stocks", ...expected },
      { proname: "screening_evaluate", ...expected },
      { proname: "screening_filter_options", ...expected },
      { proname: "stock_detail", ...expected },
    ]);
  });

  test("公開キーだけでは、スクリーニングの関数を REST から実行できない（C9-5）", async ({ request }) => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    test.skip(!key, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY が E2E の環境に無い");
    await sql("insert into public.stocks (code, company_name, market_code, sector33_code) values ('99991', '権限検査用株式会社', '0113', '5250')");
    try {
      for (const [fn, body] of [
        ["screen_stocks", { p_params: { cagr: "20", margin: "10", years: "5", cagrOn: false, marginOn: false, yearsOn: false } }],
        ["screening_filter_options", {}],
        ["screening_evaluate", { p_params: { cagr: "20", margin: "10", years: "5", cagrOn: false, marginOn: false, yearsOn: false } }],
        ["stock_detail", { p_code: "99991", p_params: { cagr: "20", margin: "10", years: "5" } }],
      ] as const) {
        const res = await request.post(`${url}/rest/v1/rpc/${fn}`, { headers: { apikey: key!, authorization: `Bearer ${key}` }, data: body });
        const text = await res.text();
        expect(res.status(), `${fn}: ${text}`).toBeGreaterThanOrEqual(400);
        expect(text).not.toContain("99991");
        expect(text).not.toContain("権限検査用");
      }
    } finally {
      await sql("delete from public.stocks where code = '99991'");
    }
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

  test("公開キーだけでは、有報（EDINET）のテーブル・ビューを REST から読めず、関数も呼べない（Sprint 8）", async ({ request }) => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    test.skip(!key, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY が E2E の環境に無い");
    const example = readFileSync(join(__dirname, "fixtures/annual-report-example.sql"), "utf8");
    const cleanup = readFileSync(join(__dirname, "fixtures/annual-report-cleanup.sql"), "utf8");
    await sql(example);
    try {
      for (const path of [
        "edinet_documents",
        "edinet_list_fetched_dates",
        "annual_report_extractions",
        "annual_report_shareholders",
        "annual_report_officers",
        "annual_report_candidates",
        "annual_report_sections",
      ]) {
        const res = await request.get(`${url}/rest/v1/${path}?select=*`, { headers: { apikey: key!, authorization: `Bearer ${key}` } });
        const text = await res.text();
        expect(res.status() >= 400 || text === "[]", `${path}: ${res.status()} ${text}`).toBe(true);
        expect(text).not.toContain("S8TEST");
      }
      for (const [fn, body] of [
        ["annual_report_detail", { p_code: "9W001" }],
        ["annual_reports_summary", {}],
      ] as const) {
        const res = await request.post(`${url}/rest/v1/rpc/${fn}`, { headers: { apikey: key!, authorization: `Bearer ${key}` }, data: body });
        expect(res.status(), fn).toBeGreaterThanOrEqual(400);
        expect(await res.text()).not.toContain("山田");
      }
    } finally {
      await sql(cleanup);
      await sql("delete from public.stocks where code like '9W%'");
    }
  });
});

test.describe("DB の権限（Sprint 9: 上場前の期の補完）", () => {
  test("business_results_summary は security invoker で、PUBLIC・anon に実行権限が無い", async () => {
    const { rows } = await sql(
      `select p.prosecdef, has_function_privilege('public', p.oid, 'execute') as public_exec,
              has_function_privilege('anon', p.oid, 'execute') as anon_exec, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
         from pg_proc p where p.oid = 'public.business_results_summary()'::regprocedure`,
    );
    expect(rows).toEqual([{ prosecdef: false, public_exec: false, anon_exec: false, auth_exec: true }]);
  });

  test("公開キーだけでは、追加したテーブル・ビューを REST から読めない（0行または権限エラー）", async ({ request }) => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    test.skip(!key, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY が E2E の環境に無い");
    for (const path of ["edinet_filers", "business_results_extractions", "business_results_periods", "edinet_document_codes", "business_results_targets"]) {
      const res = await request.get(`${url}/rest/v1/${path}?select=*`, { headers: { apikey: key!, authorization: `Bearer ${key}` } });
      const text = await res.text();
      expect(res.status() >= 400 || text === "[]", `${path}: ${res.status()} ${text}`).toBe(true);
    }
  });
});

test.describe("DB の権限（Sprint 11: 条件④の手動補正）", () => {
  test("ownership_overrides: RLS は本人かつ許可ユーザー（(select …) の形）、authenticated は select・insert・update・delete ちょうど、トリガーの関数は authenticated が実行できない", async () => {
    const { rows: grants } = await sql(
      `select grantee, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'ownership_overrides' and grantee in ('anon', 'authenticated', 'PUBLIC')
        order by grantee, privilege_type`,
    );
    expect(grants).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"].map((privilege_type) => ({ grantee: "authenticated", privilege_type })));

    const { rows: policies } = await sql(
      `select cmd, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'ownership_overrides' order by cmd`,
    );
    expect(policies.map((p) => p.cmd)).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"]);
    for (const p of policies) {
      for (const expr of [p.qual, p.with_check].filter(Boolean)) {
        expect(expr).toContain("( SELECT auth.uid()");
        expect(expr).toContain("current_user_is_allowed");
      }
    }

    const { rows: fns } = await sql(
      `select p.proname, p.prosecdef, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
              has_function_privilege('anon', p.oid, 'execute') as anon_exec
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and (p.proname like 'owner\\_override%' or p.proname = 'ownership_overrides_before_write')
        order by p.proname`,
    );
    expect(fns).toEqual([
      { proname: "owner_override_acknowledge", prosecdef: false, auth_exec: true, anon_exec: false },
      { proname: "owner_override_delete", prosecdef: false, auth_exec: true, anon_exec: false },
      { proname: "owner_override_save", prosecdef: false, auth_exec: true, anon_exec: false },
      { proname: "owner_override_summary", prosecdef: false, auth_exec: true, anon_exec: false },
      { proname: "ownership_overrides_before_write", prosecdef: false, auth_exec: false, anon_exec: false },
    ]);
  });

  test("公開キーだけでは、補正のテーブルを読めず、補正の関数も呼べない", async ({ request }) => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    test.skip(!key, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY が E2E の環境に無い");
    const headers = { apikey: key!, authorization: `Bearer ${key}` };
    const res = await request.get(`${url}/rest/v1/ownership_overrides?select=*`, { headers });
    const text = await res.text();
    expect(res.status() >= 400 || text === "[]", `${res.status()} ${text}`).toBe(true);
    for (const [fn, body] of [
      ["owner_override_save", { p_code: "99991", p_verdict: "not_matched", p_memo: "x" }],
      ["owner_override_acknowledge", { p_code: "99991" }],
      ["owner_override_delete", { p_code: "99991" }],
      ["owner_override_summary", { p_code: "99991", p_params: {} }],
    ] as const) {
      const r = await request.post(`${url}/rest/v1/rpc/${fn}`, { headers, data: body });
      expect(r.status(), fn).toBeGreaterThanOrEqual(400);
    }
    const insert = await request.post(`${url}/rest/v1/ownership_overrides`, { headers, data: { code: "99991", verdict: "not_matched", memo: "x" } });
    expect(insert.status()).toBeGreaterThanOrEqual(400);
  });
});
