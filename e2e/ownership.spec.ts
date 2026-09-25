import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { collectPageProblems, loginAsOwner, OWNER, simulateServerClockBehind, sql, expectNoPresets } from "./support";

/**
 * 条件④の自動判定と保有状態の内訳（F9、Sprint 10）。契約の第5章の投入例（ownership-example.sql）を使う。
 * 前提: 市場データ・EDINET の書類・実行履歴が0件の DB。投入するコードは 9U001〜9U014、書類IDは SXTEST…。各テストの後に削除する。
 */
test.describe.configure({ mode: "serial" });

const EXAMPLE_SQL = readFileSync(join(__dirname, "fixtures/ownership-example.sql"), "utf8");
const CLEANUP_SQL = readFileSync(join(__dirname, "fixtures/ownership-cleanup.sql"), "utf8");
const BR_EXAMPLE_SQL = readFileSync(join(__dirname, "fixtures/business-results-example.sql"), "utf8");
const BR_CLEANUP_SQL = readFileSync(join(__dirname, "fixtures/business-results-cleanup.sql"), "utf8");
const AR_EXAMPLE_SQL = readFileSync(join(__dirname, "fixtures/annual-report-example.sql"), "utf8");
const AR_CLEANUP_SQL = readFileSync(join(__dirname, "fixtures/annual-report-cleanup.sql"), "utf8");

const DEFAULT_CODES = ["9U001", "9U002", "9U006", "9U008", "9U009", "9U010", "9U014"];
const OWNER_SWITCH = "条件④ オーナー企業／社長が筆頭株主 を使う";
const THRESHOLD = "オーナー企業と判定する合計持株比率の閾値（%）";

const resultRow = (page: Page, code: string) => page.getByTestId("results-scroll").locator(`tbody tr[data-code='${code}']`);
const rowCodes = (page: Page) => page.getByTestId("results-scroll").locator("tbody tr").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-code")));
const conditions = (page: Page) => page.getByRole("complementary", { name: "条件" });

async function expectCodes(page: Page, codes: string[]) {
  await expect.poll(() => rowCodes(page)).toEqual(codes);
  await expect(page.getByTestId("result-count")).toHaveText(String(codes.length));
}

test.beforeAll(async () => {
  await expectNoPresets(); // Sprint 13（契約の C10-4）
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
  await sql(BR_CLEANUP_SQL);
  await sql(AR_CLEANUP_SQL);
  await sql("delete from public.ingestion_runs");
  await sql("insert into private.allowed_emails (email) values ($1) on conflict do nothing", [OWNER.email]);
});

test.describe("判定の4つの結果（C1。AC9.1〜AC9.4）", () => {
  test("社長が筆頭株主・オーナー企業・非該当・判定不能と、根拠と API（C1-1〜C1-5）", async ({ page }) => {
    const problems = collectPageProblems(page);
    await loginAsOwner(page);

    await page.goto("/stocks/9U001");
    const evidence = page.getByTestId("ownership-evidence");
    await expect(evidence).toHaveAttribute("data-result", "president_top");
    await expect(evidence.getByTestId("evidence-result")).toHaveText("該当（社長が筆頭株主）");
    const summary = evidence.getByTestId("evidence-summary");
    for (const text of ["山田 太郎", "30.00%", "代表取締役社長", "山田太郎", "＝"]) await expect(summary).toContainText(text);

    await page.goto("/stocks/9U002");
    await expect(evidence).toHaveAttribute("data-result", "owner_company");
    await expect(evidence.getByTestId("evidence-result")).toHaveText("該当（オーナー企業）");
    const matches = evidence.getByTestId("evidence-match");
    await expect(matches).toHaveCount(2);
    await expect(matches.nth(0)).toContainText("株式会社ヤマダホールディングス");
    await expect(matches.nth(0)).toContainText("15.00%");
    await expect(matches.nth(0)).toContainText("資産管理会社");
    await expect(matches.nth(0).getByTestId("estimated-label")).toBeVisible();
    await expect(matches.nth(0)).toContainText("社長の姓『山田』の読み『ヤマダ』を名称に含む法人（資産管理会社と推定）");
    await expect(matches.nth(1)).toContainText("山田　一郎");
    await expect(matches.nth(1)).toContainText("8.00%");
    await expect(matches.nth(1)).toContainText("社長本人");
    await expect(matches.nth(1)).toContainText("社長『山田一郎』と氏名が一致");
    await expect(evidence.getByTestId("evidence-owner-total")).toContainText("23.0%");
    await expect(evidence.getByTestId("evidence-owner-total")).toContainText("閾値 20%");
    await expect(evidence.getByTestId("evidence-matches")).not.toContainText("山田工業取引先持株会");

    await page.goto("/stocks/9U003");
    await expect(evidence.getByTestId("evidence-result")).toHaveText("非該当");
    await expect(evidence.getByTestId("evidence-matches")).toContainText("一致した株主はいません");
    await expect(evidence.getByTestId("evidence-owner-total")).toContainText("0.0%");

    for (const [code, texts] of [
      ["9U004", ["有報が未取得"]],
      ["9U005", ["大株主を抽出できなかった"]],
      ["9U013", ["取り込み待ち", "SXTEST13"]],
    ] as const) {
      await page.goto(`/stocks/${code}`);
      await expect(evidence.getByTestId("evidence-result"), code).toHaveText("判定不能");
      for (const text of texts) await expect(evidence.getByTestId("evidence-undeterminable"), code).toContainText(text);
      await expect(page.getByTestId("breakdown-undeterminable"), code).toContainText("内訳なし（判定不能）");
    }

    const api = await (await page.request.get("/api/stocks/9U002")).json();
    expect(api.data.ownership).toMatchObject({
      status: "determined",
      result: "owner_company",
      owner_total_pct: "23.00",
      owner_total_display_pct: "23.0",
      category_pct: { asset_company: "15.00", president: "8.00" },
    });
    expect(api.data.ownership.holders.map((h: { category: string }) => h.category)).toEqual(["other", "asset_company", "president", "other", "other", "other"]);
    expect(problems).toEqual([]);
  });

  test("新しい有報が取り込み待ちの間は、処理済みの直前の有報で判定する（C1-7。ユーザーの決定）", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/stocks/9U014");
    const evidence = page.getByTestId("ownership-evidence");
    await expect(evidence.getByTestId("evidence-result")).toHaveText("該当（社長が筆頭株主）");
    await expect(evidence.getByTestId("evidence-document")).toHaveAttribute("data-doc-id", "SXTEST14");
    await expect(evidence.getByTestId("evidence-documents")).toContainText("2025-06-25");
    const note = evidence.getByTestId("evidence-pending-note");
    for (const text of ["SXTEST15", "2026-06-25", "取り込み待ち", "直前の有報"]) await expect(note).toContainText(text);
    // Sprint 8 の区画は取り込み待ちの表示のまま
    await expect(page.getByTestId("annual-report")).toHaveAttribute("data-state", "pending");
    const api = await (await page.request.get("/api/stocks/9U014")).json();
    expect(api.data.ownership).toMatchObject({ status: "determined", pending_doc_id: "SXTEST15" });
    expect(api.data.ownership.documents.find((d: { role: string }) => d.role === "shareholders").doc_id).toBe("SXTEST14");
    await page.goto("/screening");
    await expect(resultRow(page, "9U014")).toBeVisible();
    await page.goto("/stocks/9U013");
    await expect(evidence.getByTestId("evidence-result")).toHaveText("判定不能");
  });
});

test.describe("スクリーニングの条件④（C2。AC9.5・AC9.8・AC9.16）", () => {
  test("既定の4条件・閾値・モード・判定不能・オフ・URL（C2-1〜C2-7）", async ({ page }) => {
    const problems = collectPageProblems(page);
    await loginAsOwner(page);
    await page.goto("/screening");
    const panel = conditions(page);
    await expect(panel.getByTestId("condition-owner")).toBeVisible();
    await expect(panel.getByTestId("condition-owner").getByTestId("auto-judgment-label")).toHaveText("自動判定");
    await expect(panel.getByRole("switch", { name: OWNER_SWITCH })).toBeChecked();
    await expect(panel.getByTestId("owner-mode-any")).toBeChecked();
    await expect(panel.getByRole("textbox", { name: THRESHOLD })).toHaveValue("20");
    await expect(panel.getByTestId("include-undeterminable")).not.toBeChecked();
    // AC9.8: 既定の4条件を満たす銘柄だけ
    await expectCodes(page, DEFAULT_CODES);
    await expect(page.getByTestId("excluded-undeterminable")).toContainText("3 件");

    // AC9.16: 40 → 30
    await panel.getByRole("textbox", { name: THRESHOLD }).fill("40");
    await expect(page).toHaveURL(/[?&]owner=40(&|$)/);
    await expectCodes(page, ["9U001", "9U008", "9U009", "9U010", "9U014"]);
    await panel.getByRole("textbox", { name: THRESHOLD }).fill("30");
    await expect(page).toHaveURL(/[?&]owner=30(&|$)/);
    await expectCodes(page, ["9U001", "9U006", "9U008", "9U009", "9U010", "9U014"]);
    // スライダー（キーボードで 30 → 20 まで下げる）
    const slider = panel.getByRole("slider", { name: `${THRESHOLD}（スライダー）` });
    await slider.focus();
    for (let i = 0; i < 10; i += 1) await page.keyboard.press("ArrowLeft");
    await expect(page).toHaveURL(/[?&]owner=20(&|$)/);
    await expectCodes(page, DEFAULT_CODES);

    // モード
    await panel.getByTestId("owner-mode-president").click();
    await expect(page).toHaveURL(/[?&]ownermode=president(&|$)/);
    await expectCodes(page, ["9U001", "9U008", "9U009", "9U010", "9U014"]);
    await expect(panel.getByRole("textbox", { name: THRESHOLD })).toBeDisabled();
    await expect(panel.getByTestId("owner-threshold-unused")).toBeVisible();
    await panel.getByTestId("owner-mode-any").click();
    await expectCodes(page, DEFAULT_CODES);

    // 判定不能を含める（算出不可を含めるとは独立）
    await panel.getByRole("switch", { name: "算出不可を含める" }).click();
    await expect(page).toHaveURL(/[?&]unavailable=include(&|$)/);
    await expectCodes(page, DEFAULT_CODES);
    await panel.getByRole("switch", { name: "算出不可を含める" }).click();
    await panel.getByTestId("include-undeterminable").click();
    await expect(page).toHaveURL(/[?&]undeterminable=include(&|$)/);
    await expect(page.getByTestId("result-count")).toHaveText("10");
    await expect(resultRow(page, "9U004").getByTestId("cell-owner-judgment")).toHaveText("判定不能");
    await panel.getByTestId("include-undeterminable").click();

    // オフ
    await panel.getByRole("switch", { name: OWNER_SWITCH }).click();
    await expect(page).toHaveURL(/[?&]off=owner(&|$)/);
    await expect(page.getByTestId("result-count")).toHaveText("12");
    await expect(resultRow(page, "9U003").getByTestId("condition-status-owner")).toHaveAttribute("data-status", "off");

    // 戻る・進む・リロード
    await page.reload();
    await expect(page.getByTestId("result-count")).toHaveText("12");
    await expect(panel.getByRole("switch", { name: OWNER_SWITCH })).not.toBeChecked();
    await page.goto("/screening?owner=40&ownermode=any");
    await expect(page.getByTestId("result-count")).toHaveText("5");
    await page.goto("/screening?ownermode=president");
    await expect(page.getByTestId("result-count")).toHaveText("5");
    await page.goBack();
    await expect(page).toHaveURL(/owner=40/);
    await expect(panel.getByRole("textbox", { name: THRESHOLD })).toHaveValue("40");
    await expect(page.getByTestId("result-count")).toHaveText("5");
    await page.goForward();
    await expect(panel.getByTestId("owner-mode-president")).toBeChecked();
    expect(problems).toEqual([]);
  });

  test("API の件数と不正な値（C2-8）・詳細への遷移と戻り先（C2-9）", async ({ page }) => {
    await loginAsOwner(page);
    const api = await (await page.request.get("/api/screening?owner=40")).json();
    expect(api.data.total).toBe(5);
    expect(api.data.conditions).toMatchObject({ owner: "40", ownermode: "any", undeterminable: "exclude" });
    expect(api.data.rows.map((r: { code: string }) => r.code)).toEqual(["9U001", "9U008", "9U009", "9U010", "9U014"]);
    for (const query of ["owner=abc", "owner=100.1", "ownermode=x", "undeterminable=yes", "off=owner,zzz", "sort=zzz"]) {
      const res = await page.request.get(`/api/screening?${query}`);
      expect(res.status(), query).toBe(400);
      expect((await res.json()).error, query).toBe("invalid_params");
    }

    await page.goto("/screening");
    await resultRow(page, "9U006").getByTestId("row-link-name").click();
    await expect(page).toHaveURL(/\/stocks\/9U006\?cagr=20&margin=10&years=5&owner=20&ownermode=any&sort=cagr&order=desc$/);
    await expect(page.getByTestId("evaluation-owner")).toHaveAttribute("data-status", "met");
    await expect(page.getByRole("navigation", { name: "パンくず" }).getByRole("link", { name: "スクリーニング" })).toHaveAttribute(
      "href",
      "/screening?cagr=20&margin=10&years=5&owner=20&ownermode=any&sort=cagr&order=desc",
    );
    await page.goBack();
    await expect(page).toHaveURL(/\/screening/);
    await expectCodes(page, DEFAULT_CODES);

    await page.goto("/stocks/9U006?owner=40");
    await expect(page.getByTestId("evaluation-owner")).toHaveAttribute("data-status", "unmet");
    await expect(page.getByTestId("evaluation-inclusion")).toHaveAttribute("data-included", "false");
    await expect(page.getByTestId("evaluation-inclusion")).toContainText("条件④を満たさない");
  });
});

test.describe("一覧の判定の列と保有状態の要約（C3。AC9.6・AC9.10〜AC9.12）", () => {
  test("列・ポップオーバー・詳細へ移らない（C3-1〜C3-4）", async ({ page }) => {
    const problems = collectPageProblems(page);
    await loginAsOwner(page);
    await page.goto("/screening");
    await expect(page.getByTestId("header-owner-judgment")).toContainText("条件④");
    await expect(page.getByTestId("header-owner-judgment")).toContainText("自動判定");
    await expect(page.getByTestId("sort-owner")).toContainText("保有状態");

    const judgment = resultRow(page, "9U006").getByTestId("owner-judgment-trigger");
    await expect(judgment).toHaveText("該当（オーナー企業）");
    await judgment.hover();
    const detail = page.getByTestId("owner-judgment-detail");
    await expect(detail).toBeVisible();
    for (const text of ["自動判定", "有限会社山田興産", "18.0%", "山田　太郎", "代表取締役社長"]) await expect(detail).toContainText(text);
    await page.mouse.move(5, 5);
    await expect(detail).toBeHidden();
    await judgment.click();
    await expect(detail).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(page).toHaveURL(/\/screening/);
    await page.keyboard.press("Escape");
    await expect(detail).toBeHidden();
    await judgment.focus();
    await page.keyboard.press("Enter");
    await expect(detail).toBeVisible();
    await expect(page).toHaveURL(/\/screening/);
    await page.keyboard.press("Escape");
    await resultRow(page, "9U008").getByTestId("owner-judgment-trigger").hover();
    await expect(detail.getByTestId("popover-presidents")).toContainText("鈴木　一郎");
    await expect(detail.getByTestId("popover-presidents")).toContainText("髙橋　二郎");
    await page.mouse.move(5, 5);

    // AC9.10
    const cell = resultRow(page, "9U006").getByTestId("cell-ownership");
    await expect(cell.getByTestId("ownership-total")).toHaveText("オーナー系 35.0%");
    await expect(cell.getByTestId("ownership-bar")).toBeVisible();
    await cell.getByTestId("ownership-trigger").hover();
    const own = page.getByTestId("ownership-detail");
    await expect(own).toBeVisible();
    for (const text of ["社長本人12.0%", "同姓の親族（推定）5.0%", "資産管理会社（推定）18.0%", "オーナー系合計35.0%", "有限会社山田興産 18.0%", "その他の役員本人0.0%"]) {
      await expect(own).toContainText(text);
    }
    await page.mouse.move(5, 5);
    await expect(own).toBeHidden();
    await cell.getByTestId("ownership-trigger").click();
    await expect(own).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(page).toHaveURL(/\/screening/);
    await page.keyboard.press("Escape");

    // AC9.11
    await page.goto("/screening?off=owner");
    await expect(resultRow(page, "9U003").getByTestId("ownership-total")).toHaveText("オーナー系 0.0%");
    await resultRow(page, "9U003").getByTestId("ownership-trigger").hover();
    await expect(own.getByTestId("popover-top-holder")).toHaveText("筆頭株主 株式会社日本カストディ銀行（信託口） 12.0%");
    await page.goto("/screening?undeterminable=include");
    await expect(resultRow(page, "9U004").getByTestId("ownership-total")).toHaveText("内訳なし（判定不能）");
    await expect(resultRow(page, "9U004").getByTestId("ownership-bar")).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test("並べ替え・バーの幅・API（C3-5・C3-6・C3-8）", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/screening");
    await page.getByTestId("sort-owner").click();
    await expect(page).toHaveURL(/sort=owner&order=desc/);
    await expectCodes(page, ["9U010", "9U006", "9U001", "9U008", "9U009", "9U014", "9U002"]);
    await page.getByTestId("sort-owner").click();
    await expect(page).toHaveURL(/sort=owner&order=asc/);
    await expectCodes(page, ["9U002", "9U014", "9U009", "9U001", "9U008", "9U006", "9U010"]);
    for (const order of ["asc", "desc"]) {
      await page.goto(`/screening?undeterminable=include&sort=owner&order=${order}`);
      await expect.poll(async () => (await rowCodes(page)).slice(-3)).toEqual(["9U004", "9U005", "9U013"]);
    }

    await page.goto("/screening");
    const bar = resultRow(page, "9U006").getByTestId("ownership-bar");
    const segments = bar.locator("[data-category]");
    await expect(segments).toHaveCount(4);
    const widths = await segments.evaluateAll((els) => els.map((el) => [el.getAttribute("data-category"), el.getBoundingClientRect().width]));
    expect(widths.map(([c]) => c)).toEqual(["president", "family", "asset_company", "other"]);
    const [p, f, a, o] = widths.map(([, w]) => w as number);
    expect(p / f).toBeCloseTo(12 / 5, 0);
    expect(a / o).toBeCloseTo(18 / 9, 0);
    await expect(bar).toHaveAttribute("aria-label", /オーナー系合計 35\.0%/);

    const api = await (await page.request.get("/api/screening")).json();
    const r = api.data.rows.find((x: { code: string }) => x.code === "9U006");
    expect(r.status.owner).toBe("met");
    expect(r.ownership).toMatchObject({ result: "owner_company", owner_total_display_pct: "35.0", top_holders: [{ name: "有限会社山田興産", ratio_pct: "18.00" }] });
  });

  test("1280 で表が横スクロールしない。375 でページが横スクロールせず、ポップオーバーが画面の中（C3-7）", async ({ browser, page }) => {
    await loginAsOwner(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/screening");
    await expect(resultRow(page, "9U006")).toBeVisible();
    expect(await page.getByTestId("results-scroll").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    // 列の中身が隣の列にはみ出さない（保有状態の要約と条件の印）
    for (const code of ["9U001", "9U006"]) {
      const cells = resultRow(page, code).locator("td");
      const overflow = await cells.evaluateAll((tds) => tds.filter((td) => td.scrollWidth > td.clientWidth + 1).map((td) => td.getAttribute("data-testid") ?? String((td as HTMLTableCellElement).cellIndex)));
      expect(overflow, code).toEqual([]);
    }

    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const mobile = await context.newPage();
    await loginAsOwner(mobile);
    await mobile.goto("/screening");
    await expect(resultRow(mobile, "9U006")).toBeVisible();
    expect(await mobile.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    for (const [trigger, content] of [
      ["ownership-trigger", "ownership-detail"],
      ["owner-judgment-trigger", "owner-judgment-detail"],
    ]) {
      await resultRow(mobile, "9U006").getByTestId(trigger).scrollIntoViewIfNeeded();
      await resultRow(mobile, "9U006").getByTestId(trigger).click();
      const box = await mobile.getByTestId(content).boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(375);
      await mobile.keyboard.press("Escape");
    }
    await context.close();
  });
});

test.describe("詳細の判定根拠と保有状態の内訳（C4。AC9.7・AC9.13〜AC9.15）", () => {
  test("9U006 の根拠・区分別の合計・明細・推定の注記（C4-1・C4-2・C4-4・C4-9）", async ({ page }) => {
    const problems = collectPageProblems(page);
    await loginAsOwner(page);
    await page.goto("/stocks/9U006");
    const evidence = page.getByTestId("ownership-evidence");
    await expect(evidence.getByTestId("evidence-top-holder")).toContainText("有限会社山田興産");
    await expect(evidence.getByTestId("evidence-top-holder")).toContainText("18.00%");
    await expect(evidence.getByTestId("evidence-president")).toContainText("山田　太郎");
    await expect(evidence.getByTestId("evidence-president")).toContainText("代表取締役社長");
    await expect(evidence.getByTestId("evidence-surname")).toHaveText("姓: 山田");
    await expect(evidence.getByTestId("evidence-match")).toHaveCount(3);
    await expect(evidence.getByTestId("evidence-owner-total")).toContainText("35.0%");
    const doc = evidence.getByTestId("evidence-document");
    await expect(doc).toContainText("SXTEST06");
    await expect(doc).toContainText("2026-06-25");
    const link = doc.getByTestId("evidence-edinet-link");
    await expect(link).toHaveAttribute("href", "https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx?SXTEST06,,");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);

    const totals = page.getByTestId("breakdown-totals");
    const total = (category: string) => totals.locator(`[data-testid=breakdown-total][data-category=${category}]`);
    for (const [category, label, value] of [
      ["president", "社長本人", "12.0%"],
      ["officer", "その他の役員本人", "0.0%"],
      ["family", "同姓の親族", "5.0%"],
      ["asset_company", "資産管理会社", "18.0%"],
      ["owner_total", "オーナー系合計", "35.0%"],
      ["other", "オーナー系以外", "9.0%"],
    ]) {
      await expect(total(category)).toContainText(label);
      await expect(total(category)).toContainText(value);
    }
    await expect(total("family").getByTestId("estimated-label")).toBeVisible();
    await expect(total("asset_company").getByTestId("estimated-label")).toBeVisible();
    await expect(total("president").getByTestId("estimated-label")).toHaveCount(0);

    const holders = page.getByTestId("breakdown-holder");
    await expect(holders).toHaveCount(4);
    const expected = [
      ["有限会社山田興産", "18.00%", "asset_company", "資産管理会社", "社長の姓『山田』を名称に含む法人（資産管理会社と推定）"],
      ["山田　太郎", "12.00%", "president", "社長本人", "社長『山田太郎』と氏名が一致"],
      ["日本マスタートラスト信託銀行株式会社（信託口）", "9.00%", "other", "オーナー系以外", "信託口・金融機関・持株会など"],
      ["山田　花子", "5.00%", "family", "同姓の親族", "社長と同姓『山田』の個人（親族と推定）"],
    ];
    for (const [i, [name, ratio, category, label, reason]] of expected.entries()) {
      const h = holders.nth(i);
      await expect(h).toHaveAttribute("data-category", category);
      await expect(h.getByTestId("breakdown-name")).toHaveText(name);
      await expect(h.getByTestId("breakdown-ratio")).toHaveText(ratio);
      await expect(h.getByTestId("breakdown-category")).toContainText(label);
      await expect(h.getByTestId("breakdown-reason")).toContainText(reason);
      await expect(h.getByTestId("estimated-label")).toHaveCount(category === "family" || category === "asset_company" ? 1 : 0);
    }
    await expect(page.getByTestId("estimation-note")).toContainText("姓（または読み）と株主の氏名・名称の一致による推定");
    await expect(page.getByTestId("estimation-note")).toContainText("実際の親族関係・資本関係は確認していません");

    const row = page.getByTestId("evaluation-owner");
    await expect(row).toHaveAttribute("data-status", "met");
    await expect(row.getByTestId("auto-judgment-label")).toBeVisible();
    await expect(row.getByTestId("evaluation-value")).toHaveText("該当（オーナー企業）");
    await expect(row.getByTestId("evaluation-owner-evidence-link")).toHaveAttribute("href", "#ownership-evidence");
    expect(problems).toEqual([]);
  });

  test("その他の役員本人・異体字・社長が複数・代表者・姓の出どころ（C4-3・C4-5〜C4-8）", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/stocks/9U007");
    const sato = page.getByTestId("breakdown-holder").filter({ hasText: "佐藤　一郎" });
    await expect(sato).toHaveAttribute("data-category", "officer");
    await expect(sato.getByTestId("breakdown-reason")).toHaveText("役員『佐藤一郎（取締役CFO）』と氏名が一致");
    await expect(page.getByTestId("evidence-owner-total")).toContainText("4.0%");
    await expect(page.locator("[data-testid=breakdown-total][data-category=officer]")).toContainText("4.0%");

    await page.goto("/stocks/9U009");
    await expect(page.getByTestId("evidence-result")).toHaveText("該当（社長が筆頭株主）");
    await expect(page.getByTestId("evidence-president")).toContainText("山﨑　健");
    await expect(page.getByTestId("evidence-president")).toContainText("代表取締役 CEO");
    const yamazaki = page.getByTestId("breakdown-holder").filter({ hasText: "株式会社ヤマザキ・エステート" });
    await expect(yamazaki).toHaveAttribute("data-category", "asset_company");
    await expect(yamazaki.getByTestId("breakdown-reason")).toContainText("ヤマザキ");
    await expect(page.getByTestId("breakdown-holder").filter({ hasText: "山崎　美香" })).toHaveAttribute("data-category", "family");

    await page.goto("/stocks/9U008");
    await expect(page.getByTestId("evidence-president")).toHaveCount(2);
    await expect(page.getByTestId("evidence-presidents")).toContainText("鈴木　一郎");
    await expect(page.getByTestId("evidence-presidents")).toContainText("髙橋　二郎");
    await expect(page.getByTestId("breakdown-holder").filter({ hasText: "高橋　二郎" })).toHaveAttribute("data-category", "president");
    await expect(page.getByTestId("evidence-result")).toHaveText("該当（社長が筆頭株主）");

    await page.goto("/stocks/9U010");
    await expect(page.getByTestId("evidence-basis-note")).toHaveText("役職名に『社長』等が無いため、代表取締役を社長として扱っています");

    await page.goto("/stocks/9U001");
    await expect(page.getByTestId("evidence-surname")).toHaveText("姓: 山田");
    await expect(page.getByTestId("evidence-surname-unknown")).toHaveCount(0);
  });

  test("375px で内訳の比率と区分が見える（C4-10）", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await context.newPage();
    await loginAsOwner(page);
    await page.goto("/stocks/9U006");
    await expect(page.getByTestId("breakdown-holders")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    for (const testId of ["breakdown-ratio", "breakdown-category"]) {
      for (const cell of await page.getByTestId(testId).all()) {
        const box = (await cell.boundingBox())!;
        expect(box.x + box.width, testId).toBeLessThanOrEqual(375);
      }
    }
    await context.close();
  });
});

test.describe("再計算（C5）", () => {
  test("比率の変更・取り下げ・不開示・役職名の変更・取り込み待ちの解消（C5-1・C5-2・C5-5・C5-9・C5-10）", async ({ page }) => {
    await loginAsOwner(page);
    const evidence = page.getByTestId("ownership-evidence");

    await sql("update public.annual_report_shareholders set ratio_pct = 5.00 where doc_id = 'SXTEST06' and rank = 1");
    await page.goto("/stocks/9U006");
    await expect(evidence.getByTestId("evidence-owner-total")).toContainText("22.0%");
    await expect(evidence.getByTestId("evidence-result")).toHaveText("該当（社長が筆頭株主）");
    await sql("update public.annual_report_shareholders set ratio_pct = 18.00 where doc_id = 'SXTEST06' and rank = 1");
    await page.reload();
    await expect(evidence.getByTestId("evidence-owner-total")).toContainText("35.0%");

    for (const column of ["withdrawn", "withheld"]) {
      await sql(`update public.edinet_documents set ${column} = true where doc_id = 'SXTEST02'`);
      await page.goto("/stocks/9U002");
      await expect(evidence.getByTestId("evidence-undeterminable"), column).toContainText("有報が未取得");
      await sql(`update public.edinet_documents set ${column} = false where doc_id = 'SXTEST02'`);
      await page.reload();
      await expect(evidence.getByTestId("evidence-result"), column).toHaveText("該当（オーナー企業）");
    }

    await sql("update public.annual_report_officers set title = '取締役' where doc_id = 'SXTEST06' and seq = 1");
    await page.goto("/stocks/9U006");
    await expect(evidence.getByTestId("evidence-undeterminable")).toContainText("社長（代表者）が見つからない");
    await sql("update public.annual_report_officers set title = '代表取締役社長' where doc_id = 'SXTEST06' and seq = 1");
    await page.reload();
    await expect(evidence.getByTestId("evidence-result")).toHaveText("該当（オーナー企業）");

    // C5-9: 取り込み待ちの解消
    await sql(`insert into public.annual_report_extractions (doc_id, shareholders_status, officers_status) values ('SXTEST15', 'ok', 'ok')`);
    await sql(`insert into public.annual_report_shareholders (doc_id, rank, name, ratio_pct, ratio_decimals)
               values ('SXTEST15', 1, '日本マスタートラスト信託銀行株式会社（信託口）', 30.00, 2), ('SXTEST15', 2, '松本　浩', 20.00, 2)`);
    await sql(`insert into public.annual_report_officers (doc_id, seq, name, title) values ('SXTEST15', 1, '松本　浩', '代表取締役社長')`);
    await page.goto("/stocks/9U014");
    await expect(evidence.getByTestId("evidence-result")).toHaveText("該当（オーナー企業）");
    await expect(evidence.getByTestId("evidence-owner-total")).toContainText("20.0%");
    await expect(evidence.getByTestId("evidence-pending-note")).toHaveCount(0);
    await sql("delete from public.annual_report_extractions where doc_id = 'SXTEST15'");
    await page.reload();
    await expect(evidence.getByTestId("evidence-pending-note")).toBeVisible();

    // C5-10: 直前の有報を取り下げると判定不能
    await sql("update public.edinet_documents set withdrawn = true where doc_id = 'SXTEST14'");
    await page.reload();
    await expect(evidence.getByTestId("evidence-result")).toHaveText("判定不能");
    await sql("update public.edinet_documents set withdrawn = false where doc_id = 'SXTEST14'");
    await page.reload();
    await expect(evidence.getByTestId("evidence-result")).toHaveText("該当（社長が筆頭株主）");
  });
});

test.describe("ダッシュボード・取り込み状況・データなし（C7）", () => {
  test("判定できた銘柄数（C7-1・C7-2）", async ({ page }) => {
    await loginAsOwner(page);
    await expect(page.getByTestId("stat-ownership")).toContainText("11 / 14 銘柄");
    const dash = await (await page.request.get("/api/dashboard")).json();
    expect(JSON.stringify(dash)).toContain('"ownershipDeterminedCount":11');
    await page.goto("/imports");
    await expect(page.getByTestId("ownership-determined-count")).toContainText("11 / 14");
    const breakdown = page.getByTestId("ownership-undeterminable-breakdown");
    for (const text of ["有報が未取得 1", "取り込み待ち 1", "大株主を抽出できなかった 1"]) await expect(breakdown).toContainText(text);
  });

  test("判定が1件も無いときの注記（C7-3）", async ({ page }) => {
    await sql(CLEANUP_SQL);
    await sql(BR_EXAMPLE_SQL);
    await loginAsOwner(page);
    await page.goto("/screening");
    await expect(page.getByTestId("missing-data-notice")).toContainText("条件④の判定がまだありません");
  });
});

test.describe("権限・時計のずれ（C8-4・C9-2）", () => {
  test("未ログインは 401、許可の取り消し後は 403。no-store（C8-4）", async ({ page, playwright }) => {
    await loginAsOwner(page);
    for (const path of ["/api/screening", "/api/stocks/9U006"]) {
      const res = await page.request.get(path);
      expect(res.status(), path).toBe(200);
      expect(res.headers()["cache-control"], path).toContain("no-store");
    }
    const anonymous = await playwright.request.newContext({ baseURL: page.url() });
    for (const path of ["/api/screening", "/api/stocks/9U006"]) {
      const res = await anonymous.get(path);
      expect(res.status(), path).toBe(401);
      expect(await res.text()).not.toContain("山田");
    }
    await anonymous.dispose();
    await sql("delete from private.allowed_emails where email = $1", [OWNER.email]);
    for (const path of ["/api/screening", "/api/stocks/9U006"]) {
      const res = await page.request.get(path);
      expect(res.status(), path).toBe(403);
      expect(await res.text()).not.toContain("山田");
    }
  });

  test("時計のずれの状態でもコンソールのエラーが出ない（C9-2）", async ({ page, context }) => {
    await simulateServerClockBehind(context);
    const problems = collectPageProblems(page);
    await loginAsOwner(page);
    for (const path of ["/screening", "/screening?owner=40&ownermode=president&undeterminable=include&sort=owner", "/stocks/9U006", "/stocks/9U004"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
    await page.goto("/stocks/9U999");
    await expect(page.getByRole("heading", { level: 1, name: "銘柄が見つかりません" })).toBeVisible();
    expect(problems).toEqual([]);
  });
});

test.describe("改善提案（C10）", () => {
  test("Sprint 9 の m1・m3・m5（C10-1・C10-3・C10-4）", async ({ page }) => {
    await sql(CLEANUP_SQL);
    await sql(BR_EXAMPLE_SQL);
    await loginAsOwner(page);
    await page.goto("/imports");
    const panel = page.getByRole("region", { name: "財務指標（売上CAGR・営業利益率）" });
    await expect(panel).toContainText("直近5期の通期実績（決算短信。無い期は EDINET の有価証券報告書・届出書から補う）から算出");
    await expect(panel).not.toContainText("通期実績（決算短信）から算出");
    await page.goto("/imports?code=9V001");
    await expect(page.getByTestId("financial-card").getByRole("columnheader", { name: "出典（売上高・営業利益）" })).toBeVisible();
    await page.goto("/screening?cagr=40&off=owner");
    const mark = resultRow(page, "9V001").getByTestId("cagr-supplement-mark");
    await expect(mark).toBeVisible();
    expect(await mark.getAttribute("title")).toBeNull();
    await expect(mark).toHaveAttribute("aria-label", "補完あり: EDINET から補った期を表示");
  });

  test("375px: Sprint 9 の m2（書類の列）と Sprint 8 の m1（持株比率）（C10-2・C10-5）", async ({ browser }) => {
    await sql(CLEANUP_SQL);
    await sql(BR_EXAMPLE_SQL);
    await sql(AR_EXAMPLE_SQL);
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await context.newPage();
    await loginAsOwner(page);
    await page.goto("/stocks/9V001");
    const rows = page.getByTestId("five-period-table").locator("tbody tr");
    await expect(rows.first()).toBeVisible();
    for (const r of await rows.all()) {
      const box = (await r.boundingBox())!;
      expect(box.height).toBeLessThanOrEqual(60);
    }
    await page.goto("/stocks/9W002");
    await expect(page.getByTestId("shareholders-table")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    for (const cell of await page.getByTestId("holder-ratio").all()) {
      const box = (await cell.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(375);
    }
    await context.close();
  });
});
