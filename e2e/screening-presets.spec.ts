import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";

import { BASE_URL, collectPageProblems, login, OWNER, simulateServerClockBehind, sql } from "./support";

/**
 * 条件プリセット（F12、Sprint 13）。契約 docs/harness/sprints/sprint-13/contract.md の完了条件。
 * 市場データは Sprint 10 の ownership-example.sql（9U001〜9U014）、プリセットは screening-presets-example.sql（owner の3件）。
 * 前提: 市場データ・実行履歴・プリセットが0件の DB、pnpm seed:users 済み（owner・owner2・intruder）、authenticated に select の権限。
 * 後片付けは各テストの後と afterAll（テストが失敗しても既定のプリセットを残さない。残ると /screening を開くほかの spec が連鎖して落ちる）。
 */
test.describe.configure({ mode: "serial" });

const FIXTURES = join(__dirname, "fixtures");
const EXAMPLE_SQL = readFileSync(join(FIXTURES, "ownership-example.sql"), "utf8");
const CLEANUP_SQL = readFileSync(join(FIXTURES, "ownership-cleanup.sql"), "utf8");
const PRESETS_SQL = readFileSync(join(FIXTURES, "screening-presets-example.sql"), "utf8");
const PRESETS_CLEANUP_SQL = readFileSync(join(FIXTURES, "screening-presets-cleanup.sql"), "utf8");

const OWNER2 = { email: "owner2@quantis.local", password: "Quantis-Owner2-2026!" };
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

const STANDARD = "cagr=20&margin=10&years=5&owner=20&ownermode=any&sort=cagr&order=desc";
const GROWTH = "cagr=20&margin=10&years=5&owner=20&ownermode=any&market=0113&sort=cagr&order=desc";
const STRICT = "cagr=20&margin=10&years=5&owner=40&ownermode=any&sort=owner&order=desc";
const STANDARD_NO_OWNER = "cagr=20&margin=10&years=5&owner=20&ownermode=any&off=owner&market=0112&sort=code&order=asc";
const DEFAULT_CODES = ["9U001", "9U002", "9U006", "9U008", "9U009", "9U010", "9U014"];
const GROWTH_CODES = ["9U001", "9U002", "9U008", "9U009", "9U010", "9U014"];
const STRICT_CODES = ["9U010", "9U001", "9U008", "9U009", "9U014"];
const STRICT30_CODES = ["9U010", "9U006", "9U001", "9U008", "9U009", "9U014"];

const selector = (page: Page) => page.getByTestId("preset-selector");
const rowCodes = (page: Page) => page.getByTestId("results-scroll").locator("tbody tr").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-code")));
const cagrInput = (page: Page) => page.getByRole("textbox", { name: "売上CAGR の閾値（%）" }).first();
const ownerInput = (page: Page) => page.getByRole("textbox", { name: "オーナー企業と判定する合計持株比率の閾値（%）" }).first();
const saveDialog = (page: Page) => page.getByTestId("preset-save-dialog");
const manageDialog = (page: Page) => page.getByTestId("preset-manage-dialog");

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

async function userId(email: string): Promise<string> {
  return (await sql("select id::text from auth.users where email = $1", [email])).rows[0].id;
}

async function presetRows(email = OWNER.email) {
  const { rows } = await sql(
    `select p.id::text, p.name, p.query, p.is_default, p.created_at, p.updated_at
       from public.screening_presets p join auth.users u on u.id = p.user_id
      where u.email = $1 order by p.created_at, p.id`,
    [email],
  );
  return rows as { id: string; name: string; query: string; is_default: boolean; created_at: Date; updated_at: Date }[];
}

async function presetId(name: string, email = OWNER.email): Promise<string> {
  const row = (await presetRows(email)).find((r) => r.name === name);
  if (!row) throw new Error(`プリセット ${name} がありません`);
  return row.id;
}

async function defaultNames(email = OWNER.email) {
  return (await presetRows(email)).filter((r) => r.is_default).map((r) => r.name);
}

/**
 * Esc で一番上の層（メニュー・ダイアログ）を閉じる。閉じる・開くアニメーションの途中の Esc は下の層に届くことがある（Radix）ので、
 * 動きが止まってから押し、層が1つ減るのを待つ。
 */
async function escape(page: Page) {
  const closing = page.locator("[role=dialog][data-state=closed], [role=alertdialog][data-state=closed], [role=menu][data-state=closed]");
  await expect(closing).toHaveCount(0);
  const open = page.locator("[role=dialog][data-state=open], [role=alertdialog][data-state=open], [role=menu][data-state=open]");
  const before = await open.count();
  await page.waitForTimeout(150);
  await page.keyboard.press("Escape");
  await expect(open).toHaveCount(Math.max(0, before - 1));
  await expect(closing).toHaveCount(0);
}

const option = (page: Page, id: string) => page.locator(`[data-testid="preset-option"][data-preset-id="${id}"]`);

async function openMenu(page: Page) {
  // 閉じるアニメーションの間はトリガーを押しても開かない（Radix）。閉じ終わるのを待つ
  await expect(page.getByTestId("preset-menu")).toHaveCount(0);
  await selector(page).click();
  await expect(page.getByTestId("preset-menu")).toBeVisible();
}

async function choose(page: Page, name: string) {
  const id = name === "標準の条件" ? "standard" : await presetId(name);
  await openMenu(page);
  await option(page, id).click();
  // 閉じ終わるとフォーカスがセレクターに戻る（Radix）。次の操作の入力のフォーカスを奪わないよう、閉じ終わるのを待つ
  await expect(page.getByTestId("preset-menu")).toHaveCount(0);
}

async function openSave(page: Page) {
  await expect(saveDialog(page)).toHaveCount(0);
  await page.getByTestId("preset-save-button").click();
  await expect(saveDialog(page)).toBeVisible();
}

async function saveAs(page: Page, name: string, { makeDefault = false } = {}) {
  await openSave(page);
  await saveDialog(page).getByLabel("プリセットの名前").fill(name);
  if (makeDefault) await saveDialog(page).getByLabel(/既定にする/).check();
  await saveDialog(page).getByRole("button", { name: "保存", exact: true }).click();
  await expect(saveDialog(page)).toBeHidden();
}

async function openManage(page: Page) {
  await expect(manageDialog(page)).toHaveCount(0);
  await page.getByTestId("preset-manage-button").click();
  await expect(manageDialog(page)).toBeVisible();
}

const manageRow = (page: Page, name: string) =>
  manageDialog(page).getByTestId("preset-row").filter({ has: page.getByTestId("preset-row-name").getByText(name, { exact: true }) });

/** 同一オリジンの書き込み（ブラウザの fetch と同じく Origin を付ける） */
function api(request: APIRequestContext) {
  const headers = { origin: BASE_URL };
  return {
    list: () => request.get("/api/screening/presets"),
    create: (data: unknown) => request.post("/api/screening/presets", { data, headers }),
    patch: (id: string, data: unknown) => request.patch(`/api/screening/presets/${id}`, { data, headers }),
    remove: (id: string) => request.delete(`/api/screening/presets/${id}`, { headers }),
  };
}

async function accessToken(request: APIRequestContext, user: { email: string; password: string }): Promise<string> {
  const res = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: PUBLISHABLE_KEY },
    data: { email: user.email, password: user.password },
  });
  expect(res.status()).toBe(200);
  return (await res.json()).access_token;
}

function rest(request: APIRequestContext, token: string | null) {
  const headers: Record<string, string> = { apikey: PUBLISHABLE_KEY, prefer: "return=representation" };
  if (token) headers.authorization = `Bearer ${token}`;
  const url = `${SUPABASE_URL}/rest/v1/screening_presets`;
  return {
    select: () => request.get(`${url}?select=*`, { headers }),
    insert: (data: object) => request.post(url, { headers, data }),
    update: (filter: string, data: object) => request.patch(`${url}?${filter}`, { headers, data }),
    remove: (filter: string) => request.delete(`${url}?${filter}`, { headers }),
    rpc: (fn: string, data: object) => request.post(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { headers, data }),
  };
}

async function cleanup() {
  await sql(PRESETS_CLEANUP_SQL);
  await sql(CLEANUP_SQL);
  await sql("delete from public.ingestion_runs");
}

test.beforeAll(async () => {
  const { rows } = await sql(
    `select (select count(*) from public.stocks)::int as stocks, (select count(*) from public.ingestion_runs)::int as runs,
            (select count(*) from public.screening_presets)::int as presets,
            (select count(*) from auth.users where email = 'owner2@quantis.local')::int as owner2,
            has_table_privilege('authenticated', 'public.screening_presets', 'select') as can_select`,
  );
  expect(rows[0], "E2E の前提: 市場データ・実行履歴・プリセットが0件、owner2 がいる、authenticated に select の権限").toEqual({
    stocks: 0,
    runs: 0,
    presets: 0,
    owner2: 1,
    can_select: true,
  });
});

test.beforeEach(async () => {
  await sql(EXAMPLE_SQL);
});

test.afterEach(cleanup);

test.afterAll(async () => {
  await sql("grant select on public.screening_presets to authenticated");
  await cleanup();
});

test.describe("保存（C1。AC12.1）", () => {
  test("標準の条件 → グロースを選んで保存すると、名前と正規形のクエリで保存され、セレクターに出る（C1-1・C1-2）", async ({ page }) => {
    const problems = collectPageProblems(page);
    await loginAs(page, OWNER);
    await page.goto("/screening");
    await expectCodes(page, DEFAULT_CODES);
    await expect(selector(page)).toHaveAttribute("data-current", "standard");
    await expect(selector(page)).toHaveAccessibleName("プリセット: 標準の条件");
    await openMenu(page);
    await expect(option(page, "standard")).toContainText("標準の条件（アプリの初期値）");
    await expect(page.getByTestId("preset-menu").getByTestId("preset-empty")).toHaveText("保存したプリセットはありません");
    await escape(page);

    await page.getByRole("checkbox", { name: /グロース/ }).first().click();
    await expectCodes(page, GROWTH_CODES);
    await expect(selector(page)).toHaveAttribute("data-current", "none");
    await expect(selector(page)).toContainText("保存されていない条件");
    const url = page.url();

    await openSave(page);
    const summary = saveDialog(page).getByTestId("preset-conditions-summary");
    await expect(summary).toContainText("市場: グロース");
    await expect(summary).toContainText("並べ替え: 売上CAGR 降順");
    await saveDialog(page).getByLabel("プリセットの名前").fill("グロースのみ");
    await saveDialog(page).getByRole("button", { name: "保存", exact: true }).click();
    await expect(saveDialog(page)).toBeHidden();
    await expect(page.getByTestId("preset-status")).toHaveText("『グロースのみ』を保存しました");
    await expect(selector(page)).toContainText("グロースのみ");
    await expect(selector(page)).toHaveAttribute("data-current", await presetId("グロースのみ"));
    expect(page.url()).toBe(url);
    await expectCodes(page, GROWTH_CODES);
    const rows = await presetRows();
    expect(rows.map(({ name, query, is_default }) => ({ name, query, is_default }))).toEqual([
      { name: "グロースのみ", query: GROWTH, is_default: false },
    ]);
    expect(problems).toEqual([]);
  });

  test("名前の検証: 空・空白だけ・41 文字・重複は保存されない。「𠮷」40 個と前後に空白のある名前は保存できる（C1-3）", async ({ page }) => {
    await sql(PRESETS_SQL);
    await loginAs(page, OWNER);
    await page.goto("/screening");
    await openSave(page);
    const input = saveDialog(page).getByLabel("プリセットの名前");
    const submit = saveDialog(page).getByRole("button", { name: "保存", exact: true });
    const error = saveDialog(page).getByTestId("preset-name-error");
    const cases: [string, string][] = [
      ["", "名前を入力してください"],
      ["   ", "名前を入力してください"],
      ["　　", "名前を入力してください"],
      ["あ".repeat(41), "名前は 40 文字以内で入力してください"],
      ["𠮷".repeat(41), "名前は 40 文字以内で入力してください"],
      ["グロースのみ", "同じ名前のプリセットがあります"],
      ["　グロースのみ ", "同じ名前のプリセットがあります"],
    ];
    for (const [name, message] of cases) {
      await input.fill(name);
      await submit.click();
      await expect(error).toHaveText(message);
      await expect(saveDialog(page)).toBeVisible();
    }
    expect((await presetRows()).length).toBe(3);

    await input.fill("𠮷".repeat(40));
    await expect(saveDialog(page).getByTestId("preset-name-count")).toHaveText("40 / 40");
    await submit.click();
    await expect(saveDialog(page)).toBeHidden();
    await saveAs(page, " 別名　");
    const names = (await presetRows()).map((r) => r.name);
    expect(names).toContain("𠮷".repeat(40));
    expect(names).toContain("別名");
  });

  test("条件④の閾値 40・オーナー系合計の降順で保存したクエリ（C1-4）", async ({ page }) => {
    await loginAs(page, OWNER);
    await page.goto("/screening");
    await ownerInput(page).fill("40");
    await ownerInput(page).press("Enter");
    await expect(page).toHaveURL(/owner=40/);
    await page.getByTestId("sort-owner").click();
    await expect(page).toHaveURL(/sort=owner&order=desc/);
    await expectCodes(page, STRICT_CODES);
    await saveAs(page, "厳しめ");
    expect((await presetRows()).map((r) => r.query)).toEqual([STRICT]);
  });

  test("入力の確定を待っている間に保存を押しても、更新後の条件（CAGR 25）を保存する（C1-5）", async ({ page }) => {
    await loginAs(page, OWNER);
    await page.goto("/screening");
    await cagrInput(page).fill("25");
    await page.getByTestId("preset-save-button").click();
    await expect(saveDialog(page).getByTestId("preset-conditions-summary")).toContainText("CAGR ≥25%");
    await saveDialog(page).getByLabel("プリセットの名前").fill("CAGR25");
    await saveDialog(page).getByRole("button", { name: "保存", exact: true }).click();
    await expect(saveDialog(page)).toBeHidden();
    expect((await presetRows()).map((r) => r.query)).toEqual([STANDARD.replace("cagr=20", "cagr=25")]);
  });

  test("名前の HTML は文字列として表示され、スクリプトは動かない（C1-6）", async ({ page }) => {
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await loginAs(page, OWNER);
    await page.goto("/screening");
    const name = "<img src=x onerror=alert(1)>";
    await saveAs(page, name);
    await expect(selector(page)).toContainText(name);
    await openManage(page);
    await expect(manageRow(page, name)).toBeVisible();
    expect(dialogs).toEqual([]);
  });

  test("API: 正規形にして保存、不正なクエリ・名前・本文は 400、既定つきの作成は1トランザクション（C1-7）", async ({ page }) => {
    await loginAs(page, OWNER);
    const presets = api(page.request);
    const created = await presets.create({ name: "P", query: "page=3&market=0113&cagr=20" });
    expect(created.status()).toBe(201);
    expect(created.headers()["cache-control"]).toContain("no-store");
    const body = await created.json();
    expect(body.data).toMatchObject({ name: "P", query: GROWTH, isDefault: false, invalidFields: [] });
    expect(body.data.createdAt).toMatch(/\+09:00$/);

    const bad = await presets.create({ name: "Q", query: "cagr=abc&market=9999" });
    expect(bad.status()).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_preset", fields: ["query"], queryFields: ["cagr", "market"] });
    for (const name of ["a\tb", "a\nb"]) {
      const res = await presets.create({ name, query: STANDARD });
      expect(res.status()).toBe(400);
      expect((await res.json()).fields).toEqual(["name"]);
    }
    const notJson = await page.request.post("/api/screening/presets", { data: Buffer.from("{not json"), headers: { origin: BASE_URL, "content-type": "application/json" } });
    expect(notJson.status()).toBe(400);
    expect(await notJson.json()).toEqual({ error: "invalid_body" });

    // 既定つきの作成（R1）
    expect((await presets.create({ name: "厳しめ", query: STRICT, isDefault: true })).status()).toBe(201);
    const next = await presets.create({ name: "新既定", query: STANDARD.replace("cagr=20", "cagr=15"), isDefault: true });
    expect(next.status()).toBe(201);
    expect((await next.json()).data.isDefault).toBe(true);
    expect(await defaultNames()).toEqual(["新既定"]);
    const dup = await presets.create({ name: "厳しめ", query: STANDARD, isDefault: true });
    expect(dup.status()).toBe(409);
    expect(await dup.json()).toEqual({ error: "duplicate_name", fields: ["name"] });
    expect(await defaultNames()).toEqual(["新既定"]);
    expect((await presetRows()).length).toBe(3);
  });

  test("上限: 50 件で保存が無効になり、API の 51 件目は 409 preset_limit（C1-8）", async ({ page }) => {
    const owner = await userId(OWNER.email);
    await sql("insert into public.screening_presets (user_id, name, query) select $1, 'P' || n, $2 from generate_series(1, 50) n", [owner, STANDARD]);
    await loginAs(page, OWNER);
    await page.goto("/screening");
    await expect(page.getByTestId("preset-save-button")).toBeDisabled();
    await expect(page.getByTestId("preset-save-disabled-reason")).toHaveText("プリセットは 50 件まで保存できます（管理から削除してください）");
    const res = await api(page.request).create({ name: "P51", query: STANDARD });
    expect(res.status()).toBe(409);
    expect(await res.json()).toEqual({ error: "preset_limit" });
    expect((await presetRows()).length).toBe(50);
  });

  test("入力欄に無効な値が残るときの注記と、既定の置き換えの注記（C1-9）", async ({ page }) => {
    await sql(PRESETS_SQL);
    await loginAs(page, OWNER);
    expect((await api(page.request).patch(await presetId("厳しめ"), { isDefault: true })).status()).toBe(200);
    await page.goto(`/screening?${STANDARD}`);
    await cagrInput(page).fill("abc");
    await expect(page.getByText("-100〜1000 の数値を小数点以下1桁までで入力してください").first()).toBeVisible();
    await openSave(page);
    await expect(saveDialog(page).getByTestId("preset-invalid-input-note")).toHaveText(
      "入力中の無効な値は保存されません（売上CAGR は 20% で保存します）",
    );
    await expect(saveDialog(page).getByTestId("preset-conditions-summary")).toContainText("CAGR ≥20%");
    await saveDialog(page).getByLabel(/既定にする/).check();
    await expect(saveDialog(page).getByTestId("preset-default-replace-note")).toHaveText("『厳しめ』の代わりに既定になります");
    await saveDialog(page).getByLabel("プリセットの名前").fill("入力途中");
    await saveDialog(page).getByRole("button", { name: "保存", exact: true }).click();
    await expect(saveDialog(page)).toBeHidden();
    const row = (await presetRows()).find((r) => r.name === "入力途中");
    expect(row?.query).toBe(STANDARD);
    expect(await defaultNames()).toEqual(["入力途中"]);
  });
});

test.describe("適用（C2。AC12.2）", () => {
  test.beforeEach(async () => {
    await sql(PRESETS_SQL);
  });

  test("厳しめ・グロースのみ・スタンダード④なし・標準の条件を選ぶと、条件パネルと結果が保存時の状態になる（C2-1〜C2-4・C2-9）", async ({ page }) => {
    const problems = collectPageProblems(page);
    await loginAs(page, OWNER);
    await page.goto("/screening");
    await expectCodes(page, DEFAULT_CODES);

    await choose(page, "厳しめ");
    await expect(page).toHaveURL(`/screening?${STRICT}`);
    await expect(ownerInput(page)).toHaveValue("40");
    await expect(page.locator("th[aria-sort='descending']")).toContainText("保有状態");
    await expectCodes(page, STRICT_CODES);
    await expect(selector(page)).toHaveAttribute("data-current", await presetId("厳しめ"));
    await openMenu(page);
    await expect(option(page, await presetId("厳しめ"))).toHaveAttribute("data-matched", "true");
    await expect(option(page, await presetId("厳しめ")).getByTestId("preset-check")).toBeVisible();
    await escape(page);

    await choose(page, "グロースのみ");
    await expect(page).toHaveURL(`/screening?${GROWTH}`);
    await expect(page.getByRole("checkbox", { name: /グロース/ }).first()).toBeChecked();
    await expect(ownerInput(page)).toHaveValue("20");
    await expectCodes(page, GROWTH_CODES);

    await choose(page, "スタンダード④なし");
    await expect(page).toHaveURL(`/screening?${STANDARD_NO_OWNER}`);
    await expect(page.getByRole("switch", { name: "条件④ オーナー企業／社長が筆頭株主 を使う" }).first()).not.toBeChecked();
    await expect(page.getByRole("checkbox", { name: /スタンダード/ }).first()).toBeChecked();
    await expectCodes(page, ["9U003", "9U007"]);

    // リロードしても同じ（C2-9）
    await page.reload();
    await expectCodes(page, ["9U003", "9U007"]);
    await expect(selector(page)).toHaveAttribute("data-current", await presetId("スタンダード④なし"));

    await choose(page, "標準の条件");
    await expect(page).toHaveURL(`/screening?${STANDARD}`);
    await expectCodes(page, DEFAULT_CODES);
    await expect(selector(page)).toHaveAttribute("data-current", "standard");
    expect(problems).toEqual([]);
  });

  test("入力欄の無効な値は消え、待っている入力は書かれない（C2-5・C2-6）。条件を変えると保存されていない条件、戻すと一致（C2-7）", async ({ page }) => {
    await loginAs(page, OWNER);
    await page.goto("/screening");
    await cagrInput(page).fill("abc");
    await expect(page.getByText("-100〜1000 の数値を小数点以下1桁までで入力してください").first()).toBeVisible();
    await choose(page, "厳しめ");
    await expect(page).toHaveURL(`/screening?${STRICT}`);
    await expect(cagrInput(page)).toHaveValue("20");
    await expect(page.getByText("-100〜1000 の数値を小数点以下1桁までで入力してください")).toHaveCount(0);

    await choose(page, "標準の条件");
    await expect(page).toHaveURL(`/screening?${STANDARD}`);
    await cagrInput(page).fill("15");
    await choose(page, "厳しめ");
    await expect(page).toHaveURL(`/screening?${STRICT}`);
    await page.waitForTimeout(800);
    await expect(page).toHaveURL(`/screening?${STRICT}`);
    await expectCodes(page, STRICT_CODES);

    await ownerInput(page).fill("30");
    await expect(selector(page)).toHaveAttribute("data-current", "none");
    await ownerInput(page).fill("40");
    await expect(selector(page)).toHaveAttribute("data-current", await presetId("厳しめ"));
  });

  test("適用は履歴を増やさない（C2-8）", async ({ page }) => {
    await loginAs(page, OWNER);
    await page.getByRole("navigation", { name: "メイン" }).getByRole("link", { name: "スクリーニング" }).click();
    await expect(page).toHaveURL("/screening");
    await expectCodes(page, DEFAULT_CODES);
    await choose(page, "厳しめ");
    await expect(page).toHaveURL(`/screening?${STRICT}`);
    await page.goBack();
    await expect(page).toHaveURL("/");
    await page.goForward();
    await expect(page).toHaveURL(`/screening?${STRICT}`);
    await expectCodes(page, STRICT_CODES);
  });

  test("375×812: 要約の直下で適用でき、横スクロールせず、注記はスクロールなしで見える（C2-10）", async ({ browser }) => {
    const { context, page } = await newUserPage(browser, OWNER, { width: 375, height: 812 });
    await page.goto("/screening");
    await expect(page.getByTestId("cagr-supplement-note").filter({ visible: true })).toBeInViewport();
    await expect(page.getByTestId("screening-presets")).toBeInViewport();
    await choose(page, "グロースのみ");
    await expect(page).toHaveURL(`/screening?${GROWTH}`);
    await expectCodes(page, GROWTH_CODES);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await page.getByRole("button", { name: "条件を変更" }).click();
    await expect(page.getByRole("dialog").getByRole("checkbox", { name: /グロース/ })).toBeChecked();
    await context.close();
  });

  test("無効な項目・正規形でないプリセット: 印と注記、適用で既定値・正規形、一致とみなさない（C2-11）", async ({ page }) => {
    const owner = await userId(OWNER.email);
    await sql("insert into public.screening_presets (user_id, name, query) values ($1, '範囲外', $2), ($1, '並び違い', $3)", [
      owner,
      "cagr=99999&margin=10&years=5&owner=20&ownermode=any&sort=cagr&order=desc",
      "cagr=20&margin=10&years=5&owner=20&ownermode=any&market=0113,0111&sort=cagr&order=desc",
    ]);
    await loginAs(page, OWNER);
    await page.goto("/screening");
    await openMenu(page);
    await expect(option(page, await presetId("範囲外")).getByTestId("preset-invalid-mark")).toHaveText("一部の条件が無効です");
    await expect(option(page, await presetId("並び違い")).getByTestId("preset-invalid-mark")).toHaveText("条件の書き方が標準の形ではありません");
    await escape(page);
    await openManage(page);
    await expect(manageRow(page, "範囲外").getByTestId("preset-invalid-mark")).toHaveText("一部の条件が無効です");
    await escape(page);

    await choose(page, "範囲外");
    await expect(page).toHaveURL(`/screening?${STANDARD}`);
    await expect(cagrInput(page)).toHaveValue("20");
    await expect(page.getByTestId("preset-invalid-notice")).toHaveText("プリセット『範囲外』の条件の一部（cagr）が無効なため、既定値で適用しました");

    await choose(page, "並び違い");
    await expect(page).toHaveURL("/screening?cagr=20&margin=10&years=5&owner=20&ownermode=any&market=0111,0113&sort=cagr&order=desc");
    await expect(page.getByTestId("preset-invalid-notice")).toHaveText("プリセット『並び違い』の条件を標準の形に直して適用しました");
    await expect(selector(page)).toHaveAttribute("data-current", "none");

    const list = await (await api(page.request).list()).json();
    const byName = new Map(list.data.map((p: { name: string; invalidFields: string[] }) => [p.name, p.invalidFields]));
    expect(byName.get("範囲外")).toEqual(["cagr"]);
    expect(byName.get("並び違い")).toEqual(["query"]);
    expect(byName.get("厳しめ")).toEqual([]);
  });

  test("表示の優先順位: 作成の古いプリセット → 標準の条件。チェックは一致のすべて（C2-12）", async ({ page }) => {
    const owner = await userId(OWNER.email);
    await sql("insert into public.screening_presets (user_id, name, query) values ($1, '標準コピー', $2)", [owner, STANDARD]);
    await sql("insert into public.screening_presets (user_id, name, query) values ($1, '厳しめ2', $2)", [owner, STRICT]);
    await loginAs(page, OWNER);
    await page.goto(`/screening?${STANDARD}`);
    await expect(selector(page)).toHaveAttribute("data-current", await presetId("標準コピー"));
    await openMenu(page);
    await expect(option(page, "standard")).toHaveAttribute("data-matched", "true");
    await expect(option(page, await presetId("標準コピー"))).toHaveAttribute("data-matched", "true");
    await expect(option(page, await presetId("厳しめ"))).toHaveAttribute("data-matched", "false");
    await option(page, await presetId("厳しめ2")).click();
    await expect(page).toHaveURL(`/screening?${STRICT}`);
    await expect(selector(page)).toHaveAttribute("data-current", await presetId("厳しめ"));
    await openMenu(page);
    await expect(option(page, await presetId("厳しめ"))).toHaveAttribute("data-matched", "true");
    await expect(option(page, await presetId("厳しめ2"))).toHaveAttribute("data-matched", "true");
    await expect(option(page, "standard")).toHaveAttribute("data-matched", "false");
  });
});

test.describe("名前変更・上書き・削除（C3。AC12.3）", () => {
  test.beforeEach(async () => {
    await sql(PRESETS_SQL);
  });

  test("名前の変更: Enter で保存、重複・空は拒否、Esc で取り消し（C3-1）", async ({ page }) => {
    await loginAs(page, OWNER);
    await page.goto("/screening");
    const [before] = (await presetRows()).filter((r) => r.name === "厳しめ");
    await openManage(page);
    const row = manageRow(page, "厳しめ");
    await row.getByRole("button", { name: "名前を変更" }).click();
    const input = manageDialog(page).getByLabel("新しい名前");
    await input.fill("グロースのみ");
    await input.press("Enter");
    await expect(manageDialog(page).getByTestId("preset-row-error")).toHaveText("同じ名前のプリセットがあります");
    await input.fill("　");
    await input.press("Enter");
    await expect(manageDialog(page).getByTestId("preset-row-error")).toHaveText("名前を入力してください");
    await input.press("Escape");
    await expect(manageDialog(page)).toBeVisible();
    await expect(manageRow(page, "厳しめ")).toBeVisible();
    expect((await presetRows()).find((r) => r.id === before.id)?.name).toBe("厳しめ");

    await manageRow(page, "厳しめ").getByRole("button", { name: "名前を変更" }).click();
    await manageDialog(page).getByLabel("新しい名前").fill("厳しめ（オーナー40）");
    await manageDialog(page).getByLabel("新しい名前").press("Enter");
    await expect(manageRow(page, "厳しめ（オーナー40）")).toBeVisible();
    await expect(page.getByTestId("preset-status")).toHaveText("『厳しめ』の名前を変更しました");
    const after = (await presetRows()).find((r) => r.id === before.id)!;
    expect(after.name).toBe("厳しめ（オーナー40）");
    expect(after.query).toBe(before.query);
    expect(after.created_at).toEqual(before.created_at);
    expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
    await escape(page);
    await openMenu(page);
    await expect(option(page, before.id)).toContainText("厳しめ（オーナー40）");
  });

  test("上書き: 確認に保存済みと現在が並び違いを強調、キャンセルでは変わらず、上書きでクエリだけが変わる（C3-2）", async ({ page }) => {
    await loginAs(page, OWNER);
    await page.goto(`/screening?${STRICT}`);
    const id = await presetId("厳しめ");
    await openManage(page);
    await expect(manageRow(page, "厳しめ").getByRole("button", { name: "現在の条件で上書き" })).toBeDisabled();
    await expect(manageRow(page, "厳しめ")).toContainText("現在の条件と同じです");
    await escape(page);

    await ownerInput(page).fill("30");
    await ownerInput(page).press("Enter");
    await expectCodes(page, STRICT30_CODES);
    const [before] = (await presetRows()).filter((r) => r.id === id);
    await openManage(page);
    await manageRow(page, "厳しめ").getByRole("button", { name: "現在の条件で上書き" }).click();
    const confirm = page.getByTestId("preset-overwrite-dialog");
    await expect(confirm).toContainText("『厳しめ』を現在の条件で上書きしますか？");
    await expect(confirm.getByTestId("preset-overwrite-before").locator("[data-changed=true]")).toHaveText(/オーナー系 ≥40%/);
    await expect(confirm.getByTestId("preset-overwrite-after").locator("[data-changed=true]")).toHaveText(/オーナー系 ≥30%/);
    await confirm.getByRole("button", { name: "キャンセル" }).click();
    expect((await presetRows()).find((r) => r.id === id)?.query).toBe(STRICT);

    await manageRow(page, "厳しめ").getByRole("button", { name: "現在の条件で上書き" }).click();
    await confirm.getByRole("button", { name: "上書き" }).click();
    await expect(confirm).toBeHidden();
    await expect(page.getByTestId("preset-status")).toHaveText("『厳しめ』を現在の条件で上書きしました");
    const after = (await presetRows()).find((r) => r.id === id)!;
    expect(after).toMatchObject({ name: "厳しめ", is_default: false, query: STRICT.replace("owner=40", "owner=30") });
    expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
    await escape(page);
    await expect(selector(page)).toHaveAttribute("data-current", id);
    await expect(page).toHaveURL(`/screening?${STRICT.replace("owner=40", "owner=30")}`);
    await expectCodes(page, STRICT30_CODES);
  });

  test("削除: 確認のダイアログ、キャンセルでは残り、削除で消える。URL と結果は変わらない。既定の削除の注記（C3-3・C3-4）", async ({ page }) => {
    await loginAs(page, OWNER);
    await page.goto(`/screening?${GROWTH}`);
    const id = await presetId("グロースのみ");
    await openManage(page);
    await manageRow(page, "グロースのみ").getByRole("button", { name: "削除" }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("プリセット『グロースのみ』を削除しますか？");
    await expect(confirm).toContainText("この操作は取り消せません。");
    await expect(confirm).not.toContainText("既定のプリセットです");
    await confirm.getByRole("button", { name: "キャンセル" }).click();
    expect((await presetRows()).map((r) => r.id)).toContain(id);
    await manageRow(page, "グロースのみ").getByRole("button", { name: "削除" }).click();
    await confirm.getByRole("button", { name: "削除" }).click();
    await expect(manageRow(page, "グロースのみ")).toHaveCount(0);
    await expect(page.getByTestId("preset-status")).toHaveText("『グロースのみ』を削除しました");
    expect((await presetRows()).map((r) => r.id)).not.toContain(id);
    await expect(page).toHaveURL(`/screening?${GROWTH}`);
    await escape(page);
    await expectCodes(page, GROWTH_CODES);

    // 既定のプリセットの削除（C3-4）
    await openManage(page);
    await manageRow(page, "厳しめ").getByRole("button", { name: "既定にする" }).click();
    await expect(manageRow(page, "厳しめ").getByTestId("preset-default-badge")).toBeVisible();
    await manageRow(page, "厳しめ").getByRole("button", { name: "削除" }).click();
    await expect(confirm).toContainText("既定のプリセットです。削除すると、スクリーニングは標準の条件で開きます");
    await confirm.getByRole("button", { name: "削除" }).click();
    await expect(manageRow(page, "厳しめ")).toHaveCount(0);
    await escape(page);
    await page.getByRole("navigation", { name: "メイン" }).getByRole("link", { name: "スクリーニング" }).click();
    await expect(page).toHaveURL("/screening");
    await expectCodes(page, DEFAULT_CODES);
  });

  test("API: 無い id・他人の id は 404 で既定は変わらない、形の違う id は 400、空の本文・不正・重複は DB を変えない（C3-5）", async ({ page }) => {
    await loginAs(page, OWNER);
    const presets = api(page.request);
    const strict = await presetId("厳しめ");
    expect((await presets.patch(strict, { isDefault: true })).status()).toBe(200);
    const missing = "00000000-0000-4000-8000-000000000000";
    for (const res of [await presets.patch(missing, { isDefault: true }), await presets.remove(missing)]) {
      expect(res.status()).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
    const owner2 = await userId(OWNER2.email);
    const { rows } = await sql("insert into public.screening_presets (user_id, name, query) values ($1, 'owner2の', $2) returning id::text", [owner2, STANDARD]);
    expect((await presets.patch(rows[0].id, { isDefault: true })).status()).toBe(404);
    expect((await presets.remove(rows[0].id)).status()).toBe(404);
    expect(await defaultNames()).toEqual(["厳しめ"]);
    expect(await defaultNames(OWNER2.email)).toEqual([]);

    const invalidId = await presets.patch("abc", { name: "x" });
    expect(invalidId.status()).toBe(400);
    expect(await invalidId.json()).toEqual({ error: "invalid_id" });
    const growth = await presetId("グロースのみ");
    expect((await presets.patch(growth, {})).status()).toBe(400);
    expect((await presets.patch(growth, { query: "cagr=abc" })).status()).toBe(400);
    const dup = await presets.patch(growth, { name: "厳しめ" });
    expect(dup.status()).toBe(409);
    expect((await dup.json()).error).toBe("duplicate_name");
    const dupDefault = await presets.patch(growth, { name: "厳しめ", isDefault: true });
    expect(dupDefault.status()).toBe(409);
    expect(await defaultNames()).toEqual(["厳しめ"]);
    const both = await presets.patch(growth, { name: "厳しめ（改）", isDefault: true });
    expect(both.status()).toBe(200);
    expect((await both.json()).data).toMatchObject({ name: "厳しめ（改）", isDefault: true });
    expect(await defaultNames()).toEqual(["厳しめ（改）"]);
    expect((await presetRows()).find((r) => r.id === growth)?.query).toBe(GROWTH);
  });

  test("キーボードだけで操作でき、ダイアログはフォーカスを閉じ込め、閉じるとフォーカスが戻る（C3-6）", async ({ page }) => {
    await loginAs(page, OWNER);
    await page.goto("/screening");
    await selector(page).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("preset-menu")).toBeVisible();
    // 矢印キーで「厳しめ」まで移る
    const strictOption = option(page, await presetId("厳しめ"));
    for (let i = 0; i < 6 && !(await strictOption.evaluate((el) => el === document.activeElement)); i++) {
      await page.keyboard.press("ArrowDown");
    }
    await expect(strictOption).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`/screening?${STRICT}`);
    // メニューが閉じ終わるとフォーカスはセレクターに戻る（Radix）。閉じ終わってから次へ
    await expect(page.getByTestId("preset-menu")).toHaveCount(0);
    await expect(selector(page)).toBeFocused();

    const manage = page.getByTestId("preset-manage-button");
    await manage.focus();
    await page.keyboard.press("Enter");
    await expect(manageDialog(page)).toBeVisible();
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest("[data-testid=preset-manage-dialog]"))).toBe(true);
    }
    await manageRow(page, "グロースのみ").getByRole("button", { name: "名前を変更" }).focus();
    await page.keyboard.press("Enter");
    await page.keyboard.type("（改）");
    await page.keyboard.press("Enter");
    await expect(manageRow(page, "グロースのみ（改）")).toBeVisible();

    await manageRow(page, "スタンダード④なし").getByRole("button", { name: "現在の条件で上書き" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("preset-overwrite-dialog")).toBeVisible();
    // 開き終わると「キャンセル」にフォーカスが移る（それより前の Esc は下の管理のダイアログに届く）
    await expect(page.getByTestId("preset-overwrite-dialog").getByRole("button", { name: "キャンセル" })).toBeFocused();
    await escape(page);
    await expect(page.getByTestId("preset-overwrite-dialog")).toHaveCount(0);
    await expect(manageRow(page, "スタンダード④なし").getByRole("button", { name: "現在の条件で上書き" })).toBeFocused();

    await manageRow(page, "スタンダード④なし").getByRole("button", { name: "削除" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await expect(page.getByRole("alertdialog").getByRole("button", { name: "キャンセル" })).toBeFocused();
    await escape(page);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(manageRow(page, "スタンダード④なし").getByRole("button", { name: "削除" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await expect(page.getByRole("alertdialog").getByRole("button", { name: "キャンセル" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("alertdialog").getByRole("button", { name: "削除" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(manageRow(page, "スタンダード④なし")).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");
    expect(await page.evaluate(() => !!document.activeElement?.closest("[data-testid=preset-manage-dialog]"))).toBe(true);

    await escape(page);
    await expect(manageDialog(page)).toBeHidden();
    await expect(manage).toBeFocused();
  });
});

test.describe("既定（C4。AC12.4）", () => {
  test.beforeEach(async () => {
    await sql(PRESETS_SQL);
  });

  test("既定にするとバッジが付き、ナビゲーション・直接の URL で既定の条件で開く（307）。既定の変更は再読み込みなしで反映（C4-1〜C4-3）", async ({ page }) => {
    const problems = collectPageProblems(page);
    await loginAs(page, OWNER);
    await page.goto("/screening");
    const growth = (await presetRows()).find((r) => r.name === "グロースのみ")!;
    await openManage(page);
    await manageRow(page, "グロースのみ").getByRole("button", { name: "既定にする" }).click();
    await expect(manageRow(page, "グロースのみ").getByTestId("preset-default-badge")).toBeVisible();
    await expect(page.getByTestId("preset-status")).toHaveText("『グロースのみ』を既定にしました");
    expect(await defaultNames()).toEqual(["グロースのみ"]);
    expect((await presetRows()).find((r) => r.id === growth.id)?.updated_at).toEqual(growth.updated_at);
    // 既定を作っても、表示中の条件（標準）と結果は変わらない（/screening のまま取り直すとリダイレクトされるので、表示中の条件の URL にする）
    await expect(page).toHaveURL(`/screening?${STANDARD}`);
    await expectCodes(page, DEFAULT_CODES);
    await expect(manageDialog(page)).toBeVisible();
    await escape(page);
    await openMenu(page);
    await expect(option(page, growth.id).getByTestId("preset-default-badge")).toBeVisible();
    await escape(page);

    await page.getByRole("navigation", { name: "メイン" }).getByRole("link", { name: "ダッシュボード" }).click();
    await expect(page).toHaveURL("/");
    await page.getByRole("navigation", { name: "メイン" }).getByRole("link", { name: "スクリーニング" }).click();
    await expect(page).toHaveURL(`/screening?${GROWTH}`);
    await expectCodes(page, GROWTH_CODES);
    await expect(selector(page)).toContainText("グロースのみ");
    await expect(selector(page).getByTestId("preset-default-badge")).toBeVisible();

    await page.goto("/screening");
    await expect(page).toHaveURL(`/screening?${GROWTH}`);
    const res = await page.request.get("/screening", { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers().location).toBe(`/screening?${GROWTH}`);

    // C4-3: 表示したまま既定を変え、再読み込みせずにヘッダーの「スクリーニング」
    await openManage(page);
    await manageRow(page, "厳しめ").getByRole("button", { name: "既定にする" }).click();
    await expect(manageRow(page, "厳しめ").getByTestId("preset-default-badge")).toBeVisible();
    await expect(manageRow(page, "グロースのみ").getByTestId("preset-default-badge")).toHaveCount(0);
    expect(await defaultNames()).toEqual(["厳しめ"]);
    await escape(page);
    await page.getByRole("navigation", { name: "メイン" }).getByRole("link", { name: "スクリーニング" }).click();
    await expect(page).toHaveURL(`/screening?${STRICT}`);
    await expectCodes(page, STRICT_CODES);
    // 振る舞いの変化: 閾値を変えた後にヘッダーの「スクリーニング」で既定のプリセットの条件に戻る
    await ownerInput(page).fill("30");
    await ownerInput(page).press("Enter");
    await expect(page).toHaveURL(/owner=30/);
    await page.getByRole("navigation", { name: "メイン" }).getByRole("link", { name: "スクリーニング" }).click();
    await expect(page).toHaveURL(`/screening?${STRICT}`);
    await expect(ownerInput(page)).toHaveValue("40");
    // ダッシュボードから
    await page.getByRole("navigation", { name: "メイン" }).getByRole("link", { name: "ダッシュボード" }).click();
    await page.getByRole("navigation", { name: "メイン" }).getByRole("link", { name: "スクリーニング" }).click();
    await expect(page).toHaveURL(`/screening?${STRICT}`);
    expect(problems).toEqual([]);
  });

  test("条件のパラメータのある URL・詳細からの戻りは上書きしない。utm だけの URL はリダイレクト（C4-4・C4-5）", async ({ page }) => {
    await loginAs(page, OWNER);
    expect((await api(page.request).patch(await presetId("厳しめ"), { isDefault: true })).status()).toBe(200);
    const explicit = STANDARD.replace("cagr=20", "cagr=15");
    await page.goto(`/screening?${explicit}`);
    await expect(page).toHaveURL(`/screening?${explicit}`);
    await page.goto("/screening?page=1");
    await expect(page).toHaveURL("/screening?page=1");
    await expectCodes(page, DEFAULT_CODES);
    await page.goto("/screening?utm=x");
    await expect(page).toHaveURL(`/screening?${STRICT}`);

    // 詳細（スクリーニングから開いた）からの戻り
    const from = `/screening?${GROWTH}`;
    await page.goto(from);
    await page.getByTestId("results-scroll").locator("tbody tr[data-code='9U001'] a").first().click();
    await expect(page).toHaveURL(/\/stocks\/9U001\?/);
    await page.getByRole("navigation", { name: "パンくず" }).getByRole("link", { name: "スクリーニング" }).click();
    await expect(page).toHaveURL(from);
    await page.getByTestId("results-scroll").locator("tbody tr[data-code='9U001'] a").first().click();
    await expect(page).toHaveURL(/\/stocks\/9U001\?/);
    await page.getByRole("navigation", { name: "メイン" }).getByRole("link", { name: "スクリーニング" }).click();
    await expect(page).toHaveURL(from);
    await page.getByTestId("results-scroll").locator("tbody tr[data-code='9U001'] a").first().click();
    await expect(page).toHaveURL(/\/stocks\/9U001\?/);
    await page.goBack();
    await expect(page).toHaveURL(from);
  });

  test("「既定の条件に戻す」は既定のプリセット、無ければ標準。既定を解除すると標準で開く（C4-6・C4-7）", async ({ page }) => {
    await loginAs(page, OWNER);
    const strict = await presetId("厳しめ");
    expect((await api(page.request).patch(strict, { isDefault: true })).status()).toBe(200);
    await page.goto(`/screening?${GROWTH}`);
    const reset = page.getByTestId("reset-conditions").first();
    await expect(reset).toHaveAttribute("title", "既定のプリセット『厳しめ』の条件に戻します");
    await reset.click();
    await expect(page).toHaveURL(`/screening?${STRICT}`);
    await expectCodes(page, STRICT_CODES);

    await openManage(page);
    await manageRow(page, "厳しめ").getByRole("button", { name: "既定を解除" }).click();
    await expect(page.getByTestId("preset-status")).toHaveText("『厳しめ』の既定を解除しました");
    expect(await defaultNames()).toEqual([]);
    await escape(page);
    await expect(reset).toHaveAttribute("title", "標準の条件（アプリの初期値）に戻します");
    await reset.click();
    await expect(page).toHaveURL(`/screening?${STANDARD}`);
    await page.getByRole("navigation", { name: "メイン" }).getByRole("link", { name: "スクリーニング" }).click();
    await expect(page).toHaveURL("/screening");
    await expectCodes(page, DEFAULT_CODES);
  });

  test("銘柄詳細（クエリなし）は既定のプリセットで判定し、API は当てない（C4-8・C4-9）", async ({ page }) => {
    await loginAs(page, OWNER);
    await page.goto("/stocks/9U006");
    await expect(page.getByTestId("evaluation-source")).toHaveText("既定の条件で判定しています");
    await expect(page.getByTestId("evaluation-owner")).toHaveAttribute("data-status", "met");

    expect((await api(page.request).patch(await presetId("厳しめ"), { isDefault: true })).status()).toBe(200);
    await page.goto("/stocks/9U006");
    await expect(page.getByTestId("evaluation-source")).toHaveText("既定のプリセット『厳しめ』の条件で判定しています");
    await expect(page.getByTestId("evaluation-source")).toHaveAttribute("data-condition-source", "preset");
    await expect(page.getByTestId("evaluation-owner")).toHaveAttribute("data-status", "unmet");
    await expect(page.getByTestId("evaluation-inclusion")).toHaveAttribute("data-included", "false");
    await page.goto("/stocks/9U006?off=owner");
    await expect(page.getByTestId("evaluation-source")).toHaveText("スクリーニングの条件で判定しています");
    await page.goto("/stocks/9U006");
    await page.getByRole("navigation", { name: "パンくず" }).getByRole("link", { name: "スクリーニング" }).click();
    await expect(page).toHaveURL(`/screening?${STRICT}`);

    const screening = await (await page.request.get("/api/screening")).json();
    expect(screening.data.conditions.owner).toBe("20");
    expect(screening.data.total).toBe(7);
    const detail = await (await page.request.get("/api/stocks/9U006")).json();
    expect(detail.data.evaluation.status.owner).toBe("met");
  });

  test("既定のプリセットに無効な項目があれば、リダイレクト先で既存の注記が出る（C4-10）", async ({ page }) => {
    const owner = await userId(OWNER.email);
    await sql("insert into public.screening_presets (user_id, name, query, is_default) values ($1, '範囲外', $2, true)", [
      owner,
      "cagr=99999&margin=10&years=5&owner=20&ownermode=any&sort=cagr&order=desc",
    ]);
    await loginAs(page, OWNER);
    await page.goto("/screening");
    await expect(page).toHaveURL("/screening?cagr=99999&margin=10&years=5&owner=20&ownermode=any&sort=cagr&order=desc");
    await expect(page.getByTestId("invalid-params-notice")).toHaveText("URL の条件の一部（cagr）が無効なため、既定値で表示しています");
    await expectCodes(page, DEFAULT_CODES);
  });

  test("プリセットを読めないとき: リダイレクトせず標準の条件、0件として表示しない、保存は無効、API は 500（C4-11）", async ({ page }) => {
    await loginAs(page, OWNER);
    expect((await api(page.request).patch(await presetId("厳しめ"), { isDefault: true })).status()).toBe(200);
    await sql("revoke select on public.screening_presets from authenticated");
    try {
      const problems: string[] = [];
      page.on("pageerror", (error) => problems.push(error.message));
      await page.goto("/screening");
      await expect(page).toHaveURL("/screening");
      await expectCodes(page, DEFAULT_CODES);
      await expect(page.getByTestId("preset-load-error")).toHaveText("既定のプリセットを読み込めませんでした（標準の条件で表示しています）");
      await expect(selector(page)).toContainText("標準の条件");
      await openMenu(page);
      await expect(page.getByTestId("preset-menu").getByTestId("preset-list-error")).toHaveText("プリセットを読み込めませんでした。再読み込みしてください");
      await expect(page.getByTestId("preset-menu").getByTestId("preset-empty")).toHaveCount(0);
      await escape(page);
      await expect(page.getByTestId("preset-save-button")).toBeDisabled();
      await expect(page.getByTestId("preset-save-disabled-reason")).toHaveText("プリセットを読み込めないため保存できません");
      await openManage(page);
      await expect(manageDialog(page).getByTestId("preset-list-error")).toBeVisible();
      await expect(manageDialog(page).getByTestId("preset-row")).toHaveCount(0);
      await escape(page);
      await cagrInput(page).fill("15");
      await cagrInput(page).press("Enter");
      await expect(page).toHaveURL(/cagr=15/);
      await choose(page, "標準の条件");
      await expect(page).toHaveURL(`/screening?${STANDARD}`);

      const res = await api(page.request).list();
      expect(res.status()).toBe(500);
      expect(res.headers()["cache-control"]).toContain("no-store");
      expect(await res.json()).toEqual({ error: "internal_error" });

      await page.goto("/stocks/9U006");
      await expect(page.getByTestId("preset-load-error")).toHaveText("既定のプリセットを読み込めませんでした（既定の条件で判定しています）");
      await expect(page.getByTestId("evaluation-owner")).toHaveAttribute("data-status", "met");
      expect(problems).toEqual([]);
    } finally {
      await sql("grant select on public.screening_presets to authenticated");
    }
    await page.goto("/screening");
    await expect(page).toHaveURL(`/screening?${STRICT}`);
  });

  test("時計のずれの状態で、リダイレクト・詳細・操作をしてもコンソールのエラーが出ない（C4-12・C9-4）", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "ja-JP" });
    await simulateServerClockBehind(context);
    const page = await context.newPage();
    const problems = collectPageProblems(page);
    await loginAs(page, OWNER);
    expect((await api(page.request).patch(await presetId("厳しめ"), { isDefault: true })).status()).toBe(200);
    await page.getByRole("navigation", { name: "メイン" }).getByRole("link", { name: "スクリーニング" }).click();
    await expect(page).toHaveURL(`/screening?${STRICT}`);
    await page.goto("/screening");
    await expect(page).toHaveURL(`/screening?${STRICT}`);
    await page.goto("/stocks/9U006");
    await expect(page.getByTestId("evaluation-source")).toContainText("既定のプリセット『厳しめ』");
    await page.goto("/screening?cagr=15");
    await saveAs(page, "ずれ");
    await choose(page, "グロースのみ");
    await expect(page).toHaveURL(`/screening?${GROWTH}`);
    await openManage(page);
    await manageRow(page, "ずれ").getByRole("button", { name: "名前を変更" }).click();
    await manageDialog(page).getByLabel("新しい名前").fill("ずれ2");
    await manageDialog(page).getByLabel("新しい名前").press("Enter");
    await expect(manageRow(page, "ずれ2")).toBeVisible();
    await manageRow(page, "ずれ2").getByRole("button", { name: "現在の条件で上書き" }).click();
    await page.getByTestId("preset-overwrite-dialog").getByRole("button", { name: "上書き" }).click();
    await expect(page.getByTestId("preset-overwrite-dialog")).toBeHidden();
    await manageRow(page, "ずれ2").getByRole("button", { name: "既定にする" }).click();
    await expect(manageRow(page, "ずれ2").getByTestId("preset-default-badge")).toBeVisible();
    await manageRow(page, "ずれ2").getByRole("button", { name: "削除" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "削除" }).click();
    await expect(manageRow(page, "ずれ2")).toHaveCount(0);
    await escape(page);
    await page.getByRole("navigation", { name: "メイン" }).getByRole("link", { name: "スクリーニング" }).click();
    await expect(page).toHaveURL("/screening");
    expect(problems).toEqual([]);
    await context.close();
  });
});

test.describe("ユーザーごとの分離と永続性（C5。AC12.5）", () => {
  test.beforeEach(async () => {
    await sql(PRESETS_SQL);
    const owner = await userId(OWNER.email);
    await sql("update public.screening_presets set is_default = true where user_id = $1 and name = 'グロースのみ'", [owner]);
  });

  test("リロード・再ログインで残る。owner2 からは見えず、影響もしない（C5-1〜C5-3）", async ({ page, browser }) => {
    await loginAs(page, OWNER);
    await page.goto("/screening");
    await expect(page).toHaveURL(`/screening?${GROWTH}`);
    await page.reload();
    await expect(selector(page)).toContainText("グロースのみ");
    await page.getByRole("button", { name: "アカウントメニュー" }).click();
    await page.getByRole("menuitem", { name: "ログアウト" }).click();
    await expect(page).toHaveURL("/login");
    await loginAs(page, OWNER);
    await page.goto("/screening");
    await expect(page).toHaveURL(`/screening?${GROWTH}`);
    await openManage(page);
    await expect(manageDialog(page).getByTestId("preset-row")).toHaveCount(3);
    await escape(page);

    const other = await newUserPage(browser, OWNER2);
    await other.page.goto("/screening");
    await expect(other.page).toHaveURL("/screening");
    await expectCodes(other.page, DEFAULT_CODES);
    await expect(selector(other.page)).toHaveAttribute("data-current", "standard");
    await openMenu(other.page);
    await expect(other.page.getByTestId("preset-menu").getByTestId("preset-empty")).toBeVisible();
    await escape(other.page);
    expect(await (await api(other.page.request).list()).json()).toEqual({ data: [] });

    await other.page.goto(`/screening?${STANDARD.replace("ownermode=any", "ownermode=any&off=owner")}`);
    await saveAs(other.page, "グロースのみ", { makeDefault: true });
    expect(await defaultNames(OWNER2.email)).toEqual(["グロースのみ"]);
    await other.page.goto("/screening");
    await expect(other.page).toHaveURL(/off=owner/);
    await other.context.close();

    await page.goto("/screening");
    await expect(page).toHaveURL(`/screening?${GROWTH}`);
    expect((await presetRows()).find((r) => r.name === "グロースのみ")?.query).toBe(GROWTH);
  });

  test("PostgREST: owner2 は owner の行を読めず・変えられず、RPC に owner の id を渡しても誰の既定も変わらない（C5-4）", async ({ request }) => {
    const owner2 = rest(request, await accessToken(request, OWNER2));
    await sql("insert into public.screening_presets (user_id, name, query, is_default) values ($1, 'owner2の既定', $2, true)", [
      await userId(OWNER2.email),
      STANDARD,
    ]);
    const selected = await (await owner2.select()).json();
    expect(selected.map((r: { name: string }) => r.name)).toEqual(["owner2の既定"]);
    const strict = await presetId("厳しめ");
    expect(await (await owner2.update(`id=eq.${strict}`, { name: "x" })).json()).toEqual([]);
    expect(await (await owner2.remove(`id=eq.${strict}`)).json()).toEqual([]);
    const forged = await owner2.insert({ user_id: await userId(OWNER.email), name: "偽", query: STANDARD });
    expect(forged.status()).toBe(403);
    const rpc = await owner2.rpc("set_default_screening_preset", { p_id: strict, p_default: true });
    expect(rpc.status()).toBe(200);
    expect(await rpc.json()).toBeNull();
    const missing = await owner2.rpc("set_default_screening_preset", { p_id: "00000000-0000-4000-8000-000000000000", p_default: true });
    expect(await missing.json()).toBeNull();
    expect(await defaultNames()).toEqual(["グロースのみ"]);
    expect(await defaultNames(OWNER2.email)).toEqual(["owner2の既定"]);
    expect((await presetRows()).map((r) => r.name)).toEqual(["グロースのみ", "厳しめ", "スタンダード④なし"]);
  });

  test("PostgREST: owner の直接の書き込みはトリガー・check 制約・一意索引が守る（C5-5）", async ({ request }) => {
    const owner = rest(request, await accessToken(request, OWNER));
    const growth = (await presetRows()).find((r) => r.name === "グロースのみ")!;
    const strict = await presetId("厳しめ");
    // 1. user_id・id の変更は拒否
    expect((await owner.update(`id=eq.${growth.id}`, { user_id: await userId(OWNER2.email) })).ok()).toBe(false);
    expect((await owner.update(`id=eq.${growth.id}`, { id: "00000000-0000-4000-8000-000000000001" })).ok()).toBe(false);
    // 2. 日時は DB が決める
    await owner.update(`id=eq.${growth.id}`, { created_at: "2000-01-01T00:00:00Z", updated_at: "2000-01-01T00:00:00Z" });
    const after = (await presetRows()).find((r) => r.id === growth.id)!;
    expect(after.created_at).toEqual(growth.created_at);
    expect(after.updated_at).toEqual(growth.updated_at);
    // 3. 2つ目の既定は一意索引で拒否
    const second = await owner.update(`id=eq.${strict}`, { is_default: true });
    expect(second.ok()).toBe(false);
    expect((await second.json()).code).toBe("23505");
    expect(await defaultNames()).toEqual(["グロースのみ"]);
    // 4. 名前
    for (const name of ["", " ", "　", "あ".repeat(41), "a\tb", "a\nb"]) {
      const res = await owner.insert({ name, query: STANDARD });
      expect(res.ok(), JSON.stringify(name)).toBe(false);
    }
    const trimmed = await owner.insert({ name: "　前後\n", query: STANDARD });
    expect(trimmed.status()).toBe(201);
    expect((await trimmed.json())[0].name).toBe("前後");
    // 5. クエリの形（R2）
    const tail = "&margin=10&years=5&owner=20&ownermode=any&sort=cagr&order=desc";
    const rejected = [
      "",
      "foo=bar",
      `page=2&cagr=20${tail}`,
      `${STANDARD}&page=2`,
      "margin=10&cagr=20&years=5&owner=20&ownermode=any&sort=cagr&order=desc",
      `cagr=20&cagr=30${tail}`,
      "cagr=20&margin=10&years=5&owner=20&ownermode=any&market=0111%2C0113&sort=cagr&order=desc",
      `cagr=20#${tail}`,
      `cagr=20/${tail}`,
      `cagr=20\\${tail}`,
      `cagr=20?${tail}`,
      `cagr=20 ${tail}`,
      `cagr=２０${tail}`,
      `cagr=2\n0${tail}`,
      `${STANDARD}\n`,
      `${STANDARD}\r\n`,
      `${STANDARD}${"x".repeat(1001)}`,
    ];
    for (const query of rejected) {
      const res = await owner.insert({ name: "形", query });
      expect(res.ok(), JSON.stringify(query)).toBe(false);
      expect((await res.json()).code, JSON.stringify(query)).toBe("23514");
    }
    for (const query of [`cagr=99999${tail}`, "cagr=20&margin=10&years=5&owner=20&ownermode=xyz&sort=cagr&order=desc"]) {
      const res = await owner.insert({ name: `通る${query.length}`, query });
      expect(res.status(), query).toBe(201);
    }
    // 6. user_id を省くと本人
    const omitted = await owner.insert({ name: "省略", query: STANDARD });
    expect(omitted.status()).toBe(201);
    expect((await omitted.json())[0].user_id).toBe(await userId(OWNER.email));
    // 7. 51 件目
    const ownerId = await userId(OWNER.email);
    await sql("insert into public.screening_presets (user_id, name, query) select $1, 'F' || n, $2 from generate_series(1, 50 - (select count(*) from public.screening_presets where user_id = $1)) n", [
      ownerId,
      STANDARD,
    ]);
    const over = await owner.insert({ name: "51", query: STANDARD });
    expect(over.ok()).toBe(false);
    expect((await over.json()).code).toBe("QP050");
  });

  test("anon は読めず書けない。未ログインの API は 401 no-store、別のオリジンは 403（C5-6・C5-8・C5-9）", async ({ request, page }) => {
    const anon = rest(request, null);
    const selected = await anon.select();
    expect(selected.ok() ? await selected.json() : []).toEqual([]);
    expect((await anon.insert({ name: "anon", query: STANDARD })).ok()).toBe(false);

    const id = await presetId("厳しめ");
    for (const res of [
      await request.get("/api/screening/presets"),
      await request.post("/api/screening/presets", { data: { name: "x", query: STANDARD }, headers: { origin: BASE_URL } }),
      await request.patch(`/api/screening/presets/${id}`, { data: { name: "x" }, headers: { origin: BASE_URL } }),
      await request.delete(`/api/screening/presets/${id}`, { headers: { origin: BASE_URL } }),
    ]) {
      expect(res.status()).toBe(401);
      expect(res.headers()["cache-control"]).toContain("no-store");
    }

    await loginAs(page, OWNER);
    const evil = { origin: "http://evil.example" };
    for (const res of [
      await page.request.post("/api/screening/presets", { data: { name: "x", query: STANDARD }, headers: evil }),
      await page.request.patch(`/api/screening/presets/${id}`, { data: { name: "x" }, headers: evil }),
      await page.request.delete(`/api/screening/presets/${id}`, { headers: evil }),
    ]) {
      expect(res.status()).toBe(403);
      expect(await res.json()).toEqual({ error: "cross_origin" });
    }
    expect((await presetRows()).map((r) => r.name)).toEqual(["グロースのみ", "厳しめ", "スタンダード④なし"]);
  });
});

test.describe("画面のそのほか（C8-1・C9）", () => {
  test("応答の無い一部完了で残りを数えていない実行は「残り 不明」（C8-1）", async ({ page }) => {
    const { rows } = await sql(
      `insert into public.ingestion_runs (target, trigger, status, started_at, finished_at, processed_count, stopped_reason, last_progress_at, error_message)
       values ('daily_quotes', 'cron', 'partial', now() - interval '3 hours', now() - interval '2 hours', 120, 'stale', now() - interval '170 minutes',
               '応答が無くなったため中断されたものとみなしました（15 分以上）。保存済みの分は残っています。残りは次回の取り込みで処理します')
       returning id`,
    );
    await loginAs(page, OWNER);
    await page.goto("/imports");
    const row = page.getByTestId("run-table").locator("tbody tr").filter({ has: page.locator(`a[href="/imports/runs/${rows[0].id}"]`) });
    await expect(row.getByTestId("run-remaining")).toHaveText("残り 不明");
    await page.goto(`/imports/runs/${rows[0].id}`);
    await expect(page.getByTestId("run-remaining")).toHaveText("不明");
  });

  test("1280×800: 市場区分と注記がスクロールなしで見え、表は横スクロールしない。375×812: ダイアログが収まり、長い名前で横スクロールしない（C9-2・C9-3）", async ({ page, browser }) => {
    await sql(PRESETS_SQL);
    const owner = await userId(OWNER.email);
    await sql("insert into public.screening_presets (user_id, name, query) values ($1, $2, $3)", [owner, "𠮷".repeat(40), STRICT]);
    await loginAs(page, OWNER);
    await page.goto("/screening");
    await expect(page.getByTestId("market-filter").first()).toBeInViewport();
    await expect(page.getByTestId("cagr-supplement-note").filter({ visible: true })).toBeInViewport();
    await expect(page.getByTestId("screening-presets")).toBeInViewport();
    const scroll = page.getByTestId("results-scroll");
    expect(await scroll.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

    const { context, page: mobile } = await newUserPage(browser, OWNER, { width: 375, height: 812 });
    await mobile.goto("/screening");
    const noHorizontal = () => mobile.evaluate(() => document.documentElement.scrollWidth <= 375);
    await openSave(mobile);
    await expect(saveDialog(mobile).getByRole("button", { name: "保存", exact: true })).toBeInViewport();
    await escape(mobile);
    await openManage(mobile);
    await expect(manageRow(mobile, "𠮷".repeat(40))).toBeVisible();
    const box = await manageDialog(mobile).boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 375).toBe(true);
    expect(await noHorizontal()).toBe(true);
    await manageRow(mobile, "厳しめ").getByRole("button", { name: "現在の条件で上書き" }).click();
    await expect(mobile.getByTestId("preset-overwrite-dialog").getByRole("button", { name: "上書き" })).toBeInViewport();
    await escape(mobile);
    await manageRow(mobile, "厳しめ").getByRole("button", { name: "削除" }).click();
    await expect(mobile.getByRole("alertdialog").getByRole("button", { name: "削除" })).toBeInViewport();
    await escape(mobile);
    expect(await noHorizontal()).toBe(true);
    await context.close();
  });
});
