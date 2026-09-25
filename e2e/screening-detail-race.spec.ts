import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page, type Route } from "@playwright/test";

import { collectPageProblems, loginAsOwner, simulateServerClockBehind, sql, expectNoPresets } from "./support";

/**
 * Sprint 7 評価の B1（Sprint 8 の契約の C9）: 閾値を入力した直後に結果の行をクリックしても、詳細への遷移が失われない。
 * 前提: 市場データと実行履歴が0件の DB。Sprint 7 の投入例（screening-example.sql ＋ stock-detail-example.sql）を使い、各テストの後に削除する。
 */
test.describe.configure({ mode: "serial" });

const SCREENING_SQL = readFileSync(join(__dirname, "fixtures/screening-example.sql"), "utf8");
const DETAIL_SQL = readFileSync(join(__dirname, "fixtures/stock-detail-example.sql"), "utf8");
const Q15 = "cagr=15&margin=10&years=5&owner=20&ownermode=any&off=owner&sort=cagr&order=desc";
const Q14 = "cagr=14&margin=10&years=5&owner=20&ownermode=any&off=owner&sort=cagr&order=desc";

const cagrInput = (page: Page) => page.getByRole("textbox", { name: "売上CAGR の閾値（%）" });
const row = (page: Page, code: string) => page.locator(`tr[data-code="${code}"]`);

/** スクリーニングの取り直し（RSC の要求）を遅らせる。書き換えが発行済みで応答を待っている状態を確実に作る。 */
async function delayScreeningRsc(page: Page, ms = 800) {
  await page.route(
    (url) => url.pathname === "/screening",
    async (route: Route) => {
      if (route.request().headers()["rsc"]) await new Promise((resolve) => setTimeout(resolve, ms));
      await route.continue();
    },
  );
}

/** URL が1,500ms の間、詳細のまま（スクリーニングに戻らない）。 */
async function expectStaysOn(page: Page, url: string) {
  await expect(page).toHaveURL(url);
  await page.waitForTimeout(1_500);
  await expect(page).toHaveURL(url);
  await expect(page.getByTestId("stock-header")).toBeVisible();
}

test.beforeAll(async () => {
  await expectNoPresets(); // Sprint 13（契約の C10-4）
  const { rows } = await sql(
    "select (select count(*) from public.stocks)::int as stocks, (select count(*) from public.ingestion_runs)::int as runs",
  );
  expect(rows[0], "E2E の前提: 市場データ・実行履歴が0件").toEqual({ stocks: 0, runs: 0 });
});

test.beforeEach(async () => {
  await sql(SCREENING_SQL);
  await sql(DETAIL_SQL);
});

test.afterEach(async () => {
  await sql("delete from public.stocks where code like '9999%' or code like '9Y%'");
  await sql("delete from public.ingestion_runs");
});

for (const skew of [false, true]) {
  const label = skew ? "（時計のずれの状態）" : "";

  test(`入力の直後に社名のリンクをクリックすると、表示中の結果の条件の詳細に移り、戻らない。「戻る」で最後の入力（14）が表示される（C9-1・C9-4）${label}`, async ({ page, context }) => {
    if (skew) await simulateServerClockBehind(context);
    const problems = collectPageProblems(page);
    await loginAsOwner(page);
    await page.goto(`/screening?${Q15}`);
    await expect(row(page, "99992")).toBeVisible();
    await delayScreeningRsc(page);

    await cagrInput(page).fill("14");
    await row(page, "99992").getByTestId("row-link-name").click();
    await expectStaysOn(page, `/stocks/99992?${Q15}`);
    await expect(page.getByTestId("evaluation-cagr").getByTestId("evaluation-threshold")).toHaveText("≥ 15%");

    await page.unrouteAll({ behavior: "wait" });
    await page.goBack();
    await expect(page).toHaveURL(`/screening?${Q14}`);
    await expect(cagrInput(page)).toHaveValue("14");
    await expect(row(page, "99992").getByTestId("row-link-code")).toHaveAttribute("href", `/stocks/99992?${Q14}`);
    expect(problems).toEqual([]);
  });

  test(`入力の直後に業種のセル（リンク以外）をクリックしても同じ詳細に移る（C9-2）${label}`, async ({ page, context }) => {
    if (skew) await simulateServerClockBehind(context);
    const problems = collectPageProblems(page);
    await loginAsOwner(page);
    await page.goto(`/screening?${Q15}`);
    await expect(row(page, "99992")).toBeVisible();
    await delayScreeningRsc(page);

    await cagrInput(page).fill("14");
    await row(page, "99992").locator("td").nth(3).click();
    await expectStaysOn(page, `/stocks/99992?${Q15}`);
    expect(problems).toEqual([]);
  });

  test(`Tab で入力を確定し、結果が cagr 14 に更新されてから、コードのリンクで Enter → cagr=14 の詳細（C9-3）${label}`, async ({ page, context }) => {
    if (skew) await simulateServerClockBehind(context);
    const problems = collectPageProblems(page);
    await loginAsOwner(page);
    await page.goto(`/screening?${Q15}`);
    await expect(row(page, "99992")).toBeVisible();

    await cagrInput(page).fill("14");
    await cagrInput(page).press("Tab");
    // 結果の更新を待つ（URL と、行のリンクの条件が 14 になる）
    await expect(page).toHaveURL(`/screening?${Q14}`);
    const link = row(page, "99992").getByTestId("row-link-code");
    await expect(link).toHaveAttribute("href", `/stocks/99992?${Q14}`);
    await link.focus();
    await page.keyboard.press("Enter");
    await expectStaysOn(page, `/stocks/99992?${Q14}`);
    expect(problems).toEqual([]);
  });

  test(`書き換えが発行済みで応答を待っている間にクリックしても、クリックした時点の条件（cagr=15）の詳細に移り、戻らない（C9-3a）${label}`, async ({ page, context }) => {
    if (skew) await simulateServerClockBehind(context);
    const problems = collectPageProblems(page);
    await loginAsOwner(page);
    await page.goto(`/screening?${Q15}`);
    await expect(row(page, "99992")).toBeVisible();
    await delayScreeningRsc(page);

    await cagrInput(page).fill("14");
    // マウスの mousedown で入力欄のフォーカスが外れ、書き換え（cagr=14）が遅延 0 で発行される。その応答は 800ms 遅れる
    const rsc = page.waitForRequest((request) => new URL(request.url()).pathname === "/screening" && Boolean(request.headers()["rsc"]));
    await row(page, "99992").getByTestId("row-link-name").hover();
    await page.mouse.down();
    await rsc;
    await page.mouse.up();
    await expectStaysOn(page, `/stocks/99992?${Q15}`);
    expect(problems).toEqual([]);
  });
}

test("入力の直後に ⌘（Ctrl）クリックで新しいタブに開くと、元のタブはスクリーニングのままで、URL は cagr=14 になる（C9-5）", async ({ page, context }) => {
  await loginAsOwner(page);
  await page.goto(`/screening?${Q15}`);
  await expect(row(page, "99992")).toBeVisible();
  await cagrInput(page).fill("14");
  const popup = context.waitForEvent("page");
  await row(page, "99992").locator("td").nth(3).click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
  const opened = await popup;
  await opened.waitForLoadState();
  expect(new URL(opened.url()).pathname).toBe("/stocks/99992");
  await expect(page).toHaveURL(`/screening?${Q14}`);
  await expect(cagrInput(page)).toHaveValue("14");
  await opened.close();
});
