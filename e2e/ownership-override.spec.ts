import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";

import { BASE_URL, collectPageProblems, login, OWNER, simulateServerClockBehind, sql, expectNoPresets } from "./support";

/**
 * 条件④の手動補正（F10、Sprint 11）。契約 docs/harness/sprints/sprint-11/contract.md の完了条件。
 * 投入は Sprint 10 の ownership-example.sql（9U001〜9U014、SXTEST…）と、AC10.5 用の ownership-override-add*.sql（SYTEST…）。
 * 補正は画面か API で作る（ユーザーごとの行）。各テストの後に投入した行を消す（補正は銘柄の削除で連鎖して消える）。
 * 前提: 市場データ・EDINET の書類・実行履歴が0件の DB、pnpm seed:users 済み（owner・owner2・intruder）。
 */
test.describe.configure({ mode: "serial" });

const EXAMPLE_SQL = readFileSync(join(__dirname, "fixtures/ownership-example.sql"), "utf8");
const CLEANUP_SQL = readFileSync(join(__dirname, "fixtures/ownership-cleanup.sql"), "utf8");
const ADD_SQL = readFileSync(join(__dirname, "fixtures/ownership-override-add.sql"), "utf8");
const ADD_9U004_SQL = readFileSync(join(__dirname, "fixtures/ownership-override-add-9u004.sql"), "utf8");
const OVERRIDE_CLEANUP_SQL = readFileSync(join(__dirname, "fixtures/ownership-override-cleanup.sql"), "utf8");

const OWNER2 = { email: "owner2@quantis.local", password: "Quantis-Owner2-2026!" };
const DEFAULT_CODES = ["9U001", "9U002", "9U006", "9U008", "9U009", "9U010", "9U014"];
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

const resultRow = (page: Page, code: string) => page.getByTestId("results-scroll").locator(`tbody tr[data-code='${code}']`);
const rowCodes = (page: Page) => page.getByTestId("results-scroll").locator("tbody tr").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-code")));
const panel = (page: Page) => page.getByTestId("owner-override");

async function expectCodes(page: Page, codes: string[]) {
  await expect.poll(() => rowCodes(page)).toEqual(codes);
  await expect(page.getByTestId("result-count")).toHaveText(String(codes.length));
}

async function loginAs(page: Page, user: { email: string; password: string }) {
  await login(page, user.email, user.password);
  await expect(page.getByRole("heading", { name: "ダッシュボード", level: 1 })).toBeVisible();
}

async function newUserPage(browser: Browser, user: { email: string; password: string }, viewport = { width: 1280, height: 800 }) {
  const context = await browser.newContext({ viewport, locale: "ja-JP" });
  const page = await context.newPage();
  await loginAs(page, user);
  return { context, page };
}

/** 同一オリジンの書き込み（ブラウザの fetch と同じく Origin を付ける） */
function putOverride(request: APIRequestContext, code: string, data: unknown, origin = BASE_URL) {
  return request.put(`/api/stocks/${code}/ownership-override`, { data, headers: { origin } });
}

async function userId(email: string): Promise<string> {
  return (await sql("select id::text from auth.users where email = $1", [email])).rows[0].id;
}

async function overrideRow(email: string, code: string) {
  const { rows } = await sql(
    `select o.verdict, o.memo, char_length(o.memo)::int as len, o.created_at, o.updated_at, o.auto_status, o.auto_president_is_top_holder,
            o.auto_owner_total_pct::text as auto_total, o.auto_shareholders_doc_id, o.auto_officers_doc_id
       from public.ownership_overrides o join auth.users u on u.id = o.user_id where u.email = $1 and o.code = $2`,
    [email, code],
  );
  return rows[0] ?? null;
}

async function overrideCount(): Promise<number> {
  return (await sql("select count(*)::int as n from public.ownership_overrides")).rows[0].n;
}

/** Supabase Auth のパスワードのログインでアクセストークンを得る（PostgREST を直接呼ぶ C4-3・C6-4 用） */
async function accessToken(request: APIRequestContext, user: { email: string; password: string }): Promise<string> {
  const res = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: PUBLISHABLE_KEY },
    data: { email: user.email, password: user.password },
  });
  expect(res.status()).toBe(200);
  return (await res.json()).access_token;
}

function rest(request: APIRequestContext, token: string) {
  const headers = { apikey: PUBLISHABLE_KEY, authorization: `Bearer ${token}`, prefer: "return=representation" };
  const url = `${SUPABASE_URL}/rest/v1/ownership_overrides`;
  return {
    select: () => request.get(`${url}?select=*`, { headers }),
    insert: (data: object) => request.post(url, { headers, data }),
    update: (filter: string, data: object) => request.patch(`${url}?${filter}`, { headers, data }),
    remove: (filter: string) => request.delete(`${url}?${filter}`, { headers }),
  };
}

test.beforeAll(async () => {
  await expectNoPresets(); // Sprint 13（契約の C10-4）
  const { rows } = await sql(
    `select (select count(*) from public.stocks)::int as stocks, (select count(*) from public.ingestion_runs)::int as runs,
            (select count(*) from public.edinet_documents)::int as docs, (select count(*) from public.ownership_overrides)::int as overrides,
            (select count(*) from auth.users where email = 'owner2@quantis.local')::int as owner2`,
  );
  expect(rows[0], "E2E の前提: 市場データ・EDINET の書類・実行履歴・補正が0件、owner2 がいる（pnpm seed:users）").toEqual({
    stocks: 0,
    runs: 0,
    docs: 0,
    overrides: 0,
    owner2: 1,
  });
});

test.beforeEach(async () => {
  await sql(EXAMPLE_SQL);
});

test.afterEach(async () => {
  await sql(OVERRIDE_CLEANUP_SQL);
  await sql(CLEANUP_SQL);
  await sql("delete from public.ingestion_runs");
  await sql("insert into private.allowed_emails (email) values ($1), ($2) on conflict do nothing", [OWNER.email, OWNER2.email]);
});

test.describe("補正の保存と表示（C1・C2。AC10.1・AC10.2）", () => {
  test("入力の検証・保存・編集・XSS（C1-1〜C1-6）", async ({ page }) => {
    const problems = collectPageProblems(page);
    const dialogs: string[] = [];
    page.on("dialog", async (d) => {
      dialogs.push(d.message());
      await d.dismiss();
    });
    await loginAs(page, OWNER);
    await page.goto("/stocks/9U003");
    await expect(panel(page)).toHaveAttribute("data-state", "none");
    await expect(page.getByTestId("owner-override-open")).toHaveText("判定を手動で補正する");
    await expect(page.getByTestId("evidence-result")).toHaveText("非該当");

    // C1-2: 開いて、キャンセルで戻る
    await page.getByTestId("owner-override-open").click();
    await expect(panel(page)).toHaveAttribute("data-state", "editing");
    for (const v of ["president_top", "owner_company", "not_matched"]) await expect(page.getByTestId(`owner-override-verdict-${v}`)).toBeVisible();
    await page.getByTestId("owner-override-cancel").click();
    await expect(panel(page)).toHaveAttribute("data-state", "none");
    expect(await overrideCount()).toBe(0);

    // C1-3: 検証（DB に行は作られない）
    await page.getByTestId("owner-override-open").click();
    const memo = page.getByTestId("owner-override-memo");
    const error = page.getByTestId("owner-override-error");
    await page.getByTestId("owner-override-save").click();
    await expect(error).toHaveText("補正後の判定を選んでください");
    await page.getByTestId("owner-override-verdict-owner_company").click();
    for (const blank of [" ", "　", "　　", "\n\n", "\t　\n"]) {
      await memo.fill(blank);
      await page.getByTestId("owner-override-save").click();
      await expect(error, JSON.stringify(blank)).toHaveText("理由のメモを入力してください");
    }
    await memo.fill("a".repeat(1001));
    await expect(page.getByTestId("owner-override-count")).toHaveText("1,001 / 1,000");
    await page.getByTestId("owner-override-save").click();
    await expect(error).toHaveText("メモは 1,000 文字以内で入力してください");
    await memo.fill("𠮷".repeat(1001));
    await expect(page.getByTestId("owner-override-count")).toHaveText("1,001 / 1,000");
    await page.getByTestId("owner-override-save").click();
    await expect(error).toHaveText("メモは 1,000 文字以内で入力してください");
    expect(await overrideCount()).toBe(0);

    // 「𠮷」1,000 個は保存でき、表示は 1,000 / 1,000
    await memo.fill("𠮷".repeat(1000));
    await expect(page.getByTestId("owner-override-count")).toHaveText("1,000 / 1,000");
    await page.getByTestId("owner-override-save").click();
    await expect(panel(page)).toHaveAttribute("data-state", "saved");
    expect((await overrideRow(OWNER.email, "9U003")).len).toBe(1000);
    // 1,000 文字の本文の末尾に改行を付けた入力は保存でき、改行は保存しない
    await page.getByTestId("owner-override-edit").click();
    await memo.fill(`${"a".repeat(1000)}\n`);
    await expect(page.getByTestId("owner-override-count")).toHaveText("1,000 / 1,000");
    await page.getByTestId("owner-override-save").click();
    await expect(panel(page)).toHaveAttribute("data-state", "saved");
    expect(await overrideRow(OWNER.email, "9U003")).toMatchObject({ len: 1000, memo: "a".repeat(1000) });

    // C1-4: 改行を含むメモで保存（URL は変わらない）
    await page.getByTestId("owner-override-edit").click();
    await memo.fill("関係会社の状況で資産管理会社と確認\n2026年6月の有報");
    await page.getByTestId("owner-override-save").click();
    await expect(panel(page)).toHaveAttribute("data-state", "saved");
    await expect(page).toHaveURL(/\/stocks\/9U003$/);
    await expect(page.getByTestId("owner-override-verdict")).toHaveText("該当（オーナー企業）");
    await expect(page.getByTestId("owner-override-verdict")).toHaveAttribute("data-verdict", "owner_company");
    await expect(page.getByTestId("owner-override-auto-result")).toHaveText("非該当");
    await expect(panel(page).getByTestId("manual-override-label")).toBeVisible();
    const memoText = page.getByTestId("owner-override-memo-text");
    await expect(memoText).toHaveText("関係会社の状況で資産管理会社と確認\n2026年6月の有報");
    expect(await memoText.evaluate((el) => el.getClientRects().length > 0 && el.getBoundingClientRect().height > 30)).toBe(true); // 2行
    await expect(page.getByTestId("owner-override-dates")).toContainText(/補正 \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    const saved = await overrideRow(OWNER.email, "9U003");
    expect(saved).toMatchObject({
      verdict: "owner_company",
      memo: "関係会社の状況で資産管理会社と確認\n2026年6月の有報",
      auto_status: "determined",
      auto_president_is_top_holder: false,
      auto_shareholders_doc_id: "SXTEST03",
      auto_officers_doc_id: "SXTEST03",
    });
    expect(Number(saved.auto_total)).toBe(0);

    // C1-6: 編集で「非該当」にすると updated_at が新しくなり、created_at は変わらない
    await page.getByTestId("owner-override-edit").click();
    await expect(memo).toHaveValue("関係会社の状況で資産管理会社と確認\n2026年6月の有報");
    await page.getByTestId("owner-override-verdict-not_matched").click();
    await page.getByTestId("owner-override-save").click();
    await expect(page.getByTestId("owner-override-verdict")).toHaveText("非該当");
    const edited = await overrideRow(OWNER.email, "9U003");
    expect(edited.verdict).toBe("not_matched");
    expect(edited.created_at).toEqual(saved.created_at);
    expect(edited.updated_at.getTime()).toBeGreaterThan(saved.updated_at.getTime());
    await page.getByTestId("owner-override-edit").click();
    await page.getByTestId("owner-override-verdict-owner_company").click();
    await page.getByTestId("owner-override-save").click();
    await expect(page.getByTestId("owner-override-verdict")).toHaveText("該当（オーナー企業）");

    // C1-5: スクリプトは文字列として表示され、動かない
    const xss = await putOverride(page.request, "9U007", { verdict: "not_matched", memo: "<script>alert(1)</script><img src=x onerror=alert(2)>" });
    expect(xss.status()).toBe(200);
    await page.goto("/stocks/9U007");
    await expect(page.getByTestId("owner-override-memo-text")).toHaveText("<script>alert(1)</script><img src=x onerror=alert(2)>");
    await page.waitForTimeout(500);
    expect(dialogs).toEqual([]);

    // C1-7: 小文字のコードでも正規化して同じ銘柄に保存される
    const lower = await putOverride(page.request, "9u002", { verdict: "not_matched", memo: "小文字" });
    expect(lower.status()).toBe(200);
    expect((await overrideRow(OWNER.email, "9U002")).memo).toBe("小文字");
    expect(problems).toEqual([]);
  });

  test("補正後の判定が詳細とスクリーニングで使われ、手動補正と元の自動判定が並ぶ（C2-1〜C2-7）", async ({ page }) => {
    await loginAs(page, OWNER);
    expect((await putOverride(page.request, "9U003", { verdict: "owner_company", memo: "資産管理会社と確認" })).status()).toBe(200);

    // C2-1: 詳細
    await page.goto("/stocks/9U003");
    const evidence = page.getByTestId("ownership-evidence");
    await expect(evidence).toHaveAttribute("data-result", "not_matched");
    await expect(evidence).toHaveAttribute("data-effective-result", "owner_company");
    await expect(evidence.getByTestId("evidence-result")).toHaveText("該当（オーナー企業）");
    await expect(evidence.getByTestId("evidence-auto-result")).toHaveText("自動判定: 非該当");
    const evaluation = page.getByTestId("evaluation-owner");
    await expect(evaluation).toHaveAttribute("data-status", "met");
    await expect(evaluation.getByTestId("manual-override-label")).toBeVisible();
    await expect(evaluation.getByTestId("evaluation-owner-auto")).toHaveText("自動判定: 非該当");
    await expect(page.getByTestId("evaluation-inclusion")).toHaveAttribute("data-included", "true");
    await expect(page.getByTestId("breakdown-totals").locator("[data-category=owner_total]")).toContainText("0.0%");

    // C2-2: スクリーニング
    await page.goto("/screening");
    await expectCodes(page, ["9U001", "9U002", "9U003", "9U006", "9U008", "9U009", "9U010", "9U014"]);
    const cell = resultRow(page, "9U003").getByTestId("cell-owner-judgment");
    await expect(cell).toHaveAttribute("data-result", "owner_company");
    await expect(cell).toHaveAttribute("data-auto-result", "not_matched");
    await expect(cell).toHaveAttribute("data-override", "true");
    await expect(cell.getByTestId("manual-override-label")).toBeVisible();
    await expect(cell.getByTestId("owner-judgment-label")).toHaveText("該当（オーナー企業）");
    await expect(cell.getByTestId("owner-judgment-auto")).toHaveText("自動: 非該当");
    await cell.getByTestId("owner-judgment-trigger").hover();
    const popover = page.getByTestId("owner-judgment-detail");
    await expect(popover.getByTestId("owner-override-popover")).toContainText("該当（オーナー企業）");
    await expect(popover.getByTestId("owner-override-popover-memo")).toHaveText("資産管理会社と確認");
    await expect(popover.getByTestId("owner-override-popover")).toContainText(/更新 \d{4}-\d{2}-\d{2}/);
    await expect(popover).toContainText("非該当");
    await expect(popover.getByTestId("popover-top-holder")).toContainText("株式会社日本カストディ銀行（信託口） 12.0%");
    await expect(popover.getByTestId("popover-presidents")).toContainText("渡辺　健一");
    await page.mouse.move(0, 0);
    await expect(popover).toBeHidden();
    await cell.getByTestId("owner-judgment-trigger").click();
    await expect(popover).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/\/screening/);
    await page.keyboard.press("Escape");
    await cell.getByTestId("owner-judgment-trigger").focus();
    await page.keyboard.press("Enter");
    await expect(popover).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(resultRow(page, "9U003").getByTestId("condition-status-owner")).toHaveAttribute("title", /満たす（手動補正）$/);
    await expect(resultRow(page, "9U006").getByTestId("manual-override-label")).toHaveCount(0);
    await expect(resultRow(page, "9U006").getByTestId("cell-owner-judgment")).not.toHaveAttribute("data-override", "true");

    // C2-3: 「社長が筆頭株主のみ」では「該当（オーナー企業）」の補正は満たさない
    await page.goto("/screening?ownermode=president");
    await expectCodes(page, ["9U001", "9U008", "9U009", "9U010", "9U014"]);
    await page.goto("/stocks/9U003?ownermode=president");
    await expect(page.getByTestId("evaluation-owner")).toHaveAttribute("data-status", "unmet");
    await expect(page.getByTestId("evaluation-owner-mode-note")).toHaveText("『社長が筆頭株主のみ』では、この補正は条件を満たしません");
    await expect(page.getByTestId("owner-override-mode-note")).toBeVisible();

    // C2-4: 閾値は補正に当てない
    await page.goto("/screening?owner=40");
    await expectCodes(page, ["9U001", "9U003", "9U008", "9U009", "9U010", "9U014"]);

    // C2-5: オフでも補正後の判定と「手動補正」を出す
    await page.goto("/screening?off=owner");
    await expect(resultRow(page, "9U003").getByTestId("condition-status-owner")).toHaveAttribute("data-status", "off");
    await expect(resultRow(page, "9U003").getByTestId("cell-owner-judgment").getByTestId("manual-override-label")).toBeVisible();
    await expect(resultRow(page, "9U003").getByTestId("owner-judgment-label")).toHaveText("該当（オーナー企業）");

    // C2-6: 9U006 を非該当、9U004 を社長が筆頭株主に補正
    expect((await putOverride(page.request, "9U006", { verdict: "not_matched", memo: "山田興産は取引先" })).status()).toBe(200);
    expect((await putOverride(page.request, "9U004", { verdict: "president_top", memo: "有報を確認" })).status()).toBe(200);
    await page.goto("/screening");
    await expectCodes(page, ["9U001", "9U002", "9U003", "9U004", "9U008", "9U009", "9U010", "9U014"]);
    await expect(page.getByTestId("excluded-undeterminable")).toContainText("2 件");
    await page.goto("/screening?undeterminable=include");
    await expect(page.getByTestId("result-count")).toHaveText("10");
    await expect(resultRow(page, "9U006")).toHaveCount(0);
    await page.goto("/stocks/9U004");
    await expect(page.getByTestId("evaluation-owner")).toHaveAttribute("data-status", "met");
    await expect(page.getByTestId("evaluation-owner-auto")).toHaveText("自動判定: 判定不能");

    // C2-7: API
    const screening = await (await page.request.get("/api/screening")).json();
    const row = screening.data.rows.find((r: { code: string }) => r.code === "9U003");
    expect(row.ownership).toMatchObject({ result: "owner_company", auto_result: "not_matched", override: { verdict: "owner_company", auto_changed: false } });
    expect(row.ownership.override.updated_at).toMatch(/\+09:00$/);
    expect(row.status.owner).toBe("met");
    const plain = screening.data.rows.find((r: { code: string }) => r.code === "9U001");
    expect(plain.ownership).toMatchObject({ result: "president_top", auto_result: "president_top", override: null });
    const detail = await (await page.request.get("/api/stocks/9U003")).json();
    expect(detail.data.evaluation).toMatchObject({ ownerResult: "owner_company", ownerAutoResult: "not_matched", ownerOverride: "owner_company" });
    expect(detail.data.ownership.override.memo).toBe("資産管理会社と確認");
  });

  test("幅: 1280 で表が横スクロールせず、375 で補正の区画とポップオーバーが画面の中（C2-8）", async ({ browser, page }) => {
    await loginAs(page, OWNER);
    for (const code of ["9U003", "9U006", "9U001", "9U008"]) {
      expect((await putOverride(page.request, code, { verdict: "owner_company", memo: "幅の確認のための長めのメモです。".repeat(5) })).status()).toBe(200);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/screening");
    await expect(resultRow(page, "9U003")).toBeVisible();
    expect(await page.getByTestId("results-scroll").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

    const { context, page: mobile } = await newUserPage(browser, OWNER, { width: 375, height: 812 });
    await mobile.goto("/stocks/9U003");
    await expect(panel(mobile)).toHaveAttribute("data-state", "saved");
    expect(await mobile.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    const box = await panel(mobile).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    await mobile.getByTestId("owner-override-edit").click();
    const form = await panel(mobile).boundingBox();
    expect(form!.x + form!.width).toBeLessThanOrEqual(375);
    expect(await mobile.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

    await mobile.goto("/screening");
    await expect(resultRow(mobile, "9U003")).toBeVisible();
    expect(await mobile.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await resultRow(mobile, "9U003").getByTestId("owner-judgment-trigger").scrollIntoViewIfNeeded();
    await resultRow(mobile, "9U003").getByTestId("owner-judgment-trigger").click();
    const pop = await mobile.getByTestId("owner-judgment-detail").boundingBox();
    expect(pop!.x).toBeGreaterThanOrEqual(0);
    expect(pop!.x + pop!.width).toBeLessThanOrEqual(375);
    await context.close();
  });
});

test.describe("取り消しと再読み込み（C3。AC10.3・AC10.4 前半）", () => {
  test("リロード・再ログインで残り、確認のダイアログの後に取り消すと自動判定に戻る（C3-1〜C3-4）", async ({ page }) => {
    await loginAs(page, OWNER);
    expect((await putOverride(page.request, "9U003", { verdict: "owner_company", memo: "残る" })).status()).toBe(200);
    await page.goto("/stocks/9U003");
    await expect(panel(page)).toHaveAttribute("data-state", "saved");
    await page.reload();
    await expect(page.getByTestId("owner-override-verdict")).toHaveText("該当（オーナー企業）");
    await page.getByRole("button", { name: "アカウントメニュー" }).click();
    await page.getByRole("menuitem", { name: "ログアウト" }).click();
    await expect(page).toHaveURL("/login");
    await loginAs(page, OWNER);
    await page.goto("/stocks/9U003");
    await expect(page.getByTestId("owner-override-memo-text")).toHaveText("残る");

    await page.getByTestId("owner-override-delete").click();
    const dialog = page.getByTestId("owner-override-delete-dialog");
    await expect(dialog).toContainText("補正を取り消すと、自動判定に戻ります。メモも消えます。");
    await page.getByTestId("owner-override-delete-cancel").click();
    await expect(dialog).toBeHidden();
    await expect(panel(page)).toHaveAttribute("data-state", "saved");
    expect(await overrideRow(OWNER.email, "9U003")).not.toBeNull();

    await page.getByTestId("owner-override-delete").click();
    await page.getByTestId("owner-override-delete-confirm").click();
    await expect(panel(page)).toHaveAttribute("data-state", "none");
    await expect(page.getByTestId("evidence-result")).toHaveText("非該当");
    await expect(page.getByTestId("ownership-evidence").getByTestId("manual-override-label")).toHaveCount(0);
    expect(await overrideRow(OWNER.email, "9U003")).toBeNull();

    await page.goto("/screening");
    await expectCodes(page, DEFAULT_CODES);
    const again = await page.request.delete("/api/stocks/9U003/ownership-override", { headers: { origin: BASE_URL } });
    expect(again.status()).toBe(200);
    expect(await again.json()).toEqual({ deleted: false });
  });

  test("保存・取り消しの直後にスクリーニングへ戻ると、直前の操作が反映される（C3-5）", async ({ page }) => {
    await loginAs(page, OWNER);
    // 条件④をオフにして 9U002 を常に一覧に出し、条件④のセル（補正後の判定と「手動補正」）で直前の操作が反映されたかを見る
    const query = "cagr=20&margin=10&years=5&owner=20&ownermode=any&off=owner&sort=owner&order=desc";
    const saveAndBack = async (back: () => Promise<unknown>, overridden: boolean) => {
      await page.goto(`/screening?${query}`);
      await expect(resultRow(page, "9U002")).toBeVisible();
      await resultRow(page, "9U002").getByTestId("row-link-code").click();
      await expect(page).toHaveURL(/\/stocks\/9U002\?/);
      if (overridden) {
        await page.getByTestId("owner-override-open").click();
        await page.getByTestId("owner-override-verdict-not_matched").click();
        await page.getByTestId("owner-override-memo").fill("戻る確認");
        await page.getByTestId("owner-override-save").click();
        await expect(panel(page)).toHaveAttribute("data-state", "saved");
      } else {
        await page.getByTestId("owner-override-delete").click();
        await page.getByTestId("owner-override-delete-confirm").click();
        await expect(panel(page)).toHaveAttribute("data-state", "none");
      }
      await back();
      await expect(page).toHaveURL(`/screening?${query}`);
      const cell = resultRow(page, "9U002").getByTestId("cell-owner-judgment");
      await expect(cell).toHaveAttribute("data-result", overridden ? "not_matched" : "owner_company");
      await expect(cell.getByTestId("manual-override-label")).toHaveCount(overridden ? 1 : 0);
      await expect(resultRow(page, "9U002").getByTestId("condition-status-owner")).toHaveAttribute("data-status", "off");
    };
    await saveAndBack(() => page.getByTestId("breadcrumb-screening").click(), true);
    await saveAndBack(() => page.getByRole("navigation", { name: "メイン" }).getByRole("link", { name: "スクリーニング" }).click(), false);
    await saveAndBack(() => page.goBack(), true);
    await saveAndBack(() => page.goBack(), false);
  });
});

test.describe("ユーザーごとの分離（C4。AC10.4 後半）", () => {
  test("owner の補正は owner2 に見えず、影響もしない。逆も同じ（C4-1・C4-2）", async ({ browser, page }) => {
    await loginAs(page, OWNER);
    expect((await putOverride(page.request, "9U003", { verdict: "owner_company", memo: "owner" })).status()).toBe(200);

    const { context, page: other } = await newUserPage(browser, OWNER2);
    await other.goto("/stocks/9U003");
    await expect(panel(other)).toHaveAttribute("data-state", "none");
    await expect(other.getByTestId("evidence-result")).toHaveText("非該当");
    await expect(other.getByTestId("manual-override-label")).toHaveCount(0);
    await other.goto("/screening");
    await expectCodes(other, DEFAULT_CODES);
    expect((await (await other.request.get("/api/stocks/9U003")).json()).data.ownership.override).toBeNull();

    expect((await putOverride(other.request, "9U003", { verdict: "not_matched", memo: "owner2" })).status()).toBe(200);
    expect((await putOverride(other.request, "9U006", { verdict: "not_matched", memo: "owner2" })).status()).toBe(200);
    await other.goto("/screening");
    await expectCodes(other, ["9U001", "9U002", "9U008", "9U009", "9U010", "9U014"]);

    await page.goto("/screening");
    await expectCodes(page, ["9U001", "9U002", "9U003", "9U006", "9U008", "9U009", "9U010", "9U014"]);
    await expect(resultRow(page, "9U006").getByTestId("cell-owner-judgment")).not.toHaveAttribute("data-override", "true");
    await page.goto("/stocks/9U003");
    await expect(page.getByTestId("owner-override-memo-text")).toHaveText("owner");
    await context.close();
  });

  test("PostgREST を owner2 の JWT で直接呼んでも、owner の行は読めず・変えられず、owner の id では追加できない（C4-3）", async ({ page, playwright }) => {
    test.skip(!PUBLISHABLE_KEY, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY が E2E の環境に無い");
    await loginAs(page, OWNER);
    expect((await putOverride(page.request, "9U003", { verdict: "owner_company", memo: "owner の行" })).status()).toBe(200);
    const ownerIdValue = await userId(OWNER.email);
    const request = await playwright.request.newContext();
    const api = rest(request, await accessToken(request, OWNER2));
    expect((await putOverride(page.request, "9U006", { verdict: "not_matched", memo: "x" })).status()).toBe(200);

    await api.insert({ code: "9U007", verdict: "not_matched", memo: "owner2 の行" });
    const selected = await (await api.select()).json();
    expect(selected.map((r: { memo: string }) => r.memo)).toEqual(["owner2 の行"]);

    const updated = await api.update(`user_id=eq.${ownerIdValue}`, { memo: "書き換え" });
    expect(await updated.json()).toEqual([]);
    const removed = await api.remove(`user_id=eq.${ownerIdValue}`);
    expect(await removed.json()).toEqual([]);
    expect((await overrideRow(OWNER.email, "9U003")).memo).toBe("owner の行");

    const forged = await api.insert({ user_id: ownerIdValue, code: "9U001", verdict: "not_matched", memo: "なりすまし" });
    expect(forged.status()).toBeGreaterThanOrEqual(400);
    expect(await overrideRow(OWNER.email, "9U001")).toBeNull();
    await request.dispose();
  });

  test("未ログインは 401、別のオリジンは 403、入力の検証は 400（C4-6〜C4-8）", async ({ page, playwright }) => {
    const anonymous = await playwright.request.newContext({ baseURL: BASE_URL });
    const base = "/api/stocks/9U003/ownership-override";
    for (const [method, path] of [
      ["get", base],
      ["put", base],
      ["delete", base],
      ["post", `${base}/acknowledge`],
    ] as const) {
      const res = await anonymous[method](path, { headers: { origin: BASE_URL }, data: method === "put" ? { verdict: "not_matched", memo: "x" } : undefined });
      expect(res.status(), `${method} ${path}`).toBe(401);
      expect(res.headers()["cache-control"], `${method} ${path}`).toContain("no-store");
    }
    await anonymous.dispose();
    expect(await overrideCount()).toBe(0);

    await loginAs(page, OWNER);
    const evil = "https://evil.example";
    expect((await putOverride(page.request, "9U003", { verdict: "not_matched", memo: "x" }, evil)).status()).toBe(403);
    expect((await page.request.delete(base, { headers: { origin: evil } })).status()).toBe(403);
    const ack = await page.request.post(`${base}/acknowledge`, { headers: { origin: evil } });
    expect(ack.status()).toBe(403);
    expect(await ack.json()).toEqual({ error: "cross_origin" });
    expect(await overrideCount()).toBe(0);

    for (const verdict of ["president", "met", "", undefined]) {
      const res = await putOverride(page.request, "9U003", { verdict, memo: "x" });
      expect(res.status(), String(verdict)).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_override", fields: ["verdict"] });
    }
    for (const memo of [undefined, " ", "　　", "\n\n", "a".repeat(1001), "𠮷".repeat(1001), 123]) {
      const res = await putOverride(page.request, "9U003", { verdict: "not_matched", memo });
      expect(res.status(), JSON.stringify(memo)?.slice(0, 10)).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_override", fields: ["memo"] });
    }
    const notJson = await page.request.put(base, { headers: { origin: BASE_URL, "content-type": "application/json" }, data: Buffer.from("{not json") });
    expect(notJson.status()).toBe(400);
    expect(await notJson.json()).toEqual({ error: "invalid_body" });
    expect((await putOverride(page.request, "ABC!", { verdict: "not_matched", memo: "x" })).status()).toBe(400);
    const missing = await putOverride(page.request, "9U999", { verdict: "not_matched", memo: "x" });
    expect(missing.status()).toBe(404);
    expect(await missing.json()).toEqual({ error: "not_found" });
    expect(await overrideCount()).toBe(0);

    const kanji = await putOverride(page.request, "9U003", { verdict: "not_matched", memo: "𠮷".repeat(1000) });
    expect(kanji.status()).toBe(200);
    expect((await kanji.json()).data.memo).toBe("𠮷".repeat(1000));
    const trimmed = await putOverride(page.request, "9U003", { verdict: "not_matched", memo: "　\n 前後の空白 \t\n" });
    expect((await trimmed.json()).data.memo).toBe("前後の空白");
    expect((await overrideRow(OWNER.email, "9U003")).memo).toBe("前後の空白");
    const ackMissing = await page.request.post("/api/stocks/9U001/ownership-override/acknowledge", { headers: { origin: BASE_URL } });
    expect(ackMissing.status()).toBe(404);
    expect(await ackMissing.json()).toEqual({ error: "override_not_found" });
  });
});

test.describe("補正後に自動判定が更新されました（C5。AC10.5）", () => {
  test("訂正有報で自動判定が変わると知らせ、消すと消え、確認済みで記録が置き換わる（C5-1〜C5-4）", async ({ page }) => {
    await loginAs(page, OWNER);
    await page.goto("/stocks/9U006");
    await page.getByTestId("owner-override-open").click();
    await page.getByTestId("owner-override-verdict-not_matched").click();
    await page.getByTestId("owner-override-memo").fill("山田興産は取引先");
    await page.getByTestId("owner-override-save").click();
    await expect(panel(page)).toHaveAttribute("data-state", "saved");
    await expect(page.getByTestId("owner-override-auto-changed")).toHaveCount(0);

    await sql(ADD_SQL);
    await page.reload();
    const notice = page.getByTestId("owner-override-auto-changed");
    await expect(notice).toContainText("補正後に自動判定が更新されました");
    const row = (key: string) => notice.locator(`[data-row=${key}]`);
    await expect(row("result").getByTestId("auto-changed-before")).toHaveText("該当（オーナー企業）");
    await expect(row("result").getByTestId("auto-changed-now")).toContainText("非該当");
    await expect(row("owner_total").getByTestId("auto-changed-before")).toHaveText("35.0%");
    await expect(row("owner_total").getByTestId("auto-changed-now")).toContainText("17.0%");
    await expect(row("shareholders_doc").getByTestId("auto-changed-before")).toHaveText("SXTEST06");
    await expect(row("shareholders_doc").getByTestId("auto-changed-now")).toContainText("SYTEST16");
    await expect(row("shareholders_doc")).toHaveAttribute("data-changed", "true");
    await expect(row("president_top")).toHaveAttribute("data-changed", "false");
    await expect(page.getByTestId("owner-override-verdict")).toHaveText("非該当");
    await expect(page.getByTestId("owner-override-memo-text")).toHaveText("山田興産は取引先");
    await expect(page.getByTestId("evidence-documents")).toContainText("SYTEST16");
    const api = await (await page.request.get("/api/stocks/9U006")).json();
    expect(api.data.ownership.override.auto_changed).toBe(true);

    await page.goto("/screening?off=owner"); // 非該当に補正したので、条件④をオフにして行を出す
    await resultRow(page, "9U006").getByTestId("owner-judgment-trigger").hover();
    await expect(page.getByTestId("owner-override-auto-changed-hint")).toHaveText("補正後に自動判定が更新されました（詳細で確認できます）");

    // C5-3: 消すと消え、もう一度入れると出る
    await sql(OVERRIDE_CLEANUP_SQL);
    await page.goto("/stocks/9U006");
    await expect(panel(page)).toHaveAttribute("data-state", "saved");
    await expect(notice).toHaveCount(0);
    await sql(ADD_SQL);
    await page.reload();
    await expect(notice).toBeVisible();

    // C5-4: 確認済みにする
    await page.getByTestId("owner-override-acknowledge").click();
    await expect(notice).toHaveCount(0);
    await expect(page.getByTestId("owner-override-verdict")).toHaveText("非該当");
    expect(await overrideRow(OWNER.email, "9U006")).toMatchObject({ auto_total: "17.00", auto_shareholders_doc_id: "SYTEST16", memo: "山田興産は取引先" });
    await page.reload();
    await expect(notice).toHaveCount(0);
    await sql(OVERRIDE_CLEANUP_SQL);
    await page.reload();
    await expect(notice).toBeVisible();
    await expect(row("shareholders_doc").getByTestId("auto-changed-now")).toContainText("SXTEST06");
  });

  test("取り下げで判定不能に変わっても知らせる（C5-6）。有報未取得 → 取り込み → 知らせ（C5-9）。sort=owner で最後（C5-10）", async ({ page }) => {
    await loginAs(page, OWNER);
    expect((await putOverride(page.request, "9U003", { verdict: "owner_company", memo: "x" })).status()).toBe(200);
    await sql("update public.edinet_documents set withdrawn = true where doc_id = 'SXTEST03'");
    await page.goto("/stocks/9U003");
    const notice = page.getByTestId("owner-override-auto-changed");
    await expect(notice.locator("[data-row=result] [data-testid=auto-changed-before]")).toHaveText("非該当");
    await expect(notice.locator("[data-row=result] [data-testid=auto-changed-now]")).toContainText("判定不能（有報が未取得）");
    await expect(page.getByTestId("owner-override-verdict")).toHaveText("該当（オーナー企業）");
    await expect(page.getByTestId("evaluation-owner")).toHaveAttribute("data-status", "met");
    await sql("update public.edinet_documents set withdrawn = false where doc_id = 'SXTEST03'");
    await page.reload();
    await expect(notice).toHaveCount(0);

    await page.goto("/stocks/9U004");
    await page.getByTestId("owner-override-open").click();
    await page.getByTestId("owner-override-verdict-president_top").click();
    await page.getByTestId("owner-override-memo").fill("有報を確認");
    await page.getByTestId("owner-override-save").click();
    await expect(panel(page)).toHaveAttribute("data-state", "saved");
    await expect(notice).toHaveCount(0);
    for (const order of ["desc", "asc"]) {
      await page.goto(`/screening?sort=owner&order=${order}`);
      await expect.poll(async () => (await rowCodes(page)).at(-1), order).toBe("9U004");
    }
    await sql(ADD_9U004_SQL);
    await page.goto("/stocks/9U004");
    await expect(notice.locator("[data-row=result] [data-testid=auto-changed-before]")).toHaveText("判定不能（有報が未取得）");
    await expect(notice.locator("[data-row=result] [data-testid=auto-changed-now]")).toContainText("該当（社長が筆頭株主）");
    await expect(notice.locator("[data-row=owner_total] [data-testid=auto-changed-now]")).toContainText("40.0%");
    await expect(notice.locator("[data-row=shareholders_doc] [data-testid=auto-changed-now]")).toContainText("SYTEST04");
    await expect(page.getByTestId("owner-override-verdict")).toHaveText("該当（社長が筆頭株主）");
    await sql(OVERRIDE_CLEANUP_SQL);
    await page.reload();
    await expect(notice).toHaveCount(0);
  });
});

test.describe("PostgREST からの直接の書き込み（C6-4）", () => {
  test("記録・日時・user_id・code・verdict・メモを偽れない", async ({ playwright }) => {
    test.skip(!PUBLISHABLE_KEY, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY が E2E の環境に無い");
    const request = await playwright.request.newContext();
    const api = rest(request, await accessToken(request, OWNER));
    const owner2 = await userId(OWNER2.email);

    // 1. 記録を偽った insert・update
    const inserted = await api.insert({ code: "9U006", verdict: "not_matched", memo: "x", auto_status: "undeterminable", auto_owner_total_pct: 99, auto_shareholders_doc_id: "FAKE", created_at: "2000-01-01T00:00:00Z" });
    expect(inserted.status()).toBe(201);
    let row = await overrideRow(OWNER.email, "9U006");
    expect(row).toMatchObject({ auto_status: "determined", auto_total: "35.00", auto_shareholders_doc_id: "SXTEST06" });
    expect(row.created_at.getTime()).toBeGreaterThan(Date.now() - 60 * 60 * 1000);
    await api.update("code=eq.9U006", { auto_owner_total_pct: 1, auto_shareholders_doc_id: "FAKE" });
    expect(await overrideRow(OWNER.email, "9U006")).toMatchObject({ auto_total: "35.00", auto_shareholders_doc_id: "SXTEST06" });

    // 2. created_at・updated_at
    const before = await overrideRow(OWNER.email, "9U006");
    await api.update("code=eq.9U006", { created_at: "2000-01-01T00:00:00Z", updated_at: "2000-01-01T00:00:00Z" });
    row = await overrideRow(OWNER.email, "9U006");
    expect(row.created_at).toEqual(before.created_at);
    expect(row.updated_at.getTime()).toBeGreaterThanOrEqual(before.updated_at.getTime());

    // 3. user_id・code の変更は拒否
    expect((await api.update("code=eq.9U006", { user_id: owner2 })).status()).toBeGreaterThanOrEqual(400);
    expect((await api.update("code=eq.9U006", { code: "9U003" })).status()).toBeGreaterThanOrEqual(400);
    expect(await overrideRow(OWNER.email, "9U006")).not.toBeNull();

    // 4. verdict
    expect((await api.insert({ code: "9U003", verdict: "met", memo: "x" })).status()).toBeGreaterThanOrEqual(400);
    expect((await api.update("code=eq.9U006", { verdict: "met" })).status()).toBeGreaterThanOrEqual(400);

    // 5. メモ
    for (const memo of [" ", "　　", "\n\n", "a".repeat(1001), "𠮷".repeat(1001)]) {
      expect((await api.insert({ code: "9U003", verdict: "not_matched", memo })).status(), JSON.stringify(memo.slice(0, 3))).toBeGreaterThanOrEqual(400);
    }
    expect(await overrideRow(OWNER.email, "9U003")).toBeNull();
    expect((await api.insert({ code: "9U003", verdict: "not_matched", memo: "　\n前後\n" })).status()).toBe(201);
    expect((await overrideRow(OWNER.email, "9U003")).memo).toBe("前後");
    expect((await api.insert({ code: "9U001", verdict: "not_matched", memo: "𠮷".repeat(1000) })).status()).toBe(201);

    // 6. user_id を省いた insert は自分の id（上の insert はどれも user_id を省いている）
    expect((await sql("select count(*)::int as n from public.ownership_overrides where user_id = $1", [await userId(OWNER.email)])).rows[0].n).toBe(3);
    await request.dispose();
  });
});

test.describe("改善提案（C8）と画面のそのほか（C9）", () => {
  test("375px の内訳の明細の氏名の列（m1）、判定不能の書類の見出し（m5）、区分名の表記（m6）", async ({ browser, page }) => {
    const { context, page: mobile } = await newUserPage(browser, OWNER, { width: 375, height: 812 });
    await mobile.goto("/stocks/9U006");
    await expect(mobile.getByTestId("breakdown-holders")).toBeVisible();
    expect(await mobile.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    const nameCells = mobile.getByTestId("breakdown-name-cell");
    for (const box of await nameCells.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width))) expect(box).toBeGreaterThanOrEqual(120);
    const trust = mobile.getByTestId("breakdown-holder").filter({ hasText: "日本マスタートラスト信託銀行株式会社（信託口）" }).getByTestId("breakdown-name");
    const lines = await trust.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
    expect(lines).toBeLessThanOrEqual(4);
    for (const testId of ["breakdown-ratio", "breakdown-category"]) {
      for (const right of await mobile.getByTestId(testId).evaluateAll((els) => els.map((el) => el.getBoundingClientRect().right))) expect(right).toBeLessThanOrEqual(375);
    }
    await context.close();

    await loginAs(page, OWNER);
    for (const code of ["9U013", "9U005"]) {
      await page.goto(`/stocks/${code}`);
      await expect(page.getByTestId("evidence-documents-heading")).toHaveText("対象の有報（判定には使っていません）");
      await expect(page.getByTestId("ownership-evidence")).not.toContainText("使った有報");
    }
    await page.goto("/stocks/9U006");
    await expect(page.getByTestId("evidence-documents-heading")).toHaveText("使った有報");

    // m6: 一覧のポップオーバー・詳細の合計・明細の区分名の文字列が同じ
    const detailNames = async (scope: string) =>
      page.locator(`[data-testid=${scope}] [data-testid=category-name]`).evaluateAll((els) => els.map((el) => `${el.getAttribute("data-category")}:${el.textContent}`));
    const totals = await detailNames("breakdown-totals");
    expect(totals).toEqual(expect.arrayContaining(["family:同姓の親族（推定）", "asset_company:資産管理会社（推定）", "president:社長本人"]));
    const holders = await detailNames("breakdown-holders");
    expect(holders).toEqual(expect.arrayContaining(["family:同姓の親族（推定）", "asset_company:資産管理会社（推定）", "president:社長本人", "other:オーナー系以外"]));
    await expect(page.locator("[data-testid=breakdown-holders] [data-category=president] [data-testid=estimated-label]")).toHaveCount(0);
    await page.goto("/screening");
    await resultRow(page, "9U006").getByTestId("ownership-trigger").hover();
    const popoverNames = await page.locator("[data-testid=ownership-detail] [data-testid=category-name]").evaluateAll((els) => els.map((el) => `${el.getAttribute("data-category")}:${el.textContent}`));
    expect(popoverNames).toEqual(["president:社長本人", "officer:その他の役員本人", "family:同姓の親族（推定）", "asset_company:資産管理会社（推定）", "other:オーナー系以外"]);
    await expect(page.locator("[data-testid=ownership-detail] [data-category=family] [data-testid=estimated-label]")).toBeVisible();
  });

  test("時計のずれの状態で、補正の保存・取り消しをしてもコンソールのエラーが出ない（C9-2）", async ({ page, context }) => {
    await simulateServerClockBehind(context);
    const problems = collectPageProblems(page);
    await loginAs(page, OWNER);
    await page.goto("/stocks/9U003");
    await page.getByTestId("owner-override-open").click();
    await page.getByTestId("owner-override-verdict-owner_company").click();
    await page.getByTestId("owner-override-memo").fill("時計");
    await page.getByTestId("owner-override-save").click();
    await expect(panel(page)).toHaveAttribute("data-state", "saved");
    await sql(ADD_SQL);
    expect((await putOverride(page.request, "9U006", { verdict: "not_matched", memo: "x" })).status()).toBe(200);
    await sql(OVERRIDE_CLEANUP_SQL);
    await page.goto("/stocks/9U006");
    await expect(page.getByTestId("owner-override-auto-changed")).toBeVisible();
    await page.goto("/screening");
    await expect(resultRow(page, "9U003")).toBeVisible();
    await page.goto("/stocks/9U003");
    await page.getByTestId("owner-override-delete").click();
    await page.getByTestId("owner-override-delete-confirm").click();
    await expect(panel(page)).toHaveAttribute("data-state", "none");
    expect(problems).toEqual([]);
  });

  test("キーボードだけで補正を開き、保存し、ダイアログで取り消せる（C9-3）", async ({ page }) => {
    await loginAs(page, OWNER);
    await page.goto("/stocks/9U003");
    await page.getByTestId("owner-override-open").focus();
    await page.keyboard.press("Enter");
    await expect(panel(page)).toHaveAttribute("data-state", "editing");
    // 開いたら選択肢にフォーカスが移る。矢印キーで選び、Space で確定
    await expect(page.getByTestId("owner-override-verdict-president_top")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("owner-override-verdict-owner_company")).toBeFocused();
    await page.keyboard.press("Space");
    await expect(page.getByTestId("owner-override-verdict-owner_company")).toHaveAttribute("data-state", "checked");
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("owner-override-memo")).toBeFocused();
    await page.keyboard.type("キーボードで入力");
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("owner-override-save")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(panel(page)).toHaveAttribute("data-state", "saved");

    const trigger = page.getByTestId("owner-override-delete");
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByTestId("owner-override-delete-dialog");
    await expect(dialog).toBeVisible();
    // フォーカスはダイアログの中に閉じ込められる
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await page.getByTestId("owner-override-delete-confirm").focus();
    await page.keyboard.press("Enter");
    await expect(panel(page)).toHaveAttribute("data-state", "none");
    expect(await overrideCount()).toBe(0);
  });
});
