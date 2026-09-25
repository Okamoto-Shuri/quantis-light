import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { collectPageProblems, login, loginAsOwner, OWNER, simulateServerClockBehind, sql } from "./support";

/**
 * 銘柄詳細（F7、Sprint 7）。契約の第5章の投入例（screening-example.sql の10銘柄 ＋ stock-detail-example.sql の4銘柄）を使う。
 * 前提: 市場データと実行履歴が0件の DB。投入するコードは 9999x・9Y001〜9Y004・9Z001〜9Z120 で、各テストの後に削除する。
 */
test.describe.configure({ mode: "serial" });

const SCREENING_SQL = readFileSync(join(__dirname, "fixtures/screening-example.sql"), "utf8");
const DETAIL_SQL = readFileSync(join(__dirname, "fixtures/stock-detail-example.sql"), "utf8");
const PAGING_SQL = readFileSync(join(__dirname, "fixtures/screening-paging.sql"), "utf8");
const NOTE = "上場前の期は EDINET の有価証券届出書・有価証券報告書から補っています。書類から値を取れない銘柄は算出不可になることがあります。";
const DEFAULT_QUERY = "cagr=20&margin=10&years=5&owner=20&ownermode=any&off=owner&sort=cagr&order=desc";

async function seed() {
  await sql(SCREENING_SQL);
  await sql(DETAIL_SQL);
}

const rows = (page: Page) => page.getByTestId("screening-table").locator("tbody tr");
const rowCodes = (page: Page) => rows(page).evaluateAll((trs) => trs.map((tr) => tr.getAttribute("data-code")));
const row = (page: Page, code: string) => page.locator(`tr[data-code="${code}"]`);
const mainNav = (page: Page) => page.getByRole("navigation", { name: "メイン" });

test.beforeAll(async () => {
  const { rows: pre } = await sql(
    "select (select count(*) from public.stocks)::int as stocks, (select count(*) from public.ingestion_runs)::int as runs",
  );
  expect(pre[0], "E2E の前提: 市場データ・実行履歴が0件").toEqual({ stocks: 0, runs: 0 });
});

test.afterEach(async () => {
  await sql("delete from public.stocks where code like '9999%' or code like '9Y%' or code like '9Z%'");
  await sql("delete from public.ingestion_runs");
});

test.describe("スクリーニングから詳細へ（C1）", () => {
  test("行の社名をクリックすると、条件付きの詳細に移る。ナビゲーションは強調しない。戻る1回でスクリーニング", async ({ page }) => {
    const problems = collectPageProblems(page);
    await seed();
    await loginAsOwner(page);
    await mainNav(page).getByRole("link", { name: "スクリーニング" }).click();
    // Sprint 10: 条件④をオフにして①〜③を確かめる（契約の C12-1 の種類1）
    await page.getByRole("switch", { name: "条件④ オーナー企業／社長が筆頭株主 を使う" }).click();
    await expect(page).toHaveURL(/off=owner/);
    await expect.poll(() => rowCodes(page)).toEqual(["9Y001", "99991", "99990"]);
    // 行にマウスを乗せると、クリックできる見た目（ポインター）
    await row(page, "99991").getByTestId("cell-cagr").hover();
    expect(await row(page, "99991").evaluate((tr) => getComputedStyle(tr).cursor)).toBe("pointer");

    await row(page, "99991").getByTestId("row-link-name").click();
    await expect(page).toHaveURL(`/stocks/99991?${DEFAULT_QUERY}`);
    await expect(page.getByRole("heading", { level: 1, name: "検証用成長二五株式会社" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "パンくず" })).toContainText("スクリーニング");
    await expect(page.getByRole("navigation", { name: "パンくず" })).toContainText("99991 検証用成長二五株式会社");
    await expect(mainNav(page).locator("[aria-current=page]")).toHaveCount(0);
    // 社名のリンクのクリックで遷移は1回だけ（戻る1回でスクリーニング）
    await page.goBack();
    await expect(page).toHaveURL(`/screening?${DEFAULT_QUERY}`);
    expect(problems).toEqual([]);
  });

  test("行のほかの場所・キーボード・修飾キー・中クリック（C1-2）", async ({ page, context }) => {
    await seed();
    await loginAsOwner(page);
    await page.goto("/screening?off=owner");
    await row(page, "99990").locator("td").nth(3).click();
    await expect(page).toHaveURL(`/stocks/99990?${DEFAULT_QUERY}`);
    await page.goBack();
    await expect(page).toHaveURL("/screening?off=owner");

    await row(page, "99991").getByTestId("row-link-code").focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`/stocks/99991?${DEFAULT_QUERY}`);
    await page.goBack();
    await expect(page).toHaveURL("/screening?off=owner");

    for (const click of [
      () => row(page, "9Y001").locator("td").nth(3).click({ modifiers: ["ControlOrMeta"] }),
      () => row(page, "9Y001").locator("td").nth(2).click({ button: "middle" }),
      () => row(page, "9Y001").getByTestId("row-link-name").click({ modifiers: ["ControlOrMeta"] }),
    ]) {
      const [popup] = await Promise.all([context.waitForEvent("page"), click()]);
      await popup.waitForLoadState();
      await expect(popup).toHaveURL(new RegExp(`/stocks/9Y001\\?${DEFAULT_QUERY}$`));
      await popup.close();
      await expect(page).toHaveURL("/screening?off=owner");
    }
  });

  test("URL を直接開ける。未ログインはログイン画面を経由して同じ URL（C1-4）", async ({ page, browser }) => {
    await seed();
    await loginAsOwner(page);
    await page.goto("/stocks/99991");
    await expect(page.getByTestId("stock-header")).toContainText("検証用成長二五株式会社");

    const anonymous = await browser.newContext();
    const other = await anonymous.newPage();
    await other.goto("/stocks/99991?cagr=15&off=owner");
    await expect(other).toHaveURL(`/login?next=${encodeURIComponent("/stocks/99991?cagr=15&off=owner")}`);
    await expect(other.getByText("検証用成長二五株式会社")).toHaveCount(0);
    await other.getByLabel("メールアドレス").fill(OWNER.email);
    await other.getByLabel("パスワード").fill(OWNER.password);
    await other.getByRole("button", { name: "ログイン" }).click();
    await expect(other).toHaveURL("/stocks/99991?cagr=15&off=owner");
    await expect(other.getByTestId("evaluation-cagr").getByTestId("evaluation-threshold")).toHaveText("≥ 15%");
    await anonymous.close();
  });
});

type SlotRow = [position: string, label: string, sales: string, op: string];
const MISSING = "データなし";
const FIVE: Record<string, SlotRow[]> = {
  "99991": [
    ["FY-4", "2021/03期", "10,000", "1,500"],
    ["FY-3", "2022/03期", "12,500", "1,875"],
    ["FY-2", "2023/03期", "15,625", "2,344"],
    ["FY-1", "2024/03期", "19,531", "2,930"],
    ["FY0", "2025/03期", "24,414", "3,662"],
  ],
  "99996": [
    ["FY-4", "2019/03期", MISSING, MISSING],
    ["FY-3", "2020/03期", MISSING, MISSING],
    ["FY-2", "2021/03期", "10,000", "1,800"],
    ["FY-1", "2022/03期", "13,000", "2,340"],
    ["FY0", "2023/03期", "16,000", "2,880"],
  ],
  "99997": [
    ["FY-4", "2021/03期", "10,000", "開示なし"],
    ["FY-3", "2022/03期", "12,500", "開示なし"],
    ["FY-2", "2023/03期", "15,625", "開示なし"],
    ["FY-1", "2024/03期", "19,531", "開示なし"],
    ["FY0", "2025/03期", "24,414", "開示なし"],
  ],
  "9Y001": [
    ["FY-4", "2021/03期", "10,000", "1,000"],
    ["FY-3", "2022/03期", "15,000", "1,500"],
    ["FY-2", "2023/03期", "20,000", "2,000"],
    ["FY-1", "2024/03期", "30,000", "3,000"],
    ["FY0", "2025/03期", "40,000", "4,800"],
  ],
  "9Y002": [
    ["FY-4", "2021/03期", "10,000", "1,000"],
    ["FY-3", "2022/03期", MISSING, MISSING],
    ["FY-2", "2023/03期", "13,000", "1,300"],
    ["FY-1", "2024/03期", "15,000", "1,500"],
    ["FY0", "2025/03期", "17,000", "1,700"],
  ],
  "9Y003": [
    ["FY-4", "2021/03期", "11,000", "1,100"],
    ["FY-3", "2022/03期", "12,000", "1,200"],
    ["FY-2", "2022/12期", "9,500", "950"],
    ["FY-1", "2023/12期", "14,000", "-1,000"],
    ["FY0", "2024/12期", "16,000", "1,600"],
  ],
  "9Y004": [
    ["FY-4", "2021/03期", "10,000", "500"],
    ["FY-3", "2022/03期", "13,000", "650"],
    ["FY-2", "2023/03期", "16,900", "845"],
    ["FY-1", "2024/03期", "21,970", "1,099"],
    ["FY0", "2025/03期", "28,561", "-1,428"],
  ],
};

test.describe("基本情報と5期の表・グラフ（C2）", () => {
  test("見出しとタイトル（C2-1）", async ({ page }) => {
    await seed();
    await loginAsOwner(page);
    await page.goto("/stocks/99991");
    const header = page.getByTestId("stock-header");
    await expect(header.getByTestId("stock-code")).toHaveText("99991");
    await expect(header).toContainText("グロース");
    await expect(header).toContainText("情報・通信業");
    await expect(header).toContainText("基準日 2026-09-24");
    await expect(page).toHaveTitle("99991 検証用成長二五株式会社 | Quantis Light");
  });

  test("5期の表の値・データなし・開示なし・印、グラフの棒（C2-2・C2-4・C2-5）", async ({ page }) => {
    const problems = collectPageProblems(page);
    await seed();
    await loginAsOwner(page);
    for (const [code, expected] of Object.entries(FIVE)) {
      await page.goto(`/stocks/${code}`);
      const table = page.getByTestId("five-period-table");
      const actual = await table.locator("tbody tr").evaluateAll((trs) =>
        trs.map((tr) => {
          const cells = [...tr.querySelectorAll("td")].map((td) => td.textContent?.trim() ?? "");
          const missing = tr.getAttribute("data-missing") === "true";
          return [tr.getAttribute("data-slot"), cells[1], missing ? "データなし" : cells[3], missing ? "データなし" : cells[4]];
        }),
      );
      expect(actual, code).toEqual(expected);
      for (const [position, , sales] of expected) {
        const tr = table.locator(`tr[data-slot="${position}"]`);
        if (sales === MISSING) await expect(tr).toHaveAttribute("data-missing", "true");
        else await expect(tr).not.toHaveAttribute("data-missing", /.*/);
      }
      // グラフ: 棒の値は表と同じ、データなし・開示なしは棒を描かない
      const chart = page.getByTestId("financial-chart");
      await expect(chart.getByTestId("chart-slot")).toHaveCount(5);
      for (const [position, , sales, op] of expected) {
        const slot = chart.locator(`[data-slot="${position}"]`);
        if (sales === MISSING) {
          await expect(slot.getByTestId("chart-missing")).toHaveText("データなし");
          await expect(slot.getByTestId("chart-bar")).toHaveCount(0);
          continue;
        }
        await expect(slot.locator('[data-series="net_sales"]')).toHaveAttribute("data-value", sales);
        if (op === "開示なし") await expect(slot.getByTestId("chart-not-disclosed")).toHaveText("開示なし");
        else await expect(slot.locator('[data-series="operating_profit"]')).toHaveAttribute("data-value", op);
      }
    }

    // 変則決算・訂正の印、基準、出典
    await page.goto("/stocks/9Y003");
    await expect(page.getByTestId("five-period-table").locator('tr[data-slot="FY-2"]')).toContainText("変則決算（9か月）");
    await expect(page.getByTestId("financial-chart").locator('[data-slot="FY-1"] [data-series="operating_profit"]')).toHaveAttribute("data-negative", "true");
    await page.goto("/stocks/9Y004");
    await expect(page.getByTestId("five-period-table").locator('tr[data-slot="FY-4"]')).toContainText("連結・日本基準");
    await expect(page.getByTestId("five-period-table").locator('tr[data-slot="FY0"]')).toContainText("単体・日本基準");
    await expect(page.getByTestId("financial-chart").locator('[data-slot="FY0"] [data-series="operating_profit"]')).toHaveAttribute("data-negative", "true");
    await page.goto("/stocks/9Y001");
    const fy0 = page.getByTestId("five-period-table").locator('tr[data-slot="FY0"]');
    await expect(fy0.getByTestId("corrected-badge")).toHaveText("開示2件（訂正あり）");
    await expect(fy0).toContainText("2025-05-20");
    await expect(fy0.getByTestId("cell-source")).toHaveText("決算短信");
    // title の円の値が保存値と一致する（訂正後の 400 億円・48 億円）
    await expect(fy0.getByTestId("cell-net-sales")).toHaveAttribute("title", "40,000,000,000円");
    await expect(fy0.getByTestId("cell-operating-profit")).toHaveAttribute("title", "4,800,000,000円");
    const { rows: stored } = await sql(
      "select net_sales::text, operating_profit::text from public.financial_periods where code = '9Y001' and fiscal_year_end = '2025-03-31'",
    );
    expect(await fy0.getByTestId("cell-net-sales").getAttribute("data-yen")).toBe(String(Number(stored[0].net_sales)));
    expect(await fy0.getByTestId("cell-operating-profit").getAttribute("data-yen")).toBe(String(Number(stored[0].operating_profit)));

    // 凡例・軸・ホバー・role="img"
    const chart = page.getByTestId("financial-chart");
    await expect(chart.getByTestId("chart-legend")).toHaveText(/売上高.*営業利益/);
    await expect(chart).toContainText("単位: 百万円");
    await expect(chart.getByRole("img")).toHaveAttribute("aria-label", /^売上高と営業利益の推移（百万円）: FY-4 2021\/03期 売上高 10,000、営業利益 1,000/);
    const bar = chart.locator('[data-slot="FY0"] [data-series="net_sales"]');
    await bar.hover();
    await expect(bar.getByTestId("chart-tooltip")).toBeVisible();
    await expect(bar.getByTestId("chart-tooltip")).toHaveText("FY0 2025/03期 売上高 40,000出典: 決算短信");
    expect(problems).toEqual([]);
  });

  test("すべての期の一覧（C2-6）と財務データなし（C2-7）", async ({ page }) => {
    await seed();
    await loginAsOwner(page);
    for (const [code, count, outsideFirst] of [
      ["9Y001", 6, "2020-03-31"],
      ["9Y002", 6, "2019-03-31"],
      ["9Y003", 6, "2020-03-31"],
    ] as const) {
      await page.goto(`/stocks/${code}`);
      const all = page.getByTestId("all-periods");
      await expect(all).toContainText(`保存済みの通期実績をすべて表示（${count}期）`);
      await all.locator("summary").click();
      const trs = all.getByTestId("all-periods-table").locator("tbody tr");
      await expect(trs).toHaveCount(count);
      await expect(trs.first()).toHaveAttribute("data-fiscal-year-end", outsideFirst);
      await expect(trs.first().locator("td").first()).toHaveText("—");
      await expect(trs.last().locator("td").first()).toHaveText("FY0");
    }
    for (const code of ["99991", "99996"]) {
      await page.goto(`/stocks/${code}`);
      await expect(page.getByTestId("five-period-table")).toBeVisible();
      await expect(page.getByTestId("all-periods")).toHaveCount(0);
    }
    await page.goto("/stocks/99998");
    await expect(page.getByTestId("financials-empty")).toContainText("財務データがありません（未取り込み）");
    await expect(page.getByTestId("financials-empty").getByRole("link", { name: "取り込み状況を見る" })).toHaveAttribute("href", "/imports");
    await expect(page.getByTestId("five-period-table")).toHaveCount(0);
    await expect(page.getByTestId("financial-chart")).toHaveCount(0);
  });
});

test.describe("指標と算出に使った期（C3）", () => {
  test("値・期間・算出不可の理由・注記・算出に使用の印（C3-1〜C3-4）", async ({ page }) => {
    await seed();
    await loginAsOwner(page);
    const expectations: Record<string, { cagr: string[]; margin: string[]; years: string[]; used: boolean }> = {
      "99991": {
        cagr: ["25.0%", "2021/03期 → 2025/03期（4年）"],
        margin: ["15.0%", "営業利益 3,662 ÷ 売上高 24,414"],
        years: ["4.0年", "初出日 2022-09-24 → 基準日 2026-09-24"],
        used: true,
      },
      "9Y001": {
        cagr: ["41.4%", "2021/03期 → 2025/03期（4年）"],
        margin: ["12.0%", "2025/03期: 営業利益 4,800 ÷ 売上高 40,000（百万円）"],
        years: ["4.0年"],
        used: true,
      },
      "99996": { cagr: ["算出不可（通期実績が5期未満）", "取得済みの通期実績: 3 期"], margin: ["18.0%"], years: ["2.0年"], used: false },
      "99997": { cagr: ["25.0%"], margin: ["算出不可（営業利益の開示なし）"], years: ["3.0年"], used: true },
      "99995": { cagr: ["40.0%"], margin: ["25.0%"], years: ["9年超", "データ期間開始以前から上場（9年超）", "データ期間の開始日 2016-09-26"], used: true },
      "99999": { cagr: ["21.0%"], margin: ["11.0%"], years: ["未確定（株価の初出日が未取り込み）"], used: true },
      "9Y002": { cagr: ["算出不可（直近5期の通期実績が連続していない）"], margin: ["10.0%"], years: ["データ期間開始以前から上場（9年超）"], used: false },
      "9Y003": { cagr: ["算出不可（直近5期に変則決算を含む）"], margin: ["10.0%", "営業利益 1,600 ÷ 売上高 16,000"], years: ["7.0年"], used: false },
      "9Y004": { cagr: ["30.0%"], margin: ["-5.0%", "営業利益 -1,428 ÷ 売上高 28,561"], years: ["1.0年"], used: true },
    };
    for (const [code, e] of Object.entries(expectations)) {
      await page.goto(`/stocks/${code}`);
      for (const text of e.cagr) await expect(page.getByTestId("metric-cagr"), code).toContainText(text);
      for (const text of e.margin) await expect(page.getByTestId("metric-margin"), code).toContainText(text);
      for (const text of e.years) await expect(page.getByTestId("metric-years"), code).toContainText(text);
      await expect(page.getByTestId("metric-years")).toContainText("株価データの初出日からの推定");
      const used = page.getByTestId("five-period-table").locator('tr[data-used="true"]');
      await expect(used, code).toHaveCount(e.used ? 5 : 0);
      await expect(page.getByTestId("metric-cagr").getByTestId("cagr-supplement-note")).toHaveCount(code === "99996" ? 1 : 0);
    }
    await page.goto("/stocks/99996");
    await expect(page.getByTestId("metric-cagr").getByTestId("cagr-supplement-note")).toHaveText(NOTE);
    await page.goto("/stocks/99998");
    await expect(page.getByTestId("metric-cagr")).toContainText("財務データなし（未取り込み）");
  });

  test("基準日なし（実行履歴を消した状態）でも壊れない（C3-5）", async ({ page }) => {
    const problems = collectPageProblems(page);
    await seed();
    await sql("delete from public.ingestion_runs");
    await loginAsOwner(page);
    await page.goto("/stocks/99991");
    await expect(page.getByTestId("metric-years")).toContainText("基準日なし（株価の取り込み実績がありません）");
    await expect(page.getByTestId("evaluation-years")).toHaveAttribute("data-status", "unavailable");
    await expect(page.getByTestId("stock-header")).toContainText("基準日なし");
    expect(problems).toEqual([]);
  });
});

const DEFAULT_EVALUATION: Record<string, [string, string, string, boolean, string]> = {
  "99990": ["met", "met", "met", true, "included"],
  "99991": ["met", "met", "met", true, "included"],
  "99992": ["unmet", "met", "met", false, "unmet"],
  "99993": ["met", "unmet", "met", false, "unmet"],
  "99994": ["met", "met", "unmet", false, "unmet"],
  "99995": ["met", "met", "unmet", false, "unmet"],
  "99996": ["unavailable", "met", "met", false, "unavailable"],
  "99997": ["met", "unavailable", "met", false, "unavailable"],
  "99998": ["unavailable", "unavailable", "met", false, "unavailable"],
  "99999": ["met", "met", "unavailable", false, "unavailable"],
  "9Y001": ["met", "met", "met", true, "included"],
  "9Y002": ["unavailable", "met", "unmet", false, "unmet"],
  "9Y003": ["unavailable", "met", "unmet", false, "unmet"],
  "9Y004": ["met", "unmet", "met", false, "unmet"],
};

async function expectEvaluation(page: Page, statuses: [string, string, string], included: boolean) {
  await expect(page.getByTestId("evaluation-cagr")).toHaveAttribute("data-status", statuses[0]);
  await expect(page.getByTestId("evaluation-margin")).toHaveAttribute("data-status", statuses[1]);
  await expect(page.getByTestId("evaluation-years")).toHaveAttribute("data-status", statuses[2]);
  await expect(page.getByTestId("evaluation-inclusion")).toHaveAttribute("data-included", String(included));
}

test.describe("現在の閾値での判定（C4）", () => {
  test("既定の条件: 14銘柄の状態と結果に含まれるか（C4-1・C4-7・C4-8）", async ({ page }) => {
    await seed();
    await loginAsOwner(page);
    // Sprint 10: 既定の条件①〜③の判定を確かめるため、条件④はオフにする（有報の無い投入例の銘柄は判定不能のため。契約の C12-1 の種類1）。
    // クエリに条件のパラメータがあるので、判定の出どころの表示は「スクリーニングの条件」になる
    for (const [code, [cagr, margin, years, included, kind]] of Object.entries(DEFAULT_EVALUATION)) {
      await page.goto(`/stocks/${code}?off=owner`);
      await expect(page.getByTestId("evaluation-source")).toHaveText("スクリーニングの条件で判定しています");
      await expectEvaluation(page, [cagr, margin, years], included);
      await expect(page.getByTestId("evaluation-inclusion"), code).toHaveAttribute("data-kind", kind);
    }
    await page.goto("/stocks/99991?off=owner");
    await expect(page.getByTestId("evaluation-cagr").getByTestId("evaluation-threshold")).toHaveText("≥ 20%");
    await expect(page.getByTestId("evaluation-margin").getByTestId("evaluation-threshold")).toHaveText("≥ 10%");
    await expect(page.getByTestId("evaluation-years").getByTestId("evaluation-threshold")).toHaveText("5年以内");
    await expect(page.getByTestId("evaluation-inclusion")).toHaveText("現在の条件でスクリーニング結果に含まれます");
    await expect(page.getByTestId("evaluation-cagr").getByTestId("evaluation-status")).toHaveText("満たす");
    await page.goto("/stocks/9Y002?off=owner");
    await expect(page.getByTestId("evaluation-inclusion")).toHaveText("条件③を満たさないため、スクリーニング結果に含まれません");
    await page.goto("/stocks/99998?off=owner");
    await expect(page.getByTestId("evaluation-inclusion")).toHaveText(
      "条件①・条件②が算出不可のため、スクリーニング結果から除外されています（『算出不可を含める』をオンにすると表示されます）",
    );
    // 銀行業も特別扱いしない（条件②は算出不可）
    await page.goto("/stocks/99997");
    await expect(page.getByTestId("evaluation-margin").getByTestId("evaluation-value")).toHaveText("算出不可（営業利益の開示なし）");
    await expect(page.getByTestId("evaluation-margin").getByTestId("evaluation-status")).toHaveText("算出不可");
  });

  test("スクリーニングの条件で判定する（C4-2〜C4-5）", async ({ page }) => {
    await seed();
    await loginAsOwner(page);
    await page.goto("/screening?off=owner");
    await page.getByRole("textbox", { name: "売上CAGR の閾値（%）" }).fill("15");
    await expect(page).toHaveURL(/[?&]cagr=15(&|$)/);
    await expect(row(page, "99992")).toBeVisible();
    await row(page, "99992").getByTestId("row-link-name").click();
    await expect(page).toHaveURL("/stocks/99992?cagr=15&margin=10&years=5&owner=20&ownermode=any&off=owner&sort=cagr&order=desc");
    await expect(page.getByTestId("evaluation-source")).toHaveText("スクリーニングの条件で判定しています");
    await expect(page.getByTestId("evaluation-cagr").getByTestId("evaluation-threshold")).toHaveText("≥ 15%");
    await expectEvaluation(page, ["met", "met", "met"], true);

    await page.goto("/stocks/99992?cagr=15.1&off=owner");
    await expect(page.getByTestId("evaluation-cagr")).toHaveAttribute("data-status", "unmet");
    await page.goto("/stocks/99990?cagr=20&margin=10&years=5&off=owner");
    await expectEvaluation(page, ["met", "met", "met"], true);
    await page.goto("/stocks/99990?years=4.9&off=owner");
    await expect(page.getByTestId("evaluation-years")).toHaveAttribute("data-status", "unmet");

    await page.goto("/stocks/99996?unavailable=include&off=owner");
    await expectEvaluation(page, ["unavailable", "met", "met"], true);
    await page.goto("/stocks/99996?off=cagr,owner");
    await expectEvaluation(page, ["off", "met", "met"], true);
    await expect(page.getByTestId("evaluation-cagr").getByTestId("evaluation-threshold")).toHaveText("オフ（絞り込みに使っていない）");

    await page.goto("/stocks/99991?market=0111&off=owner");
    await expectEvaluation(page, ["met", "met", "met"], false);
    await expect(page.getByTestId("evaluation-inclusion")).toHaveText("市場区分・業種の絞り込みの対象外のため、スクリーニング結果に含まれません");
    await expect(page.getByTestId("evaluation-filters")).toContainText("市場区分: プライム");
  });

  test("不正な条件は既定値で判定して注記（C4-6）", async ({ page, context }) => {
    await simulateServerClockBehind(context);
    const problems = collectPageProblems(page);
    await seed();
    await loginAsOwner(page);
    let res = await page.goto("/stocks/99991?cagr=abc&years=0&off=owner");
    expect(res?.status()).toBe(200);
    await expect(page.getByTestId("invalid-params-notice")).toHaveText("URL の条件の一部（cagr, years）が無効なため、既定値で判定しています");
    await expect(page.getByTestId("evaluation-cagr").getByTestId("evaluation-threshold")).toHaveText("≥ 20%");
    await expect(page.getByTestId("evaluation-years").getByTestId("evaluation-threshold")).toHaveText("5年以内");
    // 閾値の文法・範囲は Sprint 6 と同じ（上場年数は 0.1〜10.0。小数点以下2桁・範囲外の 99 は無効）
    for (const query of ["years=4.95", "years=99"]) {
      res = await page.goto(`/stocks/99991?${query}`);
      expect(res?.status()).toBe(200);
      await expect(page.getByTestId("invalid-params-notice")).toHaveText("URL の条件の一部（years）が無効なため、既定値で判定しています");
    }
    await page.goto("/stocks/99991?years=10&off=owner");
    await expect(page.getByTestId("invalid-params-notice")).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test("スクリーニングの API と一致する（C4-9）・連結と単体の混在（C4-10）", async ({ page }) => {
    await seed();
    await loginAsOwner(page);
    for (const [code, query, included] of [
      ["9Y004", "market=0113&sector=5250&off=margin,owner", true],
      ["99991", "market=0113&sector=3050&off=owner", false],
      ["99996", "cagr=15&unavailable=include&off=owner", true],
      ["9Y002", "off=years,owner", false],
    ] as const) {
      await page.goto(`/stocks/${code}?${query}`);
      await expect(page.getByTestId("evaluation-inclusion")).toHaveAttribute("data-included", String(included));
      const api = await (await page.request.get(`/api/screening?${query}`)).json();
      const hit = api.data.rows.find((r: { code: string }) => r.code === code);
      expect(Boolean(hit), `${code} ?${query}`).toBe(included);
      if (hit) {
        for (const key of ["cagr", "margin", "years"]) {
          await expect(page.getByTestId(`evaluation-${key}`)).toHaveAttribute("data-status", hit.status[key]);
        }
      }
    }
    await page.goto("/stocks/9Y004");
    await expect(page.getByTestId("metric-mixed-consolidation")).toHaveText("連結・単体が混在");
    await expect(page.getByTestId("metric-mixed-standard")).toHaveCount(0);
    for (const code of ["99991", "9Y001"]) {
      await page.goto(`/stocks/${code}`);
      await expect(page.getByTestId("metric-mixed-consolidation")).toHaveCount(0);
    }
  });
});

test.describe("見つからない銘柄（C5）", () => {
  test("404・コード・戻るリンク・リダイレクト・アプリ全体の 404（C5-1〜C5-5）", async ({ page }) => {
    const problems = collectPageProblems(page);
    await seed();
    await loginAsOwner(page);
    let res = await page.goto("/stocks/99989");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "銘柄が見つかりません" })).toBeVisible();
    await expect(page.getByTestId("not-found-code")).toHaveText("99989");
    await expect(page).toHaveTitle(/銘柄が見つかりません/);
    await expect(page.getByTestId("not-found-back")).toHaveAttribute("href", "/screening");
    await expect(page.locator("header").getByRole("navigation", { name: "メイン" })).toBeVisible();

    for (const bad of ["abc-1", "123456"]) {
      res = await page.goto(`/stocks/${bad}`);
      expect(res?.status(), bad).toBe(404);
      await expect(page.getByRole("heading", { level: 1, name: "銘柄が見つかりません" })).toBeVisible();
      await expect(page.getByTestId("not-found-code")).toHaveCount(0);
    }

    await page.goto("/stocks/9y001");
    await expect(page).toHaveURL("/stocks/9Y001");
    await expect(page.getByTestId("stock-header")).toContainText("検証用六期訂正株式会社");
    await page.goto("/stocks/9999?cagr=15&off=owner");
    await expect(page).toHaveURL("/stocks/99990?cagr=15&off=owner");
    await expect(page.getByTestId("evaluation-cagr").getByTestId("evaluation-threshold")).toHaveText("≥ 15%");

    await page.goto("/stocks/99989?cagr=15&off=owner");
    await expect(page.getByTestId("not-found-back")).toHaveAttribute("href", "/screening?cagr=15&margin=10&years=5&owner=20&ownermode=any&off=owner&sort=cagr&order=desc");
    await expect(page.getByTestId("breadcrumb-screening")).toHaveAttribute("href", "/screening?cagr=15&margin=10&years=5&owner=20&ownermode=any&off=owner&sort=cagr&order=desc");

    for (const path of ["/stocks", "/stocks/99991/zzz"]) {
      res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
      await expect(page.getByRole("heading", { level: 1, name: "ページが見つかりません" })).toBeVisible();
      await expect(mainNav(page).locator("[aria-current=page]")).toHaveCount(0);
    }
    expect(problems).toEqual([]);
  });

  test("未ログインでは銘柄の有無を明かさずログイン画面へ（C5-6）", async ({ browser }) => {
    await seed();
    const anonymous = await browser.newContext();
    const page = await anonymous.newPage();
    await page.goto("/stocks/99989");
    await expect(page).toHaveURL(`/login?next=${encodeURIComponent("/stocks/99989")}`);
    await expect(page.getByText("銘柄が見つかりません")).toHaveCount(0);
    await anonymous.close();
  });
});

test.describe("dev の時計のずれ（C6）", () => {
  test("notFound・redirect・クライアント遷移で pageerror もコンソールのエラーも出ない", async ({ page, context }) => {
    await simulateServerClockBehind(context);
    const problems = collectPageProblems(page);
    await seed();
    await loginAsOwner(page);
    await page.goto("/stocks/99991");
    await expect(page.getByTestId("stock-header")).toBeVisible();
    await page.goto("/stocks/99989");
    await expect(page.getByRole("heading", { level: 1, name: "銘柄が見つかりません" })).toBeVisible();
    await page.goto("/stocks/9y001");
    await expect(page).toHaveURL("/stocks/9Y001");
    await page.goto("/screening?off=owner");
    await row(page, "99991").getByTestId("row-link-name").click();
    await expect(page).toHaveURL(`/stocks/99991?${DEFAULT_QUERY}`);
    await page.getByTestId("breadcrumb-screening").click();
    await expect(page).toHaveURL(`/screening?${DEFAULT_QUERY}`);
    await expect.poll(() => rowCodes(page)).toEqual(["9Y001", "99991", "99990"]);
    // 「銘柄が見つかりません」からのクライアント遷移
    await page.goto("/stocks/99989?cagr=15&off=owner");
    await page.getByTestId("not-found-back").click();
    await expect(page).toHaveURL("/screening?cagr=15&margin=10&years=5&owner=20&ownermode=any&off=owner&sort=cagr&order=desc");
    await page.waitForTimeout(500);
    expect(problems).toEqual([]);
  });
});

const CONDITIONED = "/screening?cagr=15&margin=10&years=5&owner=20&ownermode=any&off=margin,owner&unavailable=include&sort=years&order=asc";

async function expectConditionedScreening(page: Page, codes: string[]) {
  await expect(page).toHaveURL(CONDITIONED);
  await expect.poll(() => rowCodes(page)).toEqual(codes);
  await expect(page.getByRole("textbox", { name: "売上CAGR の閾値（%）" })).toHaveValue("15");
  await expect(page.getByRole("switch", { name: "条件② 営業利益率 を使う" })).not.toBeChecked();
  await expect(page.getByRole("switch", { name: "算出不可を含める" })).toBeChecked();
  await expect(page.getByTestId("sort-years").locator("xpath=..")).toHaveAttribute("aria-sort", "ascending");
}

test.describe("スクリーニングに戻る（C7）", () => {
  test("パンくず・条件を変える・ブラウザの戻る/進む・ナビゲーション（C7-1・C7-2・C7-4・C7-5）", async ({ page }) => {
    await seed();
    await loginAsOwner(page);
    await page.goto("/screening?cagr=15&off=margin,owner&unavailable=include&sort=years&order=asc");
    await expect(page).toHaveURL("/screening?cagr=15&off=margin,owner&unavailable=include&sort=years&order=asc");
    const codes = (await rowCodes(page)) as string[];
    expect(codes.length).toBeGreaterThan(3);
    const target = "99992";
    const detailUrl = `/stocks/${target}?${CONDITIONED.split("?")[1]}`;

    // パンくず
    await row(page, target).getByTestId("row-link-name").click();
    await expect(page).toHaveURL(detailUrl);
    await expect(page.getByTestId("change-conditions")).toHaveAttribute("href", CONDITIONED);
    await expect(page.getByTestId("breadcrumb-screening")).toHaveAttribute("href", CONDITIONED);
    await page.getByTestId("breadcrumb-screening").click();
    await expectConditionedScreening(page, codes);

    // ブラウザの戻る・進む
    await row(page, target).getByTestId("row-link-name").click();
    await expect(page).toHaveURL(detailUrl);
    await page.goBack();
    await expectConditionedScreening(page, codes);
    await page.goForward();
    await expect(page).toHaveURL(detailUrl);

    // ヘッダーのナビゲーション
    await expect(mainNav(page).getByRole("link", { name: "スクリーニング" })).toHaveAttribute("href", CONDITIONED);
    await mainNav(page).getByRole("link", { name: "スクリーニング" }).click();
    await expectConditionedScreening(page, codes);

    // 条件を変える
    await row(page, target).getByTestId("row-link-name").click();
    await page.getByTestId("change-conditions").click();
    await expectConditionedScreening(page, codes);

    // ほかの画面・クエリなし・不正な項目
    for (const [path, href] of [
      ["/", "/screening"],
      ["/imports", "/screening"],
      ["/stocks/99991", "/screening"],
      ["/stocks/99991?cagr=abc&foo=1&off=owner", "/screening?cagr=20&margin=10&years=5&owner=20&ownermode=any&off=owner&sort=cagr&order=desc"],
      ["/stocks/99989?cagr=15&off=owner", "/screening?cagr=15&margin=10&years=5&owner=20&ownermode=any&off=owner&sort=cagr&order=desc"],
    ] as const) {
      await page.goto(path);
      await expect(mainNav(page).getByRole("link", { name: "スクリーニング" }), path).toHaveAttribute("href", href);
    }
  });

  test("375px のドロワーのナビゲーションから戻っても条件を保つ（C7-5）", async ({ browser }) => {
    await seed();
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await context.newPage();
    await login(page, OWNER.email, OWNER.password);
    await expect(page.getByRole("heading", { name: "ダッシュボード", level: 1 })).toBeVisible();
    await page.goto(CONDITIONED);
    const codes = (await rowCodes(page)) as string[];
    await row(page, "99992").getByTestId("row-link-code").click();
    await expect(page).toHaveURL(/\/stocks\/99992\?/);
    await page.getByRole("button", { name: "メニューを開く" }).click();
    const link = page.getByRole("dialog").getByRole("link", { name: "スクリーニング" });
    await expect(link).toHaveAttribute("href", CONDITIONED);
    await link.click();
    await expect(page).toHaveURL(CONDITIONED);
    await expect.poll(() => rowCodes(page)).toEqual(codes);
    await context.close();
  });

  test("2ページ目から開いて戻ると2ページ目（C7-3）", async ({ page }) => {
    await seed();
    await sql(PAGING_SQL);
    await loginAsOwner(page);
    await page.goto("/screening?page=2&off=owner");
    await expect(page.getByTestId("page-position")).toHaveText("2 / 2 ページ");
    const codes = (await rowCodes(page)) as string[];
    await row(page, codes[0]!).getByTestId("row-link-name").click();
    await expect(page).toHaveURL(new RegExp(`/stocks/${codes[0]}\\?.*page=2$`));
    await page.getByTestId("breadcrumb-screening").click();
    await expect(page).toHaveURL(/[?&]page=2$/);
    await expect(page.getByTestId("page-position")).toHaveText("2 / 2 ページ");
    await expect.poll(() => rowCodes(page)).toEqual(codes);
  });
});

test.describe("API（C8）", () => {
  test("GET /api/stocks/[code] の値・枠・判定・400・404・401・405", async ({ page, playwright }) => {
    await seed();
    await loginAsOwner(page);
    const res = await page.request.get("/api/stocks/99991");
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toContain("no-store");
    const body = (await res.json()).data;
    expect(body.stock).toMatchObject({ code: "99991", company_name: "検証用成長二五株式会社", market_name: "グロース" });
    expect(body.referenceDate).toBe("2026-09-24");
    expect(body.listing).toMatchObject({ first_price_date: "2022-09-24", estimated_listing_years: 4, listed_before_data_start: false });
    expect(body.metrics).toMatchObject({ revenue_cagr_display_pct: 25, operating_margin_display_pct: 15 });
    expect(body.periods).toHaveLength(5);
    expect(body.slots.map((s: { position: string }) => s.position)).toEqual(["FY-4", "FY-3", "FY-2", "FY-1", "FY0"]);
    // Sprint 10: 既定の条件では条件④もオン。有報の無い 99991 は判定不能（④ unavailable）で、結果に含まれない（契約の C12-1。self-review に記載）
    expect(body.evaluation).toMatchObject({
      source: "default",
      status: { cagr: "met", margin: "met", years: "met", owner: "unavailable" },
      ownerResult: "undeterminable",
      included: false,
      matchesFilters: true,
    });
    const offOwner = (await (await page.request.get("/api/stocks/99991?off=owner")).json()).data.evaluation;
    expect(offOwner).toMatchObject({ source: "screening", status: { cagr: "met", margin: "met", years: "met", owner: "off" }, included: true });

    const s96 = (await (await page.request.get("/api/stocks/99996")).json()).data.slots;
    expect(s96.slice(0, 2)).toEqual([
      { position: "FY-4", fiscal_year_end: "2019-03-31", missing: true },
      { position: "FY-3", fiscal_year_end: "2020-03-31", missing: true },
    ]);
    const s9y2 = (await (await page.request.get("/api/stocks/9Y002")).json()).data.slots;
    expect(s9y2.slice(0, 2)).toEqual([
      { position: "FY-4", fiscal_year_end: "2021-03-31", missing: false },
      { position: "FY-3", fiscal_year_end: "2022-03-31", missing: true },
    ]);

    const c30 = (await (await page.request.get("/api/stocks/99991?cagr=30&off=owner")).json()).data.evaluation;
    expect(c30).toMatchObject({ source: "screening", status: { cagr: "unmet" }, included: false });

    const notFound = await page.request.get("/api/stocks/99989");
    expect(notFound.status()).toBe(404);
    expect(await notFound.json()).toEqual({ error: "not_found" });
    const badCode = await page.request.get("/api/stocks/abc-1");
    expect(badCode.status()).toBe(400);
    expect(await badCode.json()).toEqual({ error: "invalid_code" });
    const badParams = await page.request.get("/api/stocks/99991?cagr=abc&off=owner");
    expect(await badParams.json()).toEqual({ error: "invalid_params", fields: ["cagr"] });
    const badBoth = await page.request.get("/api/stocks/99991?cagr=abc&years=0&off=owner");
    expect(badBoth.status()).toBe(400);
    expect(await badBoth.json()).toEqual({ error: "invalid_params", fields: ["cagr", "years"] });
    for (const code of ["9y001", "9999"]) expect((await page.request.get(`/api/stocks/${code}`)).status(), code).toBe(200);
    expect((await page.request.post("/api/stocks/99991")).status()).toBe(405);

    const anonymous = await playwright.request.newContext({ baseURL: page.url() });
    const unauth = await anonymous.get("/api/stocks/99991");
    expect(unauth.status()).toBe(401);
    expect(await unauth.text()).not.toContain("99991");
    await anonymous.dispose();

    const { rows: runs } = await sql("select count(*)::int as n from public.ingestion_runs where target <> 'daily_quotes'");
    expect(runs[0].n).toBe(0);
  });
});

test.describe("取り込み状況の画面からの導線（C9）", () => {
  test("銘柄コードで確認の結果から詳細を開ける", async ({ page }) => {
    await seed();
    await loginAsOwner(page);
    await page.goto("/imports?code=99991");
    await page.getByTestId("open-stock-detail").click();
    await expect(page).toHaveURL("/stocks/99991");
    await expect(page.getByTestId("evaluation-source")).toHaveText("既定の条件で判定しています");
    await page.goto("/imports?code=99989");
    await expect(page.getByTestId("open-stock-detail")).toHaveCount(0);
  });
});

test.describe("375px（C11-4）", () => {
  test("ページの横スクロールが無く、表は枠の中でスクロールし、グラフの5枠が見える", async ({ browser }) => {
    await seed();
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await context.newPage();
    const problems = collectPageProblems(page);
    await login(page, OWNER.email, OWNER.password);
    await expect(page.getByRole("heading", { name: "ダッシュボード", level: 1 })).toBeVisible();
    for (const code of ["9Y001", "99996", "9Y003"]) {
      await page.goto(`/stocks/${code}`);
      await expect(page.getByTestId("stock-header")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth), code).toBeLessThanOrEqual(375);
      const slots = page.getByTestId("financial-chart").getByTestId("chart-slot");
      await expect(slots).toHaveCount(5);
      for (let i = 0; i < 5; i += 1) {
        const box = await slots.nth(i).boundingBox();
        expect(box!.x + box!.width, `${code} slot ${i}`).toBeLessThanOrEqual(375);
      }
      const scroller = page.getByTestId("five-period-table").locator("xpath=..");
      expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    }
    expect(problems).toEqual([]);
    await context.close();
  });
});

test.describe("Sprint 6 評価の軽微な指摘（C12）", () => {
  test("m1: 既定の条件に戻すと、入力欄の不正な値とエラーの表示が消える", async ({ page }) => {
    await seed();
    await loginAsOwner(page);
    await page.goto("/screening?cagr=15&off=margin,owner&market=0113&unavailable=include&sort=years&order=asc");
    const years = page.getByRole("textbox", { name: "上場年数 の閾値（年）" });
    await years.fill("zz");
    await expect(years).toHaveAttribute("aria-invalid", "true");
    await page.getByRole("button", { name: "既定の条件に戻す" }).click();
    // Sprint 10: 既定の条件は条件④もオン（正規形に owner=20&ownermode=any が入る。契約の C12-1 の種類2）
    await expect(page).toHaveURL("/screening?cagr=20&margin=10&years=5&owner=20&ownermode=any&sort=cagr&order=desc");
    await expect(page.getByRole("textbox", { name: "売上CAGR の閾値（%）" })).toHaveValue("20");
    await expect(page.getByRole("textbox", { name: "営業利益率 の閾値（%）" })).toHaveValue("10");
    await expect(years).toHaveValue("5");
    await expect(years).not.toHaveAttribute("aria-invalid", /.*/);
    await expect(page.getByText("0.1〜10 の数値を小数点以下1桁までで入力してください")).toHaveCount(0);
  });

  test("m3・m4・m5: 並べ替えの矢印の位置、市場区分が見える、印の title は結果の閾値", async ({ page }) => {
    await seed();
    await loginAsOwner(page);
    await page.goto("/screening?off=owner");
    // m4: 1280×800 で「市場区分」と AC6.12 の注記がスクロールなしで見える
    await expect(page.getByTestId("market-filter").locator("legend")).toBeInViewport();
    await expect(page.getByTestId("cagr-supplement-note").filter({ visible: true })).toBeInViewport();
    // m3: 右揃えの列の矢印は見出しの文字の右隣（セルの反対側の端に離れない）
    for (const key of ["cagr", "margin", "years"]) {
      const button = page.getByTestId(`sort-${key}`);
      const icon = await button.getByTestId("sort-icon").boundingBox();
      const cell = await button.locator("xpath=..").boundingBox();
      expect(icon!.x + icon!.width, key).toBeGreaterThan(cell!.x + cell!.width - 16);
    }
    // m5: 入力を変えた直後（取り直しの前）でも、印の title は結果の条件の閾値
    const mark = row(page, "99991").getByTestId("condition-status-cagr");
    await expect(mark).toHaveAttribute("title", "条件① 売上CAGR（≥20%）: 満たす");
    await page.getByRole("textbox", { name: "売上CAGR の閾値（%）" }).fill("22");
    await expect(mark).toHaveAttribute("title", "条件① 売上CAGR（≥20%）: 満たす");
    await expect(page).toHaveURL(/[?&]cagr=22(&|$)/);
    await expect(mark).toHaveAttribute("title", "条件① 売上CAGR（≥22%）: 満たす");
  });
});
