import { expect, test } from "@playwright/test";

import { expectFooter, expectNeverShown, INTRUDER, login, OWNER, sql, TEST_STOCK } from "./support";

test.describe("未ログイン", () => {
  for (const path of ["/", "/screening", "/stocks/72030", "/imports", "/settings", "/foo/bar", "/stocks/72030.png"]) {
    test(`${path} はログイン画面へリダイレクトされる`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login(\?|$)/);
      if (path !== "/") expect(new URL(page.url()).searchParams.get("next")).toBe(path);
      await expect(page.getByRole("heading", { name: "ログイン" })).toBeVisible();
    });
  }

  test("ログイン画面に新規登録の導線が無く、フッターに出典と注記がある", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText(/新規登録|アカウント作成|サインアップ/)).toHaveCount(0);
    await expectFooter(page);
  });

  test("データ取得エンドポイントは 401 を返し、データを含まない", async ({ request }) => {
    for (const path of ["/api/stocks", "/api/stocks.json", "/api/foo"]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
  });
});

test.describe("ログイン", () => {
  test("許可ユーザーはダッシュボードに入れ、リロード後もログイン状態が続く", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => msg.type() === "error" && consoleErrors.push(msg.text()));

    await login(page, OWNER.email, OWNER.password);
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { name: "ダッシュボード" })).toBeVisible();
    await expect(page.getByRole("button", { name: "アカウントメニュー" })).toContainText(OWNER.email);
    await expectFooter(page);

    await page.reload();
    await expect(page.getByRole("heading", { name: "ダッシュボード" })).toBeVisible();

    await page.goto("/login");
    await expect(page).toHaveURL("/");
    expect(consoleErrors).toEqual([]);
  });

  test("大文字や前後の空白を含むメールアドレスでもログインできる", async ({ page }) => {
    await login(page, "  OWNER@Quantis.Local ", OWNER.password);
    await expect(page.getByRole("heading", { name: "ダッシュボード" })).toBeVisible();
  });

  test("ログイン後は next のパスへ戻る（404 画面もアプリのレイアウト内）", async ({ page }) => {
    await page.goto("/stocks/72030");
    await expect(page).toHaveURL("/login?next=%2Fstocks%2F72030");
    await page.getByLabel("メールアドレス").fill(OWNER.email);
    await page.getByLabel("パスワード").fill(OWNER.password);
    await page.getByRole("button", { name: "ログイン" }).click();
    await expect(page).toHaveURL("/stocks/72030");
    await expect(page.getByRole("heading", { name: "ページが見つかりません" })).toBeVisible();
    await expect(page.getByRole("button", { name: "アカウントメニュー" })).toBeVisible();
    await expectFooter(page);
  });

  test("ログイン後の 404 画面を直接開いてもコンソールエラーや例外が出ない", async ({ page }) => {
    await login(page, OWNER.email, OWNER.password);
    await expect(page.getByRole("heading", { name: "ダッシュボード" })).toBeVisible();
    const problems: string[] = [];
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      // 404 ステータスのリソース読み込みエラーは想定どおり
      if (m.type() === "error" && !m.text().includes("404")) problems.push(m.text());
    });
    await page.goto("/foo");
    await expect(page.getByRole("heading", { name: "ページが見つかりません" })).toBeVisible();
    await page.waitForTimeout(1000);
    expect(problems).toEqual([]);
  });

  test("無効になったセッションの Cookie は、画面を開いたときに削除される", async ({ page, browser }) => {
    await login(page, OWNER.email, OWNER.password);
    await expect(page.getByRole("heading", { name: "ダッシュボード" })).toBeVisible();
    const stale = (await page.context().cookies()).filter((c) => /^sb-.+-auth-token/.test(c.name));
    // 別のブラウザでは同じセッションを破棄する
    const res = await page.request.post("/auth/signout", { headers: { origin: "http://localhost:3000" } });
    expect(res.status()).toBe(204);

    const other = await browser.newContext();
    await other.addCookies(stale);
    const otherPage = await other.newPage();
    await otherPage.goto("/");
    await expect(otherPage).toHaveURL(/\/login$/);
    expect((await other.cookies()).filter((c) => /^sb-.+-auth-token/.test(c.name))).toEqual([]);
    await other.close();
  });

  for (const query of [
    "next=https%3A%2F%2Fexample.com",
    "next=%2F%2Fexample.com",
    "next=%2F%5Cexample.com",
    "next=%252F%255Cexample.com",
    "next=/%09/example.com",
    "next=%2F%0A%2Fexample.com",
    "next=https%3Aexample.com",
    "next=javascript%3Aalert(1)",
  ]) {
    test(`外部への next（${query}）では / に遷移する`, async ({ page }) => {
      await login(page, OWNER.email, OWNER.password, `/login?${query}`);
      await expect(page.getByRole("heading", { name: "ダッシュボード" })).toBeVisible();
      const url = new URL(page.url());
      expect(url.origin).toBe("http://localhost:3000");
      expect(url.pathname).toBe("/");
    });
  }

  test("パスワードが違うと日本語のエラーが出て、ログインできない", async ({ page }) => {
    await login(page, OWNER.email, "wrong-password");
    await expect(page.locator("[data-slot=alert]")).toHaveText("メールアドレスまたはパスワードが正しくありません");
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
  });

  test("未入力・形式不正は日本語の入力エラー", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "ログイン" }).click();
    await expect(page.getByText("メールアドレスを入力してください")).toBeVisible();
    await expect(page.getByText("パスワードを入力してください")).toBeVisible();
    await page.getByLabel("メールアドレス").fill("not-an-email");
    await page.getByLabel("パスワード").fill("x");
    await page.getByRole("button", { name: "ログイン" }).click();
    await expect(page.getByText("メールアドレスの形式が正しくありません")).toBeVisible();
  });

  test("許可リスト外（アカウント無し／あり）は拒否される", async ({ page }) => {
    await login(page, "stranger@example.com", "whatever-password");
    await expect(page.locator("[data-slot=alert]")).toHaveText("このメールアドレスは利用が許可されていません");

    await login(page, INTRUDER.email, INTRUDER.password);
    await expect(page.locator("[data-slot=alert]")).toHaveText("このメールアドレスは利用が許可されていません");
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("ログアウト", () => {
  async function logout(page: import("@playwright/test").Page) {
    await page.getByRole("button", { name: "アカウントメニュー" }).click();
    await page.getByRole("menuitem", { name: "ログアウト" }).click();
    await expect(page).toHaveURL("/login");
  }

  test("404 画面を直接開き、リンクで戻ってからログアウトしても、戻る操作で保護画面が表示されない", async ({
    page,
    context,
  }) => {
    await login(page, OWNER.email, OWNER.password);
    await expect(page.getByRole("heading", { name: "ダッシュボード" })).toBeVisible();

    // 評価ラウンド1の B1 の再現手順
    await page.goto("/foo");
    await expect(page.getByRole("heading", { name: "ページが見つかりません" })).toBeVisible();
    await page.getByRole("link", { name: "ダッシュボードに戻る" }).click();
    await expect(page.getByRole("heading", { name: "ダッシュボード" })).toBeVisible();

    await logout(page);
    const cookies = await context.cookies();
    expect(cookies.filter((c) => /^sb-.+-auth-token/.test(c.name))).toEqual([]);

    await page.goBack();
    await expectNeverShown(page, OWNER.email);
    await expect(page).toHaveURL(/\/login/);

    await page.goBack();
    await expectNeverShown(page, OWNER.email);
    await expect(page).toHaveURL(/\/login/);

    const res = await page.request.get("/api/stocks");
    expect(res.status()).toBe(401);
  });

  test("ダッシュボードを読み込んだ後、別の画面からログアウトしても、戻る操作でダッシュボードが表示されない", async ({
    page,
  }) => {
    await login(page, OWNER.email, OWNER.password);
    await expect(page.getByRole("heading", { name: "ダッシュボード" })).toBeVisible();
    await page.goto("/"); // ダッシュボードをドキュメントとして読み込み、ブラウザのキャッシュに載せる
    await expect(page.getByRole("heading", { name: "ダッシュボード" })).toBeVisible();
    await page.goto("/stocks/72030");
    await expect(page.getByRole("heading", { name: "ページが見つかりません" })).toBeVisible();
    await logout(page);

    await page.goBack();
    await expectNeverShown(page, OWNER.email);
    await expect(page).toHaveURL(/\/login/);
  });

  test("外部サイトからの GET /auth/signout では、許可ユーザーのセッションを破棄しない", async ({ page }) => {
    await login(page, OWNER.email, OWNER.password);
    await expect(page.getByRole("heading", { name: "ダッシュボード" })).toBeVisible();
    await page.goto("/auth/signout");
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { name: "ダッシュボード" })).toBeVisible();

    const res = await page.request.post("/auth/signout", { headers: { origin: "https://evil.example" } });
    expect(res.status()).toBe(403);
    await page.reload();
    await expect(page.getByRole("heading", { name: "ダッシュボード" })).toBeVisible();
  });
});

test.describe("データの保護", () => {
  test.beforeEach(async () => {
    await sql(
      `insert into public.stocks (code, company_name, market_name, sector33_name) values ($1, $2, $3, $4)
       on conflict (code) do nothing`,
      [TEST_STOCK.code, TEST_STOCK.company_name, TEST_STOCK.market_name, TEST_STOCK.sector33_name],
    );
  });

  test.afterEach(async () => {
    await sql("delete from public.stocks where code = $1", [TEST_STOCK.code]);
    await sql("insert into private.allowed_emails (email) values ($1) on conflict do nothing", [OWNER.email]);
  });

  test("許可ユーザーは /api/stocks で RLS 経由の銘柄を読める", async ({ page }) => {
    await login(page, OWNER.email, OWNER.password);
    await expect(page.getByRole("heading", { name: "ダッシュボード" })).toBeVisible();
    const res = await page.request.get("/api/stocks");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual(expect.arrayContaining([expect.objectContaining(TEST_STOCK)]));
  });

  test("ログイン中に許可を取り消すと、API は 403、画面はサインアウトしてループしない", async ({ page, context }) => {
    await login(page, OWNER.email, OWNER.password);
    await expect(page.getByRole("heading", { name: "ダッシュボード" })).toBeVisible();

    await sql("delete from private.allowed_emails where email = $1", [OWNER.email]);

    const res = await page.request.get("/api/stocks");
    expect(res.status()).toBe(403);
    expect(await res.text()).not.toContain(TEST_STOCK.code);

    await page.goto("/");
    await expect(page).toHaveURL("/login?reason=revoked");
    await expect(page.locator("[data-slot=alert]")).toHaveText("このアカウントの利用許可が取り消されました");
    const cookies = await context.cookies();
    expect(cookies.filter((c) => /^sb-.+-auth-token/.test(c.name))).toEqual([]);
  });
});

test.describe("表示", () => {
  test("ダークモードではダーク配色で表示される", async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: "dark" });
    const page = await context.newPage();
    await page.goto("/login");
    const [r, g, b] = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = getComputedStyle(document.body).backgroundColor;
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data);
    });
    expect((r + g + b) / 3).toBeLessThan(60);
    await context.close();
  });

  test("375px 幅でも横スクロールせず、フッターが読める", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 740 } });
    const page = await context.newPage();
    await page.goto("/login");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expectFooter(page);
    await context.close();
  });
});
