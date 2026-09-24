import { expect, test, type Page } from "@playwright/test";

import {
  collectPageProblems,
  expectNeverShown,
  loginAsOwner,
  logout,
  OWNER,
  simulateServerClockBehind,
  sql,
} from "./support";

const NAV = [
  { label: "ダッシュボード", path: "/", heading: "ダッシュボード" },
  { label: "スクリーニング", path: "/screening", heading: "スクリーニング" },
  { label: "取り込み状況", path: "/imports", heading: "取り込み状況" },
  { label: "設定", path: "/settings", heading: "設定" },
] as const;

const mainNav = (page: Page) => page.getByRole("navigation", { name: "メイン" });

test.describe("ナビゲーション（AC2.1）", () => {
  test("実装済みの4画面だけが並び、押すと移動して現在の画面が示される", async ({ page }) => {
    const problems = collectPageProblems(page);
    await loginAsOwner(page);

    await expect(mainNav(page).getByRole("link")).toHaveText(NAV.map((item) => item.label));
    await expect(page.getByText(/ウォッチリスト|準備中|近日公開/)).toHaveCount(0);

    for (const item of NAV) {
      await mainNav(page).getByRole("link", { name: item.label }).click();
      await expect(page).toHaveURL(item.path);
      await expect(page.getByRole("heading", { level: 1, name: item.heading, exact: true })).toBeVisible();
      await expect(page).toHaveTitle(`${item.heading} | Quantis Light`);
      for (const other of NAV) {
        const link = mainNav(page).getByRole("link", { name: other.label });
        if (other === item) await expect(link).toHaveAttribute("aria-current", "page");
        else await expect(link).not.toHaveAttribute("aria-current");
      }
      // リロードしても同じ項目が現在の画面になる
      await page.reload();
      await expect(mainNav(page).getByRole("link", { name: item.label })).toHaveAttribute("aria-current", "page");
    }
    expect(problems).toEqual([]);
  });

  test("キーボードだけで移動できる", async ({ page }) => {
    await loginAsOwner(page);
    const link = mainNav(page).getByRole("link", { name: "設定" });
    await link.focus();
    await expect(link).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL("/settings");
  });

  test("未実装の画面は 404 のまま", async ({ page }) => {
    await loginAsOwner(page);
    for (const path of ["/watchlist", "/screening/zzz"]) {
      const res = await page.goto(path);
      expect(res?.status()).toBe(404);
      await expect(page.getByRole("heading", { name: "ページが見つかりません" })).toBeVisible();
      await expect(page).toHaveTitle("ページが見つかりません | Quantis Light");
    }
  });

  test("設定画面に、実際のセッションのアカウント情報が表示される", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/settings");
    const account = page.getByRole("region", { name: "アカウント" });
    await expect(account).toContainText(OWNER.email);
    await expect(account).toContainText("許可リストに登録済み");
    await expect(account).toContainText(/最終ログイン\s*\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  });
});

test.describe("テーマ（AC2.4）", () => {
  async function chooseTheme(page: Page, label: string) {
    await page.getByRole("button", { name: /^テーマ/ }).click();
    await page.getByRole("menuitemradio", { name: label }).click();
  }

  test("ダークを選ぶと即座に切り替わり、リロード・別タブ・ログアウト後も保持される", async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: "light" });
    const page = await context.newPage();
    await loginAsOwner(page);

    await chooseTheme(page, "ダーク");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect((await context.cookies()).find((c) => c.name === "theme")?.value).toBe("dark");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("button", { name: "テーマ（現在: ダーク）" })).toBeVisible();

    const other = await context.newPage();
    await other.goto("/settings");
    await expect(other.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(other.getByRole("radio", { name: "ダーク" })).toBeChecked();
    await other.close();

    await logout(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await context.close();
  });

  test("ライトは OS がダークでも保持され、OS に合わせるでは OS の設定に従う", async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: "dark" });
    const page = await context.newPage();
    await loginAsOwner(page);

    await chooseTheme(page, "ライト");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await bodyLightness(page)).toBeGreaterThan(200);

    // 設定画面の3択でも切り替えられ、ヘッダーのボタンと一致する
    await page.goto("/settings");
    await page.getByRole("radio", { name: "OS に合わせる" }).click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
    await expect(page.getByRole("button", { name: "テーマ（現在: OS に合わせる）" })).toBeVisible();
    await page.reload();
    expect(await bodyLightness(page)).toBeLessThan(60);

    await page.emulateMedia({ colorScheme: "light" });
    expect(await bodyLightness(page)).toBeGreaterThan(200);
    await context.close();
  });

  test("サーバーが Cookie のテーマを HTML に出力し、不正な値は出力しない", async ({ request }) => {
    const dark = await request.get("/login", { headers: { cookie: "theme=dark" } });
    expect(await dark.text()).toMatch(/<html[^>]*data-theme="dark"/);
    const invalid = await request.get("/login", { headers: { cookie: "theme=<script>" } });
    const html = await invalid.text();
    expect(html).not.toMatch(/<html[^>]*data-theme=/);
    expect(html).not.toContain("<script>\"");
  });
});

test.describe("狭い画面（AC2.5）", () => {
  test("375px ではドロワーでナビゲーションを使え、横スクロールしない", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await context.newPage();
    const problems = collectPageProblems(page);
    await loginAsOwner(page);

    await expect(mainNav(page)).toBeHidden();
    const menuButton = page.getByRole("button", { name: "メニューを開く" });
    await expect(menuButton).toBeVisible();
    expect(await scrollOverflow(page)).toBeLessThanOrEqual(0);

    await menuButton.click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("link")).toHaveText(NAV.map((item) => item.label));
    await expect(drawer.getByRole("link", { name: "ダッシュボード" })).toHaveAttribute("aria-current", "page");

    await drawer.getByRole("link", { name: "取り込み状況" }).click();
    await expect(page).toHaveURL("/imports");
    await expect(drawer).toBeHidden();

    // Esc でも閉じ、フォーカスはメニューボタンに戻る
    await menuButton.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(menuButton).toBeFocused();

    for (const path of ["/", "/imports", "/settings", "/nope"]) {
      await page.goto(path);
      expect(await scrollOverflow(page), path).toBeLessThanOrEqual(0);
    }

    // テーマボタンとアカウントメニュー（ログアウト）も使える
    await page.getByRole("button", { name: /^テーマ/ }).click();
    await page.getByRole("menuitemradio", { name: "ダーク" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await logout(page);
    expect(problems).toEqual([]);
    await context.close();
  });
});

/**
 * Sprint 1 の B2'（Sprint 2 評価ラウンド1の B1）。例外は「サーバーの時計がブラウザより遅れている」ときに出る。
 * 起動直後の dev サーバーでは時計がずれていないため、ブラウザ側で時計のずれを再現してから操作する。
 */
test.describe("404 からの戻る・進む（Sprint 1 の B2'）", () => {
  test.beforeEach(async ({ context }) => {
    await simulateServerClockBehind(context);
  });

  test("時計がずれていても、404 を直接開いて例外が出ない", async ({ page }) => {
    const problems = collectPageProblems(page);
    await loginAsOwner(page);
    for (const path of ["/nope", "/foo/bar", "/screening/zzz", "/stocks/72030"]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
      await expect(page.getByRole("heading", { name: "ページが見つかりません" })).toBeVisible();
      await expect(page.getByRole("button", { name: "アカウントメニュー" })).toBeVisible();
      await page.waitForTimeout(500);
    }
    // 404 画面の中のクライアントの部品（テーマメニュー）も動く（ハイドレーションが完了している）
    await page.getByRole("button", { name: /^テーマ/ }).click();
    await expect(page.getByRole("menuitemradio", { name: "ダーク" })).toBeVisible();
    await page.keyboard.press("Escape");
    for (const path of ["/", "/imports", "/settings"]) {
      await page.goto(path);
      await page.waitForTimeout(300);
    }
    expect(problems).toEqual([]);
  });

  test("時計がずれていても、許可の取り消し後のクライアント遷移（redirect を投げる）で例外が出ない", async ({ page }) => {
    const problems = collectPageProblems(page);
    await loginAsOwner(page);
    try {
      await sql("delete from private.allowed_emails where email = $1", [OWNER.email]);
      await mainNav(page).getByRole("link", { name: "取り込み状況" }).click();
      // クライアント遷移でも、取り消しの理由付きでログイン画面に着く（Sprint 2 評価の N1）
      await expect(page).toHaveURL("/login?reason=revoked");
      await expect(page.locator("[data-slot=alert]")).toHaveText("このアカウントの利用許可が取り消されました");
      await page.waitForTimeout(1000);
      await expect(page).toHaveURL("/login?reason=revoked");
    } finally {
      await sql("insert into private.allowed_emails (email) values ($1) on conflict do nothing", [OWNER.email]);
    }
    expect(problems).toEqual([]);
  });

  test("404 画面の中のリンク（ナビゲーション・製品名・戻る）で実際に移動できる", async ({ page }) => {
    await loginAsOwner(page);
    const destinations = [
      { click: () => mainNav(page).getByRole("link", { name: "取り込み状況" }).click(), path: "/imports", heading: "取り込み状況" },
      { click: () => mainNav(page).getByRole("link", { name: "設定" }).click(), path: "/settings", heading: "設定" },
      { click: () => page.getByRole("link", { name: "Quantis Light" }).click(), path: "/", heading: "ダッシュボード" },
      { click: () => page.getByRole("link", { name: "ダッシュボードに戻る" }).click(), path: "/", heading: "ダッシュボード" },
    ];
    for (const destination of destinations) {
      await page.goto("/nope");
      await expect(page.getByRole("heading", { name: "ページが見つかりません" })).toBeVisible();
      await destination.click();
      await expect(page).toHaveURL(destination.path);
      await expect(page.getByRole("heading", { level: 1, name: destination.heading, exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "ページが見つかりません" })).toHaveCount(0);
    }
  });

  test("404 → ダッシュボード → ログアウト → 戻る×2 → 進む で例外が出ない（3回）", async ({ page }) => {
    for (let round = 0; round < 3; round++) {
      await page.context().clearCookies();
      const problems = collectPageProblems(page);
      await loginAsOwner(page);

      const res = await page.goto("/nope");
      expect(res?.status()).toBe(404);
      await expect(page.getByRole("heading", { name: "ページが見つかりません" })).toBeVisible();
      await expect(page.getByRole("button", { name: "アカウントメニュー" })).toBeVisible();
      await page.getByRole("link", { name: "ダッシュボードに戻る" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "ダッシュボード" })).toBeVisible();
      await page.getByRole("link", { name: "Quantis Light" }).click();
      await expect(page).toHaveURL("/");
      await logout(page);

      await page.goBack();
      await expectNeverShown(page, OWNER.email, 1000);
      await page.goBack();
      await expectNeverShown(page, OWNER.email, 1000);
      await page.goForward();
      await expectNeverShown(page, OWNER.email, 1500);
      await expect(page).toHaveURL(/\/login/);
      expect(problems, `round ${round + 1}`).toEqual([]);
      page.removeAllListeners("pageerror");
      page.removeAllListeners("console");
    }
  });

  test("404 → ナビゲーションで移動 → ログアウト → 戻る×3 → 進む×2 で例外が出ない", async ({ page }) => {
    const problems = collectPageProblems(page);
    await loginAsOwner(page);

    await page.goto("/nope");
    await expect(page.getByRole("heading", { name: "ページが見つかりません" })).toBeVisible();
    await mainNav(page).getByRole("link", { name: "取り込み状況" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "取り込み状況" })).toBeVisible();
    await mainNav(page).getByRole("link", { name: "設定" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "設定" })).toBeVisible();
    await logout(page);

    for (let i = 0; i < 3; i++) {
      await page.goBack();
      await expectNeverShown(page, OWNER.email, 1000);
    }
    for (let i = 0; i < 2; i++) {
      await page.goForward();
      await expectNeverShown(page, OWNER.email, 1000);
    }
    await expect(page).toHaveURL(/\/login/);
    expect(problems).toEqual([]);
  });
});

async function scrollOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

/** body の背景色の明るさ（0〜255）。 */
async function bodyLightness(page: Page) {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = getComputedStyle(document.body).backgroundColor;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return (r + g + b) / 3;
  });
}

test.describe("許可の取り消し後のナビゲーション（Sprint 2 評価の N1）", () => {
  test.afterEach(async () => {
    await sql("insert into private.allowed_emails (email) values ($1) on conflict do nothing", [OWNER.email]);
  });

  for (const target of ["取り込み状況", "設定"] as const) {
    test(`375px のドロワーから「${target}」へ移動しても、理由付きでログイン画面に着き、Cookie が消える`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
      await simulateServerClockBehind(context);
      const page = await context.newPage();
      const problems = collectPageProblems(page);
      await loginAsOwner(page);
      await sql("delete from private.allowed_emails where email = $1", [OWNER.email]);

      await page.getByRole("button", { name: "メニューを開く" }).click();
      await page.getByRole("dialog").getByRole("link", { name: target }).click();
      await expect(page).toHaveURL("/login?reason=revoked");
      await expect(page.locator("[data-slot=alert]")).toHaveText("このアカウントの利用許可が取り消されました");
      const cookies = await context.cookies();
      expect(cookies.filter((c) => /^sb-.+-auth-token/.test(c.name))).toEqual([]);
      expect(problems).toEqual([]);
      await context.close();
    });
  }

  test("許可されたユーザーが /auth/signout?reason=revoked を開いても、セッションは残り、理由も表示されない", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/auth/signout?reason=revoked");
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { name: "ダッシュボード", level: 1 })).toBeVisible();
  });

  test("未ログイン（セッションの Cookie 無し）で /auth/signout?reason=revoked を開いても、理由は表示されない", async ({ page }) => {
    await page.goto("/auth/signout?reason=revoked");
    await expect(page).toHaveURL("/login");
    await expect(page.locator("[data-slot=alert]")).toHaveCount(0);
  });
});

test.describe("404 のナビゲーション（Sprint 2 評価の N2）", () => {
  test("404 の画面では、配下のパスでも、どの項目にも aria-current が付かない", async ({ page }) => {
    await loginAsOwner(page);
    for (const path of ["/imports/zzz", "/settings/x", "/screening/zzz", "/nope"]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
      await expect(page.getByRole("heading", { name: "ページが見つかりません" })).toBeVisible();
      await expect(mainNav(page).locator("[aria-current]")).toHaveCount(0);
    }
    // 通常の画面では、これまでどおり該当の項目に付く
    for (const item of NAV) {
      await page.goto(item.path);
      await expect(mainNav(page).getByRole("link", { name: item.label })).toHaveAttribute("aria-current", "page");
    }
  });

  test("375px のドロワーの中でも、404 では aria-current が付かない", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await context.newPage();
    await loginAsOwner(page);
    await page.goto("/imports/zzz");
    await page.getByRole("button", { name: "メニューを開く" }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("link", { name: "取り込み状況" })).toBeVisible();
    await expect(drawer.locator("[aria-current]")).toHaveCount(0);
    await context.close();
  });
});
