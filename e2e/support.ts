import { expect, type Page } from "@playwright/test";
import { Client } from "pg";

export const OWNER = { email: "owner@quantis.local", password: "Quantis-Owner-2026!" };
export const INTRUDER = { email: "intruder@quantis.local", password: "Quantis-Intruder-2026!" };
export const TEST_STOCK = {
  code: "99991",
  company_name: "E2E検証用銘柄株式会社",
  market_name: "グロース",
  sector33_name: "情報・通信業",
};

const DB_URL = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/** ローカル DB に対して SQL を実行する（テストの前準備と後片付けのみ）。 */
export async function sql(text: string, values: unknown[] = []) {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    return await client.query(text, values);
  } finally {
    await client.end();
  }
}

export async function login(page: Page, email: string, password: string, path = "/login") {
  await page.goto(path);
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill(password);
  await page.getByRole("button", { name: "ログイン" }).click();
}

export async function expectFooter(page: Page) {
  const footer = page.locator("footer");
  await expect(footer).toContainText("データ出典: J-Quants API（日本取引所グループ）／EDINET（金融庁）");
  await expect(footer).toContainText("本アプリは情報提供を目的とした個人用ツールであり、投資助言ではありません。");
}

/**
 * 一定時間、画面にテキストが一度も現れないことを確かめる（キャッシュからの復元や再読み込みが
 * 落ち着くまで観測する）。観測中に表示された URL の一覧を返す。
 */
export async function expectNeverShown(page: Page, text: string, durationMs = 2000, intervalMs = 100) {
  const seen: string[] = [];
  const deadline = Date.now() + durationMs;
  while (Date.now() < deadline) {
    try {
      const visible = await page.evaluate((t) => document.body?.innerText.includes(t) ?? false, text);
      if (visible) seen.push(page.url());
    } catch {
      // ナビゲーション中は評価できないことがある
    }
    await page.waitForTimeout(intervalMs);
  }
  expect(seen, `"${text}" が表示された URL`).toEqual([]);
}
