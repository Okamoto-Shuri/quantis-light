import { expect, test, type Page } from "@playwright/test";

import {
  cleanupDashboardData,
  collectPageProblems,
  insertRun,
  jstOfRun,
  loginAsOwner,
  sql,
} from "./support";

/**
 * ダッシュボード（AC2.2、AC2.3）と取り込み状況の画面。
 * 前提: 市場データと実行履歴が0件の DB（pnpm db:reset && pnpm seed:users 直後）。
 * テストで投入した行は、各テストの後に削除する。
 */
test.describe.configure({ mode: "serial" });

let runIds: number[] = [];

test.beforeAll(async () => {
  const { rows } = await sql(
    "select (select count(*) from public.stocks)::int as stocks, (select count(*) from public.ingestion_runs)::int as runs",
  );
  expect(rows[0], "E2E の前提: 市場データと実行履歴が0件").toEqual({ stocks: 0, runs: 0 });
});

test.afterEach(async () => {
  await cleanupDashboardData(runIds);
  runIds = [];
  await sql("grant execute on function public.dashboard_summary() to authenticated");
});

async function insertStocks(codes: string[]) {
  for (const code of codes) {
    await sql(
      `insert into public.stocks (code, company_name, market_name, sector33_name)
       values ($1, $2, 'グロース', '情報・通信業')`,
      [code, `E2E検証用銘柄${code}株式会社`],
    );
  }
}

/**
 * 契約 第6章の投入例（財務指標と条件④の判定）。Sprint 5 から財務指標は通期実績（financial_statements）から DB が算出するので、
 * 同じ件数（99901 は売上CAGR と営業利益率、99902 は営業利益率だけ）になる通期実績を投入する。
 */
async function insertMetricsAndJudgments() {
  await sql(`insert into public.financial_statements
      (code, disclosure_no, disclosed_date, document_type, fiscal_year_start, fiscal_year_end, net_sales, operating_profit)
      select '99901', 'E1-' || y, make_date(y, 5, 14), 'FYFinancialStatements_Consolidated_JP', make_date(y - 1, 4, 1), make_date(y, 3, 31),
             100 * power(1.414, y - 2021), 12 * power(1.414, y - 2021)
        from generate_series(2021, 2025) as y
      union all
      select '99902', 'E2-' || y, make_date(y, 5, 14), 'FYFinancialStatements_Consolidated_JP', make_date(y - 1, 4, 1), make_date(y, 3, 31),
             100, 8
        from generate_series(2022, 2025) as y`);
  // Sprint 10: 条件④の判定は有報の抽出結果からトリガーで保存される（直接は書かない。契約の C12-1 の種類4）。
  // 99901 は判定できる（社長が筆頭株主）、99902 は大株主を抽出できず判定不能
  await sql(`insert into public.edinet_documents (doc_id, sec_code, edinet_code, doc_type_code, ordinance_code, form_code, period_end, submitted_at, xbrl_available, list_date)
      values ('SDASH01', '99901', 'E99D01', '120', '010', '030000', '2025-03-31', '2025-06-25 15:00+09', true, '2025-06-25'),
             ('SDASH02', '99902', 'E99D02', '120', '010', '030000', '2025-03-31', '2025-06-25 15:00+09', true, '2025-06-25')`);
  await sql(`insert into public.annual_report_extractions (doc_id, shareholders_status, officers_status, shareholders_detail)
      values ('SDASH01', 'ok', 'ok', null), ('SDASH02', 'invalid_values', 'ok', 'ratio_not_numeric')`);
  await sql("insert into public.annual_report_shareholders (doc_id, rank, name, ratio_pct, ratio_decimals) values ('SDASH01', 1, '検証　太郎', 30, 2)");
  await sql(`insert into public.annual_report_officers (doc_id, seq, name, title)
      values ('SDASH01', 1, '検証　太郎', '代表取締役社長'), ('SDASH02', 1, '検証　次郎', '代表取締役社長')`);
}

const tile = (page: Page, id: string) => page.getByTestId(id);

test.describe("空状態（AC2.3）", () => {
  test("銘柄が0件なら、件数を出さずに空状態と取り込み状況へのリンクを表示する", async ({ page }) => {
    const problems = collectPageProblems(page);
    await loginAsOwner(page);

    await expect(page.getByRole("heading", { name: "まだデータが取り込まれていません" })).toBeVisible();
    await expect(page.getByTestId(/^stat-/)).toHaveCount(0);
    await expect(page.getByText("銘柄数")).toHaveCount(0);
    await expect(page.getByText("直近の実行")).toHaveCount(0);

    await page.getByRole("link", { name: "取り込み状況を見る" }).click();
    await expect(page).toHaveURL("/imports");
    await expect(page.getByText("実行履歴はまだありません")).toBeVisible();
    await expect(page.getByText(/準備中|近日公開/)).toHaveCount(0);
    // Sprint 3 から「今すぐ取り込み」がある（押すと実際に取り込みを実行する。ingestion.spec.ts）
    await expect(page.getByRole("button", { name: "今すぐ取り込み" })).toBeVisible();
    expect(problems).toEqual([]);
  });

  test("失敗した実行だけがあるときは、空状態のまま直近の実行の失敗を表示する", async ({ page }) => {
    const id = await insertRun({
      target: "stock_master",
      trigger: "manual",
      status: "failed",
      startedAgo: "5 hours",
      finishedAgo: "4 hours 59 minutes",
      errorMessage: "J-Quants の API キーが設定されていません",
    });
    runIds.push(id);
    await loginAsOwner(page);

    await expect(page.getByRole("heading", { name: "まだデータが取り込まれていません" })).toBeVisible();
    const latest = page.getByTestId("latest-run");
    await expect(latest).toContainText("失敗");
    await expect(latest).toContainText(await jstOfRun(id, "started_at"));
    await expect(latest).toContainText("J-Quants の API キーが設定されていません");
  });
});

test.describe("件数と鮮度（AC2.2）", () => {
  test("銘柄だけがあるときは、実際の件数と0件を表示する", async ({ page }) => {
    await insertStocks(["99901", "99902", "99903"]);
    await loginAsOwner(page);

    await expect(page.getByTestId("last-completed")).toContainText("記録なし");
    await expect(page.getByTestId("latest-run")).toContainText("実行履歴なし");
    await expect(tile(page, "stat-stocks")).toContainText("3 銘柄");
    await expect(tile(page, "stat-financial")).toContainText("0 / 3 銘柄（0.0%）");
    await expect(tile(page, "stat-financial")).toContainText(/売上CAGR\s*0/);
    await expect(tile(page, "stat-financial")).toContainText(/営業利益率\s*0/);
    await expect(tile(page, "stat-ownership")).toContainText("0 / 3 銘柄（0.0%）");

    // 保存済みデータから集計していること: 1行足すと分母も変わる
    await insertStocks(["99904"]);
    await page.reload();
    await expect(tile(page, "stat-stocks")).toContainText("4 銘柄");
    await expect(tile(page, "stat-financial")).toContainText("0 / 4 銘柄（0.0%）");
  });

  test("投入例のとおりに件数・最終取り込み・直近の実行を表示し、API も同じ値を返す", async ({ page }) => {
    await insertStocks(["99901", "99902", "99903"]);
    await insertMetricsAndJudgments();
    const succeeded = await insertRun({
      target: "stock_master",
      trigger: "cron",
      status: "succeeded",
      startedAgo: "2 days 3 hours",
      finishedAgo: "2 days 2 hours 55 minutes",
      processedCount: 3,
    });
    const failed = await insertRun({
      target: "stock_master",
      trigger: "manual",
      status: "failed",
      startedAgo: "5 hours",
      finishedAgo: "4 hours 59 minutes",
      errorMessage: "J-Quants の API キーが設定されていません",
    });
    runIds.push(succeeded, failed);
    await loginAsOwner(page);

    const lastCompleted = page.getByTestId("last-completed");
    await expect(lastCompleted).toContainText(await jstOfRun(succeeded, "finished_at"));
    await expect(lastCompleted).toContainText("2日前");
    await expect(lastCompleted).toContainText("銘柄マスタ");
    const latest = page.getByTestId("latest-run");
    await expect(latest).toContainText("失敗");
    await expect(latest).toContainText(await jstOfRun(failed, "started_at"));
    await expect(latest).toContainText("J-Quants の API キーが設定されていません");
    await expect(tile(page, "stat-stocks")).toContainText("3 銘柄");
    await expect(tile(page, "stat-financial")).toContainText("2 / 3 銘柄（66.7%）");
    await expect(tile(page, "stat-financial")).toContainText(/売上CAGR\s*1/);
    await expect(tile(page, "stat-financial")).toContainText(/営業利益率\s*2/);
    await expect(tile(page, "stat-ownership")).toContainText("1 / 3 銘柄（33.3%）");

    const res = await page.request.get("/api/dashboard");
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toContain("no-store");
    const { data } = await res.json();
    expect(data).toMatchObject({
      stockCount: 3,
      financialMetrics: { anyCount: 2, revenueCagrCount: 1, operatingMarginCount: 2 },
      ownershipDeterminedCount: 1,
      lastCompletedRun: { target: "stock_master", status: "succeeded" },
      latestRun: {
        target: "stock_master",
        status: "failed",
        errorMessage: "J-Quants の API キーが設定されていません",
      },
    });

    // 一部失敗も完了として数える
    await sql("update public.ingestion_runs set status = 'partial' where id = $1", [failed]);
    await page.reload();
    await expect(lastCompleted).toContainText(await jstOfRun(failed, "finished_at"));
    await expect(lastCompleted).toContainText("4時間前");

    // 実行中の行が最新なら、直近の実行は「実行中」。最終取り込みは変わらない
    runIds.push(
      await insertRun({ target: "financials", trigger: "manual", status: "running", startedAgo: "0 seconds", finishedAgo: null }),
    );
    await page.reload();
    await expect(latest).toContainText("実行中");
    await expect(latest).toContainText("財務");
    await expect(lastCompleted).toContainText(await jstOfRun(failed, "finished_at"));
  });

  test("未ログインの API は 401 で件数を含まない", async ({ request }) => {
    const res = await request.get("/api/dashboard");
    expect(res.status()).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  test("集計に失敗したら、0 件や空状態ではなくエラーを表示する", async ({ page }) => {
    await insertStocks(["99901"]);
    await loginAsOwner(page);
    await sql("revoke execute on function public.dashboard_summary() from authenticated");

    await page.reload();
    await expect(page.getByText("ダッシュボードの集計を取得できませんでした")).toBeVisible();
    await expect(page.getByTestId(/^stat-/)).toHaveCount(0);
    await expect(page.getByText("まだデータが取り込まれていません")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "メイン" })).toBeVisible();

    const res = await page.request.get("/api/dashboard");
    expect(res.status()).toBe(500);
    expect(await res.json()).toEqual({ error: "internal_error" });
  });
});

test.describe("取り込み状況（実行履歴の閲覧）", () => {
  test("実行履歴を新しい順に日本語で表示する", async ({ page }) => {
    const succeeded = await insertRun({
      target: "stock_master",
      trigger: "cron",
      status: "succeeded",
      startedAgo: "2 days 3 hours",
      finishedAgo: "2 days 2 hours 55 minutes",
      processedCount: 3812,
    });
    const failed = await insertRun({
      target: "stock_master",
      trigger: "manual",
      status: "failed",
      startedAgo: "5 hours",
      finishedAgo: "4 hours 59 minutes",
      errorMessage: "J-Quants の API キーが設定されていません",
    });
    const running = await insertRun({
      target: "edinet_reports",
      trigger: "cron",
      status: "running",
      startedAgo: "1 minute",
      finishedAgo: null,
    });
    runIds.push(succeeded, failed, running);
    await loginAsOwner(page);
    await page.goto("/imports");

    const rows = page.getByTestId("run-table").locator("tbody tr");
    await expect(rows).toHaveCount(3);
    await expect(page.getByTestId("run-table").locator("thead th")).toHaveText([
      "開始",
      "終了",
      "対象",
      "起動",
      "結果",
      "処理件数",
      "エラー",
    ]);
    await expect(rows.nth(0)).toContainText("EDINET");
    await expect(rows.nth(0)).toContainText("実行中");
    await expect(rows.nth(0).locator("td").nth(1)).toHaveText("—");
    await expect(rows.nth(1)).toContainText(await jstOfRun(failed, "started_at"));
    await expect(rows.nth(1)).toContainText("手動");
    await expect(rows.nth(1)).toContainText("失敗");
    await expect(rows.nth(1)).toContainText("J-Quants の API キーが設定されていません");
    await expect(rows.nth(2)).toContainText("定期実行");
    await expect(rows.nth(2)).toContainText("成功");
    await expect(rows.nth(2).locator("td").nth(5)).toHaveText("3,812");
    await expect(rows.nth(2).locator("td").nth(5)).toHaveCSS("text-align", "right");
  });

  test("51件以上あるときは新しい50件と注記を表示する", async ({ page }) => {
    const { rows } = await sql(
      `insert into public.ingestion_runs (target, trigger, status, started_at, finished_at)
       select 'daily_quotes', 'cron', 'succeeded', now() - (g || ' hours')::interval, now() - (g || ' hours')::interval
         from generate_series(1, 51) g
       returning id`,
    );
    runIds.push(...rows.map((row) => Number(row.id)));
    await loginAsOwner(page);
    await page.goto("/imports");
    await expect(page.getByTestId("run-table").locator("tbody tr")).toHaveCount(50);
    await expect(page.getByText("新しい 50 件だけを表示しています")).toBeVisible();
  });

  test("375px ではカード形式で、横スクロールしない", async ({ browser }) => {
    runIds.push(
      await insertRun({
        target: "stock_master",
        trigger: "manual",
        status: "failed",
        startedAgo: "5 hours",
        finishedAgo: "4 hours 59 minutes",
        errorMessage: "J-Quants の API キーが設定されていません",
      }),
    );
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await context.newPage();
    await loginAsOwner(page);
    await page.goto("/imports");
    await expect(page.getByTestId("run-list")).toBeVisible();
    await expect(page.getByTestId("run-table")).toBeHidden();
    await expect(page.getByTestId("run-list")).toContainText("J-Quants の API キーが設定されていません");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await context.close();
  });
});
