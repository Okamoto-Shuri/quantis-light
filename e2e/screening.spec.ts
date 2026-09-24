import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { collectPageProblems, login, loginAsOwner, OWNER, simulateServerClockBehind, sql } from "./support";

/**
 * スクリーニング（F6、Sprint 6）。契約の第5章の投入例（e2e/fixtures）を使う。
 * 前提: 市場データと実行履歴が0件の DB。投入するコードは 9999x と 9Z001〜9Z120 で、各テストの後に削除する。
 */
test.describe.configure({ mode: "serial" });

const EXAMPLE_SQL = readFileSync(join(__dirname, "fixtures/screening-example.sql"), "utf8");
const PAGING_SQL = readFileSync(join(__dirname, "fixtures/screening-paging.sql"), "utf8");
const NOTE = "上場から約4年未満の銘柄は、上場前の期のデータがまだ無いため通期実績が5期に満たず、条件①（売上CAGR）を算出できません。";

const rows = (page: Page) => page.getByTestId("screening-table").locator("tbody tr");
const rowCodes = (page: Page) => rows(page).evaluateAll((trs) => trs.map((tr) => tr.getAttribute("data-code")));
const count = (page: Page) => page.getByTestId("result-count");
const cagrInput = (page: Page) => page.getByRole("textbox", { name: "売上CAGR の閾値（%）" });
const toggle = (page: Page, name: string) => page.getByRole("switch", { name });

async function expectCodes(page: Page, expected: string[]) {
  await expect.poll(() => rowCodes(page)).toEqual(expected);
  await expect(count(page)).toHaveText(String(expected.length));
}

test.beforeAll(async () => {
  const { rows: pre } = await sql(
    "select (select count(*) from public.stocks)::int as stocks, (select count(*) from public.ingestion_runs)::int as runs",
  );
  expect(pre[0], "E2E の前提: 市場データ・実行履歴が0件").toEqual({ stocks: 0, runs: 0 });
});

test.afterEach(async () => {
  await sql("delete from public.stocks where code like '9999%' or code like '9Z%'");
  await sql("delete from public.ingestion_runs");
});

test.describe("画面を開いたときの表示（C1）", () => {
  test("ナビゲーションから開くと、既定の条件で 99991・99990 の2件。注記と基準日", async ({ page }) => {
    const problems = collectPageProblems(page);
    await sql(EXAMPLE_SQL);
    await loginAsOwner(page);
    await page.getByRole("navigation", { name: "メイン" }).getByRole("link", { name: "スクリーニング" }).click();
    await expect(page).toHaveURL("/screening");
    await expect(page.getByRole("heading", { level: 1, name: "スクリーニング" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "メイン" }).getByRole("link", { name: "スクリーニング" })).toHaveAttribute("aria-current", "page");

    await expect(cagrInput(page)).toHaveValue("20");
    await expect(page.getByRole("textbox", { name: "営業利益率 の閾値（%）" })).toHaveValue("10");
    await expect(page.getByRole("textbox", { name: "上場年数 の閾値（年）" })).toHaveValue("5");
    for (const name of ["条件① 売上CAGR を使う", "条件② 営業利益率 を使う", "条件③ 上場年数 を使う"]) {
      await expect(toggle(page, name)).toBeChecked();
    }
    await expect(toggle(page, "算出不可を含める")).not.toBeChecked();
    await expect(page.getByTestId("market-filter")).toContainText("すべて");
    await expect(page.getByTestId("sector-filter")).toContainText("すべて");

    await expectCodes(page, ["99991", "99990"]);
    await expect(page.getByTestId("result-summary")).toContainText("該当 2 件（銘柄マスタ 10 銘柄中）");
    await expect(page.getByTestId("screening-conditions").first()).toContainText("直近5期の通期実績から算出（成長4年分）");
    const note = page.getByTestId("cagr-provisional-note").filter({ visible: true });
    await expect(note).toHaveText(NOTE);
    await expect(note).toBeInViewport();
    await expect(page.getByText(/基準日 2026-09-24/)).toBeVisible();
    expect(problems).toEqual([]);
  });

  test("375px でも、条件パネルを開かずに注記が結果の上に見える", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await context.newPage();
    await sql(EXAMPLE_SQL);
    await loginAsOwner(page);
    await page.getByRole("button", { name: "メニューを開く" }).click();
    await page.getByRole("dialog").getByRole("link", { name: "スクリーニング" }).click();
    await expect(page).toHaveURL("/screening");
    const note = page.getByTestId("cagr-provisional-note").filter({ visible: true });
    await expect(note).toHaveText(NOTE);
    await expect(note).toBeInViewport();
    await expect(page.getByTestId("conditions-summary")).toContainText("CAGR ≥20% ・ 営業利益率 ≥10% ・ 上場5年以内");
    await context.close();
  });
});

test.describe("閾値（C2）", () => {
  test("CAGR を 15 → 20 に変えると 99992 が加わり、消える。URL に反映される（AC6.3）", async ({ page }) => {
    const problems = collectPageProblems(page);
    await sql(EXAMPLE_SQL);
    await loginAsOwner(page);
    await page.goto("/screening");
    await cagrInput(page).fill("15");
    await expect(page).toHaveURL(/[?&]cagr=15(&|$)/);
    await expectCodes(page, ["99991", "99990", "99992"]);
    await cagrInput(page).fill("20");
    await cagrInput(page).press("Enter");
    await expect(page).toHaveURL(/[?&]cagr=20(&|$)/);
    await expectCodes(page, ["99991", "99990"]);
    await expect(page).toHaveURL("/screening?cagr=20&margin=10&years=5&sort=cagr&order=desc");
    expect(problems).toEqual([]);
  });

  test("スライダーを矢印キーで連続して操作しても、最後の値だけが反映され、コンソールにエラーが出ない（C2-2・C2-6）", async ({ page }) => {
    const problems = collectPageProblems(page);
    await sql(EXAMPLE_SQL);
    await loginAsOwner(page);
    await page.goto("/screening");
    const slider = page.getByRole("slider", { name: "売上CAGR の閾値（%）（スライダー）" });
    await slider.focus();
    for (let i = 0; i < 10; i += 1) await page.keyboard.press("ArrowLeft");
    await expect(cagrInput(page)).toHaveValue("10");
    await expect(page).toHaveURL(/[?&]cagr=10(&|$)/);
    await expectCodes(page, ["99991", "99990", "99992"]);
    expect(problems).toEqual([]);
  });

  test("入力エラーは結果と URL を変えない（C2-5）。全角・U+2212 のマイナスは受け付ける", async ({ page }) => {
    await sql(EXAMPLE_SQL);
    await loginAsOwner(page);
    await page.goto("/screening?cagr=20&margin=10&years=5&sort=cagr&order=desc");
    const url = page.url();
    for (const [name, value] of [
      ["売上CAGR の閾値（%）", "abc"],
      ["売上CAGR の閾値（%）", ""],
      ["売上CAGR の閾値（%）", "20.55"],
      ["売上CAGR の閾値（%）", "1001"],
      ["上場年数 の閾値（年）", "0"],
      ["上場年数 の閾値（年）", "10.5"],
    ] as const) {
      const input = page.getByRole("textbox", { name });
      await input.fill(value);
      await expect(input).toHaveAttribute("aria-invalid", "true");
      await expect(page.getByRole("alert").filter({ hasText: "の数値を小数点以下1桁までで入力してください" })).toBeVisible();
      await page.waitForTimeout(600);
      expect(page.url()).toBe(url);
      await expectCodes(page, ["99991", "99990"]);
      await input.fill(name.startsWith("上場") ? "5" : "20");
      await expect(input).not.toHaveAttribute("aria-invalid", "true");
    }
    await cagrInput(page).fill("１５");
    await expect(page).toHaveURL(/[?&]cagr=15(&|$)/);
    await cagrInput(page).fill("−5");
    await expect(page).toHaveURL(/[?&]cagr=-5(&|$)/);
  });
});

test.describe("条件のオン／オフ（C3）", () => {
  test("②オフで4件（99997 は ② off）、③オフで5件、全部オフで10件", async ({ page }) => {
    await sql(EXAMPLE_SQL);
    await loginAsOwner(page);
    await page.goto("/screening");
    await toggle(page, "条件② 営業利益率 を使う").click();
    await expect(page).toHaveURL(/[?&]off=margin(&|$)/);
    await expectCodes(page, ["99993", "99991", "99997", "99990"]);
    await expect(page.getByRole("textbox", { name: "営業利益率 の閾値（%）" })).toBeDisabled();
    const r97 = page.locator("tr[data-code='99997']");
    await expect(r97.getByTestId("condition-status-cagr")).toHaveAttribute("data-status", "met");
    await expect(r97.getByTestId("condition-status-margin")).toHaveAttribute("data-status", "off");
    await expect(r97.getByTestId("condition-status-years")).toHaveAttribute("data-status", "met");
    await expect(r97.getByTestId("cell-margin")).toHaveText("算出不可（営業利益の開示なし）");
    await expect(page.getByTestId("excluded-unavailable")).toContainText("算出不可・未確定のため除外: 3 件");

    await toggle(page, "条件② 営業利益率 を使う").click();
    await toggle(page, "条件③ 上場年数 を使う").click();
    await expect(page).toHaveURL(/[?&]off=years(&|$)/);
    await expectCodes(page, ["99995", "99991", "99994", "99999", "99990"]);
    await expect(page.locator("tr[data-code='99999']").getByTestId("condition-status-years")).toHaveAttribute("data-status", "off");
    await expect(page.locator("tr[data-code='99999']").getByTestId("cell-years")).toHaveText("未確定");
    await expect(page.getByTestId("excluded-unavailable")).toContainText("算出不可・未確定のため除外: 3 件");

    await toggle(page, "条件① 売上CAGR を使う").click();
    await toggle(page, "条件② 営業利益率 を使う").click();
    await expect(page).toHaveURL(/[?&]off=cagr,margin,years(&|$)/);
    await expect(count(page)).toHaveText("10");
    for (const mark of await page.getByTestId("condition-status-cagr").all()) await expect(mark).toHaveAttribute("data-status", "off");
    // オフにした閾値は保たれる
    await toggle(page, "条件③ 上場年数 を使う").click();
    await expect(page.getByRole("textbox", { name: "上場年数 の閾値（年）" })).toHaveValue("5");
  });
});

test.describe("算出不可を含める（C4）", () => {
  test("オンにすると 99996〜99999 が加わり、99995 は加わらない。表示の区別", async ({ page }) => {
    await sql(EXAMPLE_SQL);
    await loginAsOwner(page);
    await page.goto("/screening");
    await expect(page.getByTestId("excluded-unavailable")).toContainText("算出不可・未確定のため除外: 4 件");
    await page.getByRole("button", { name: "含めて表示" }).click();
    await expect(page).toHaveURL(/[?&]unavailable=include(&|$)/);
    await expect(toggle(page, "算出不可を含める")).toBeChecked();
    await expectCodes(page, ["99991", "99997", "99999", "99990", "99996", "99998"]);

    const r96 = page.locator("tr[data-code='99996']");
    await expect(r96.getByTestId("cell-cagr")).toHaveText("算出不可（通期実績が5期未満）");
    await expect(r96.getByTestId("condition-status-cagr")).toHaveAttribute("data-status", "unavailable");
    await expect(page.getByTestId("cagr-provisional-note").filter({ visible: true })).toHaveText(NOTE);
    const r97 = page.locator("tr[data-code='99997']");
    await expect(r97.getByTestId("cell-cagr")).toHaveText("25.0%");
    await expect(r97.getByTestId("cell-margin")).toHaveText("算出不可（営業利益の開示なし）");
    await expect(page.getByTestId("screening-conditions").first()).toContainText("銀行など営業利益を開示しない会社は、営業利益率が算出不可になります。");
    await expect(page.locator("tr[data-code='99998']").getByTestId("cell-cagr")).toHaveText("財務データなし");
    await expect(page.locator("tr[data-code='99998']").getByTestId("cell-margin")).toHaveText("財務データなし");
    await expect(page.locator("tr[data-code='99999']").getByTestId("cell-years")).toHaveText("未確定");
    await expect(r96.getByTestId("cell-cagr").locator("[data-kind=unavailable]")).toBeVisible();

    await cagrInput(page).fill("30");
    await expect(page).toHaveURL(/[?&]cagr=30(&|$)/);
    await expect.poll(() => rowCodes(page)).toContain("99996");
    expect(await rowCodes(page)).not.toContain("99997");
  });
});

test.describe("並べ替え（C5）", () => {
  test("見出しで並べ替えると順序・aria-sort・URL が変わる", async ({ page }) => {
    await sql(EXAMPLE_SQL);
    await loginAsOwner(page);
    await page.goto("/screening?off=cagr,margin,years&unavailable=include");
    await expectCodes(page, ["99995", "99993", "99991", "99997", "99994", "99999", "99990", "99992", "99996", "99998"]);
    const cagrHeader = page.locator("th").filter({ has: page.getByTestId("sort-cagr") });
    await expect(cagrHeader).toHaveAttribute("aria-sort", "descending");

    await page.getByTestId("sort-cagr").click();
    await expect(page).toHaveURL(/sort=cagr&order=asc/);
    await expectCodes(page, ["99992", "99990", "99999", "99994", "99991", "99997", "99993", "99995", "99996", "99998"]);
    await expect(cagrHeader).toHaveAttribute("aria-sort", "ascending");

    await page.getByTestId("sort-years").click();
    await expect(page).toHaveURL(/sort=years&order=asc/);
    await expectCodes(page, ["99998", "99996", "99993", "99997", "99991", "99992", "99990", "99994", "99995", "99999"]);
    await page.getByTestId("sort-years").press("Enter");
    await expect(page).toHaveURL(/sort=years&order=desc/);
    await expectCodes(page, ["99995", "99994", "99990", "99991", "99992", "99993", "99997", "99996", "99998", "99999"]);

    await page.getByTestId("sort-margin").click();
    await expectCodes(page, ["99995", "99994", "99996", "99991", "99992", "99999", "99990", "99993", "99997", "99998"]);
    await page.getByTestId("sort-market").click();
    await expectCodes(page, ["99990", "99994", "99995", "99997", "99992", "99999", "99991", "99993", "99996", "99998"]);
  });
});

test.describe("URL（C6）", () => {
  const URL_WITH_CONDITIONS = "/screening?cagr=15&margin=10&years=8&unavailable=include&market=0113&sort=years&order=asc";

  test("条件付きの URL をリロードしても同じ。未ログインはログイン画面を経由して同じ URL に戻る", async ({ page, browser }) => {
    await sql(EXAMPLE_SQL);
    await loginAsOwner(page);
    await page.goto(URL_WITH_CONDITIONS);
    const expected = ["99998", "99996", "99991"];
    await expectCodes(page, expected);
    await page.reload();
    await expectCodes(page, expected);
    await expect(cagrInput(page)).toHaveValue("15");
    await expect(page.getByRole("checkbox", { name: /^グロース/ })).toBeChecked();

    const anonymous = await browser.newContext();
    const other = await anonymous.newPage();
    await other.goto(URL_WITH_CONDITIONS);
    await expect(other).toHaveURL(`/login?next=${encodeURIComponent(URL_WITH_CONDITIONS)}`);
    await expect(other.getByText("検証用成長二五株式会社")).toHaveCount(0);
    await other.getByLabel("メールアドレス").fill(OWNER.email);
    await other.getByLabel("パスワード").fill(OWNER.password);
    await other.getByRole("button", { name: "ログイン" }).click();
    await expect(other).toHaveURL(URL_WITH_CONDITIONS);
    await expectCodes(other, expected);
    await anonymous.close();
  });

  test("不正な URL はその項目だけ既定値で注記。時計のずれがあっても pageerror は0件（C6-4）", async ({ page, context }) => {
    await simulateServerClockBehind(context);
    const problems = collectPageProblems(page);
    await sql(EXAMPLE_SQL);
    await loginAsOwner(page);
    for (const [query, field] of [
      ["cagr=abc", "cagr"],
      ["cagr=+20", "cagr"],
      ["cagr=1e1", "cagr"],
      ["cagr=10&cagr=20", "cagr"],
      ["years=99", "years"],
      ["sort=zzz", "sort"],
      ["market=9999", "market"],
      ["sector=9999", "sector"],
      ["page=-1", "page"],
      ["page=abc", "page"],
      ["off=foo", "off"],
    ]) {
      const res = await page.goto(`/screening?${query}`);
      expect(res?.status(), query).toBe(200);
      await expect(page.getByTestId("invalid-params-notice")).toHaveText(`URL の条件の一部（${field}）が無効なため、既定値で表示しています`);
      await expectCodes(page, ["99991", "99990"]);
    }

    await page.goto("/screening?market=0111,9999");
    await expect(page.getByTestId("invalid-params-notice")).toContainText("market");
    await expectCodes(page, ["99990"]);
    await expect(page.getByRole("checkbox", { name: /^プライム/ })).toBeChecked();

    await page.goto("/screening?off=margin,foo");
    await expect(page.getByTestId("invalid-params-notice")).toContainText("off");
    await expect(count(page)).toHaveText("4");

    await page.goto("/screening?foo=1&unavailable=exclude&market=0111,0111&cagr=020.0");
    await expect(page.getByTestId("invalid-params-notice")).toHaveCount(0);
    await expectCodes(page, ["99990"]);
    await page.getByTestId("sort-code").click();
    await expect(page).toHaveURL("/screening?cagr=20&margin=10&years=5&market=0111&sort=code&order=asc");

    await page.goto("/screening?sector=0050");
    await expect(page.getByTestId("sector-chips")).toContainText("水産・農林業（該当銘柄なし）");
    await expect(page.getByText("条件に一致する銘柄はありません")).toBeVisible();
    await page.getByRole("button", { name: "水産・農林業 を外す" }).click();
    await expectCodes(page, ["99991", "99990"]);
    expect(problems).toEqual([]);
  });

  test("戻る・進むで直前の条件が復元され、閾値の入力のたびに履歴は増えない（C6-6）", async ({ page }) => {
    await sql(EXAMPLE_SQL);
    await loginAsOwner(page);
    await page.getByRole("navigation", { name: "メイン" }).getByRole("link", { name: "スクリーニング" }).click();
    await expect(page).toHaveURL("/screening");
    for (const value of ["18", "16", "15"]) {
      await cagrInput(page).fill(value);
      await expect(page).toHaveURL(new RegExp(`[?&]cagr=${value}(&|$)`));
    }
    await page.getByRole("navigation", { name: "メイン" }).getByRole("link", { name: "取り込み状況" }).click();
    await expect(page).toHaveURL("/imports");
    await page.goBack();
    await expect(page).toHaveURL(/[?&]cagr=15(&|$)/);
    await expect(cagrInput(page)).toHaveValue("15");
    await expectCodes(page, ["99991", "99990", "99992"]);
    await page.goBack();
    await expect(page).toHaveURL("/");
    await page.goForward();
    await expect(page).toHaveURL(/[?&]cagr=15(&|$)/);
    await expect(cagrInput(page)).toHaveValue("15");
  });

  test("入力欄の不正な値が残ったまま別の操作をすると、URL は直前の有効な値（C6-5）", async ({ page }) => {
    await sql(EXAMPLE_SQL);
    await loginAsOwner(page);
    await page.goto("/screening");
    await cagrInput(page).fill("abc");
    await toggle(page, "条件② 営業利益率 を使う").click();
    await expect(page).toHaveURL("/screening?cagr=20&margin=10&years=5&off=margin&sort=cagr&order=desc");
    await expectCodes(page, ["99993", "99991", "99997", "99990"]);
    await expect(cagrInput(page)).toHaveValue("abc");
    await expect(cagrInput(page)).toHaveAttribute("aria-invalid", "true");
  });
});

test.describe("市場区分と業種（C7）", () => {
  test("グロース → +プライム、業種の一覧、食料品のチップ", async ({ page }) => {
    await sql(EXAMPLE_SQL);
    await loginAsOwner(page);
    await page.goto("/screening");
    await page.getByRole("checkbox", { name: /^グロース/ }).click();
    await expect(page).toHaveURL(/[?&]market=0113(&|$)/);
    await expectCodes(page, ["99991"]);
    await page.getByRole("checkbox", { name: /^プライム/ }).click();
    await expect(page).toHaveURL(/[?&]market=0111,0113(&|$)/);
    await expectCodes(page, ["99991", "99990"]);
    await page.getByRole("checkbox", { name: /^プライム/ }).click();
    await page.getByRole("checkbox", { name: /^グロース/ }).click();
    await expect(page).not.toHaveURL(/market=/);

    await cagrInput(page).fill("15");
    await expect(page).toHaveURL(/[?&]cagr=15(&|$)/);
    await page.getByRole("button", { name: "業種を選ぶ" }).click();
    const options = page.getByTestId("sector-options");
    await expect(options.getByRole("listitem")).toHaveText([/^食料品\s*3$/, /^情報・通信業\s*6$/, /^銀行業\s*1$/]);
    await options.getByRole("checkbox", { name: /食料品/ }).click();
    await expect(page).toHaveURL(/[?&]sector=3050(&|$)/);
    await page.keyboard.press("Escape");
    await expectCodes(page, ["99992"]);
    await page.getByRole("button", { name: "食料品 を外す" }).click();
    await expect(page).not.toHaveURL(/sector=/);
    await expectCodes(page, ["99991", "99990", "99992"]);
  });
});

test.describe("空状態とページ送り（C8）", () => {
  test("該当0件と、データが無いときの空状態は別の表示", async ({ page }) => {
    await sql(EXAMPLE_SQL);
    await loginAsOwner(page);
    await page.goto("/screening?cagr=500");
    await expect(page.getByText("条件に一致する銘柄はありません")).toBeVisible();
    await expect(page.getByTestId("screening-table")).toHaveCount(0);

    await sql("delete from public.stocks where code like '9999%'");
    await page.goto("/screening");
    await expect(page.getByRole("heading", { name: "まだデータが取り込まれていません" })).toBeVisible();
    await expect(page.getByTestId("screening-results").getByRole("link", { name: "取り込み状況を見る" })).toHaveAttribute("href", "/imports");
    await expect(page.getByText("条件に一致する銘柄はありません")).toHaveCount(0);
    await expect(cagrInput(page)).toBeEnabled();
  });

  test("銘柄マスタだけがある（財務指標・初出日が0件）ときは、データ不足の注意とリンク（C8-3）", async ({ page }) => {
    await sql(
      "insert into public.stocks (code, company_name, market_code, market_name, product_category) values ('99991', '検証用マスタのみ株式会社', '0113', 'グロース', '011')",
    );
    await loginAsOwner(page);
    await page.goto("/screening");
    const notice = page.getByTestId("missing-data-notice");
    await expect(notice).toContainText("財務指標がまだ算出されていません。");
    await expect(notice).toContainText("株価の初出日がまだ取り込まれていません。");
    await expect(notice.getByRole("link", { name: "取り込み状況を見る" })).toHaveAttribute("href", "/imports");
    await expect(page.getByText("条件に一致する銘柄はありません")).toBeVisible();
  });

  test("122件は 100 + 22 行。次へ・前へ、条件を変えると 1 ページ目、最終ページを超えると最終ページ", async ({ page }) => {
    await sql(EXAMPLE_SQL);
    await sql(PAGING_SQL);
    await loginAsOwner(page);
    await page.goto("/screening");
    await expect(count(page)).toHaveText("122");
    await expect(rows(page)).toHaveCount(100);
    await expect(page.getByTestId("result-range")).toHaveText("1〜100 件目を表示");
    const first = await rowCodes(page);
    await page.getByRole("button", { name: "次へ" }).click();
    await expect(page).toHaveURL(/[?&]page=2(&|$)/);
    await expect(rows(page)).toHaveCount(22);
    await expect(page.getByTestId("page-position")).toHaveText("2 / 2 ページ");
    const second = await rowCodes(page);
    expect(new Set([...first, ...second]).size).toBe(122);
    await page.getByRole("button", { name: "前へ" }).click();
    await expect(rows(page)).toHaveCount(100);

    await page.getByRole("button", { name: "次へ" }).click();
    await expect(page).toHaveURL(/[?&]page=2(&|$)/);
    await page.getByRole("textbox", { name: "営業利益率 の閾値（%）" }).fill("9");
    await expect(page).toHaveURL(/[?&]margin=9(&|$)/);
    await expect(page).not.toHaveURL(/page=/);

    await page.goto("/screening?page=99");
    await expect(rows(page)).toHaveCount(22);
    await expect(page.getByTestId("page-position")).toHaveText("2 / 2 ページ");
  });
});

test.describe("API（C9）", () => {
  test("GET /api/screening の値・並び・400・401・no-store", async ({ page, playwright }) => {
    await sql(EXAMPLE_SQL);
    await loginAsOwner(page);
    const res = await page.request.get("/api/screening");
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toContain("no-store");
    const body = await res.json();
    expect(body.data).toMatchObject({ total: 2, stockCount: 10, excludedUnavailable: 4, referenceDate: "2026-09-24", pageSize: 100 });
    expect(body.data.rows.map((row: { code: string }) => row.code)).toEqual(["99991", "99990"]);
    expect(body.data.rows[0]).toMatchObject({ revenue_cagr_display_pct: 25, operating_margin_display_pct: 15, status: { cagr: "met", margin: "met", years: "met" } });

    const sorted = await (await page.request.get("/api/screening?off=cagr,margin,years&unavailable=include&sort=years&order=asc")).json();
    expect(sorted.data.rows.map((row: { code: string }) => row.code)).toEqual(["99998", "99996", "99993", "99997", "99991", "99992", "99990", "99994", "99995", "99999"]);

    const bad = await page.request.get("/api/screening?cagr=abc&market=0111,9999&foo=1");
    expect(bad.status()).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_params", fields: ["cagr", "market"] });

    const anonymous = await playwright.request.newContext({ baseURL: page.url() });
    const unauth = await anonymous.get("/api/screening");
    expect(unauth.status()).toBe(401);
    expect(await unauth.text()).not.toContain("99991");
    await anonymous.dispose();

    const { rows: runs } = await sql("select count(*)::int as n from public.ingestion_runs where target <> 'daily_quotes'");
    expect(runs[0].n).toBe(0);
  });
});

test.describe("375px（C12-4）", () => {
  test("ページの横スクロールが無く、条件パネルを開いて閾値を変えられる", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await context.newPage();
    const problems = collectPageProblems(page);
    await sql(EXAMPLE_SQL);
    await login(page, OWNER.email, OWNER.password);
    await expect(page.getByRole("heading", { name: "ダッシュボード", level: 1 })).toBeVisible();
    await page.goto("/screening?off=cagr,margin,years&unavailable=include");
    await expect(count(page)).toHaveText("10");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await page.getByRole("button", { name: "条件を変更" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("switch", { name: "条件① 売上CAGR を使う" }).click();
    await sheet.getByRole("textbox", { name: "売上CAGR の閾値（%）" }).fill("30");
    await expect(page).toHaveURL(/[?&]cagr=30(&|$)/);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("conditions-summary")).toContainText("CAGR ≥30%");
    await expectCodes(page, ["99995", "99993", "99996", "99998"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    expect(problems).toEqual([]);
    await context.close();
  });
});
