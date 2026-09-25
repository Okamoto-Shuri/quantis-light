/**
 * 上場前の期の補完（Sprint 9）の、期の選び方（financial_periods）・再計算のトリガー・要約・権限・性能の結合テスト
 * （契約の C4-8・C4-9・C8-1・C11-6・C12-1）。
 * 実行: pnpm test:db（銘柄マスタ・EDINET の書類が0件の DB）。
 * 投入は契約の第5章の e2e/fixtures/business-results-example.sql（9V001〜9V010、S9TEST…、E99V…）と、この中で作る
 * 9V8xx・S9SEL…・E9SEL…、性能の R0000〜R3999・S9PERF…。後片付けで自分の行だけを消す。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const DB_URL = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const FIXTURES = join(__dirname, "../../../e2e/fixtures");
const EXAMPLE_SQL = readFileSync(join(FIXTURES, "business-results-example.sql"), "utf8");
const ADD_SQL = readFileSync(join(FIXTURES, "business-results-add.sql"), "utf8");
const CLEANUP_SQL = readFileSync(join(FIXTURES, "business-results-cleanup.sql"), "utf8");

const db = new Client({ connectionString: DB_URL });
let ownerId = "";
let intruderId = "";

async function cleanup() {
  await db.query("delete from public.edinet_documents where doc_id like 'S9SEL%' or doc_id like 'S9PERF%'");
  await db.query("delete from public.edinet_filers where edinet_code like 'E9SEL%'");
  await db.query("delete from public.stocks where code like '9V8%' or code ~ '^R[0-9]{4}$'");
  await db.query(CLEANUP_SQL);
}

async function metrics(code: string) {
  const { rows } = await db.query(
    `select revenue_cagr::text, revenue_cagr_display_pct::text, revenue_cagr_unavailable_reason, revenue_cagr_supplemented,
            revenue_cagr_mixed_consolidation, revenue_cagr_mixed_standard, annual_period_count, latest_period_source, calculated_at
       from public.financial_metrics where code = $1`,
    [code],
  );
  return rows[0] ?? null;
}

async function periods(code: string) {
  const { rows } = await db.query(
    `select fiscal_year_end::text as end, (net_sales / 100000000)::float as sales, source, source_document_id as doc, consolidated, disclosure_count
       from public.financial_periods where code = $1 order by fiscal_year_end`,
    [code],
  );
  return rows;
}

/** 許可リストのユーザー（authenticated）として、1つのトランザクションの中で実行する。 */
async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  await db.query("begin");
  try {
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
    return await fn();
  } finally {
    await db.query("rollback");
  }
}

type Doc = { id: string; code: string | null; edinet?: string; type: "120" | "130" | "030" | "040"; submitted: string; withdrawn?: boolean; withheld?: boolean };

async function insertDoc(d: Doc) {
  await db.query(
    `insert into public.edinet_documents (doc_id, sec_code, edinet_code, doc_type_code, ordinance_code, form_code, period_start, period_end,
       submitted_at, withdrawn, withheld, xbrl_available, list_date)
     values ($1, $2, $3, $4, '010', '030000', null, $5, $6, $7, $8, true, '2025-06-01')`,
    [d.id, d.code, d.edinet ?? "E9SEL01", d.type, d.type === "120" ? "2025-03-31" : null, d.submitted, d.withdrawn ?? false, d.withheld ?? false],
  );
}

/** 期の行（億円）。[終了日, 売上, 連結か] */
async function insertPeriods(docId: string, rows: [end: string, sales: number | null, consolidated?: boolean][], status = "ok") {
  await db.query("insert into public.business_results_extractions (doc_id, status, period_count) values ($1, $2, $3)", [docId, status, rows.length]);
  for (const [end, sales, consolidated = true] of rows) {
    await db.query(
      `insert into public.business_results_periods (doc_id, fiscal_year_start, fiscal_year_end, consolidated, accounting_standard, net_sales, revenue_element)
       values ($1, ($2::date - interval '1 year' + interval '1 day')::date, $2, $3, 'JP', $4, 'NetSalesSummaryOfBusinessResults')`,
      [docId, end, consolidated, sales === null ? null : sales * 1e8],
    );
  }
}

async function insertStock(code: string) {
  await db.query(
    `insert into public.stocks (code, company_name, market_code, market_name, sector33_code, sector33_name, product_category)
     values ($1, $2, '0113', 'グロース', '5250', '情報・通信業', '011') on conflict do nothing`,
    [code, `選び方テスト${code}株式会社`],
  );
}

async function insertStatements(code: string, rows: [end: string, sales: number][]) {
  for (const [i, [end, sales]] of rows.entries()) {
    await db.query(
      `insert into public.financial_statements (code, disclosure_no, disclosed_date, disclosed_time, document_type, fiscal_year_start, fiscal_year_end, net_sales, operating_profit)
       values ($1, $2, $3::date + 45, '15:00', 'FYFinancialStatements_Consolidated_JP', ($3::date - interval '1 year' + interval '1 day')::date, $3, $4, $5)`,
      [code, `S9SELT${code}${i}`, end, sales * 1e8, sales * 1e7],
    );
  }
}

beforeAll(async () => {
  await db.connect();
  const { rows: others } = await db.query(
    `select (select count(*) from public.stocks where code not like '9V%')::int
          + (select count(*) from public.edinet_documents where doc_id not like 'S9TEST%' and doc_id not like 'S9SEL%' and doc_id not like 'S9PERF%')::int as n`,
  );
  if (others[0].n > 0) throw new Error("テスト以外の銘柄または EDINET の書類があるため、始められません（pnpm db:reset 直後の DB で実行してください）");
  const { rows: users } = await db.query("select id::text, email from auth.users where email in ('owner@quantis.local', 'intruder@quantis.local')");
  ownerId = users.find((u) => u.email === "owner@quantis.local")?.id ?? "";
  intruderId = users.find((u) => u.email === "intruder@quantis.local")?.id ?? "";
  if (!ownerId || !intruderId) throw new Error("評価用ユーザーがいません（pnpm seed:users を実行してください）");
});

beforeEach(async () => {
  await cleanup();
  await db.query(EXAMPLE_SQL);
});

afterAll(async () => {
  await cleanup();
  await db.end();
});

describe("第5章の投入例の期待値（C1・C3・C4・C5・C8）", () => {
  it("出典の優先順位（短信 > 有報 > 届出書）と、取り下げの除外（AC15.1）", async () => {
    expect(await periods("9V001")).toEqual([
      { end: "2021-03-31", sales: 100, source: "edinet_registration_statement", doc: "S9TEST12", consolidated: true, disclosure_count: 1 },
      { end: "2022-03-31", sales: 150, source: "edinet_annual_report", doc: "S9TEST11", consolidated: true, disclosure_count: 1 },
      { end: "2023-03-31", sales: 200, source: "edinet_annual_report", doc: "S9TEST11", consolidated: true, disclosure_count: 1 },
      { end: "2024-03-31", sales: 300, source: "tdnet_summary", doc: "S9A1", consolidated: true, disclosure_count: 1 },
      { end: "2025-03-31", sales: 400, source: "tdnet_summary", doc: "S9A2", consolidated: true, disclosure_count: 1 },
    ]);
    expect(await metrics("9V001")).toMatchObject({
      revenue_cagr: "0.4142135624",
      revenue_cagr_display_pct: "41.4",
      revenue_cagr_supplemented: true,
      latest_period_source: "tdnet_summary",
    });
  });

  it("算出不可の理由（AC15.5・AC15.6）と、結び付かない届出書（9V010）", async () => {
    expect((await metrics("9V002")).revenue_cagr_unavailable_reason).toBe("insufficient_periods");
    expect((await metrics("9V003")).revenue_cagr_unavailable_reason).toBe("irregular_period");
    expect((await metrics("9V004")).revenue_cagr_unavailable_reason).toBe("non_consecutive_periods");
    expect((await metrics("9V010")).revenue_cagr_unavailable_reason).toBe("insufficient_periods");
    expect((await periods("9V010")).every((p) => p.source === "tdnet_summary")).toBe(true);
  });

  it("連結と単体（AC15.8）・訂正届出書（AC15.9）・IFRS", async () => {
    expect((await periods("9V007")).map((p) => [p.end, p.sales, p.consolidated])).toEqual([
      ["2021-03-31", 100, false],
      ["2022-03-31", 150, false],
      ["2023-03-31", 250, true],
      ["2024-03-31", 300, true],
      ["2025-03-31", 400, true],
    ]);
    expect(await metrics("9V007")).toMatchObject({ revenue_cagr_display_pct: "41.4", revenue_cagr_mixed_consolidation: true, revenue_cagr_mixed_standard: false });
    const v008 = await periods("9V008");
    expect(v008.slice(0, 4).map((p) => [p.sales, p.doc, p.disclosure_count])).toEqual([
      [100, "S9TEST82", 2],
      [120, "S9TEST82", 2],
      [150, "S9TEST82", 2],
      [200, "S9TEST82", 2],
    ]);
    expect((await metrics("9V008")).revenue_cagr_display_pct).toBe("31.6");
    expect((await periods("9V009")).map((p) => [p.sales, p.source])).toEqual([
      [250, "edinet_annual_report"],
      [300, "edinet_annual_report"],
      [400, "edinet_annual_report"],
      [500, "tdnet_summary"],
      [600, "tdnet_summary"],
    ]);
    expect(await metrics("9V009")).toMatchObject({ revenue_cagr_display_pct: "24.4", revenue_cagr_mixed_standard: false });
  });

  it("定義は変わらない（AC15.7）: 届出書の2期を足すと、同じ値の決算短信5期の銘柄と CAGR が numeric で等しい", async () => {
    expect((await metrics("9V005")).revenue_cagr_unavailable_reason).toBe("insufficient_periods");
    await db.query(ADD_SQL);
    const added = await metrics("9V005");
    const tdnetOnly = await metrics("9V006");
    expect(added.revenue_cagr).toBe(tdnetOnly.revenue_cagr);
    expect(added.revenue_cagr_display_pct).toBe("25.7");
    expect(added.revenue_cagr_supplemented).toBe(true);
    expect(tdnetOnly.revenue_cagr_supplemented).toBe(false);
  });

  it("取り込み状況の要約（C8-1・C8-2）", async () => {
    const { rows } = await db.query("select public.business_results_summary() - 'lastRun' as s");
    expect(rows[0].s).toEqual({
      stockCount: 10,
      supplementedStockCount: 7,
      supplementedCagrCount: 4,
      processedAnnualReports: 4,
      processedRegistrationStatements: 8,
      statusCounts: { ok: 11, section_not_found: 1 },
      pendingDocumentCount: 1,
      unlinkedRegistrationStatements: 1,
    });
    await db.query(ADD_SQL);
    const { rows: after } = await db.query("select public.business_results_summary() as s");
    expect(after[0].s).toMatchObject({ supplementedStockCount: 8, supplementedCagrCount: 5 });
    // Sprint 8 の区画の「取り込み待ち」は大株主・役員が未処理の有報だけ（主要な経営指標等の未処理は数えない）
    const { rows: annual } = await db.query("select public.annual_reports_summary() ->> 'pendingDocumentCount' as n");
    expect(Number(annual[0].n)).toBe(5); // S9TEST11・22・31・42・91（大株主・役員が未処理）
  });
});

describe("期の選び方と再計算（C4-8・C4-9）", () => {
  it("同じ出典の中は提出日時の新しい書類。取り下げ・不開示の書類は使わない", async () => {
    await insertStock("9V801");
    await insertDoc({ id: "S9SEL01", code: "9V801", type: "030", submitted: "2024-01-10 15:00+09" });
    await insertDoc({ id: "S9SEL02", code: "9V801", type: "040", submitted: "2024-02-10 15:00+09" });
    await insertPeriods("S9SEL01", [["2022-03-31", 10]]);
    await insertPeriods("S9SEL02", [["2022-03-31", 12]]);
    expect((await periods("9V801")).map((p) => [p.sales, p.doc, p.disclosure_count])).toEqual([[12, "S9SEL02", 2]]);
    await db.query("update public.edinet_documents set withheld = true where doc_id = 'S9SEL02'");
    expect((await periods("9V801")).map((p) => [p.sales, p.doc, p.disclosure_count])).toEqual([[10, "S9SEL01", 1]]);
    await db.query("update public.edinet_documents set withdrawn = true where doc_id = 'S9SEL01'");
    expect(await periods("9V801")).toEqual([]);
    expect(await metrics("9V801")).toBeNull();
  });

  it("連結と単体の選択: 連結の売上高 → 単体の売上高 → 連結 → 単体（1つの書類・1つの期で値を混ぜない）", async () => {
    await insertStock("9V802");
    await insertDoc({ id: "S9SEL11", code: "9V802", type: "030", submitted: "2024-01-10 15:00+09" });
    await insertPeriods("S9SEL11", [
      ["2020-03-31", 11, true],
      ["2020-03-31", 10, false],
      ["2021-03-31", null, true],
      ["2021-03-31", 20, false],
      ["2022-03-31", null, true],
      ["2022-03-31", null, false],
    ]);
    expect((await periods("9V802")).map((p) => [p.end, p.sales, p.consolidated])).toEqual([
      ["2020-03-31", 11, true],
      ["2021-03-31", 20, false],
      ["2022-03-31", null, true],
    ]);
  });

  it("EDINET の期だけの銘柄も同じ関数で算出する。stocks の追加で、上場前に保存した届出書の期を使う", async () => {
    await insertDoc({ id: "S9SEL21", code: null, edinet: "E9SEL21", type: "030", submitted: "2024-01-10 15:00+09" });
    await insertPeriods("S9SEL21", [
      ["2020-03-31", 100],
      ["2021-03-31", 150],
      ["2022-03-31", 200],
      ["2023-03-31", 300],
      ["2024-03-31", 400],
    ]);
    await db.query("insert into public.edinet_filers (edinet_code, sec_code) values ('E9SEL21', '9V803')");
    expect(await metrics("9V803")).toBeNull(); // 銘柄マスタにまだ無い
    await insertStock("9V803");
    expect(await metrics("9V803")).toMatchObject({ revenue_cagr: "0.4142135624", revenue_cagr_supplemented: true, latest_period_source: "edinet_registration_statement" });
  });

  it("edinet_filers の追加・変更・削除で再計算する（同じトランザクション）", async () => {
    await insertStock("9V804");
    await insertStock("9V805");
    await insertStatements("9V804", [
      ["2023-03-31", 300],
      ["2024-03-31", 400],
      ["2025-03-31", 500],
    ]);
    await insertDoc({ id: "S9SEL31", code: null, edinet: "E9SEL31", type: "030", submitted: "2023-01-10 15:00+09" });
    await insertPeriods("S9SEL31", [
      ["2021-03-31", 100],
      ["2022-03-31", 200],
    ]);
    expect((await metrics("9V804")).revenue_cagr_unavailable_reason).toBe("insufficient_periods");
    await db.query("insert into public.edinet_filers (edinet_code, sec_code) values ('E9SEL31', '9V804')");
    expect((await metrics("9V804")).revenue_cagr_unavailable_reason).toBeNull();
    await db.query("update public.edinet_filers set sec_code = '9V805' where edinet_code = 'E9SEL31'");
    expect((await metrics("9V804")).revenue_cagr_unavailable_reason).toBe("insufficient_periods");
    expect((await metrics("9V805")).annual_period_count).toBe(2);
    await db.query("delete from public.edinet_filers where edinet_code = 'E9SEL31'");
    expect(await metrics("9V805")).toBeNull();
  });

  it("書類の行の削除（連鎖。R3）: 同じ文の中で、期が無くなった後の値で再計算する。証券コードの無い届出書も edinet_filers から", async () => {
    await db.query("begin");
    try {
      await db.query("delete from public.edinet_documents where doc_id = 'S9TEST12'");
      expect(await metrics("9V001")).toMatchObject({ revenue_cagr: null, revenue_cagr_unavailable_reason: "insufficient_periods", annual_period_count: 4 });
      await db.query("delete from public.edinet_documents where doc_id in ('S9TEST81', 'S9TEST82')");
      expect(await metrics("9V008")).toMatchObject({ revenue_cagr_unavailable_reason: "insufficient_periods", annual_period_count: 1 });
    } finally {
      await db.query("rollback");
    }
  });

  it("抽出の行の削除（取り直し）でも再計算する", async () => {
    await db.query("delete from public.business_results_extractions where doc_id = 'S9TEST91'");
    expect(await metrics("9V009")).toMatchObject({ revenue_cagr_unavailable_reason: "insufficient_periods", annual_period_count: 2 });
  });

  it("後片付けの後に 9V… の指標が残らない", async () => {
    await db.query(CLEANUP_SQL);
    const { rows } = await db.query("select count(*)::int as n from public.financial_metrics where code like '9V%'");
    expect(rows[0].n).toBe(0);
  });

  it("銘柄マスタの upsert（既存の銘柄だけ）では、既存の銘柄を再計算しない", async () => {
    const before = await metrics("9V001");
    await db.query(
      `insert into public.stocks (code, company_name, market_code, market_name, sector33_code, sector33_name, product_category)
       select code, company_name || '（更新）', market_code, market_name, sector33_code, sector33_name, product_category from public.stocks where code like '9V%'
       on conflict (code) do update set company_name = excluded.company_name`,
    );
    expect((await metrics("9V001")).calculated_at).toEqual(before.calculated_at);
  });

  it("算出の関数は出典を読まない（C4-9）。混在の旗は連結・単体と会計基準で分ける", async () => {
    const make = (source: string, consolidated: boolean[], standards: string[]) =>
      JSON.stringify(
        [2021, 2022, 2023, 2024, 2025].map((y, i) => ({
          fiscal_year_start: `${y - 1}-04-01`,
          fiscal_year_end: `${y}-03-31`,
          net_sales: [100, 150, 200, 300, 400][i],
          operating_profit: 10,
          consolidated: consolidated[i],
          accounting_standard: standards[i],
          source,
          source_document_id: `X${i}`,
        })),
      );
    const run = async (json: string) => (await db.query("select public.financial_metrics_from_periods($1::jsonb) as r", [json])).rows[0].r;
    const allTrue = [true, true, true, true, true];
    const jp = ["JP", "JP", "JP", "JP", "JP"];
    expect(await run(make("tdnet_summary", allTrue, jp))).toEqual(await run(make("edinet_registration_statement", allTrue, jp)));
    expect(await run(make("x", [false, false, true, true, true], jp))).toMatchObject({
      revenue_cagr_mixed_basis: true,
      revenue_cagr_mixed_consolidation: true,
      revenue_cagr_mixed_standard: false,
    });
    expect(await run(make("x", allTrue, ["JP", "JP", "IFRS", "IFRS", "IFRS"]))).toMatchObject({
      revenue_cagr_mixed_basis: true,
      revenue_cagr_mixed_consolidation: false,
      revenue_cagr_mixed_standard: true,
    });
  });
});

describe("権限（C11-6）", () => {
  it("許可リストのユーザーは読め、許可リスト外は EDINET の期・追加のテーブルの行が0件", async () => {
    const read = (userId: string) =>
      asUser(userId, async () => {
        const q = async (sql: string) => (await db.query(sql)).rows[0].n as number;
        return {
          periods: await q("select count(*)::int as n from public.financial_periods where source <> 'tdnet_summary'"),
          filers: await q("select count(*)::int as n from public.edinet_filers"),
          extractions: await q("select count(*)::int as n from public.business_results_extractions"),
          rows: await q("select count(*)::int as n from public.business_results_periods"),
          codes: await q("select count(*)::int as n from public.edinet_document_codes"),
          summary: (await db.query("select (public.business_results_summary() ->> 'supplementedStockCount')::int as n")).rows[0].n as number,
        };
      });
    // EDINET の期: 9V001 3・9V002 2・9V003 4・9V004 3・9V007 4・9V008 4・9V009 3
    expect(await read(ownerId)).toMatchObject({ periods: 23, filers: 1, extractions: 12, summary: 7 });
    expect(await read(intruderId)).toEqual({ periods: 0, filers: 0, extractions: 0, rows: 0, codes: 0, summary: 0 });
  });
});

describe("性能（C12-1。4,000 銘柄、決算短信 2期と EDINET の期 3期）", () => {
  it("1銘柄の期の読み出し 20ms、スクリーニング 100ms、全銘柄の再計算 10 秒、1書類の取り下げの再計算 100ms 以内", async () => {
    await db.query(`
      insert into public.stocks (code, company_name, market_code, market_name, sector33_code, sector33_name, product_category)
      select 'R' || lpad(i::text, 4, '0'), '性能テスト' || i, '0113', 'グロース', '5250', '情報・通信業', '011' from generate_series(0, 3999) i;
      insert into public.financial_statements (code, disclosure_no, disclosed_date, disclosed_time, document_type, fiscal_year_start, fiscal_year_end, net_sales, operating_profit)
      select 'R' || lpad(i::text, 4, '0'), 'S9PERFT' || i || '-' || y, make_date(y, 5, 14), '15:00', 'FYFinancialStatements_Consolidated_JP',
             make_date(y - 1, 4, 1), make_date(y, 3, 31), (100 + i + y) * 1e8, (10 + i) * 1e7
        from generate_series(0, 3999) i, generate_series(2024, 2025) y;
      insert into public.edinet_documents (doc_id, sec_code, edinet_code, doc_type_code, ordinance_code, form_code, submitted_at, xbrl_available, list_date)
      select 'S9PERF' || lpad(i::text, 4, '0'), 'R' || lpad(i::text, 4, '0'), 'E9PERF' || i, '120', '010', '030000', '2024-06-25 15:00+09', true, '2024-06-25'
        from generate_series(0, 3999) i;
      insert into public.business_results_extractions (doc_id, status, period_count)
      select 'S9PERF' || lpad(i::text, 4, '0'), 'ok', 3 from generate_series(0, 3999) i;
      insert into public.business_results_periods (doc_id, fiscal_year_start, fiscal_year_end, consolidated, accounting_standard, net_sales)
      select 'S9PERF' || lpad(i::text, 4, '0'), make_date(y - 1, 4, 1), make_date(y, 3, 31), true, 'JP', (80 + i + y) * 1e8
        from generate_series(0, 3999) i, generate_series(2021, 2023) y;
    `);
    const { rows: computed } = await db.query("select count(*)::int as n from public.financial_metrics where code ~ '^R[0-9]{4}$' and revenue_cagr_supplemented");
    expect(computed[0].n).toBe(4000);

    const time = async (fn: () => Promise<unknown>, runs = 5) => {
      const times: number[] = [];
      for (let i = 0; i < runs; i++) {
        const t = performance.now();
        await fn();
        times.push(performance.now() - t);
      }
      return Math.min(...times);
    };
    const onePeriod = await time(() => asUser(ownerId, () => db.query("select * from public.financial_periods where code = 'R1234'")));
    expect(onePeriod).toBeLessThan(20);
    const screen = await time(() =>
      asUser(ownerId, () =>
        db.query("select public.screen_stocks($1::jsonb)", [JSON.stringify({ cagr: "20", margin: "10", years: "5", sort: "cagr", order: "desc", page: 1 })]),
      ),
    );
    expect(screen).toBeLessThan(100);
    const all = await time(() => db.query("select public.recalculate_financial_metrics(array(select code from public.stocks where code ~ '^R[0-9]{4}$'))"), 1);
    expect(all).toBeLessThan(10_000);
    const withdraw = await time(async () => {
      await db.query("update public.edinet_documents set withdrawn = not withdrawn where doc_id = 'S9PERF2000'");
    });
    expect(withdraw).toBeLessThan(100);
    console.info(`[perf] 1銘柄の期 ${onePeriod.toFixed(1)}ms、スクリーニング ${screen.toFixed(1)}ms、全銘柄の再計算 ${all.toFixed(0)}ms、取り下げ ${withdraw.toFixed(1)}ms`);
  }, 120_000);
});
