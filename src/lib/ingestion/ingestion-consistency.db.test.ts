/**
 * Sprint 12 の DB の結合テスト（取り込みを通さず、DB 関数とビューを直接呼ぶ）:
 * - 取り込み中の検索の整合（C5-1）: 保存の関数5つは、保存と再計算が同じトランザクション。コミットの後にそろった値が見える
 * - データの鮮度（C4-7・C4-10）と未取得の残り（第2章の5の3）
 * - 上場廃止の画面・検索への影響（C6-4・C6-5 の DB 部分）
 * - 性能（C7）: 実測値を expect のメッセージと標準出力に出す（Sprint 11 評価の m5）
 * 実行: pnpm test:db（pnpm db:reset 直後の DB。seed:users 済み）
 * 作る行: 銘柄 9N8xx・N0000〜N3999、書類 S12NDB…、実行は details の fixture = 'sprint-12-db'。後片付けはこれらだけを消す。
 */
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const DB_URL = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const db = new Client({ connectionString: DB_URL });
const other = new Client({ connectionString: DB_URL });
let ownerId = "";

const MARK = { fixture: "sprint-12-db" };
/** 条件をすべてオフ・算出不可と判定不能を含める（すべての上場中の銘柄が結果に出る） */
const ALL = { cagr: "20", margin: "10", years: "5", cagrOn: false, marginOn: false, yearsOn: false, ownerOn: false, includeUnavailable: true, includeUndeterminable: true, sort: "code", order: "asc", pageSize: 500 };

async function asUser<T>(client: Client, fn: () => Promise<T>): Promise<T> {
  await client.query("begin");
  try {
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ownerId, role: "authenticated" })]);
    const value = await fn();
    await client.query("commit");
    return value;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

/** authenticated（owner）として、別の接続からスクリーニングの行を読む */
async function screenRow(code: string, params: object = ALL) {
  const { rows } = await asUser(other, () => other.query("select public.screen_stocks($1::jsonb) as r", [JSON.stringify(params)]));
  return (rows[0].r.rows as { code: string }[]).find((row) => row.code === code) as Record<string, unknown> | undefined;
}

async function detail(code: string) {
  const { rows } = await asUser(other, () => other.query("select public.stock_detail($1, $2::jsonb) as d", [code, JSON.stringify(ALL)]));
  return rows[0].d;
}

async function insertStock(code: string) {
  await db.query(
    `insert into public.stocks (code, company_name, market_code, market_name, sector33_code, sector33_name, product_category, listed_info_date)
     values ($1, $2, '0113', 'グロース', '5250', '情報・通信業', '011', '2026-09-24')`,
    [code, `整合テスト${code}株式会社`],
  );
}

async function startRun(target: string): Promise<number> {
  const { rows } = await db.query(
    "insert into public.ingestion_runs (target, trigger, status, details) values ($1, 'manual', 'running', $2) returning id",
    [target, MARK],
  );
  return Number(rows[0].id);
}

async function finishRun(id: number) {
  await db.query("update public.ingestion_runs set status = 'succeeded', finished_at = now() where id = $1 and status = 'running'", [id]);
}

/** 決算短信の通期（金額は億円 → 円） */
function statement(code: string, no: string, fyEnd: number, sales: number, op: number | null) {
  return {
    code,
    disclosure_no: no,
    disclosed_date: `${fyEnd}-05-14`,
    disclosed_time: "15:00:00",
    document_type: "FYFinancialStatements_Consolidated_JP",
    fiscal_year_start: `${fyEnd - 1}-04-01`,
    fiscal_year_end: `${fyEnd}-03-31`,
    net_sales: String(sales * 100_000_000),
    operating_profit: op === null ? null : String(op * 100_000_000),
  };
}

async function cleanup() {
  await db.query("delete from public.edinet_documents where doc_id like 'S12NDB%'");
  await db.query("delete from public.stocks where code like '9N8%' or code ~ '^N[0-9]{4}$'");
  await db.query("delete from public.ingestion_runs where details ->> 'fixture' = 'sprint-12-db'");
  // 保存の関数が記録する取得済みの開示日・書類一覧の日（このテストだけが使う日付）
  await db.query("delete from public.financial_fetched_dates where disclosure_date = '2025-05-14'");
  await db.query("delete from public.edinet_list_fetched_dates where list_date = '2023-02-10'");
}

beforeAll(async () => {
  await db.connect();
  await other.connect();
  const { rows } = await db.query("select id from auth.users where email = 'owner@quantis.local'");
  if (!rows[0]) throw new Error("owner@quantis.local がありません（pnpm seed:users を実行してください）");
  ownerId = rows[0].id;
  const { rows: running } = await db.query("select count(*)::int as n from public.ingestion_runs where status = 'running'");
  if (running[0].n > 0) throw new Error("実行中の実行が残っているため、結合テストを始められません");
  await cleanup();
});

afterEach(async () => {
  await db.query("delete from public.ingestion_runs where details ->> 'fixture' = 'sprint-12-db' and status = 'running'");
});

afterAll(async () => {
  await cleanup();
  await db.end();
  await other.end();
});

describe("取り込み中の検索の整合（C5-1）: 保存と再計算は同じトランザクション", () => {
  it("save_stock_listing_dates: コミットの後に初出日と推定上場年数がそろって見える。コミット前は見えない", async () => {
    await insertStock("9N801");
    const base = await startRun("daily_quotes");
    await finishRun(base); // 基準日（株価の成功）
    const run = await startRun("daily_quotes");
    const rows = [{ code: "9N801", first_price_date: "2024-03-15", data_start_date: "2016-09-26" }];

    await db.query("begin");
    await db.query("select public.save_stock_listing_dates($1, $2::jsonb)", [run, JSON.stringify(rows)]);
    expect((await detail("9N801")).listing).toBeNull(); // コミット前は保存前の値
    await db.query("commit");

    const after = await detail("9N801");
    expect(after.listing).toMatchObject({ first_price_date: "2024-03-15", listed_before_data_start: false });
    expect(after.listing.estimated_listing_years).not.toBeNull();
    expect((await db.query("select last_progress_at from public.ingestion_runs where id = $1", [run])).rows[0].last_progress_at).not.toBeNull();
  });

  it("save_financial_statements: コミットの後に指標（営業利益率）がそろって見える", async () => {
    await insertStock("9N802");
    const run = await startRun("financials");
    await db.query("begin");
    await db.query("select public.save_financial_statements($1, '2025-05-14', $2::jsonb, 1)", [
      run,
      JSON.stringify([statement("9N802", "S12NDB-F1", 2025, 400, 48)]),
    ]);
    expect((await screenRow("9N802"))?.operating_margin ?? null).toBeNull();
    await db.query("commit");
    const row = await screenRow("9N802");
    expect(row).toMatchObject({ has_financials: true, operating_margin_display_pct: 12 });
  });

  it("save_edinet_extractions・save_edinet_document_list: 補完の期の保存と取り下げで、コミットの後の CAGR がそろって変わる", async () => {
    await insertStock("9N803");
    const tdnet = await startRun("financials");
    await db.query("select public.save_financial_statements($1, '2025-05-14', $2::jsonb, 3)", [
      tdnet,
      JSON.stringify([
        statement("9N803", "S12NDB-G1", 2023, 200, 20),
        statement("9N803", "S12NDB-G2", 2024, 300, 30),
        statement("9N803", "S12NDB-G3", 2025, 400, 40),
      ]),
    ]);
    await finishRun(tdnet);
    expect(await screenRow("9N803")).toMatchObject({ revenue_cagr: null, revenue_cagr_unavailable_reason: "insufficient_periods" });

    const run = await startRun("edinet_reports");
    await db.query(
      `insert into public.edinet_documents (doc_id, sec_code, edinet_code, filer_name, doc_type_code, ordinance_code, form_code,
         submitted_at, doc_description, xbrl_available, list_date)
       values ('S12NDB01', '9N803', 'E12ND1', '整合テスト9N803株式会社', '030', '010', '010000', '2023-02-01 15:00+09',
         '有価証券届出書（新規公開時）', true, '2023-02-01')`,
    );
    const periods = [
      { fiscal_year_start: "2020-04-01", fiscal_year_end: "2021-03-31", consolidated: true, accounting_standard: "JP", net_sales: "10000000000", operating_profit: null, revenue_element: "NetSalesSummaryOfBusinessResults", operating_profit_element: null },
      { fiscal_year_start: "2021-04-01", fiscal_year_end: "2022-03-31", consolidated: true, accounting_standard: "JP", net_sales: "15000000000", operating_profit: null, revenue_element: "NetSalesSummaryOfBusinessResults", operating_profit_element: null },
    ];
    await db.query("begin");
    await db.query("select public.save_edinet_extractions($1, 'S12NDB01', null, $2::jsonb)", [
      run,
      JSON.stringify({ status: "ok", detail: null, periods }),
    ]);
    expect((await screenRow("9N803"))?.revenue_cagr).toBeNull(); // コミット前は保存前の値
    await db.query("commit");
    const supplemented = await screenRow("9N803");
    expect(supplemented).toMatchObject({ revenue_cagr_supplemented: true });
    expect(Number(supplemented?.revenue_cagr)).toBeCloseTo(Math.pow(400 / 100, 1 / 4) - 1, 8);

    // 取り下げ（書類一覧の保存）: 補完に使っていた届出書が外れ、コミットの後は補完なしの値（算出不可）
    await db.query("begin");
    await db.query("select public.save_edinet_document_list($1, '2023-02-10', '[]'::jsonb, $2::jsonb, '[]'::jsonb, '[]'::jsonb, 0)", [
      run,
      JSON.stringify(["S12NDB01"]),
    ]);
    expect(Number((await screenRow("9N803"))?.revenue_cagr)).toBeGreaterThan(0);
    await db.query("commit");
    expect(await screenRow("9N803")).toMatchObject({ revenue_cagr: null, revenue_cagr_supplemented: false });
    await db.query("delete from public.edinet_list_fetched_dates where list_date = '2023-02-10'");
  });

  it("complete_stock_master_run: コミットの後に上場廃止がそろって見える（結果から消え、詳細は含まれない）", async () => {
    await insertStock("9N804");
    await insertStock("9N805");
    // テスト以外の銘柄があると、それも上場廃止になるので確かめる
    const { rows } = await db.query("select count(*)::int as n from public.stocks where not (code like '9N8%')");
    expect(rows[0].n, "銘柄マスタにテスト以外の銘柄がある（pnpm db:reset 直後の DB で実行してください）").toBe(0);
    const run = await startRun("stock_master");
    const master = ["9N801", "9N802", "9N803", "9N805"].map((code) => ({
      code, company_name: `整合テスト${code}株式会社`, company_name_en: "", market_code: "0113", market_name: "グロース",
      sector17_code: "10", sector17_name: "情報通信・サービスその他", sector33_code: "5250", sector33_name: "情報・通信業",
      scale_category: "-", product_category: "011", listed_info_date: "2026-09-25",
    }));
    await db.query("begin");
    await db.query("select public.complete_stock_master_run($1, $2::jsonb, $3::jsonb)", [run, JSON.stringify(master), JSON.stringify(MARK)]);
    expect(await screenRow("9N804")).toBeDefined();
    await db.query("commit");
    expect(await screenRow("9N804")).toBeUndefined();
    const d = await detail("9N804");
    expect(d.stock.delisted_on).toBe("2026-09-25");
    expect(d.evaluation).toMatchObject({ delisted: true, included: false });
    const { rows: runRow } = await db.query("select status, details, last_progress_at from public.ingestion_runs where id = $1", [run]);
    expect(runRow[0]).toMatchObject({ status: "succeeded", details: { delistedDetected: 1, relisted: 0 } });
  });
});

describe("データの鮮度（C4-7・C4-10）と未取得の残り", () => {
  async function freshness(now: string) {
    const { rows } = await db.query("select public.data_freshness($1::timestamptz) as f", [now]);
    return rows[0].f as { stale: boolean; lastUpdatedAt: string | null; targets: { target: string; stale: boolean; lastUpdatedAt: string | null; remainingCount: number | null; remainingUnit: string | null }[] };
  }
  const target = (f: Awaited<ReturnType<typeof freshness>>, name: string) => f.targets.find((t) => t.target === name)!;

  beforeEach(async () => {
    await db.query("delete from public.ingestion_runs where details ->> 'fixture' = 'sprint-12-db'");
  });

  async function insertRun(values: { target: string; status: string; finished: string; lastProgress?: string | null; stopped?: string | null; remaining?: number | null; unit?: string | null; processed?: number }) {
    const { rows } = await db.query(
      `insert into public.ingestion_runs (target, trigger, status, started_at, finished_at, last_progress_at, stopped_reason, remaining_count, remaining_unit, processed_count, details)
       values ($1, 'cron', $2, $3::timestamptz - interval '3 minutes', $3::timestamptz, $4, $5, $6, $7, $8, $9) returning id`,
      [values.target, values.status, values.finished, values.lastProgress ?? null, values.stopped ?? null, values.remaining ?? null, values.unit ?? null, values.processed ?? 0, MARK],
    );
    return Number(rows[0].id);
  }

  it("境界: 最終更新から 47:59:59.999 は古くない、48:00:00 ちょうどは古い", async () => {
    const { rows } = await db.query("select count(*)::int as n from public.ingestion_runs where details ->> 'fixture' is distinct from 'sprint-12-db'");
    expect(rows[0].n, "実行履歴が0件の DB で実行してください").toBe(0);
    await insertRun({ target: "daily_quotes", status: "succeeded", finished: "2026-09-20T00:00:00Z" });
    expect(target(await freshness("2026-09-21T23:59:59.999Z"), "daily_quotes").stale).toBe(false);
    const f = await freshness("2026-09-22T00:00:00Z");
    expect(f.stale).toBe(true);
    expect(new Date(f.lastUpdatedAt!).toISOString()).toBe("2026-09-20T00:00:00.000Z");
    expect(f.targets.filter((t) => t.stale).map((t) => t.target)).toEqual(["daily_quotes"]);
    // 一度も更新していない target は古いとしない
    expect(target(f, "stock_master")).toMatchObject({ stale: false, lastUpdatedAt: null });
    // failed は更新とみなさない。partial はみなす
    await insertRun({ target: "daily_quotes", status: "failed", finished: "2026-09-21T23:00:00Z" });
    expect((await freshness("2026-09-22T00:00:00Z")).stale).toBe(true);
    await insertRun({ target: "daily_quotes", status: "partial", finished: "2026-09-21T23:00:00Z", stopped: "time_budget", remaining: 5, unit: "stocks" });
    expect((await freshness("2026-09-22T00:00:00Z")).stale).toBe(false);
    await db.query("delete from public.ingestion_runs where details ->> 'fixture' = 'sprint-12-db'");
  });

  it("R3: 応答なしで後片付けされた実行は、後片付けの時刻ではなく最後に保存した時刻で数える（C4-10・C1-4）", async () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3_600_000).toISOString();
    const { rows } = await db.query(
      `insert into public.ingestion_runs (target, trigger, status, started_at, processed_count, last_progress_at, details)
       values ('daily_quotes', 'cron', 'running', $1, 120, $1, $2) returning id`,
      [threeDaysAgo, MARK],
    );
    const staleId = Number(rows[0].id);
    const { rows: started } = await db.query("select public.start_ingestion_run('stock_master', 'manual') as r");
    const newRun = Number(started[0].r.runId);
    await db.query("update public.ingestion_runs set details = $2 where id = $1", [newRun, MARK]);
    await db.query("select public.finish_ingestion_run($1, 'failed', 0, 'テスト', null)", [newRun]);

    const { rows: cleaned } = await db.query(
      "select status, stopped_reason, error_message, last_progress_at, finished_at from public.ingestion_runs where id = $1",
      [staleId],
    );
    expect(cleaned[0]).toMatchObject({
      status: "partial",
      stopped_reason: "stale",
      error_message: "応答が無くなったため中断されたものとみなしました（15 分以上）。保存済みの分は残っています。残りは次回の取り込みで処理します",
    });
    expect(new Date(cleaned[0].last_progress_at).toISOString()).toBe(threeDaysAgo);
    const f = await freshness(new Date().toISOString());
    expect(target(f, "daily_quotes").stale).toBe(true);
    expect(new Date(target(f, "daily_quotes").lastUpdatedAt!).toISOString()).toBe(threeDaysAgo);

    // last_progress_at の無い stale の行は数えない
    await db.query("update public.ingestion_runs set last_progress_at = null where id = $1", [staleId]);
    expect(target(await freshness(new Date().toISOString()), "daily_quotes").lastUpdatedAt).toBeNull();

    // 処理0件の応答なしの実行は failed・旧い文言のまま（R2）
    const { rows: zero } = await db.query(
      `insert into public.ingestion_runs (target, trigger, status, started_at, details) values ('financials', 'cron', 'running', now() - interval '16 minutes', $1) returning id`,
      [MARK],
    );
    const { rows: s2 } = await db.query("select public.start_ingestion_run('stock_master', 'manual') as r");
    await db.query("update public.ingestion_runs set details = $2 where id = $1", [Number(s2[0].r.runId), MARK]);
    await db.query("select public.finish_ingestion_run($1, 'failed', 0, 'テスト', null)", [Number(s2[0].r.runId)]);
    const { rows: zeroRow } = await db.query("select status, stopped_reason, error_message from public.ingestion_runs where id = $1", [zero[0].id]);
    expect(zeroRow[0]).toEqual({ status: "failed", stopped_reason: null, error_message: "15 分以上応答が無かったため、中断されたものとみなしました" });
    await db.query("delete from public.ingestion_runs where details ->> 'fixture' = 'sprint-12-db'");
  });

  it("未取得の残り: 最新の終了済みの実行の残り。failed で残りの無い実行は飛ばし、1つ前を見る", async () => {
    const now = "2026-09-25T12:00:00Z";
    await insertRun({ target: "financials", status: "partial", finished: "2026-09-25T10:00:00Z", stopped: "rate_limited", remaining: 20, unit: "disclosure_dates", processed: 5 });
    expect(target(await freshness(now), "financials")).toMatchObject({ remainingCount: 20, remainingUnit: "disclosure_dates" });
    await insertRun({ target: "financials", status: "failed", finished: "2026-09-25T11:00:00Z" });
    expect(target(await freshness(now), "financials")).toMatchObject({ remainingCount: 20, remainingUnit: "disclosure_dates" });
    await insertRun({ target: "financials", status: "succeeded", finished: "2026-09-25T11:30:00Z", remaining: 0, unit: "disclosure_dates" });
    expect(target(await freshness(now), "financials")).toMatchObject({ remainingCount: null, remainingUnit: null });
    await db.query("delete from public.ingestion_runs where details ->> 'fixture' = 'sprint-12-db'");
  });
});

describe("上場廃止（C6-4・C6-5 の DB 部分）", () => {
  it("株価の初出日の対象と EDINET の本文の対象に入らない。手動補正は残り、再上場で使われる", async () => {
    await insertStock("9N806");
    await db.query(
      `insert into public.edinet_documents (doc_id, sec_code, edinet_code, filer_name, doc_type_code, ordinance_code, form_code,
         period_start, period_end, submitted_at, doc_description, xbrl_available, list_date)
       values ('S12NDB06', '9N806', 'E12ND6', '整合テスト9N806株式会社', '120', '010', '030000', '2025-04-01', '2026-03-31',
         '2026-06-25 15:00+09', '有価証券報告書', true, '2026-06-25')`,
    );
    const pendingCodes = async () => (await db.query("select public.listing_dates_pending() as p")).rows[0].p.pending as string[];
    const edinetTargets = async () =>
      ((await db.query("select public.edinet_ingestion_state('2025-01-01', '2026-12-31') as s")).rows[0].s.targets as { docId: string }[]).map((t) => t.docId);
    expect(await pendingCodes()).toContain("9N806");
    expect(await edinetTargets()).toContain("S12NDB06");

    await db.query(
      `insert into public.ownership_overrides (user_id, code, verdict, memo) values ($1, '9N806', 'owner_company', '上場廃止の前の補正')`,
      [ownerId],
    );
    await db.query("update public.stocks set delisted_on = '2026-09-18' where code = '9N806'");
    expect(await pendingCodes()).not.toContain("9N806");
    expect(await edinetTargets()).not.toContain("S12NDB06");
    expect((await db.query("select count(*)::int as n from public.ownership_overrides where code = '9N806'")).rows[0].n).toBe(1);
    expect(await screenRow("9N806", { ...ALL, ownerOn: true })).toBeUndefined();

    await db.query("update public.stocks set delisted_on = null where code = '9N806'");
    const row = await screenRow("9N806", { ...ALL, ownerOn: true });
    expect(row).toMatchObject({ ownership: { result: "owner_company", override: { verdict: "owner_company" } } });
  });
});

describe("性能（C7。authenticated として測る。実測値を出力する）", () => {
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
  async function time(fn: () => Promise<unknown>): Promise<number> {
    const samples: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const started = performance.now();
      await fn();
      if (i > 0) samples.push(performance.now() - started);
    }
    return median(samples);
  }

  it("screen_stocks（既定の4条件・sort=owner）が、4,000 銘柄（うち上場廃止 200）で 100ms 以内（C7-1）", async () => {
    await db.query("delete from public.stocks where code like '9N8%'");
    await db.query(`
      insert into public.stocks (code, company_name, market_code, market_name, sector33_code, sector33_name, product_category, delisted_on)
      select 'N' || lpad(i::text, 4, '0'), '性能テスト' || i || '株式会社',
             (array['0111','0112','0113'])[1 + i % 3], (array['プライム','スタンダード','グロース'])[1 + i % 3],
             (array['3050','5250','7050','9050'])[1 + i % 4], (array['食料品','情報・通信業','銀行業','サービス業'])[1 + i % 4], '011',
             case when i % 20 = 0 then date '2026-09-18' end
        from generate_series(0, 3999) as i`);
    await db.query(`
      insert into public.stock_listing_dates (code, first_price_date, data_start_date)
      select 'N' || lpad(i::text, 4, '0'), date '2016-09-27' + (i * 7 % 3600), date '2016-09-26' from generate_series(0, 3999) as i`);
    await db.query(`
      insert into public.financial_statements (code, disclosure_no, disclosed_date, document_type, fiscal_year_start, fiscal_year_end, net_sales, operating_profit)
      select 'N' || lpad(i::text, 4, '0'), 'NF' || i || '-' || y, make_date(y, 5, 14), 'FYFinancialStatements_Consolidated_JP',
             make_date(y - 1, 4, 1), make_date(y, 3, 31),
             1000000000::numeric * power(1 + (i % 40) / 100.0, y - 2021)::numeric, 1000000000::numeric * (i % 30) / 100
        from generate_series(0, 3999) as i, generate_series(2021, 2025) as y`);
    await db.query("analyze public.stocks, public.stock_listing_dates, public.financial_metrics, public.ownership_judgments");
    const params = JSON.stringify({ cagr: "20", margin: "10", years: "5", owner: "20", ownerMode: "any", sort: "owner", order: "desc", pageSize: 100 });
    const ms = await time(() => asUser(other, () => other.query("select public.screen_stocks($1::jsonb)", [params])));
    const { rows } = await asUser(other, () => other.query("select public.screen_stocks($1::jsonb) as r", [JSON.stringify({ ...ALL, pageSize: 100 })]));
    expect(rows[0].r).toMatchObject({ stockCount: 3800, delistedCount: 200 });
    console.info(`[perf] screen_stocks（4,000 銘柄・上場廃止 200・sort=owner）: 中央値 ${ms.toFixed(1)}ms`);
    expect(ms, `screen_stocks の中央値 ${ms.toFixed(1)}ms`).toBeLessThan(100);
  }, 120_000);

  it("data_freshness() が実行履歴 5,000 行で 20ms 以内（C7-2）。失敗 1,000 行の実行の詳細の読み出しが 100ms 以内（C7-3）", async () => {
    await db.query(
      `insert into public.ingestion_runs (target, trigger, status, started_at, finished_at, processed_count, details)
       select (array['stock_master','daily_quotes','financials','edinet_reports'])[1 + g % 4], 'cron',
              (array['succeeded','partial','failed'])[1 + g % 3], now() - (g || ' hours')::interval - interval '3 minutes',
              now() - (g || ' hours')::interval, 1, $1
         from generate_series(1, 5000) g`,
      [MARK],
    );
    const fresh = await time(() => asUser(other, () => other.query("select public.data_freshness()")));
    console.info(`[perf] data_freshness（実行履歴 5,000 行）: 中央値 ${fresh.toFixed(1)}ms`);
    expect(fresh, `data_freshness の中央値 ${fresh.toFixed(1)}ms`).toBeLessThan(20);

    const run = await startRun("daily_quotes");
    await db.query(
      `select public.finish_ingestion_run($1, 'partial', 10, 'テスト', null, $2::jsonb)`,
      [
        run,
        JSON.stringify({
          stoppedReason: null,
          remainingCount: 0,
          remainingUnit: "stocks",
          failedCount: 1_200,
          failures: Array.from({ length: 1_200 }, (_, i) => ({ itemType: "stock", itemKey: `N${String(i % 4000).padStart(4, "0")}-${i}`, code: `N${String(i % 4000).padStart(4, "0")}`, reason: "http_error", httpStatus: 500, networkError: null })),
        }),
      ],
    );
    expect((await db.query("select count(*)::int as n from public.ingestion_run_failures where run_id = $1", [run])).rows[0].n).toBe(1_000);
    const detailMs = await time(() =>
      asUser(other, async () => {
        await other.query("select * from public.ingestion_runs where id = $1", [run]);
        const { rows } = await other.query("select code from public.ingestion_run_failures where run_id = $1 order by id limit 1000", [run]);
        await other.query("select code, company_name from public.stocks where code = any($1)", [[...new Set(rows.map((r) => r.code))]]);
      }),
    );
    console.info(`[perf] 実行の詳細（失敗 1,000 行）: 中央値 ${detailMs.toFixed(1)}ms`);
    expect(detailMs, `実行の詳細の中央値 ${detailMs.toFixed(1)}ms`).toBeLessThan(100);
  }, 120_000);
});
