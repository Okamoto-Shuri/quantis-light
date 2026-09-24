import { expect, test, type Page } from "@playwright/test";

import { collectPageProblems, CRON_SECRET, loginAsOwner, simulateServerClockBehind, sql } from "./support";

/**
 * 財務データと指標の算出（F5、Sprint 5）。
 * 前提: 市場データ・取得済みの開示日・実行履歴が0件の DB。J-Quants の API キーが未設定のサーバー（キーがあるサーバーでは、
 * キー未設定を前提にしたテストをスキップする）。投入する銘柄コードは 9999x で、各テストの後に削除する。
 */
test.describe.configure({ mode: "serial" });

const PORT = Number(process.env.E2E_PORT ?? 3000);
const KEY_MISSING = "J-Quants の API キーが設定されていません";

/** 契約の第6章の投入例（99991〜99998）。 */
const EXAMPLE_SQL = "insert into public.stocks (code, company_name, market_code, market_name, sector33_code, sector33_name, product_category)\nvalues ('99991', '検証用成長株式会社',     '0113', 'グロース',     '5250', '情報・通信業', '011'),\n       ('99992', '検証用四期株式会社',     '0112', 'スタンダード', '3050', '食料品',       '011'),\n       ('99993', '検証用売上ゼロ株式会社', '0113', 'グロース',     '5250', '情報・通信業', '011'),\n       ('99994', '検証用決算期変更株式会社', '0111', 'プライム',   '3050', '食料品',       '011'),\n       ('99995', '検証用IFRS株式会社',     '0111', 'プライム',     '5250', '情報・通信業', '011'),\n       ('99996', '検証用六期株式会社',     '0112', 'スタンダード', '3050', '食料品',       '011'),\n       ('99997', '検証用欠期株式会社',     '0112', 'スタンダード', '3050', '食料品',       '011'),\n       ('99998', '検証用未取込株式会社',   '0113', 'グロース',     '5250', '情報・通信業', '011');\n\ninsert into public.financial_statements\n  (code, disclosure_no, disclosed_date, disclosed_time, document_type,\n   fiscal_year_start, fiscal_year_end, net_sales, operating_profit)\nselect code, no, disc::date, '15:00:00', doc, st::date, en::date,\n       sales * 100000000, op * 100000000        -- 億円 → 円（op が NULL なら NULL）\nfrom (values\n  -- 99991: 売上 100 → 150 → 200 → 300 → 400。CAGR 41.4%、営業利益率 15.0%\n  ('99991','T9999121','2021-05-14','FYFinancialStatements_Consolidated_JP','2020-04-01','2021-03-31',100::numeric, 10::numeric),\n  ('99991','T9999122','2022-05-13','FYFinancialStatements_Consolidated_JP','2021-04-01','2022-03-31',150, 15),\n  ('99991','T9999123','2023-05-12','FYFinancialStatements_Consolidated_JP','2022-04-01','2023-03-31',200, 20),\n  ('99991','T9999124','2024-05-14','FYFinancialStatements_Consolidated_JP','2023-04-01','2024-03-31',300, 40),\n  ('99991','T9999125','2025-05-14','FYFinancialStatements_Consolidated_JP','2024-04-01','2025-03-31',400, 60),\n  -- 99992: 4期だけ。直近は売上 1,000、営業利益 120。CAGR 算出不可（5期未満）、営業利益率 12.0%\n  ('99992','T9999222','2022-05-13','FYFinancialStatements_NonConsolidated_JP','2021-04-01','2022-03-31', 700,  70),\n  ('99992','T9999223','2023-05-12','FYFinancialStatements_NonConsolidated_JP','2022-04-01','2023-03-31', 800,  90),\n  ('99992','T9999224','2024-05-14','FYFinancialStatements_NonConsolidated_JP','2023-04-01','2024-03-31', 900, 100),\n  ('99992','T9999225','2025-05-14','FYFinancialStatements_NonConsolidated_JP','2024-04-01','2025-03-31',1000, 120),\n  -- 99993: FY-4 の売上が 0。CAGR 算出不可（FY-4 の売上高が0以下）、営業利益率 10.0%\n  ('99993','T9999321','2021-05-14','FYFinancialStatements_Consolidated_JP','2020-04-01','2021-03-31',   0,  -5),\n  ('99993','T9999322','2022-05-13','FYFinancialStatements_Consolidated_JP','2021-04-01','2022-03-31',  50,   1),\n  ('99993','T9999323','2023-05-12','FYFinancialStatements_Consolidated_JP','2022-04-01','2023-03-31',  80,   5),\n  ('99993','T9999324','2024-05-14','FYFinancialStatements_Consolidated_JP','2023-04-01','2024-03-31', 100,   8),\n  ('99993','T9999325','2025-05-14','FYFinancialStatements_Consolidated_JP','2024-04-01','2025-03-31', 120,  12),\n  -- 99994: 3月決算から12月決算へ変更（2022-04-01〜2022-12-31 の9か月）。CAGR 算出不可（変則決算）、営業利益率 10.0%\n  ('99994','T9999421','2021-05-14','FYFinancialStatements_Consolidated_JP','2020-04-01','2021-03-31', 100,  10),\n  ('99994','T9999422','2022-05-13','FYFinancialStatements_Consolidated_JP','2021-04-01','2022-03-31', 110,  11),\n  ('99994','T9999423','2023-02-14','FYFinancialStatements_Consolidated_JP','2022-04-01','2022-12-31',  90,   9),\n  ('99994','T9999424','2024-02-14','FYFinancialStatements_Consolidated_JP','2023-01-01','2023-12-31', 130,  13),\n  ('99994','T9999425','2025-02-14','FYFinancialStatements_Consolidated_JP','2024-01-01','2024-12-31', 150,  15),\n  ('99994','T9999426','2026-02-13','FYFinancialStatements_Consolidated_JP','2025-01-01','2025-12-31', 160,  16),\n  -- 99995: IFRS で営業利益の開示なし。売上 100 → 207.36（×1.2^4）。CAGR 20.0%（ちょうど）、営業利益率 算出不可\n  ('99995','T9999521','2021-05-14','FYFinancialStatements_Consolidated_IFRS','2020-04-01','2021-03-31',100,    null),\n  ('99995','T9999522','2022-05-13','FYFinancialStatements_Consolidated_IFRS','2021-04-01','2022-03-31',120,    null),\n  ('99995','T9999523','2023-05-12','FYFinancialStatements_Consolidated_IFRS','2022-04-01','2023-03-31',144,    null),\n  ('99995','T9999524','2024-05-14','FYFinancialStatements_Consolidated_IFRS','2023-04-01','2024-03-31',172.8,  null),\n  ('99995','T9999525','2025-05-14','FYFinancialStatements_Consolidated_IFRS','2024-04-01','2025-03-31',207.36, null),\n  -- 99996: 6期（FY-5 は 50）。FY0 は訂正あり（先の開示 140 → 訂正後 146.41）。CAGR 10.0%、営業利益率 10.0%\n  ('99996','T9999620','2020-05-15','FYFinancialStatements_Consolidated_JP','2019-04-01','2020-03-31',  50,   5),\n  ('99996','T9999621','2021-05-14','FYFinancialStatements_Consolidated_JP','2020-04-01','2021-03-31', 100,  10),\n  ('99996','T9999622','2022-05-13','FYFinancialStatements_Consolidated_JP','2021-04-01','2022-03-31', 110,  11),\n  ('99996','T9999623','2023-05-12','FYFinancialStatements_Consolidated_JP','2022-04-01','2023-03-31', 121,  12.1),\n  ('99996','T9999624','2024-05-14','FYFinancialStatements_Consolidated_JP','2023-04-01','2024-03-31', 133.1, 13.31),\n  ('99996','T9999625','2025-05-14','FYFinancialStatements_Consolidated_JP','2024-04-01','2025-03-31', 140,  20),\n  ('99996','T9999626','2025-05-20','FYFinancialStatements_Consolidated_JP','2024-04-01','2025-03-31', 146.41, 14.641),\n  -- 99997: 2023/03期が欠けている。CAGR 算出不可（連続していない）、営業利益率 8.0%\n  ('99997','T9999720','2020-05-15','FYFinancialStatements_Consolidated_JP','2019-04-01','2020-03-31',  60,   5),\n  ('99997','T9999721','2021-05-14','FYFinancialStatements_Consolidated_JP','2020-04-01','2021-03-31',  70,   5),\n  ('99997','T9999722','2022-05-13','FYFinancialStatements_Consolidated_JP','2021-04-01','2022-03-31',  80,   6),\n  ('99997','T9999724','2024-05-14','FYFinancialStatements_Consolidated_JP','2023-04-01','2024-03-31',  90,   7),\n  ('99997','T9999725','2025-05-14','FYFinancialStatements_Consolidated_JP','2024-04-01','2025-03-31', 100,   8)\n) as v(code, no, disc, doc, st, en, sales, op);\n-- 99998 は通期実績を入れない（財務データ未取り込み）";

async function insertExample() {
  await sql(EXAMPLE_SQL);
}

async function jquantsConfigured(page: Page): Promise<boolean> {
  const res = await page.request.get("/api/ingestion");
  const body = (await res.json()) as { data: { sources: { id: string; configured: boolean }[] } };
  return body.data.sources.find((source) => source.id === "jquants")?.configured === true;
}

async function lookup(page: Page, code: string) {
  const section = page.getByTestId("code-lookup");
  await section.getByRole("textbox", { name: "銘柄コード" }).fill(code);
  await section.getByRole("button", { name: "確認" }).click();
}

const manualButton = (page: Page) => page.getByRole("button", { name: /今すぐ取り込み|実行中/ });

test.beforeAll(async () => {
  const { rows } = await sql(
    `select (select count(*) from public.stocks)::int as stocks, (select count(*) from public.ingestion_runs)::int as runs,
            (select count(*) from public.financial_fetched_dates)::int as dates`,
  );
  expect(rows[0], "E2E の前提: 市場データ・実行履歴・取得済みの開示日が0件").toEqual({ stocks: 0, runs: 0, dates: 0 });
});

test.afterEach(async () => {
  await sql("delete from public.stocks where code like '9999%'");
  await sql("delete from public.financial_fetched_dates");
  await sql("delete from public.ingestion_runs");
});

test.describe("指標の表示（AC5.1〜AC5.4、C1・C2）", () => {
  test("99991: 41.4%、期間、15.0%、通期実績の表。URL は正規化したコード", async ({ page }) => {
    const problems = collectPageProblems(page);
    await insertExample();
    await loginAsOwner(page);
    await page.goto("/imports");
    await lookup(page, " 99991 ");
    await expect(page).toHaveURL("/imports?code=99991");

    const card = page.getByTestId("financial-card");
    await expect(card.getByTestId("financial-cagr")).toContainText("41.4%");
    await expect(card.getByTestId("financial-cagr-period")).toHaveText("2021/03期 → 2025/03期（4年）");
    await expect(card.getByTestId("financial-margin")).toContainText("15.0%");
    await expect(card.getByTestId("financial-margin")).toContainText("2025/03期");
    const rows = card.getByTestId("financial-periods-table").locator("tbody tr");
    await expect(rows).toHaveCount(5);
    const texts = await rows.allInnerTexts();
    expect(texts.map((text) => text.split(/\s+/)[0])).toEqual(["FY-4", "FY-3", "FY-2", "FY-1", "FY0"]);
    for (const [i, sales] of ["10,000", "15,000", "20,000", "30,000", "40,000"].entries()) {
      expect(texts[i]).toContain(sales);
      expect(texts[i]).toContain("連結・日本基準");
      expect(texts[i]).toContain("決算短信");
    }
    await expect(page.getByTestId("listing-lookup-card")).toBeVisible();
    expect(problems).toEqual([]);
  });

  test("算出不可の理由（99992〜99995・99997）、未取り込み（99998）、訂正あり（99996）。時計のずれがあっても pageerror は0件", async ({
    page,
    context,
  }) => {
    await simulateServerClockBehind(context);
    const problems = collectPageProblems(page);
    await insertExample();
    await loginAsOwner(page);
    await page.goto("/imports");
    const cagr = page.getByTestId("financial-cagr");
    const margin = page.getByTestId("financial-margin");

    await lookup(page, "99992");
    await expect(cagr).toContainText("算出不可（通期実績が5期未満）");
    await expect(cagr).toContainText("取得済みの通期実績: 4 期");
    await expect(margin).toContainText("12.0%");
    await expect(page.getByTestId("financial-periods-table")).toContainText("単体・日本基準");

    await lookup(page, "99993");
    await expect(cagr).toContainText("算出不可（FY-4 の売上高が0以下）");
    await expect(margin).toContainText("10.0%");

    await lookup(page, "99994");
    await expect(cagr).toContainText("算出不可（直近5期に変則決算を含む）");
    await expect(page.locator("tr[data-fiscal-year-end='2022-12-31']")).toContainText("変則決算（9か月）");
    await expect(margin).toContainText("2025/12期");

    await lookup(page, "99995");
    await expect(cagr).toContainText("20.0%");
    await expect(margin).toContainText("算出不可（営業利益の開示なし）");

    await lookup(page, "99996");
    await expect(cagr).toContainText("10.0%");
    await expect(page.locator("tr[data-fiscal-year-end='2025-03-31']")).toContainText("14,641");
    await expect(page.locator("tr[data-fiscal-year-end='2025-03-31']")).toContainText("訂正あり（2件）");

    await lookup(page, "99997");
    await expect(cagr).toContainText("算出不可（直近5期の通期実績が連続していない）");
    await expect(margin).toContainText("8.0%");

    await lookup(page, "99998");
    await expect(page.getByTestId("financial-empty")).toHaveText("財務データがありません（未取り込み）");

    await lookup(page, "12340");
    await expect(page.getByTestId("listing-lookup-message")).toHaveText("銘柄コード 12340 は銘柄マスタにありません");
    await lookup(page, "8697");
    await expect(page).toHaveURL("/imports?code=86970");
    expect(problems).toEqual([]);
  });

  test("表示は切り捨て（207.35 億円なら 19.9%、営業利益 −1.23 億円なら -1.1%）", async ({ page }) => {
    await insertExample();
    await loginAsOwner(page);
    await sql("update public.financial_statements set net_sales = 20735000000 where disclosure_no = 'T9999525'");
    await page.goto("/imports?code=99995");
    await expect(page.getByTestId("financial-cagr")).toContainText("19.9%");
    await sql("update public.financial_statements set operating_profit = -123000000 where disclosure_no = 'T9999325'");
    await page.goto("/imports?code=99993");
    await expect(page.getByTestId("financial-margin")).toContainText("-1.1%");
  });

  test("区画の要約と算出不可の内訳、空状態", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/imports");
    const panel = page.getByTestId("financial-metrics");
    await expect(panel.getByTestId("financial-empty-state")).toContainText("財務データはまだ取り込まれていません");
    await expect(panel.getByTestId("financial-with-statements")).toContainText("0 銘柄");
    await expect(panel.getByTestId("financial-fetched-dates")).toContainText("—財務の取り込み実績がありません");

    await insertExample();
    await page.reload();
    await expect(panel.getByTestId("financial-with-statements")).toContainText("7 銘柄");
    await expect(panel.getByTestId("financial-with-statements")).toContainText("銘柄マスタ 8 銘柄のうち");
    await expect(panel.getByTestId("financial-cagr-count")).toContainText("3 銘柄");
    await expect(panel.getByTestId("financial-margin-count")).toContainText("6 銘柄");
    await expect(panel.getByTestId("financial-latest-disclosure")).toContainText("2026-02-13");
    const reasons = panel.getByTestId("financial-reasons-table");
    await expect(reasons.locator("tr[data-reason='insufficient_periods']")).toContainText("1");
    await expect(reasons.locator("tr[data-reason='operating_profit_not_disclosed']")).toContainText("1");
    await expect(panel.getByTestId("financial-empty-state")).toHaveCount(0);

    // 最後の財務の実行が取得途中なら、注意を出す
    await sql(
      `insert into public.ingestion_runs (target, trigger, status, started_at, finished_at, processed_count, details)
       values ('financials', 'manual', 'partial', now() - interval '5 minutes', now(), 10,
               '{"windowStart":"2020-09-24","windowEnd":"2026-09-24","datesInWindow":1467,"datesRemaining":1280}')`,
    );
    await page.reload();
    await expect(panel.getByTestId("financial-fetched-dates")).toContainText("187 / 1,467");
    await expect(panel.getByTestId("financial-fetch-incomplete")).toContainText("取り込み途中の銘柄が含まれます");

    // カードでは「通期実績が5期未満」の銘柄だけに出す（Sprint 5 評価の改善提案。Sprint 6 の C13-4）
    await page.goto("/imports?code=99991");
    await expect(page.getByTestId("financial-card").getByTestId("financial-cagr")).toContainText("41.4%");
    await expect(page.getByTestId("financial-card").getByTestId("financial-fetch-incomplete")).toHaveCount(0);
    await page.goto("/imports?code=99992");
    await expect(page.getByTestId("financial-card").getByTestId("financial-fetch-incomplete")).toContainText("取り込み途中の銘柄が含まれます");
  });
});

test.describe("API（C6）", () => {
  test("GET /api/stocks に指標、GET /api/financials に指標と通期実績", async ({ page, request }) => {
    await insertExample();
    expect((await request.get("/api/financials?code=99991")).status()).toBe(401);
    expect((await request.get("/api/stocks")).status()).toBe(401);

    await loginAsOwner(page);
    const stocks = await (await page.request.get("/api/stocks")).json();
    const byCode = Object.fromEntries(stocks.data.map((row: { code: string }) => [row.code, row]));
    expect(byCode["99991"]).toMatchObject({
      revenue_cagr: 0.4142135624,
      revenue_cagr_display_pct: 41.4,
      revenue_cagr_unavailable_reason: null,
      revenue_cagr_mixed_basis: false,
      operating_margin: 0.15,
      operating_margin_display_pct: 15,
      latest_fiscal_year_end: "2025-03-31",
    });
    expect(byCode["99992"]).toMatchObject({ revenue_cagr: null, revenue_cagr_unavailable_reason: "insufficient_periods", operating_margin_display_pct: 12 });
    expect(byCode["99998"]).toMatchObject({ revenue_cagr: null, operating_margin: null, latest_fiscal_year_end: null });

    const res = await page.request.get("/api/financials?code=99991");
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toContain("no-store");
    const body = await res.json();
    expect(body.data.code).toBe("99991");
    expect(body.data.metrics).toMatchObject({ revenue_cagr: 0.4142135624, revenue_cagr_display_pct: 41.4 });
    expect(body.data.periods).toHaveLength(5);
    expect(body.data.periods[0]).toMatchObject({
      fiscal_year_start: "2020-04-01",
      fiscal_year_end: "2021-03-31",
      period_days: 365,
      is_irregular: false,
      net_sales: 10000000000,
      consolidated: true,
      accounting_standard: "JP",
      source: "tdnet_summary",
      disclosed_date: "2021-05-14",
      disclosure_count: 1,
    });
    expect((await (await page.request.get("/api/financials?code=99998")).json()).data).toEqual({ code: "99998", metrics: null, periods: [] });
    const missing = await page.request.get("/api/financials?code=12340");
    expect(missing.status()).toBe(404);
    expect(await missing.json()).toEqual({ error: "not_found" });
    for (const query of ["?code=abc", ""]) {
      const bad = await page.request.get(`/api/financials${query}`);
      expect(bad.status(), query).toBe(400);
      expect(await bad.json()).toEqual({ error: "invalid_code" });
    }
  });
});

test.describe("財務の手動取り込み（キー未設定、C7）", () => {
  test("対象「財務（決算短信）」を選んで押すと失敗が記録される", async ({ page }) => {
    const problems = collectPageProblems(page);
    await loginAsOwner(page);
    test.skip(await jquantsConfigured(page), "サーバーの J-Quants のキーが設定済み");
    await page.goto("/imports");
    const master = page.getByRole("radio", { name: /^銘柄マスタ/ });
    const financials = page.getByRole("radio", { name: /^財務（決算短信）/ });
    await expect(master).toBeChecked();
    await manualButton(page).focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(financials).toBeChecked();

    await manualButton(page).click();
    await expect(page.getByTestId("ingestion-result")).toHaveText(`失敗: ${KEY_MISSING}`);
    const { rows } = await sql("select target, trigger, status, processed_count, error_message from public.ingestion_runs");
    expect(rows).toEqual([{ target: "financials", trigger: "manual", status: "failed", processed_count: 0, error_message: KEY_MISSING }]);
    await page.reload();
    const first = page.getByTestId("run-table").locator("tbody tr").first();
    await expect(first).toContainText("財務");
    await expect(first).toContainText(KEY_MISSING);
    expect(problems).toEqual([]);
  });

  test("API で target financials は 202", async ({ page }) => {
    await loginAsOwner(page);
    const res = await page.request.post("/api/ingestion/runs", { headers: { origin: `http://localhost:${PORT}` }, data: { target: "financials" } });
    expect(res.status()).toBe(202);
    await expect.poll(async () => (await sql("select status from public.ingestion_runs")).rows[0]?.status).not.toBe("running");
  });

  test("実行中は3つの対象を変えられない", async ({ page }) => {
    await sql("insert into public.ingestion_runs (target, trigger, status) values ('financials', 'cron', 'running')");
    await loginAsOwner(page);
    await page.goto("/imports");
    await expect(page.getByTestId("active-run")).toContainText("実行中: 財務");
    await expect(page.getByRole("radio", { name: /^財務（決算短信）/ })).toBeDisabled();
  });
});

test.describe("定期実行（財務、C9）", () => {
  test("正しいシークレットで財務の実行が1つ記録される。実行中なら 409。認証と HEAD", async ({ page, request }) => {
    await loginAsOwner(page);
    const configured = await jquantsConfigured(page);
    const res = await request.get("/api/cron/financials", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    test.skip(res.status() === 401, "サーバーの CRON_SECRET が E2E_CRON_SECRET と異なる");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.runs).toHaveLength(1);
    expect(body.data.runs[0]).toMatchObject({ target: "financials" });
    const { rows } = await sql("select target, trigger, status, error_message from public.ingestion_runs");
    expect(rows).toHaveLength(1);
    if (!configured) expect(rows[0]).toEqual({ target: "financials", trigger: "cron", status: "failed", error_message: KEY_MISSING });

    await sql("insert into public.ingestion_runs (target, trigger, status) values ('stock_master', 'manual', 'running')");
    const busy = await request.get("/api/cron/financials", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(busy.status()).toBe(409);
    await sql("delete from public.ingestion_runs");

    for (const headers of [{}, { authorization: "Bearer wrong" }, { authorization: CRON_SECRET }] as Record<string, string>[]) {
      expect((await request.get("/api/cron/financials", { headers })).status(), JSON.stringify(headers)).toBe(401);
    }
    expect((await request.get(`/api/cron/financials?secret=${CRON_SECRET}`)).status()).toBe(401);
    expect((await request.post("/api/cron/financials", { headers: { authorization: `Bearer ${CRON_SECRET}` } })).status()).toBe(405);
    for (const headers of [{ authorization: `Bearer ${CRON_SECRET}` }, {}] as Record<string, string>[]) {
      const head = await request.head("/api/cron/financials", { headers });
      expect(head.status()).toBe(405);
      expect(head.headers()["allow"]).toBe("GET");
    }
    expect((await sql("select count(*)::int as n from public.ingestion_runs")).rows[0].n).toBe(0);
  });
});

test.describe("ダッシュボードへの反映（C10）", () => {
  test("投入例で「財務指標を算出できた銘柄数」は 7（売上CAGR 3、営業利益率 6）。99991 を消すと 6（2）", async ({ page }) => {
    await insertExample();
    await loginAsOwner(page);
    await page.goto("/");
    const tile = page.getByTestId("stat-financial");
    const breakdown = (label: string) => tile.locator("dl > div").filter({ hasText: label }).locator("dd");
    await expect(tile.locator("p")).toContainText("7 / 8 銘柄");
    await expect(breakdown("売上CAGR")).toHaveText("3");
    await expect(breakdown("営業利益率")).toHaveText("6");
    await sql("delete from public.financial_statements where code = '99991'");
    await page.reload();
    await expect(tile.locator("p")).toContainText("6 / 8 銘柄");
    await expect(breakdown("売上CAGR")).toHaveText("2");
  });
});
