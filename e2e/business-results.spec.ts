import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { collectPageProblems, loginAsOwner, OWNER, simulateServerClockBehind, sql, expectNoPresets, expectNoSnapshotsOrWatchlist } from "./support";

/**
 * 上場前の期の補完（F15、Sprint 9）。契約の第5章の投入例（business-results-example.sql）を使う。
 * 前提: 市場データ・EDINET の書類・実行履歴が0件の DB。EDINET のキーが未設定のサーバー（設定済みならキー未設定前提のテストはスキップ）。
 * 投入するコードは 9V001〜9V010、書類IDは S9TEST…、提出者は E99V…。各テストの後に削除する。
 */
test.describe.configure({ mode: "serial" });

const EXAMPLE_SQL = readFileSync(join(__dirname, "fixtures/business-results-example.sql"), "utf8");
const ADD_SQL = readFileSync(join(__dirname, "fixtures/business-results-add.sql"), "utf8");
const CLEANUP_SQL = readFileSync(join(__dirname, "fixtures/business-results-cleanup.sql"), "utf8");
const ANNUAL_EXAMPLE_SQL = readFileSync(join(__dirname, "fixtures/annual-report-example.sql"), "utf8");
const ANNUAL_CLEANUP_SQL = readFileSync(join(__dirname, "fixtures/annual-report-cleanup.sql"), "utf8");
const NOTE = "上場前の期は EDINET の有価証券届出書・有価証券報告書から補っています。書類から値を取れない銘柄は算出不可になることがあります。";
const OLD_NOTE = "上場前の期のデータがまだ無い";

const row = (page: Page, end: string) => page.getByTestId("five-period-table").locator(`tr[data-fiscal-year-end='${end}']`);
const resultRow = (page: Page, code: string) => page.getByTestId("results-scroll").locator(`tbody tr[data-code='${code}']`);

test.beforeAll(async () => {
  await expectNoPresets(); // Sprint 13（契約の C10-4）
  await expectNoSnapshotsOrWatchlist(); // Sprint 14（契約の C11-1 の種類5）
  const { rows } = await sql(
    `select (select count(*) from public.stocks)::int as stocks, (select count(*) from public.ingestion_runs)::int as runs,
            (select count(*) from public.edinet_documents)::int as docs`,
  );
  expect(rows[0], "E2E の前提: 市場データ・EDINET の書類・実行履歴が0件").toEqual({ stocks: 0, runs: 0, docs: 0 });
});

test.beforeEach(async () => {
  await sql(EXAMPLE_SQL);
});

test.afterEach(async () => {
  await sql(CLEANUP_SQL);
  await sql(ANNUAL_CLEANUP_SQL);
  await sql("delete from public.ingestion_runs");
  await sql("insert into private.allowed_emails (email) values ($1) on conflict do nothing", [OWNER.email]);
});

test.describe("出典の優先順位と5期の表（C1。AC15.1・AC15.2）", () => {
  test("9V001: 届出書・有報・決算短信の順に選ばれ、出典・書類ID・提出日・EDINET へのリンクが出る。使わない値は出ない", async ({ page }) => {
    const problems = collectPageProblems(page);
    await loginAsOwner(page);
    await page.goto("/stocks/9V001");
    const expected: [string, string, string, string, string | null, string | null][] = [
      ["2021-03-31", "10,000", "edinet_registration_statement", "有価証券届出書", "S9TEST12", "2023-02-20"],
      ["2022-03-31", "15,000", "edinet_annual_report", "有価証券報告書", "S9TEST11", "2024-06-26"],
      ["2023-03-31", "20,000", "edinet_annual_report", "有価証券報告書", "S9TEST11", "2024-06-26"],
      ["2024-03-31", "30,000", "tdnet_summary", "決算短信", null, null],
      ["2025-03-31", "40,000", "tdnet_summary", "決算短信", null, null],
    ];
    const { rows: dbPeriods } = await sql("select fiscal_year_end::text as e, net_sales::text as s from public.financial_periods where code = '9V001'");
    for (const [end, sales, source, label, doc, submitted] of expected) {
      const r = row(page, end);
      await expect(r.getByTestId("cell-net-sales")).toHaveText(sales);
      await expect(r.getByTestId("cell-net-sales")).toHaveAttribute("data-yen", dbPeriods.find((p) => p.e === end)!.s.replace(/\.0+$/, ""));
      await expect(r.getByTestId("cell-source")).toHaveAttribute("data-source", source);
      await expect(r.getByTestId("cell-source")).toHaveText(label);
      const link = r.getByTestId("period-edinet-link");
      if (doc) {
        await expect(r.getByTestId("cell-document")).toHaveAttribute("data-doc-id", doc);
        await expect(r.getByTestId("cell-document")).toContainText(`${submitted} 提出`);
        await expect(link).toHaveAttribute("href", `https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx?${doc},,`);
        await expect(link).toHaveAttribute("target", "_blank");
        await expect(link).toHaveAttribute("rel", /noopener/);
      } else {
        await expect(link).toHaveCount(0);
      }
    }
    // 営業利益: 有報の期は「記載なし」、届出書の 2021/03 は 800
    for (const end of ["2022-03-31", "2023-03-31"]) {
      const cell = row(page, end).getByTestId("cell-operating-profit");
      await expect(cell).toHaveText("記載なし");
      await expect(cell).toHaveAttribute("data-kind", "not-stated");
      await expect(cell).toHaveAttribute("title", /主要な経営指標等の推移/);
    }
    await expect(row(page, "2021-03-31").getByTestId("cell-operating-profit")).toHaveText("800");
    // 使われない値（有報の 2024/03 の 310、届出書の 2022/03 の 140、取り下げた訂正届出書の 999）
    const main = page.locator("main");
    for (const text of ["31,000", "14,000", "99,900", "S9TEST13"]) await expect(main).not.toContainText(text);
    // 指標
    await expect(page.getByTestId("metric-cagr").getByTestId("metric-value")).toHaveText("41.4%");
    await expect(page.getByTestId("metric-cagr-period")).toContainText("2021/03期 → 2025/03期（4年）");
    await expect(page.getByTestId("metric-cagr-supplement")).toContainText("2021/03期（有価証券届出書）、2022/03期・2023/03期（有価証券報告書）");
    await expect(page.getByTestId("metric-margin").getByTestId("metric-value")).toHaveText("12.0%");
    await expect(page.getByTestId("cagr-supplement-note")).toHaveCount(0);
    // グラフのツールチップの出典
    await page.getByTestId("chart-slot").first().getByTestId("chart-bar").first().hover();
    await expect(page.getByTestId("chart-slot").first().getByTestId("chart-tooltip-source").first()).toContainText("出典: 有価証券届出書 S9TEST12");
    expect(problems).toEqual([]);
  });

  test("9V006（決算短信だけ）: すべての期が「決算短信」で、EDINET のリンク・補完の表示が無い", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/stocks/9V006");
    await expect(page.getByTestId("five-period-table").getByTestId("cell-source")).toHaveText(Array(5).fill("決算短信"));
    await expect(page.getByTestId("period-edinet-link")).toHaveCount(0);
    await expect(page.getByTestId("metric-cagr-supplement")).toHaveCount(0);
  });

  test("API と、取り込み状況の「銘柄コードで確認」も同じ出典（C1-8・C1-9）", async ({ page }) => {
    await loginAsOwner(page);
    const body = await (await page.request.get("/api/stocks/9V001")).json();
    expect(body.data.periods.map((p: Record<string, unknown>) => [p.fiscal_year_end, p.source, p.source_document_id, p.source_document_type_code, p.edinet_url])).toEqual([
      ["2021-03-31", "edinet_registration_statement", "S9TEST12", "030", "https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx?S9TEST12,,"],
      ["2022-03-31", "edinet_annual_report", "S9TEST11", "120", "https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx?S9TEST11,,"],
      ["2023-03-31", "edinet_annual_report", "S9TEST11", "120", "https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx?S9TEST11,,"],
      ["2024-03-31", "tdnet_summary", "S9A1", null, null],
      ["2025-03-31", "tdnet_summary", "S9A2", null, null],
    ]);
    expect(body.data.metrics.revenue_cagr_supplemented).toBe(true);
    expect(body.data.metrics.revenue_cagr_period_sources).toHaveLength(5);
    const tdnetOnly = await (await page.request.get("/api/stocks/9V006")).json();
    expect(tdnetOnly.data.metrics.revenue_cagr_supplemented).toBe(false);
    expect(tdnetOnly.data.metrics.revenue_cagr_period_sources.every((s: { source: string }) => s.source === "tdnet_summary")).toBe(true);
    const financials = await (await page.request.get("/api/financials?code=9V001")).json();
    expect(financials.data.periods.map((p: { source: string }) => p.source)).toEqual(body.data.periods.map((p: { source: string }) => p.source));

    await page.goto("/imports?code=9V001");
    const card = page.getByTestId("financial-card");
    await expect(card.getByTestId("cell-source")).toHaveText(["有価証券届出書", "有価証券報告書", "有価証券報告書", "決算短信", "決算短信"]);
    await expect(card).not.toContainText("edinet_");
    await expect(card.getByTestId("financial-cagr-supplement")).toContainText("2021/03期（有価証券届出書）");
  });
});

test.describe("スクリーニングの「補完」の印と絞り込み（C2。AC15.3・AC15.4）", () => {
  test("印にマウスを乗せる・クリック・Enter で補った期を示し、詳細へ移らない。閾値 40 で出て 45 で出ない", async ({ page }) => {
    const problems = collectPageProblems(page);
    await loginAsOwner(page);
    await page.goto("/screening?cagr=40&margin=10&years=5&off=owner");
    await expect(resultRow(page, "9V001")).toBeVisible();
    await expect(resultRow(page, "9V007")).toBeVisible();
    const mark = resultRow(page, "9V001").getByTestId("cagr-supplement-mark");
    await expect(mark).toHaveText("補完");
    await expect(mark).toHaveAttribute("aria-label", "補完あり: EDINET から補った期を表示");

    await mark.hover();
    const detail = page.getByTestId("cagr-supplement-detail");
    await expect(detail).toBeVisible();
    await expect(detail.getByTestId("cagr-supplement-period")).toHaveText([
      "2021/03期 有価証券届出書 S9TEST12（2023-02-20 提出）",
      "2022/03期 有価証券報告書 S9TEST11（2024-06-26 提出）",
      "2023/03期 有価証券報告書 S9TEST11（2024-06-26 提出）",
    ]);
    await expect(detail).not.toContainText("決算短信 S9A");

    // クリックしても詳細へ移らない（行のクリックに伝わらない）。Esc で閉じる
    await mark.click();
    await expect(detail).toBeVisible();
    await page.waitForTimeout(1_500);
    await expect(page).toHaveURL(/\/screening\?/);
    await page.keyboard.press("Escape");
    await expect(detail).toBeHidden();
    // キーボード（Enter）でも開く
    await page.mouse.move(0, 0);
    await mark.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("cagr-supplement-detail")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/screening\?/);

    // 9V007 の説明に「連結・単体が混在」
    await page.mouse.move(0, 0);
    await resultRow(page, "9V007").getByTestId("cagr-supplement-mark").click();
    await expect(page.getByTestId("cagr-supplement-detail").getByTestId("cagr-supplement-mixed-consolidation")).toHaveText("連結・単体が混在");
    await page.keyboard.press("Escape");

    // 閾値 45 では出ない
    await page.goto("/screening?cagr=45&margin=10&years=5&off=owner");
    await expect(page.getByTestId("result-summary")).toBeVisible();
    await expect(resultRow(page, "9V001")).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test("決算短信だけの行・算出不可の行には印が無い。API も同じ（C2-6・C2-7）", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/screening?cagr=20&margin=10&years=5&off=owner");
    await expect(resultRow(page, "9V006")).toBeVisible();
    await expect(resultRow(page, "9V006").getByTestId("cagr-supplement-mark")).toHaveCount(0);
    await expect(resultRow(page, "9V005")).toHaveCount(0);
    await page.goto("/screening?cagr=20&margin=10&years=5&unavailable=include&off=owner");
    await expect(resultRow(page, "9V005").getByTestId("cell-cagr")).toHaveText("算出不可（通期実績が5期未満）");
    await expect(resultRow(page, "9V005").getByTestId("cagr-supplement-mark")).toHaveCount(0);

    const api = await (await page.request.get("/api/screening?cagr=40&margin=10&years=5&off=owner")).json();
    const v001 = api.data.rows.find((r: { code: string }) => r.code === "9V001");
    expect(v001.revenue_cagr_supplemented).toBe(true);
    expect(v001.revenue_cagr_supplement.map((s: { fiscal_year_end: string; document_id: string }) => `${s.fiscal_year_end}:${s.document_id}`)).toEqual([
      "2023-03-31:S9TEST11",
      "2022-03-31:S9TEST11",
      "2021-03-31:S9TEST12",
    ]);
    const api20 = await (await page.request.get("/api/screening?cagr=20&margin=10&years=5&off=owner")).json();
    const v006 = api20.data.rows.find((r: { code: string }) => r.code === "9V006");
    expect(v006).toMatchObject({ revenue_cagr_supplemented: false, revenue_cagr_supplement: [] });
  });

  test("375px: 印はセルに収まり、ポップオーバーは画面の外に切れない。ページ全体の横スクロールが無い（C2-8）", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await context.newPage();
    await loginAsOwner(page);
    await page.goto("/screening?cagr=40&margin=10&years=5&off=owner");
    const mark = resultRow(page, "9V001").getByTestId("cagr-supplement-mark");
    await mark.scrollIntoViewIfNeeded();
    await mark.click();
    const box = await page.getByTestId("cagr-supplement-detail").boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    const cell = await resultRow(page, "9V001").getByTestId("cell-cagr").boundingBox();
    const markBox = await mark.boundingBox();
    expect(markBox!.x + markBox!.width).toBeLessThanOrEqual(cell!.x + cell!.width + 0.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await context.close();
  });
});

test.describe("補完しても算出不可・連結と単体・訂正届出書（C3・C4・C5）", () => {
  test("9V002・9V003・9V004 は理由付きの算出不可。足りない期は「データなし」（AC15.5・AC15.6）", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/stocks/9V002");
    await expect(page.getByTestId("metric-cagr").getByTestId("metric-value")).toHaveText("算出不可（通期実績が5期未満）");
    await expect(page.getByTestId("five-period-table").locator("tr[data-slot='FY-4']")).toHaveAttribute("data-missing", "true");
    await expect(row(page, "2022-03-31").getByTestId("cell-source")).toHaveText("有価証券届出書");
    await expect(page.getByTestId("metric-cagr").getByTestId("cagr-supplement-note")).toHaveText(NOTE);

    await page.goto("/stocks/9V003");
    await expect(page.getByTestId("metric-cagr").getByTestId("metric-value")).toHaveText("算出不可（直近5期に変則決算を含む）");
    await expect(row(page, "2022-12-31").getByTestId("irregular-badge")).toHaveText("変則決算（9か月）");
    await expect(row(page, "2022-12-31").getByTestId("cell-source")).toHaveText("有価証券報告書");

    await page.goto("/stocks/9V004");
    await expect(page.getByTestId("metric-cagr").getByTestId("metric-value")).toHaveText("算出不可（直近5期の通期実績が連続していない）");
    await expect(page.getByTestId("five-period-table").locator("tr[data-slot='FY-2']")).toHaveAttribute("data-missing", "true");
  });

  test("9V005: 届出書の2期を足してリロードするだけで CAGR が出て、9V006 と一致する。ダッシュボードの売上CAGR の件数が1増える（AC15.7）", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/");
    const cagrCount = async () => Number((await page.getByTestId("stat-financial").textContent())!.match(/売上CAGR\s*([\d,]+)/)![1]);
    const before = await cagrCount();
    await page.goto("/stocks/9V005");
    await expect(page.getByTestId("metric-cagr").getByTestId("metric-value")).toHaveText("算出不可（通期実績が5期未満）");
    await sql(ADD_SQL);
    await page.reload();
    await expect(page.getByTestId("metric-cagr").getByTestId("metric-value")).toHaveText("25.7%");
    await expect(row(page, "2021-03-31").getByTestId("cell-source")).toHaveText("有価証券届出書");
    await page.goto("/stocks/9V006");
    await expect(page.getByTestId("metric-cagr").getByTestId("metric-value")).toHaveText("25.7%");
    const { rows } = await sql("select (select revenue_cagr from public.financial_metrics where code = '9V005') = (select revenue_cagr from public.financial_metrics where code = '9V006') as eq");
    expect(rows[0].eq).toBe(true);
    await page.goto("/");
    expect(await cagrCount()).toBe(before + 1);
    const summary = (await sql("select (public.dashboard_summary() -> 'financialMetrics' ->> 'revenueCagrCount')::int as n")).rows[0].n;
    expect(await cagrCount()).toBe(summary);
  });

  test("9V007: 連結と単体。9V009: IFRS の売上収益（AC15.8）", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/stocks/9V007");
    const basis = page.getByTestId("five-period-table").locator("tbody tr td:nth-child(6)");
    await expect(basis).toHaveText(["単体・日本基準", "単体・日本基準", "連結・日本基準", "連結・日本基準", "連結・日本基準"]);
    await expect(row(page, "2023-03-31").getByTestId("cell-net-sales")).toHaveText("25,000");
    await expect(page.locator("main")).not.toContainText("24,000");
    await expect(page.getByTestId("metric-cagr").getByTestId("metric-value")).toHaveText("41.4%");
    await expect(page.getByTestId("metric-mixed-consolidation")).toHaveText("連結・単体が混在");
    await expect(page.getByTestId("metric-mixed-standard")).toHaveCount(0);

    await page.goto("/stocks/9V009");
    await expect(row(page, "2021-03-31").getByTestId("revenue-label")).toHaveText("売上収益");
    await expect(row(page, "2021-03-31").locator("td:nth-child(6)")).toHaveText("連結・IFRS");
    await expect(row(page, "2024-03-31").getByTestId("cell-net-sales")).toHaveText("50,000");
    await expect(page.getByTestId("metric-cagr").getByTestId("metric-value")).toHaveText("24.4%");
    await expect(page.getByTestId("metric-mixed-standard")).toHaveCount(0);
  });

  test("9V008: 訂正届出書の値と書類ID。訂正を取り下げると元の届出書に切り替わり、戻すと元に戻る（AC15.9）", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/stocks/9V008");
    for (const [end, sales] of [
      ["2021-03-31", "10,000"],
      ["2022-03-31", "12,000"],
      ["2023-03-31", "15,000"],
      ["2024-03-31", "20,000"],
    ]) {
      await expect(row(page, end).getByTestId("cell-net-sales")).toHaveText(sales);
      await expect(row(page, end).getByTestId("cell-document")).toHaveAttribute("data-doc-id", "S9TEST82");
      await expect(row(page, end).getByTestId("amendment-badge")).toHaveText("訂正");
      await expect(row(page, end).getByTestId("corrected-badge")).toHaveText("書類2件（訂正あり）");
    }
    await expect(page.locator("main")).not.toContainText("9,000");
    await expect(page.getByTestId("metric-cagr").getByTestId("metric-value")).toHaveText("31.6%");

    await sql("update public.edinet_documents set withdrawn = true where doc_id = 'S9TEST82'");
    await page.reload();
    await expect(row(page, "2021-03-31").getByTestId("cell-net-sales")).toHaveText("9,000");
    await expect(row(page, "2021-03-31").getByTestId("cell-document")).toHaveAttribute("data-doc-id", "S9TEST81");
    await expect(page.getByTestId("metric-cagr").getByTestId("metric-value")).toHaveText("35.1%");
    await sql("update public.edinet_documents set withdrawn = false where doc_id = 'S9TEST82'");
    await page.reload();
    await expect(page.getByTestId("metric-cagr").getByTestId("metric-value")).toHaveText("31.6%");
  });

  test("優先順位の重なり: 有報の期は届出書に、決算短信の期は EDINET に優先する（C4-6・C4-7）", async ({ page }) => {
    await loginAsOwner(page);
    await sql(
      `insert into public.business_results_periods (doc_id, fiscal_year_start, fiscal_year_end, consolidated, accounting_standard, net_sales, revenue_element)
       values ('S9TEST11', '2020-04-01', '2021-03-31', true, 'JP', 9500000000, 'NetSalesSummaryOfBusinessResults')`,
    );
    await page.goto("/stocks/9V001");
    await expect(row(page, "2021-03-31").getByTestId("cell-net-sales")).toHaveText("9,500");
    await expect(row(page, "2021-03-31").getByTestId("cell-source")).toHaveText("有価証券報告書");
    await expect(page.getByTestId("metric-cagr").getByTestId("metric-value")).toHaveText("43.2%");
    await sql("delete from public.business_results_periods where doc_id = 'S9TEST11' and fiscal_year_end = '2021-03-31'");

    await sql(
      `insert into public.financial_statements (code, disclosure_no, disclosed_date, disclosed_time, document_type, fiscal_year_start, fiscal_year_end, net_sales, operating_profit)
       values ('9V001', 'S9A0', '2021-05-14', '15:00', 'FYFinancialStatements_Consolidated_JP', '2020-04-01', '2021-03-31', 10500000000, 1000000000)`,
    );
    await page.reload();
    await expect(row(page, "2021-03-31").getByTestId("cell-net-sales")).toHaveText("10,500");
    await expect(row(page, "2021-03-31").getByTestId("cell-source")).toHaveText("決算短信");
    await sql("delete from public.financial_statements where code = '9V001' and disclosure_no = 'S9A0'");
    await page.reload();
    await expect(row(page, "2021-03-31").getByTestId("cell-source")).toHaveText("有価証券届出書");
    await expect(page.getByTestId("metric-cagr").getByTestId("metric-value")).toHaveText("41.4%");
  });
});

test.describe("取り込み状況とキー（C6-1・C8）", () => {
  test("区画の件数は DB の集計と一致する。追加の投入で 8・5 になる。表示名は「EDINET（有報・届出書）」（C8-1・C8-2・C8-4）", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/imports");
    const panel = page.getByTestId("business-results-panel");
    await expect(panel.getByTestId("supplemented-stock-count")).toContainText("7 / 10");
    await expect(panel.getByTestId("supplemented-cagr-count")).toContainText("4");
    await expect(panel.getByTestId("business-results-processed")).toContainText("12");
    await expect(panel.getByTestId("business-results-processed-breakdown")).toHaveText(/有報 4、届出書 8。読み取れた 11、記載なし 1、読み取れず 0、XBRL なし 0/);
    await expect(panel.getByTestId("business-results-pending-count")).toContainText("1");
    await expect(panel.getByTestId("business-results-unlinked")).toContainText("1");
    const summary = (await sql("select public.business_results_summary() as s")).rows[0].s;
    expect(summary).toMatchObject({ supplementedStockCount: 7, supplementedCagrCount: 4, pendingDocumentCount: 1, unlinkedRegistrationStatements: 1 });

    await sql(ADD_SQL);
    await page.reload();
    await expect(panel.getByTestId("supplemented-stock-count")).toContainText("8 / 10");
    await expect(panel.getByTestId("supplemented-cagr-count")).toContainText("5");

    await expect(page.getByRole("radio", { name: /^EDINET（有報・届出書）/ })).toBeVisible();
    await expect(page.getByTestId("cron-settings")).toContainText("EDINET（有報・届出書）");
  });

  test("データが0件なら空の状態とキーの注記（C8-3）", async ({ page }) => {
    await sql(CLEANUP_SQL);
    await loginAsOwner(page);
    const res = await page.request.get("/api/ingestion");
    const edinet = (await res.json()).data.sources.find((s: { id: string }) => s.id === "edinet");
    await page.goto("/imports");
    const panel = page.getByTestId("business-results-panel");
    await expect(panel.getByTestId("business-results-empty")).toContainText("まだ上場前の期の補完は行われていません");
    if (!edinet.configured) await expect(panel.getByTestId("business-results-key-missing")).toContainText("EDINET の API キーが設定されていません");
  });

  test("キーなしで「EDINET（有報・届出書）」を実行すると失敗が記録され、決算短信から算出済みの指標は変わらない（C6-1。AC15.10）", async ({ page }) => {
    await loginAsOwner(page);
    const res = await page.request.get("/api/ingestion");
    const edinet = (await res.json()).data.sources.find((s: { id: string }) => s.id === "edinet");
    test.skip(edinet.configured, "サーバーの EDINET のキーが設定済み");
    const before = (await sql("select code, revenue_cagr::text, revenue_cagr_unavailable_reason, calculated_at::text from public.financial_metrics order by code")).rows;
    await page.goto("/imports");
    await page.getByRole("radio", { name: /^EDINET（有報・届出書）/ }).check();
    await page.getByRole("button", { name: /今すぐ取り込み/ }).click();
    await expect(page.getByTestId("ingestion-result")).toHaveText("失敗: EDINET の API キーが設定されていません");
    const { rows } = await sql("select target, status, processed_count, error_message from public.ingestion_runs where target = 'edinet_reports'");
    expect(rows).toEqual([{ target: "edinet_reports", status: "failed", processed_count: 0, error_message: "EDINET の API キーが設定されていません" }]);
    await page.reload();
    await expect(page.getByTestId("run-table").locator("tbody tr").first()).toContainText("EDINET");
    expect((await sql("select code, revenue_cagr::text, revenue_cagr_unavailable_reason, calculated_at::text from public.financial_metrics order by code")).rows).toEqual(before);
  });
});

test.describe("注記の差し替え（C9。AC15.12）", () => {
  test("スクリーニングを開いた直後に新しい注記が条件①と一緒に見え、旧い注記はどこにも無い", async ({ page }) => {
    await loginAsOwner(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/screening");
    const note = page.getByTestId("cagr-supplement-note").filter({ visible: true });
    await expect(note).toHaveText(NOTE);
    await expect(note).toBeInViewport();
    for (const path of ["/screening", "/stocks/9V002", "/stocks/9V001"]) {
      await page.goto(path);
      await expect(page.locator("main")).not.toContainText(OLD_NOTE);
      await expect(page.getByTestId("cagr-provisional-note")).toHaveCount(0);
    }
    await page.goto("/stocks/9V001");
    await expect(page.getByTestId("metric-cagr").getByTestId("cagr-supplement-note")).toHaveCount(0);
  });
});

test.describe("Sprint 8 評価の改善提案（C10）", () => {
  test("m2: 区画がフォールバックの銘柄は「最新の提出分を使っています」と書かない。m3: 区画の取り込み待ちに書類ID と提出日", async ({ page }) => {
    await sql(ANNUAL_EXAMPLE_SQL);
    await loginAsOwner(page);
    await page.goto("/stocks/9W007");
    const summary = page.getByTestId("annual-report-siblings-summary");
    await expect(summary).toContainText("区画によっては元の有報の記載を表示しています");
    await expect(summary).not.toContainText("最新の提出分を使っています");
    await page.goto("/stocks/9W002");
    await expect(page.getByTestId("annual-report-siblings-summary")).toContainText("最新の提出分を使っています");

    await sql("delete from public.annual_report_extractions where doc_id = 'S8TEST61'");
    await page.goto("/stocks/9W007");
    const pending = page.getByTestId("major-shareholders").getByTestId("section-pending");
    await expect(pending).toContainText("S8TEST61");
    await expect(pending).toContainText("2025-06-26");
  });
});

test.describe("画面のそのほか（C11）", () => {
  test("375px の詳細でページ全体の横スクロールが無く、表は枠の中だけで横スクロールする（C11-2）", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 800 } });
    const page = await context.newPage();
    await loginAsOwner(page);
    await page.goto("/stocks/9V001");
    await expect(page.getByTestId("five-period-table")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    const scroller = page.getByTestId("five-period-table").locator("xpath=..");
    expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth && getComputedStyle(el).overflowX === "auto")).toBe(true);
    await context.close();
  });

  test("時計のずれの状態でも、詳細・見つからない銘柄・スクリーニングでコンソールのエラーが出ない（C11-3）", async ({ page, context }) => {
    await simulateServerClockBehind(context);
    const problems = collectPageProblems(page);
    await loginAsOwner(page);
    for (const code of ["9V001", "9V008", "9V002"]) {
      await page.goto(`/stocks/${code}`);
      await expect(page.getByTestId("five-period-table")).toBeVisible();
    }
    await page.goto("/stocks/99989");
    await expect(page.getByRole("heading", { level: 1, name: "銘柄が見つかりません" })).toBeVisible();
    await page.goto("/screening?cagr=40&margin=10&years=5&off=owner");
    await expect(resultRow(page, "9V001")).toBeVisible();
    expect(problems).toEqual([]);
  });

  test("未ログインの API は 401 で、補完の値を返さない。画面を開いても実行履歴は増えない（C11-4・C11-8）", async ({ page, request }) => {
    for (const path of ["/api/stocks/9V001", "/api/screening?cagr=40&margin=10&years=5&off=owner", "/api/financials?code=9V001"]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(401);
      expect(await res.text()).not.toContain("S9TEST");
    }
    await loginAsOwner(page);
    const res = await page.request.get("/api/stocks/9V001");
    expect(res.headers()["cache-control"]).toContain("no-store");
    for (const path of ["/stocks/9V001", "/screening?cagr=40&margin=10&years=5&off=owner", "/imports"]) {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
    }
    expect((await sql("select count(*)::int as n from public.ingestion_runs where target <> 'daily_quotes'")).rows[0].n).toBe(0);
    // 許可の取り消し後は 403（補完の値を含まない。afterEach で許可リストに戻す）
    await sql("delete from private.allowed_emails where email = $1", [OWNER.email]);
    const revoked = await page.request.get("/api/stocks/9V001");
    expect(revoked.status()).toBe(403);
    expect(await revoked.text()).not.toContain("S9TEST");
  });
});
