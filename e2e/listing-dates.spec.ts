import { expect, test, type Page } from "@playwright/test";

import { collectPageProblems, CRON_SECRET, loginAsOwner, OWNER, simulateServerClockBehind, sql } from "./support";

/**
 * 株価の初出日と推定上場年数（F4、Sprint 4）と、Sprint 3 評価の M1・M2。
 * 前提: 市場データと実行履歴が0件の DB。J-Quants の API キーが未設定のサーバー（キーがあるサーバーでは、
 * キー未設定を前提にしたテストをスキップする）。投入する銘柄コードは 9999x で、各テストの後に削除する。
 */
test.describe.configure({ mode: "serial" });

const PORT = Number(process.env.E2E_PORT ?? 3000);
const KEY_MISSING = "J-Quants の API キーが設定されていません";

/** 契約の第6章の投入例（基準日 2026-09-24、99991〜99993）。 */
async function insertExample() {
  await sql(
    `insert into public.ingestion_runs (target, trigger, status, started_at, finished_at, processed_count)
     values ('daily_quotes', 'manual', 'succeeded', '2026-09-24 20:00:00+09', '2026-09-24 20:03:00+09', 0)`,
  );
  await sql(
    `insert into public.stocks (code, company_name, market_code, market_name, sector33_code, sector33_name, product_category)
     values ('99991', '検証用三年株式会社', '0113', 'グロース', '5250', '情報・通信業', '011'),
            ('99992', '検証用老舗株式会社', '0111', 'プライム', '3050', '食料品', '011'),
            ('99993', '検証用未確定株式会社', '0112', 'スタンダード', '3050', '食料品', '011')`,
  );
  await sql(
    `insert into public.stock_listing_dates (code, first_price_date, data_start_date)
     values ('99991', '2023-09-24', '2016-09-26'), ('99992', '2016-09-26', '2016-09-26')`,
  );
}

async function jquantsConfigured(page: Page): Promise<boolean> {
  const res = await page.request.get("/api/ingestion");
  const body = (await res.json()) as { data: { sources: { id: string; configured: boolean }[] } };
  return body.data.sources.find((source) => source.id === "jquants")?.configured === true;
}

async function lookup(page: Page, code: string) {
  const panel = page.getByTestId("listing-dates");
  await panel.getByLabel("銘柄コード").fill(code);
  await panel.getByRole("button", { name: "確認" }).click();
}

const manualButton = (page: Page) => page.getByRole("button", { name: /今すぐ取り込み|実行中/ });
const targetRadio = (page: Page, name: RegExp) => page.getByRole("radio", { name });

test.beforeAll(async () => {
  const { rows } = await sql(
    "select (select count(*) from public.stocks)::int as stocks, (select count(*) from public.ingestion_runs)::int as runs",
  );
  expect(rows[0], "E2E の前提: 市場データと実行履歴が0件").toEqual({ stocks: 0, runs: 0 });
});

test.afterEach(async () => {
  await sql("delete from public.stocks where code like '9999%'");
  await sql("delete from public.ingestion_runs");
  await sql("insert into private.allowed_emails (email) values ($1) on conflict do nothing", [OWNER.email]);
});

test.describe("推定上場年数の表示（AC4.2、AC4.3）", () => {
  test("要約、コードでの確認（3.0年）、初出日の新しい銘柄の表", async ({ page }) => {
    const problems = collectPageProblems(page);
    await insertExample();
    await loginAsOwner(page);
    await page.goto("/imports");

    const panel = page.getByTestId("listing-dates");
    await expect(panel.getByRole("heading", { name: "株価の初出日と推定上場年数" })).toBeVisible();
    await expect(panel).toContainText("株価データの初出日からの推定");
    await expect(panel.getByTestId("listing-reference-date")).toContainText("2026-09-24");
    await expect(panel.getByTestId("listing-data-start")).toContainText("2016-09-26");
    await expect(panel.getByTestId("listing-determined")).toContainText("2 銘柄");
    await expect(panel.getByTestId("listing-determined")).toContainText("うち、データ期間開始以前から上場: 1 銘柄");
    await expect(panel.getByTestId("listing-undetermined")).toContainText("1 銘柄");

    await lookup(page, "99991");
    await expect(page).toHaveURL("/imports?code=99991");
    const card = page.getByTestId("listing-lookup-card");
    await expect(card).toContainText("99991");
    await expect(card).toContainText("検証用三年株式会社");
    await expect(card).toContainText("グロース");
    await expect(card.getByTestId("listing-first-date")).toHaveText("2023-09-24");
    await expect(card.getByTestId("listing-years")).toContainText("3.0年");
    await expect(card.getByTestId("listing-years")).toContainText("株価データの初出日からの推定");

    const table = page.getByTestId("listing-recent-table");
    await expect(table.locator("tr[data-code='99991']")).toContainText("3.0年");
    await expect(table.locator("tr[data-code='99992']")).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test("表示は DB で小数1桁に切り上げた値（5年−1日は 5.0年、5年＋1日は 5.1年）", async ({ page }) => {
    await insertExample();
    await loginAsOwner(page);
    for (const [first, shown] of [
      ["2023-09-25", "3.0年"],
      ["2023-09-23", "3.1年"],
      ["2021-09-24", "5.0年"],
      ["2021-09-25", "5.0年"],
      ["2021-09-23", "5.1年"],
      ["2026-09-24", "0.0年"],
    ]) {
      await sql("update public.stock_listing_dates set first_price_date = $1 where code = '99991'", [first]);
      await page.goto("/imports?code=99991");
      await expect(page.getByTestId("listing-years"), first).toContainText(shown);
    }
  });

  test("基準日が無ければ「なし」、年数は「基準日がないため算出できません」", async ({ page }) => {
    await insertExample();
    await sql("delete from public.ingestion_runs");
    await loginAsOwner(page);
    await page.goto("/imports?code=99991");
    await expect(page.getByTestId("listing-reference-date")).toContainText("なし（株価の取り込み実績がありません）");
    await expect(page.getByTestId("listing-first-date")).toHaveText("2023-09-24");
    await expect(page.getByTestId("listing-years")).toHaveText("基準日がないため算出できません");
    await expect(page.getByTestId("listing-years")).not.toContainText("年数");
  });

  test("データ期間開始以前（9年超）、未確定、無いコード、形式の違うコード。時計のずれがあっても pageerror は0件", async ({ page, context }) => {
    await simulateServerClockBehind(context);
    const problems = collectPageProblems(page);
    await insertExample();
    await loginAsOwner(page);
    await page.goto("/imports");

    await lookup(page, "99992");
    const years = page.getByTestId("listing-years");
    await expect(years).toContainText("データ期間開始以前から上場（9年超）");
    await expect(years).toContainText("年数を特定できません");
    await expect(years).not.toContainText(/\d\.\d年/);

    await lookup(page, "99993");
    await expect(years).toContainText("未確定（株価の初出日をまだ取り込んでいません）");

    await lookup(page, "12340");
    await expect(page.getByTestId("listing-lookup-message")).toHaveText("銘柄コード 12340 は銘柄マスタにありません");

    await lookup(page, "9999");
    await expect(page).toHaveURL("/imports?code=9999");
    await expect(page.getByTestId("listing-lookup-message")).toHaveText("銘柄コード 99990 は銘柄マスタにありません");

    for (const bad of ["abc", "123456", ""]) {
      await lookup(page, bad);
      await expect(page.getByTestId("listing-lookup-message"), bad).toHaveText("銘柄コードは4桁または5桁の英数字で入力してください");
      await expect(page.getByLabel("銘柄コード")).toHaveAttribute("aria-invalid", "true");
    }
    expect(problems).toEqual([]);
  });

  test("?code= に <script> や %00 を入れても 200 で、そのまま HTML に出ない", async ({ page }) => {
    await loginAsOwner(page);
    for (const query of ["%3Cscript%3Ealert(1)%3C%2Fscript%3E", "9999%00", "%22%3E%3Cimg%20src%3Dx%3E"]) {
      const res = await page.request.get(`/imports?code=${query}`);
      expect(res.status(), query).toBe(200);
      const html = await res.text();
      expect(html).not.toContain("<script>alert(1)");
      expect(html).not.toContain('"><img src=x>');
    }
  });

  test("初出日の行が1件も無ければ、未取り込みの案内を出す（ダミーの数値は出さない）", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/imports");
    await expect(page.getByTestId("listing-empty")).toContainText("株価の初出日はまだ取り込まれていません");
    await expect(page.getByTestId("listing-determined")).toContainText("0 銘柄");
    await expect(page.getByTestId("listing-reference-date")).toContainText("なし");
  });
});

test.describe("GET /api/stocks の初出日と推定上場年数", () => {
  test("各行に年数の項目、meta.referenceDate。?code= で1銘柄に絞れる", async ({ page, request }) => {
    await insertExample();
    const unauth = await request.get("/api/stocks?code=99991");
    expect(unauth.status()).toBe(401);
    expect(await unauth.text()).not.toContain("99991");

    await loginAsOwner(page);
    const res = await page.request.get("/api/stocks");
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toContain("no-store");
    const body = await res.json();
    expect(body.meta).toEqual({ referenceDate: "2026-09-24" });
    const byCode = Object.fromEntries(body.data.map((row: { code: string }) => [row.code, row]));
    expect(byCode["99991"]).toMatchObject({
      first_price_date: "2023-09-24",
      data_start_date: "2016-09-26",
      listed_before_data_start: false,
      listing_years_exact: 3,
      estimated_listing_years: 3,
      listing_years_lower_bound: null,
    });
    expect(byCode["99992"]).toMatchObject({
      listed_before_data_start: true,
      listing_years_exact: null,
      estimated_listing_years: null,
      listing_years_lower_bound: 9,
    });
    expect(byCode["99993"]).toMatchObject({
      first_price_date: null,
      data_start_date: null,
      listed_before_data_start: null,
      listing_years_exact: null,
      estimated_listing_years: null,
      listing_years_lower_bound: null,
    });

    const one = await (await page.request.get("/api/stocks?code=99991")).json();
    expect(one.data.map((row: { code: string }) => row.code)).toEqual(["99991"]);
    const four = await (await page.request.get("/api/stocks?code=9999")).json();
    expect(four.data).toEqual([]);
    const bad = await page.request.get("/api/stocks?code=abc");
    expect(bad.status()).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_code" });
  });
});

test.describe("株価（初出日）の手動取り込み（キー未設定）", () => {
  test("対象「株価（初出日）」を選んで押すと失敗が記録される。対象はキーボードで選べる", async ({ page }) => {
    const problems = collectPageProblems(page);
    await loginAsOwner(page);
    test.skip(await jquantsConfigured(page), "サーバーの J-Quants のキーが設定済み");
    await page.goto("/imports");

    const master = targetRadio(page, /^銘柄マスタ/);
    const quotes = targetRadio(page, /^株価（初出日）/);
    await expect(master).toBeChecked();
    await expect(page.getByRole("radiogroup", { name: "対象" })).toBeVisible();
    // Tab でグループに入り、矢印キーで選択を変える
    await manualButton(page).focus();
    await page.keyboard.press("Shift+Tab");
    await expect(master).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(quotes).toBeChecked();
    await expect(quotes).toBeFocused();

    await manualButton(page).click();
    await expect(page.getByTestId("ingestion-result")).toHaveText(`失敗: ${KEY_MISSING}`);
    const { rows } = await sql("select target, trigger, status, processed_count, error_message from public.ingestion_runs");
    expect(rows).toEqual([
      { target: "daily_quotes", trigger: "manual", status: "failed", processed_count: 0, error_message: KEY_MISSING },
    ]);
    await page.reload();
    const history = page.getByTestId("run-table");
    await expect(history.locator("tbody tr").first()).toContainText("株価");
    await expect(history.locator("tbody tr").first()).toContainText("失敗");
    await expect(history.locator("tbody tr").first()).toContainText(KEY_MISSING);
    expect(problems).toEqual([]);
  });

  test("銘柄マスタだけがある状態でも、キーの確認が先（キー未設定の失敗）", async ({ page }) => {
    await loginAsOwner(page);
    test.skip(await jquantsConfigured(page), "サーバーの J-Quants のキーが設定済み");
    await sql("insert into public.stocks (code, company_name) values ('99991', '検証用株式会社')");
    const res = await page.request.post("/api/ingestion/runs", {
      headers: { origin: `http://localhost:${PORT}` },
      data: { target: "daily_quotes" },
    });
    expect(res.status()).toBe(202);
    await expect
      .poll(async () => (await sql("select status, error_message from public.ingestion_runs")).rows[0])
      .toEqual({ status: "failed", error_message: KEY_MISSING });
  });

  test("実行中は対象を変えられない", async ({ page }) => {
    await sql("insert into public.ingestion_runs (target, trigger, status) values ('daily_quotes', 'cron', 'running')");
    await loginAsOwner(page);
    await page.goto("/imports");
    await expect(manualButton(page)).toHaveText("実行中…");
    await expect(page.getByTestId("active-run")).toContainText("実行中: 株価");
    await expect(targetRadio(page, /^銘柄マスタ/)).toBeDisabled();
    await expect(targetRadio(page, /^株価（初出日）/)).toBeDisabled();
  });
});

test.describe("定期実行（銘柄マスタ → 株価）と HEAD（M2）", () => {
  test("正しいシークレットで、銘柄マスタと株価の2つの実行が記録される", async ({ page, request }) => {
    await loginAsOwner(page);
    test.skip(await jquantsConfigured(page), "サーバーの J-Quants のキーが設定済み");
    const res = await request.get("/api/cron/daily", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    test.skip(res.status() === 401, "サーバーの CRON_SECRET が E2E_CRON_SECRET と異なる");
    expect(res.status()).toBe(200);
    expect((await res.json()).data).toEqual({
      runs: [
        { runId: expect.any(Number), target: "stock_master", status: "failed", processedCount: 0 },
        { runId: expect.any(Number), target: "daily_quotes", status: "failed", processedCount: 0 },
      ],
    });
    const { rows } = await sql("select target, trigger, status, error_message from public.ingestion_runs order by started_at, id");
    expect(rows).toEqual([
      { target: "stock_master", trigger: "cron", status: "failed", error_message: KEY_MISSING },
      { target: "daily_quotes", trigger: "cron", status: "failed", error_message: KEY_MISSING },
    ]);
    await page.goto("/imports");
    await expect(page.getByTestId("cron-settings")).toContainText("銘柄マスタ、株価（初出日）");
  });

  test("HEAD はシークレットの有無にかかわらず 405（Allow: GET）で、実行履歴は増えない", async ({ request }) => {
    const cases: Record<string, string>[] = [{ authorization: `Bearer ${CRON_SECRET}` }, {}];
    for (const headers of cases) {
      const res = await request.head("/api/cron/daily", { headers });
      expect(res.status(), JSON.stringify(headers)).toBe(405);
      expect(res.headers()["allow"]).toBe("GET");
    }
    expect((await sql("select count(*)::int as n from public.ingestion_runs")).rows[0].n).toBe(0);
  });
});

test.describe("同一オリジンの確認（M1）とリダイレクト先のホスト（R1）", () => {
  test("127.0.0.1 で開いても手動取り込みとログアウトができ、ホストは変わらない", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: `http://127.0.0.1:${PORT}` });
    const page = await context.newPage();
    const problems = collectPageProblems(page);
    try {
      await page.goto("/login");
      await page.getByLabel("メールアドレス").fill(OWNER.email);
      await page.getByLabel("パスワード").fill(OWNER.password);
      await page.getByRole("button", { name: "ログイン" }).click();
      await expect(page.getByRole("heading", { name: "ダッシュボード", level: 1 })).toBeVisible();
      expect(new URL(page.url()).host).toBe(`127.0.0.1:${PORT}`);

      if (!(await jquantsConfigured(page))) {
        await page.goto("/imports");
        await manualButton(page).click();
        await expect(page.getByTestId("ingestion-result")).toHaveText(`失敗: ${KEY_MISSING}`);
      }

      // 許可の取り消し後に移る /login も同じホスト
      await sql("delete from private.allowed_emails where email = $1", [OWNER.email]);
      await page.goto("/imports");
      await expect(page).toHaveURL(`http://127.0.0.1:${PORT}/login?reason=revoked`);
      const signout = await page.request.get("/auth/signout?reason=revoked", { maxRedirects: 0 });
      expect(signout.headers()["location"]).toMatch(/^\/login/);
      await sql("insert into private.allowed_emails (email) values ($1) on conflict do nothing", [OWNER.email]);

      // ログアウト
      await page.goto("/login");
      await page.getByLabel("メールアドレス").fill(OWNER.email);
      await page.getByLabel("パスワード").fill(OWNER.password);
      await page.getByRole("button", { name: "ログイン" }).click();
      await expect(page.getByRole("heading", { name: "ダッシュボード", level: 1 })).toBeVisible();
      await page.getByRole("button", { name: "アカウントメニュー" }).click();
      await page.getByRole("menuitem", { name: "ログアウト" }).click();
      await expect(page).toHaveURL(`http://127.0.0.1:${PORT}/login`);
      expect(problems).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("Origin が無い・null・別のサイト・ポート違いは 403 cross_origin。ログアウトも同じで、セッションは残る", async ({ page }) => {
    await loginAsOwner(page);
    for (const origin of [undefined, "null", "https://evil.example", `http://localhost:${PORT + 1}`]) {
      const headers: Record<string, string> = origin ? { origin } : {};
      const res = await page.request.post("/api/ingestion/runs", { headers, data: { target: "stock_master" } });
      expect(res.status(), String(origin)).toBe(403);
      expect(await res.json()).toEqual({ error: "cross_origin" });
      const signout = await page.request.post("/auth/signout", { headers });
      expect(signout.status(), String(origin)).toBe(403);
    }
    expect((await sql("select count(*)::int as n from public.ingestion_runs")).rows[0].n).toBe(0);
    expect((await page.request.get("/api/ingestion")).status()).toBe(200);
  });

  test("画面: cross_origin の 403 は「別のサイトからの要求」、forbidden と 401 は「ログインし直してください」", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/imports");
    for (const [status, body, text] of [
      [403, { error: "cross_origin" }, "別のサイトからの要求とみなされました"],
      [403, { error: "forbidden" }, "ログインし直してください"],
      [401, { error: "unauthorized" }, "ログインし直してください"],
    ] as const) {
      await page.route("**/api/ingestion/runs", (route) =>
        route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }),
      );
      await manualButton(page).click();
      const result = page.getByTestId("ingestion-result");
      await expect(result).toContainText(text);
      if (body.error === "cross_origin") await expect(result).not.toContainText("ログインし直してください");
      await page.unroute("**/api/ingestion/runs");
    }
  });
});
