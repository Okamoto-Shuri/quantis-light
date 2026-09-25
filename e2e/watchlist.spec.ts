import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";

import { BASE_URL, collectPageProblems, login, OWNER, simulateServerClockBehind, sql } from "./support";

/**
 * ウォッチリスト（F13、Sprint 14）。契約 docs/harness/sprints/sprint-14/contract.md の C1・C2・C5・C6-1。
 * 市場データは Sprint 10 の ownership-example.sql（9U001〜9U014）、ウォッチリストは watchlist-example.sql（owner の4件）。
 * 前提: 市場データ・実行履歴・プリセット・ウォッチリスト・比較の基準の記録が0件の DB、pnpm seed:users 済み（owner・owner2・intruder）。
 * 後片付けは各テストの後と afterAll（権限を外すテストは finally でも戻す）。
 */
test.describe.configure({ mode: "serial" });

const FIXTURES = join(__dirname, "fixtures");
const EXAMPLE_SQL = readFileSync(join(FIXTURES, "ownership-example.sql"), "utf8");
const CLEANUP_SQL = readFileSync(join(FIXTURES, "ownership-cleanup.sql"), "utf8");
const WATCHLIST_SQL = readFileSync(join(FIXTURES, "watchlist-example.sql"), "utf8");
const WATCHLIST_CLEANUP_SQL = readFileSync(join(FIXTURES, "watchlist-cleanup.sql"), "utf8");
const PRESETS_SQL = readFileSync(join(FIXTURES, "screening-presets-example.sql"), "utf8");
const PRESETS_CLEANUP_SQL = readFileSync(join(FIXTURES, "screening-presets-cleanup.sql"), "utf8");

const OWNER2 = { email: "owner2@quantis.local", password: "Quantis-Owner2-2026!" };
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const STANDARD = "cagr=20&margin=10&years=5&owner=20&ownermode=any&sort=cagr&order=desc";
const STRICT = "cagr=20&margin=10&years=5&owner=40&ownermode=any&sort=owner&order=desc";

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

async function items(email = OWNER.email) {
  const { rows } = await sql(
    `select w.code, w.memo, w.created_at, w.updated_at from public.watchlist_items w join auth.users u on u.id = w.user_id
      where u.email = $1 order by w.created_at desc, w.code`,
    [email],
  );
  return rows as { code: string; memo: string | null; created_at: Date; updated_at: Date }[];
}

const jstToday = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());

const screeningRow = (page: Page, code: string) => page.getByTestId("results-scroll").locator(`tbody tr[data-code="${code}"]`);
const star = (page: Page, code: string) => screeningRow(page, code).getByTestId("watchlist-toggle");
const watchRow = (page: Page, code: string) => page.getByTestId("watchlist-row").and(page.locator(`[data-code="${code}"]`));
const watchCodes = (page: Page) => page.getByTestId("watchlist-row").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-code")));

/** 同一オリジンの書き込み（ブラウザの fetch と同じく Origin を付ける） */
function api(request: APIRequestContext) {
  const headers = { origin: BASE_URL };
  return {
    list: (query = "") => request.get(`/api/watchlist${query ? `?${query}` : ""}`),
    put: (code: string) => request.put(`/api/watchlist/${code}`, { headers }),
    patch: (code: string, data: unknown) => request.patch(`/api/watchlist/${code}`, { data, headers }),
    patchRaw: (code: string, body: string) => request.patch(`/api/watchlist/${code}`, { data: Buffer.from(body), headers: { ...headers, "content-type": "application/json" } }),
    remove: (code: string) => request.delete(`/api/watchlist/${code}`, { headers }),
  };
}

function rest(request: APIRequestContext, token: string | null, table = "watchlist_items") {
  const headers: Record<string, string> = { apikey: PUBLISHABLE_KEY, prefer: "return=representation" };
  if (token) headers.authorization = `Bearer ${token}`;
  const url = `${SUPABASE_URL}/rest/v1/${table}`;
  return {
    select: () => request.get(`${url}?select=*`, { headers }),
    insert: (data: object) => request.post(url, { headers, data }),
    update: (filter: string, data: object) => request.patch(`${url}?${filter}`, { headers, data }),
    remove: (filter: string) => request.delete(`${url}?${filter}`, { headers }),
    rpc: (fn: string, data: object) => request.post(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { headers, data }),
  };
}

async function cleanup() {
  await sql(WATCHLIST_CLEANUP_SQL);
  await sql(PRESETS_CLEANUP_SQL);
  await sql(CLEANUP_SQL);
  await sql("delete from public.screening_snapshots");
  await sql("delete from public.ingestion_runs");
}

test.beforeAll(async () => {
  const { rows } = await sql(
    `select (select count(*) from public.stocks)::int as stocks, (select count(*) from public.ingestion_runs)::int as runs,
            (select count(*) from public.screening_presets)::int as presets,
            (select count(*) from public.watchlist_items)::int as watchlist,
            (select count(*) from public.screening_snapshots)::int as snapshots,
            (select count(*) from auth.users where email = 'owner2@quantis.local')::int as owner2,
            has_table_privilege('authenticated', 'public.watchlist_items', 'select') as can_select`,
  );
  expect(rows[0], "E2E の前提: 市場データ・実行履歴・プリセット・ウォッチリスト・記録が0件、owner2 がいる、authenticated に select の権限").toEqual({
    stocks: 0,
    runs: 0,
    presets: 0,
    watchlist: 0,
    snapshots: 0,
    owner2: 1,
    can_select: true,
  });
});

test.beforeEach(async () => {
  await sql(EXAMPLE_SQL);
});

test.afterEach(cleanup);

test.afterAll(async () => {
  await sql("grant select on public.watchlist_items to authenticated");
  await cleanup();
});

test.describe("追加・削除（C1。AC13.1）", () => {
  test("スクリーニングの星で追加し、リロード後も登録済み。詳細へは遷移しない（C1-1・C1-2・C1-9）", async ({ page }) => {
    const problems = collectPageProblems(page);
    const runsBefore = (await sql("select count(*)::int as n from public.ingestion_runs")).rows[0].n;
    await loginAs(page, OWNER);
    await page.goto(`/screening?${STANDARD}`);
    await expect(page.getByTestId("result-count")).toHaveText("7");
    const toggle = star(page, "9U001");
    await expect(toggle).toHaveAttribute("data-state", "off");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(toggle).toHaveAccessibleName("ウォッチリストに追加: 9U001 検証用社長筆頭株式会社");

    await toggle.click();
    await expect(toggle).toHaveAttribute("data-state", "on");
    await expect(page.getByTestId("watchlist-status")).toHaveText("『検証用社長筆頭株式会社』をウォッチリストに追加しました");
    await expect(page).toHaveURL(`/screening?${STANDARD}`);
    await expect(page.getByTestId("result-count")).toHaveText("7");
    const rows = await items();
    expect(rows.map((r) => [r.code, r.memo])).toEqual([["9U001", null]]);

    await page.reload();
    await expect(star(page, "9U001")).toHaveAttribute("data-state", "on");
    await expect(star(page, "9U001")).toHaveAttribute("aria-pressed", "true");
    expect((await sql("select count(*)::int as n from public.ingestion_runs")).rows[0].n).toBe(runsBefore);
    expect(problems).toEqual([]);
  });

  test("キーボード: Tab で星に移り、Enter で追加、Space で外す。遷移しない（C1-3）", async ({ page }) => {
    await loginAs(page, OWNER);
    await page.goto(`/screening?${STANDARD}`);
    const toggle = star(page, "9U002");
    await toggle.focus();
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("data-state", "on");
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("data-state", "off");
    await expect(page).toHaveURL(`/screening?${STANDARD}`);
    expect(await items()).toEqual([]);
  });

  test("銘柄詳細のボタンで外す・追加し、戻る・ヘッダーのどちらでもスクリーニングの星が一致する（C1-4）", async ({ page }) => {
    await loginAs(page, OWNER);
    await page.goto(`/screening?${STANDARD}`);
    await star(page, "9U001").click();
    await expect(star(page, "9U001")).toHaveAttribute("data-state", "on");

    await screeningRow(page, "9U001").getByTestId("row-link-code").click();
    await expect(page).toHaveURL(/\/stocks\/9U001\?/);
    const button = page.getByTestId("watchlist-toggle");
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(button).toContainText("ウォッチリスト登録済み");
    // アクセシブルな名前は見える文字で始める（WCAG 2.5.3。Sprint 14 評価の m4）
    await expect(button).toHaveAccessibleName(/^ウォッチリスト登録済み（外す）: 9U001 /);
    await expect(page.getByTestId("watchlist-added-note")).toHaveText(`${jstToday()} にウォッチリストに追加`);

    await button.click();
    await expect(button).toContainText("ウォッチリストに追加");
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("watchlist-added-note")).toHaveCount(0);
    await expect.poll(async () => (await items()).length).toBe(0);

    await page.goBack();
    await expect(page).toHaveURL(`/screening?${STANDARD}`);
    await expect(star(page, "9U001")).toHaveAttribute("data-state", "off");

    await screeningRow(page, "9U001").getByTestId("row-link-code").click();
    await expect(page).toHaveURL(/\/stocks\/9U001\?/);
    await page.getByTestId("watchlist-toggle").click();
    await expect(page.getByTestId("watchlist-toggle")).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("navigation", { name: "メイン" }).getByRole("link", { name: "スクリーニング" }).click();
    await expect(page).toHaveURL(`/screening?${STANDARD}`);
    await expect(star(page, "9U001")).toHaveAttribute("data-state", "on");
  });

  test("メモのある銘柄を外すときは確認のダイアログ（C1-5）", async ({ page }) => {
    await sql("insert into public.watchlist_items (user_id, code, memo) values ($1, '9U001', 'テスト')", [await userId(OWNER.email)]);
    await loginAs(page, OWNER);
    await page.goto(`/screening?${STANDARD}`);
    const toggle = star(page, "9U001");
    await expect(toggle).toHaveAttribute("data-state", "on");
    await toggle.click();
    const dialog = page.getByTestId("watchlist-remove-dialog");
    await expect(dialog).toHaveAttribute("role", "alertdialog");
    await expect(dialog).toContainText("『検証用社長筆頭株式会社』をウォッチリストから外しますか？");
    await expect(dialog).toContainText("メモも削除されます。この操作は取り消せません。");
    await dialog.getByRole("button", { name: "キャンセル" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(toggle).toBeFocused();
    expect((await items()).map((r) => r.code)).toEqual(["9U001"]);

    await toggle.click();
    await page.getByTestId("watchlist-remove-dialog").getByRole("button", { name: "外す" }).click();
    await expect(toggle).toHaveAttribute("data-state", "off");
    expect(await items()).toEqual([]);

    // 詳細の「ウォッチリスト登録済み」でも同じダイアログ
    await sql("insert into public.watchlist_items (user_id, code, memo) values ($1, '9U001', 'テスト')", [await userId(OWNER.email)]);
    await page.goto("/stocks/9U001");
    await page.getByTestId("watchlist-toggle").click();
    await expect(page.getByTestId("watchlist-remove-dialog")).toContainText("メモも削除されます。");
    await page.getByTestId("watchlist-remove-dialog").getByRole("button", { name: "外す" }).click();
    await expect(page.getByTestId("watchlist-toggle")).toHaveAttribute("aria-pressed", "false");
    expect(await items()).toEqual([]);
  });

  test("上場廃止の銘柄も詳細で追加・削除できる（C1-6）", async ({ page }) => {
    await sql("update public.stocks set delisted_on = '2026-09-25' where code = '9U007'");
    await loginAs(page, OWNER);
    await page.goto("/stocks/9U007");
    await expect(page.getByTestId("delisted-badge")).toBeVisible();
    await page.getByTestId("watchlist-toggle").click();
    await expect(page.getByTestId("watchlist-toggle")).toHaveAttribute("aria-pressed", "true");
    expect((await items()).map((r) => r.code)).toEqual(["9U007"]);
    await page.getByTestId("watchlist-toggle").click();
    await expect(page.getByTestId("watchlist-toggle")).toHaveAttribute("aria-pressed", "false");
    expect(await items()).toEqual([]);
  });

  test("API: 冪等な追加、正規化、不正なコード、無い銘柄、外す、同時の追加（C1-7）", async ({ page }) => {
    await loginAs(page, OWNER);
    const client = api(page.request);
    const first = await client.put("9U003");
    expect(first.status()).toBe(201);
    const created = (await first.json()).data;
    expect(created).toMatchObject({ code: "9U003", memo: null });
    expect(created.addedAt).toMatch(/\+09:00$/);
    const again = await client.put("9U003");
    expect(again.status()).toBe(200);
    expect((await again.json()).data.addedAt).toBe(created.addedAt);
    expect((await items()).map((r) => r.code)).toEqual(["9U003"]);

    const missing = await client.put("9U00");
    expect(missing.status()).toBe(404);
    expect(await missing.json()).toEqual({ error: "stock_not_found" });
    const invalid = await client.put("abc!");
    expect(invalid.status()).toBe(400);
    expect(await invalid.json()).toEqual({ error: "invalid_code" });

    const removed = await client.remove("9U003");
    expect(removed.status()).toBe(200);
    expect(await removed.json()).toEqual({ deleted: true });
    const again404 = await client.remove("9U003");
    expect(again404.status()).toBe(404);
    expect(await again404.json()).toEqual({ error: "not_found" });

    const [a, b] = await Promise.all([client.put("9U005"), client.put("9U005")]);
    expect([a.status(), b.status()].sort()).toEqual([200, 201]);
    expect((await items()).map((r) => r.code)).toEqual(["9U005"]);
  });

  test("上限 500 件: 501 件目は 409、登録済みの PUT は 200 で行は変わらない。画面は上限の文言（C1-8）", async ({ page }) => {
    const owner = await userId(OWNER.email);
    await sql(
      `insert into public.stocks (code, company_name, market_code, market_name, sector33_code, sector33_name, product_category)
       select 'W' || lpad(i::text, 4, '0'), '上限検証' || i, '0113', 'グロース', '5250', '情報・通信業', '011' from generate_series(0, 499) i`,
    );
    await sql("insert into public.watchlist_items (user_id, code) select $1, 'W' || lpad(i::text, 4, '0') from generate_series(0, 499) i", [owner]);
    try {
      await loginAs(page, OWNER);
      const client = api(page.request);
      const over = await client.put("9U001");
      expect(over.status()).toBe(409);
      expect(await over.json()).toEqual({ error: "watchlist_limit" });
      const before = (await sql("select created_at from public.watchlist_items where user_id = $1 and code = 'W0007'", [owner])).rows[0].created_at;
      const existing = await client.put("W0007");
      expect(existing.status()).toBe(200);
      const after = await sql("select count(*)::int as n, max(created_at) filter (where code = 'W0007') as c from public.watchlist_items where user_id = $1", [owner]);
      expect(after.rows[0].n).toBe(500);
      expect(after.rows[0].c).toEqual(before);

      await page.goto(`/screening?${STANDARD}`);
      await star(page, "9U001").click();
      await expect(page.getByTestId("watchlist-status")).toHaveText("ウォッチリストは 500 銘柄まで登録できます");
      await expect(star(page, "9U001")).toHaveAttribute("data-state", "off");
    } finally {
      await sql("delete from public.watchlist_items where user_id = $1", [owner]);
      await sql("delete from public.stocks where code like 'W%' and company_name like '上限検証%'");
    }
  });
});

test.describe("ウォッチリスト画面（C2。AC13.2）", () => {
  test.beforeEach(async () => {
    await sql(WATCHLIST_SQL);
  });

  test("ナビゲーションから開き、4行の指標・判定・メモ・追加日（C2-1・C2-2・C2-7）", async ({ page }) => {
    const problems = collectPageProblems(page);
    await loginAs(page, OWNER);
    const nav = page.getByRole("navigation", { name: "メイン" });
    await expect(nav.getByRole("link")).toHaveText(["ダッシュボード", "スクリーニング", "ウォッチリスト", "取り込み状況", "設定"]);
    await nav.getByRole("link", { name: "ウォッチリスト" }).click();
    await expect(page).toHaveURL("/watchlist");
    await expect(nav.getByRole("link", { name: "ウォッチリスト" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "ウォッチリスト", level: 1 })).toBeVisible();
    await expect(page.getByTestId("watchlist-conditions")).toHaveText("既定の条件で判定しています");
    await expect.poll(() => watchCodes(page)).toEqual(["9U001", "9U006", "9U011", "9U004"]);

    const expected = [
      { code: "9U001", cagr: "25.0%", margin: "15.0%", years: "3.0年", owner: "president_top", kind: "included", text: "該当", added: "2026-09-23" },
      { code: "9U006", cagr: "25.0%", margin: "15.0%", years: "3.0年", owner: "owner_company", kind: "included", text: "該当", added: "2026-09-22" },
      { code: "9U011", cagr: "10.0%", margin: "15.0%", years: "3.0年", owner: "president_top", kind: "unmet", text: "該当しない（条件①）", added: "2026-09-21" },
      { code: "9U004", cagr: "25.0%", margin: "15.0%", years: "3.0年", owner: "undeterminable", kind: "undeterminable", text: "該当しない（条件④ 判定不能）", added: "2026-09-20" },
    ];
    for (const e of expected) {
      const row = watchRow(page, e.code);
      await expect(row.getByTestId("watchlist-cagr")).toContainText(e.cagr);
      await expect(row.getByTestId("watchlist-margin")).toContainText(e.margin);
      await expect(row.getByTestId("watchlist-years")).toContainText(e.years);
      await expect(row.getByTestId("watchlist-owner")).toHaveAttribute("data-result", e.owner);
      await expect(row.getByTestId("watchlist-inclusion")).toHaveAttribute("data-kind", e.kind);
      await expect(row.getByTestId("watchlist-inclusion")).toHaveText(e.text);
      await expect(row.getByTestId("watchlist-added-on")).toHaveText(e.added);
      await expect(row.getByTestId("watchlist-change-badge")).toHaveCount(0);
    }
    await expect(watchRow(page, "9U001").getByTestId("watchlist-memo")).toHaveText("決算説明会の資料を確認する");
    expect(await watchRow(page, "9U011").getByTestId("watchlist-memo").evaluate((el) => (el as HTMLElement).innerText)).toBe("成長率の回復待ち\n来期の予想を見る");
    await expect(watchRow(page, "9U006").getByTestId("watchlist-memo")).toHaveCount(0);
    await expect(watchRow(page, "9U006").getByRole("button", { name: "メモを追加" })).toBeVisible();

    await watchRow(page, "9U001").getByTestId("watchlist-link").click();
    await expect(page).toHaveURL("/stocks/9U001");
    expect(problems).toEqual([]);
  });

  test("手動補正は「手動補正」のラベルと元の自動判定で、該当が変わる（C2-3）", async ({ page }) => {
    await sql("insert into public.ownership_overrides (user_id, code, verdict, memo) values ($1, '9U006', 'not_matched', '確認済み')", [await userId(OWNER.email)]);
    await loginAs(page, OWNER);
    await page.goto("/watchlist");
    const cell = watchRow(page, "9U006").getByTestId("watchlist-owner");
    await expect(cell).toHaveAttribute("data-result", "not_matched");
    await expect(cell).toHaveAttribute("data-auto-result", "owner_company");
    await expect(cell).toHaveAttribute("data-override", "true");
    await expect(cell).toContainText("手動補正");
    await expect(watchRow(page, "9U006").getByTestId("watchlist-inclusion")).toHaveText("該当しない（条件④）");
    await sql("delete from public.ownership_overrides where code = '9U006'");
    await page.reload();
    await expect(watchRow(page, "9U006").getByTestId("watchlist-inclusion")).toHaveText("該当");
  });

  test("メモの編集: 追加・保存・Ctrl+Enter・Esc・消す・1,000 文字・XSS（C2-4）", async ({ page }) => {
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await loginAs(page, OWNER);
    await page.goto("/watchlist");
    const row6 = watchRow(page, "9U006");
    await row6.getByRole("button", { name: "メモを追加" }).click();
    const box6 = row6.getByRole("textbox", { name: "メモ（9U006）" });
    await expect(box6).toBeFocused();
    await box6.fill("IR に問い合わせ中");
    await row6.getByRole("button", { name: "保存" }).click();
    await expect(page.getByTestId("watchlist-status")).toHaveText("メモを保存しました");
    await expect(row6.getByTestId("watchlist-memo")).toHaveText("IR に問い合わせ中");
    await expect(row6.getByRole("button", { name: "編集" })).toBeFocused();
    const saved = (await items()).find((r) => r.code === "9U006")!;
    expect(saved.memo).toBe("IR に問い合わせ中");
    expect(saved.updated_at.getTime()).toBeGreaterThan(saved.created_at.getTime());
    await page.reload();
    await expect(watchRow(page, "9U006").getByTestId("watchlist-memo")).toHaveText("IR に問い合わせ中");
    await expect(watchRow(page, "9U006").getByTestId("watchlist-added-on")).toHaveText("2026-09-22");

    // 前後の空白・改行は除く。⌘／Ctrl＋Enter で保存
    const row1 = watchRow(page, "9U001");
    await row1.getByRole("button", { name: "編集" }).click();
    await row1.getByRole("textbox", { name: "メモ（9U001）" }).fill("　新しいメモ\n");
    await page.keyboard.press("Control+Enter");
    await expect(row1.getByTestId("watchlist-memo")).toHaveText("新しいメモ");
    expect((await items()).find((r) => r.code === "9U001")!.memo).toBe("新しいメモ");

    // Esc で取り消し
    await row1.getByRole("button", { name: "編集" }).click();
    await row1.getByRole("textbox", { name: "メモ（9U001）" }).fill("取り消す");
    await page.keyboard.press("Escape");
    await expect(row1.getByTestId("watchlist-memo")).toHaveText("新しいメモ");
    await expect(row1.getByRole("button", { name: "編集" })).toBeFocused();
    expect((await items()).find((r) => r.code === "9U001")!.memo).toBe("新しいメモ");

    // 全角空白だけで保存すると消える
    await row1.getByRole("button", { name: "編集" }).click();
    await row1.getByRole("textbox", { name: "メモ（9U001）" }).fill("　　");
    await row1.getByRole("button", { name: "保存" }).click();
    await expect(row1.getByTestId("watchlist-memo")).toHaveCount(0);
    await expect(row1.getByRole("button", { name: "メモを追加" })).toBeVisible();
    expect((await items()).find((r) => r.code === "9U001")!.memo).toBeNull();

    // 「𠮷」1,000 個は保存でき、1,001 個は保存されない
    await row1.getByRole("button", { name: "メモを追加" }).click();
    const box1 = row1.getByRole("textbox", { name: "メモ（9U001）" });
    await box1.fill("𠮷".repeat(1001));
    await expect(row1.getByTestId("watchlist-memo-count")).toHaveText("1,001 / 1,000");
    await row1.getByRole("button", { name: "保存" }).click();
    await expect(row1.getByTestId("watchlist-memo-error")).toHaveText("メモは 1,000 文字以内で入力してください");
    expect((await items()).find((r) => r.code === "9U001")!.memo).toBeNull();
    // 保存に失敗した直後（フォーカスは「保存」）でも Esc で取り消せる（Sprint 14 評価の m2）
    await expect(row1.getByRole("button", { name: "保存" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(row1.getByTestId("watchlist-memo-edit")).toHaveCount(0);
    await expect(row1.getByRole("button", { name: "メモを追加" })).toBeFocused();
    await row1.getByRole("button", { name: "メモを追加" }).click();
    await box1.fill("𠮷".repeat(1000));
    await expect(row1.getByTestId("watchlist-memo-count")).toHaveText("1,000 / 1,000");
    await row1.getByRole("button", { name: "保存" }).click();
    await expect(row1.getByTestId("watchlist-memo")).toBeVisible();
    expect([...((await items()).find((r) => r.code === "9U001")!.memo ?? "")].length).toBe(1000);

    // XSS
    await row1.getByRole("button", { name: "編集" }).click();
    await row1.getByRole("textbox", { name: "メモ（9U001）" }).fill("<img src=x onerror=alert(1)>");
    await row1.getByRole("button", { name: "保存" }).click();
    await expect(row1.getByTestId("watchlist-memo")).toHaveText("<img src=x onerror=alert(1)>");
    await page.waitForTimeout(300);
    expect(dialogs).toEqual([]);
  });

  test("メモのある銘柄を外すと確認のダイアログ。外すと行が消える（C2-5）", async ({ page }) => {
    await loginAs(page, OWNER);
    await page.goto("/watchlist");
    await watchRow(page, "9U001").getByTestId("watchlist-toggle").click();
    await expect(page.getByTestId("watchlist-remove-dialog")).toBeVisible();
    await page.getByTestId("watchlist-remove-dialog").getByRole("button", { name: "外す" }).click();
    await expect(page.getByTestId("watchlist-status")).toHaveText("『検証用社長筆頭株式会社』をウォッチリストから外しました");
    await expect.poll(() => watchCodes(page)).toEqual(["9U006", "9U011", "9U004"]);
  });

  test("既定のプリセット（厳しめ）で判定する。API は既定を当てない（C2-6・C2-9）", async ({ page }) => {
    await sql(PRESETS_SQL);
    await sql("update public.screening_presets set is_default = true where name = '厳しめ'");
    await loginAs(page, OWNER);
    await page.goto("/watchlist");
    await expect(page.getByTestId("watchlist-conditions")).toHaveText("既定のプリセット『厳しめ』の条件で判定しています");
    await expect(watchRow(page, "9U006").getByTestId("watchlist-inclusion")).toHaveText("該当しない（条件④）");
    await expect(page.getByTestId("watchlist-open-screening")).toHaveAttribute("href", `/screening?${STRICT}`);

    const client = api(page.request);
    const list = await client.list();
    expect(list.status()).toBe(200);
    expect(list.headers()["cache-control"]).toContain("no-store");
    const body = (await list.json()).data;
    expect(body.items.map((item: { code: string }) => item.code)).toEqual(["9U001", "9U006", "9U011", "9U004"]);
    const item6 = body.items.find((item: { code: string }) => item.code === "9U006");
    expect(item6.evaluation.included).toBe(true);
    expect(item6).toMatchObject({ memo: null, addedAt: "2026-09-22T10:00:00+09:00", change: null, stock: { market_name: "プライム", delisted_on: null } });
    expect(item6.metrics).toMatchObject({ revenue_cagr_display_pct: 25, operating_margin_display_pct: 15, estimated_listing_years: 3 });
    expect(body.comparison.status).toBe("no_snapshot");
    const strict = (await (await client.list("owner=40")).json()).data;
    expect(strict.items.find((item: { code: string }) => item.code === "9U006").evaluation).toMatchObject({ included: false, exclusion: "unmet" });
    const bad = await client.list("cagr=abc");
    expect(bad.status()).toBe(400);
    expect((await bad.json()).error).toBe("invalid_params");

    const patch = async (code: string, data: unknown) => client.patch(code, data);
    const x = await patch("9U001", { memo: "x" });
    expect(x.status()).toBe(200);
    expect((await x.json()).data.memo).toBe("x");
    expect((await (await patch("9U001", { memo: null })).json()).data.memo).toBeNull();
    for (const data of [{ memo: 123 }, { memo: "a".repeat(1001) }, {}]) {
      const res = await patch("9U001", data);
      expect(res.status()).toBe(400);
      expect((await res.json()).error).toBe("invalid_memo");
    }
    const raw = await client.patchRaw("9U001", "not json");
    expect(raw.status()).toBe(400);
    expect((await raw.json()).error).toBe("invalid_body");
    const notInList = await patch("9U003", { memo: "x" });
    expect(notInList.status()).toBe(404);
    expect((await notInList.json()).error).toBe("not_found");
  });

  test("空状態（C2-8）", async ({ page }) => {
    await sql(WATCHLIST_CLEANUP_SQL);
    await loginAs(page, OWNER);
    await page.goto("/watchlist");
    await expect(page.getByTestId("watchlist-empty")).toContainText("ウォッチリストはまだ空です。スクリーニングの結果や銘柄詳細の☆から追加できます");
    await expect(page.getByTestId("watchlist-empty").getByRole("link", { name: "スクリーニングを開く" })).toHaveAttribute("href", "/screening");
  });

  test("375×812: ページは横スクロールせず、表は枠の中でスクロールし、メモの編集が画面に収まる（C2-10）", async ({ browser }) => {
    const { context, page } = await newUserPage(browser, OWNER, { width: 375, height: 812 });
    try {
      await page.goto("/watchlist");
      await expect(page.getByTestId("watchlist-table")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
      const scroll = page.getByTestId("watchlist-scroll");
      expect(await scroll.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
      await scroll.evaluate((el) => (el.scrollLeft = el.scrollWidth));
      const codeCell = watchRow(page, "9U001").locator("td").first();
      const box = await codeCell.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x).toBeLessThan(40);
      const row6 = watchRow(page, "9U006");
      await row6.getByRole("button", { name: "メモを追加" }).click();
      const textbox = row6.getByRole("textbox", { name: "メモ（9U006）" });
      await expect(textbox).toBeInViewport();
      for (const name of ["保存", "キャンセル"]) {
        const button = row6.getByRole("button", { name });
        await button.scrollIntoViewIfNeeded();
        await expect(button).toBeInViewport();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    } finally {
      await context.close();
    }
  });
});

test.describe("ユーザーごとの分離と永続性（C5。AC13.5）", () => {
  test.beforeEach(async () => {
    await sql(WATCHLIST_SQL);
  });

  test("再ログインで残り、owner2 からは見えない。owner2 の追加は owner に影響しない（C5-1〜C5-3）", async ({ page, browser }) => {
    await loginAs(page, OWNER);
    await page.goto("/watchlist");
    await expect.poll(() => watchCodes(page)).toEqual(["9U001", "9U006", "9U011", "9U004"]);
    await page.getByRole("button", { name: "アカウントメニュー" }).click();
    await page.getByRole("menuitem", { name: "ログアウト" }).click();
    await expect(page).toHaveURL("/login");
    await loginAs(page, OWNER);
    await page.goto("/watchlist");
    await expect.poll(() => watchCodes(page)).toEqual(["9U001", "9U006", "9U011", "9U004"]);

    const { context, page: page2 } = await newUserPage(browser, OWNER2);
    try {
      await page2.goto("/watchlist");
      await expect(page2.getByTestId("watchlist-empty")).toBeVisible();
      await page2.goto(`/screening?${STANDARD}`);
      await expect(page2.getByTestId("watchlist-toggle").first()).toBeVisible();
      await expect(page2.locator('[data-testid="watchlist-toggle"][data-state="on"]')).toHaveCount(0);
      await page2.goto("/stocks/9U001");
      await expect(page2.getByTestId("watchlist-toggle")).toHaveAttribute("aria-pressed", "false");
      expect((await (await page2.request.get("/api/watchlist")).json()).data.items).toEqual([]);

      const client2 = api(page2.request);
      expect((await client2.put("9U001")).status()).toBe(201);
      expect((await client2.patch("9U001", { memo: "owner2 のメモ" })).status()).toBe(200);
      await page.reload();
      await expect(watchRow(page, "9U001").getByTestId("watchlist-memo")).toHaveText("決算説明会の資料を確認する");
      expect((await client2.remove("9U001")).status()).toBe(200);
      expect((await items()).map((r) => r.code)).toEqual(["9U001", "9U006", "9U011", "9U004"]);
    } finally {
      await context.close();
    }
  });

  test("anon は読めず書けない。未ログインの API は 401 no-store、別のオリジンは 403（C5-6・C5-9・C5-10）", async ({ request, page }) => {
    const anon = rest(request, null);
    const selected = await anon.select();
    expect(selected.ok() ? await selected.json() : []).toEqual([]);
    expect((await anon.insert({ code: "9U003" })).ok()).toBe(false);
    for (const table of ["screening_snapshots", "screening_snapshot_stocks"]) {
      const res = await rest(request, null, table).select();
      expect(res.ok() ? await res.json() : [], table).toEqual([]);
    }
    for (const fn of ["screening_changes", "capture_screening_snapshot"]) {
      const res = await anon.rpc(fn, fn === "screening_changes" ? { p_params: { cagr: "20", margin: "10", years: "5" } } : {});
      expect(res.ok(), fn).toBe(false);
    }

    for (const res of [
      await request.get("/api/watchlist"),
      await request.put("/api/watchlist/9U001", { headers: { origin: BASE_URL } }),
      await request.patch("/api/watchlist/9U001", { data: { memo: "x" }, headers: { origin: BASE_URL } }),
      await request.delete("/api/watchlist/9U001", { headers: { origin: BASE_URL } }),
      await request.get("/api/screening/changes"),
    ]) {
      expect(res.status()).toBe(401);
      expect(res.headers()["cache-control"]).toContain("no-store");
    }

    await loginAs(page, OWNER);
    const evil = { origin: "http://evil.example" };
    for (const res of [
      await page.request.put("/api/watchlist/9U003", { headers: evil }),
      await page.request.patch("/api/watchlist/9U001", { data: { memo: "x" }, headers: evil }),
      await page.request.delete("/api/watchlist/9U001", { headers: evil }),
    ]) {
      expect(res.status()).toBe(403);
      expect(await res.json()).toEqual({ error: "cross_origin" });
    }
    expect((await items()).map((r) => [r.code, r.memo])).toEqual([
      ["9U001", "決算説明会の資料を確認する"],
      ["9U006", null],
      ["9U011", "成長率の回復待ち\n来期の予想を見る"],
      ["9U004", null],
    ]);

    // NUL（U+0000）を含むメモは DB に送らずに 400（Sprint 14 評価の m1）
    const nul = await page.request.patch("/api/watchlist/9U001", { data: { memo: "a\u0000b" }, headers: { origin: BASE_URL } });
    expect(nul.status()).toBe(400);
    expect(await nul.json()).toEqual({ error: "invalid_memo", fields: ["memo"] });
    expect((await items()).find((r) => r.code === "9U001")!.memo).toBe("決算説明会の資料を確認する");
  });

  test("owner2 の許可を取り消すと、owner2 の API は 403。owner は変わらない（C5-11）", async ({ page, browser }) => {
    const { context, page: page2 } = await newUserPage(browser, OWNER2);
    try {
      expect((await api(page2.request).put("9U001")).status()).toBe(201);
      await sql("delete from private.allowed_emails where email = $1", [OWNER2.email]);
      expect((await page2.request.get("/api/watchlist")).status()).toBe(403);
      expect((await api(page2.request).put("9U003")).status()).toBe(403);
      expect((await items(OWNER2.email)).map((r) => r.code)).toEqual(["9U001"]);
      await loginAs(page, OWNER);
      await page.goto("/watchlist");
      await expect.poll(() => watchCodes(page)).toEqual(["9U001", "9U006", "9U011", "9U004"]);
    } finally {
      await sql("insert into private.allowed_emails (email) values ($1) on conflict do nothing", [OWNER2.email]);
      await context.close();
    }
  });
});

test.describe("読めないとき（C6-1）", () => {
  test("watchlist_items の select を外すと、ウォッチリストはエラー、スクリーニングと詳細は描画を続け、API は 500", async ({ page }) => {
    await sql(WATCHLIST_SQL);
    await loginAs(page, OWNER);
    try {
      await sql("revoke select on public.watchlist_items from authenticated");
      await page.goto("/watchlist");
      await expect(page.getByTestId("watchlist-error")).toBeVisible();
      await expect(page.getByTestId("watchlist-empty")).toHaveCount(0);

      await page.goto(`/screening?${STANDARD}`);
      await expect(page.getByTestId("result-count")).toHaveText("7");
      await expect(page.getByTestId("watchlist-load-error")).toBeVisible();
      await expect(star(page, "9U001")).toBeDisabled();

      await page.goto("/stocks/9U001");
      await expect(page.getByTestId("watchlist-toggle")).toBeDisabled();
      await expect(page.getByTestId("watchlist-load-error")).toBeVisible();

      for (const path of ["/api/watchlist", `/api/screening?${STANDARD}`]) {
        const res = await page.request.get(path);
        expect(res.status(), path).toBe(500);
        expect(await res.json()).toEqual({ error: "internal_error" });
      }
    } finally {
      await sql("grant select on public.watchlist_items to authenticated");
    }
    await page.goto("/watchlist");
    await expect.poll(() => watchCodes(page)).toEqual(["9U001", "9U006", "9U011", "9U004"]);
  });
});

test.describe("時計のずれ（C4-12 の一部。dev で意味がある）", () => {
  test("simulateServerClockBehind の下で、ウォッチリスト・星・メモの保存でエラーが出ない", async ({ browser }) => {
    await sql(WATCHLIST_SQL);
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await simulateServerClockBehind(context);
    const page = await context.newPage();
    const problems = collectPageProblems(page);
    try {
      await loginAs(page, OWNER);
      await page.goto("/watchlist");
      const row6 = watchRow(page, "9U006");
      await row6.getByRole("button", { name: "メモを追加" }).click();
      await row6.getByRole("textbox", { name: "メモ（9U006）" }).fill("時計");
      await row6.getByRole("button", { name: "保存" }).click();
      await expect(row6.getByTestId("watchlist-memo")).toHaveText("時計");
      await page.goto(`/screening?${STANDARD}`);
      await star(page, "9U002").click();
      await expect(star(page, "9U002")).toHaveAttribute("data-state", "on");
      await page.goto("/stocks/9U011");
      await page.getByTestId("watchlist-toggle").click();
      await expect(page.getByTestId("watchlist-remove-dialog")).toBeVisible();
      await page.getByTestId("watchlist-remove-dialog").getByRole("button", { name: "外す" }).click();
      await expect(page.getByTestId("watchlist-toggle")).toHaveAttribute("aria-pressed", "false");
      expect(problems).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
