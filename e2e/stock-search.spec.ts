import { expect, test, type Page } from "@playwright/test";

import { collectPageProblems, expectNoSnapshotsOrWatchlist, loginAsOwner, sql } from "./support";

/**
 * ヘッダーの銘柄の検索（コマンドパレット）と、操作の結果の通知（トースト）・ツールチップ（UI/UX の改善）。
 * 銘柄は 9Q001〜9Q003 をこのファイルで入れて消す（ウォッチリストの行は銘柄の削除で連鎖して消える）。
 * 前提: 比較の基準の記録・ウォッチリストが0件の DB、pnpm seed:users 済み。
 */
test.describe.configure({ mode: "serial" });

const CLEANUP = "delete from public.stocks where code like '9Q%'";

async function openPalette(page: Page) {
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "銘柄を検索" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.beforeAll(async () => {
  await expectNoSnapshotsOrWatchlist();
  await sql(CLEANUP);
  await sql(
    `insert into public.stocks (code, company_name, company_name_en, market_code, market_name, sector33_code, sector33_name, product_category, delisted_on)
     values ('9Q001', 'ケンサク検証電機株式会社', 'KENSAKU DENKI CO.,LTD.', '0111', 'プライム', '3650', '電気機器', '011', null),
            ('9Q002', 'ケンサク検証食品株式会社', null, '0113', 'グロース', '3050', '食料品', '011', null),
            ('9Q003', 'ケンサク検証廃止株式会社', null, '0112', 'スタンダード', '3050', '食料品', '011', '2026-09-01')`,
  );
});

test.afterAll(async () => {
  await sql(CLEANUP);
});

test("⌘K・Ctrl+K で開き、空の間は画面の移動を出す。Esc で閉じて開いたボタンにフォーカスが戻る", async ({ page }) => {
  const problems = collectPageProblems(page);
  await loginAsOwner(page);
  const dialog = await openPalette(page);
  await expect(dialog.getByRole("option")).toHaveText(["ダッシュボード", "スクリーニング", "ウォッチリスト", "取り込み状況", "設定"]);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.getByTestId("stock-search-open").click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("stock-search-open")).toBeFocused();
  expect(problems).toEqual([]);
});

test("ひらがな・英文社名・コードで探せる。上場廃止は最後にラベル付き。Enter で銘柄詳細へ移る", async ({ page }) => {
  await loginAsOwner(page);
  const dialog = await openPalette(page);
  const input = dialog.getByTestId("stock-search-input");
  const items = dialog.getByTestId("stock-search-item");

  await input.fill("けんさく");
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toHaveAttribute("data-code", "9Q001");
  await expect(items.nth(1)).toHaveAttribute("data-code", "9Q002");
  await expect(items.nth(2)).toHaveAttribute("data-code", "9Q003");
  await expect(items.nth(2)).toContainText("上場廃止");

  await input.fill("kensaku denki");
  await expect(items).toHaveCount(1);
  await expect(items.first()).toHaveAttribute("data-code", "9Q001");

  await input.fill("9q002");
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText("ケンサク検証食品株式会社");

  await input.fill("該当しない名前ZZZ");
  await expect(dialog.getByTestId("stock-search-status")).toHaveText("一致する銘柄がありません");

  await input.fill("9Q001");
  await expect(items).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/stocks\/9Q001$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("ケンサク検証電機株式会社");
  await expect(dialog).toBeHidden();
});

test("検索の API は未ログインなら 401、長すぎる入力は 400", async ({ page, request }) => {
  expect((await request.get("/api/stocks/search?q=9Q")).status()).toBe(401);
  await loginAsOwner(page);
  const ok = await page.request.get(`/api/stocks/search?q=${encodeURIComponent("けんさく")}`);
  expect(ok.status()).toBe(200);
  expect(((await ok.json()) as { data: { code: string }[] }).data.map((hit) => hit.code)).toEqual(["9Q001", "9Q002", "9Q003"]);
  expect((await page.request.get(`/api/stocks/search?q=${"a".repeat(51)}`)).status()).toBe(400);
});

test("ウォッチリストの追加は通知で知らせ、「元に戻す」で取り消せる。星のツールチップに状態が出る", async ({ page }) => {
  await loginAsOwner(page);
  await page.goto("/stocks/9Q002");
  const toggle = page.getByTestId("watchlist-toggle");
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("data-state", "off");

  await toggle.hover();
  await expect(page.getByRole("tooltip")).toHaveText("ウォッチリストに追加");

  await toggle.click();
  const toast = page.getByTestId("watchlist-status");
  await expect(toast).toHaveText("『ケンサク検証食品株式会社』をウォッチリストに追加しました");
  await expect(toggle).toHaveAttribute("data-state", "on");
  expect((await sql("select count(*)::int as n from public.watchlist_items where code = '9Q002'")).rows[0].n).toBe(1);

  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect(toast).toHaveText("『ケンサク検証食品株式会社』の追加を取り消しました");
  await expect(toggle).toHaveAttribute("data-state", "off");
  expect((await sql("select count(*)::int as n from public.watchlist_items where code = '9Q002'")).rows[0].n).toBe(0);
});
