import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, request as playwrightRequest, test, type Page } from "@playwright/test";

import { BASE_URL, collectPageProblems, loginAsOwner, logout, simulateServerClockBehind, sql } from "./support";

/**
 * 日次取り込みの信頼性（F11、Sprint 12）。契約 docs/harness/sprints/sprint-12/contract.md の完了条件。
 * 投入例は e2e/fixtures/ingestion-reliability-example.sql（9N001〜9N004、書類 S12NTST1、実行 A〜E）。
 * 鮮度の確認は、投入例を入れずに実行の行だけを入れる（日時は now() からの相対）。
 * 前提: 市場データ・EDINET の書類・実行履歴が0件の DB、pnpm seed:users 済み。キー未設定のサーバー（C1-4 だけ）。
 */
test.describe.configure({ mode: "serial" });

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");
const EXAMPLE_SQL = fixture("ingestion-reliability-example.sql");
const CLEANUP_SQL = fixture("ingestion-reliability-cleanup.sql");
const SCREENING_SQL = fixture("screening-example.sql");
const OWNERSHIP_SQL = fixture("ownership-example.sql");
const OWNERSHIP_CLEANUP_SQL = fixture("ownership-cleanup.sql");

const PAGES = ["/", "/screening", "/imports", "/settings", "/zzz"];
const warning = (page: Page) => page.getByTestId("stale-data-warning");

async function runId(name: string): Promise<number> {
  const { rows } = await sql("select id from public.ingestion_runs where details ->> 'fixture' = 'sprint-12' and details ->> 'run' = $1", [name]);
  return Number(rows[0].id);
}

async function insertFreshnessRun(target: string, status: string, finishedAgo: string, extra: { remaining?: number; unit?: string } = {}) {
  await sql(
    `insert into public.ingestion_runs (target, trigger, status, started_at, finished_at, remaining_count, remaining_unit, details)
     values ($1, 'cron', $2, now() - $3::interval - interval '3 minutes', now() - $3::interval, $4, $5, '{"fixture":"sprint-12"}')`,
    [target, status, finishedAgo, extra.remaining ?? null, extra.unit ?? null],
  );
}

async function jstOfFinished(target: string): Promise<string> {
  const { rows } = await sql(
    `select to_char(max(finished_at) at time zone 'Asia/Tokyo', 'YYYY-MM-DD HH24:MI') as v
       from public.ingestion_runs where target = $1 and status in ('succeeded', 'partial')`,
    [target],
  );
  return rows[0].v;
}

async function keyConfigured(page: Page): Promise<boolean> {
  const res = await page.request.get("/api/ingestion");
  const body = await res.json();
  return body.data.sources.find((source: { id: string }) => source.id === "jquants")?.configured === true;
}

test.beforeEach(async () => {
  await sql(CLEANUP_SQL);
  await sql("delete from public.ingestion_runs");
});

test.afterEach(async () => {
  await sql(CLEANUP_SQL);
  await sql("delete from public.stocks where code like '9999%'");
  await sql(OWNERSHIP_CLEANUP_SQL);
  await sql("delete from public.ingestion_runs");
});

test.describe("実行履歴と実行の詳細（C1・C2・C3）", () => {
  test("実行履歴に一部完了・一部失敗・残り・失敗の件数。見出しは7列のまま（C1-5）", async ({ page }) => {
    await sql(EXAMPLE_SQL);
    // 新しい列の無い過去の partial の行は「一部失敗」のまま
    await sql(`insert into public.ingestion_runs (target, trigger, status, started_at, finished_at, processed_count, details)
               values ('financials', 'manual', 'partial', now() - interval '5 hours', now() - interval '5 hours' + interval '1 minute', 3, '{"fixture":"sprint-12","run":"OLD"}')`);
    await loginAsOwner(page);
    await page.goto("/imports");
    await expect(page.getByTestId("run-table").locator("thead th")).toHaveText(["開始", "終了", "対象", "起動", "結果", "処理件数", "エラー"]);
    const row = async (name: string) => page.getByTestId("run-table").locator("tbody tr").filter({ has: page.locator(`a[href="/imports/runs/${await runId(name)}"]`) });

    const a = await row("A");
    await expect(a.locator("[data-status=partial]")).toHaveAttribute("data-partial-kind", "incomplete");
    await expect(a.locator("[data-status=partial]")).toHaveText("一部完了");
    await expect(a.getByTestId("run-remaining")).toHaveText("残り 3,512 銘柄");
    await expect(a.locator("td").nth(5)).toHaveText("350");
    const b = await row("B");
    await expect(b.locator("[data-status=partial]")).toHaveText("一部失敗");
    await expect(b.getByTestId("run-failed-count")).toHaveText("失敗 2 件");
    const c = await row("C");
    await expect(c.locator("[data-status=partial]")).toHaveText("一部失敗");
    await expect(c.getByTestId("run-remaining")).toHaveText("残り 20 日分");
    await expect(c.getByTestId("run-failed-count")).toHaveText("失敗 1 件");
    const d = await row("D");
    await expect(d.getByTestId("run-remaining")).toHaveText("残り 15 件の書類");
    await expect(d.getByTestId("run-failed-count")).toHaveText("失敗 2 件");
    await expect((await row("E")).locator("[data-status=succeeded]")).toHaveText("成功");
    await expect((await row("OLD")).locator("[data-status=partial]")).toHaveAttribute("data-partial-kind", "failed");

    await page.setViewportSize({ width: 375, height: 812 });
    const card = page.getByTestId("run-list").locator("li").filter({ has: page.locator(`a[href="/imports/runs/${await runId("A")}"]`) });
    await expect(card.locator("[data-status=partial]")).toHaveText("一部完了");
    await expect(card.getByTestId("run-remaining")).toHaveText("残り 3,512 銘柄");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  });

  test("実行の詳細: 失敗した対象・開示日の注記・書類・呼び出しの制限（C2-7・C2-8・C3-7）", async ({ page }) => {
    const problems = collectPageProblems(page);
    await sql(EXAMPLE_SQL);
    await loginAsOwner(page);
    await page.goto("/imports");
    const b = await runId("B");
    await page.getByTestId("run-table").locator(`a[href="/imports/runs/${b}"]`).click();
    await expect(page).toHaveURL(`/imports/runs/${b}`);
    await expect(page.getByRole("heading", { level: 1, name: "実行の詳細" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "メイン" }).getByRole("link", { name: "取り込み状況" })).toHaveAttribute("aria-current", "page");
    const failures = page.getByTestId("run-failures").locator("tbody tr");
    await expect(failures).toHaveCount(2);
    await expect(failures.nth(0)).toContainText("9N001");
    await expect(failures.nth(0)).toContainText("検証用株価失敗一株式会社");
    await expect(failures.nth(0)).toContainText("J-Quants から予期しない応答がありました（HTTP 500）");
    await expect(failures.nth(1)).toContainText("J-Quants に接続できませんでした（タイムアウト）");
    await expect(page.getByTestId("run-overview")).toContainText("一部失敗");
    await failures.nth(0).getByRole("link", { name: "9N001" }).click();
    await expect(page).toHaveURL("/stocks/9N001");

    await page.goto(`/imports/runs/${await runId("C")}`);
    await expect(page.getByTestId("run-failures").locator("tbody tr")).toHaveCount(1);
    await expect(page.getByTestId("run-failures")).toContainText("2026-09-01");
    await expect(page.getByTestId("run-failures-date-note")).toContainText("この日に開示したすべての銘柄の財務が未取得です。次回の取り込みで再試行します");
    await expect(page.getByTestId("run-rate-limit")).toHaveText("呼び出し回数の制限: 4 回（3 回再試行、待機 合計 1分45秒）。解消しなかったため中断しました");
    await expect(page.getByTestId("run-stopped-reason")).toHaveText("呼び出し回数の制限が解消しなかったため");
    await expect(page.getByTestId("run-remaining")).toHaveText("残り 20 日分");

    await page.goto(`/imports/runs/${await runId("D")}`);
    const docRow = page.getByTestId("run-failures").locator("tbody tr[data-item-key='S12NTST1']");
    await expect(docRow).toContainText("書類");
    await expect(docRow).toContainText("9N004");
    await expect(docRow).toContainText("検証用書類失敗株式会社");
    await expect(docRow).toContainText("有価証券報告書");
    await expect(docRow).toContainText("EDINET から書類を取得できませんでした（HTTP 404）");
    await expect(page.getByTestId("run-failures").locator("tbody tr[data-item-key='2026-09-20']")).toContainText("書類一覧の日");
    const scroll = await page.getByTestId("run-failures").evaluate((el) => ({ sw: el.parentElement!.scrollWidth, cw: el.parentElement!.clientWidth }));
    expect(scroll.sw).toBeLessThanOrEqual(scroll.cw);

    await page.goto(`/imports/runs/${await runId("E")}`);
    await expect(page.getByTestId("run-failures-empty")).toHaveText("失敗した対象はありません");
    await page.goto(`/imports/runs/${await runId("A")}`);
    await expect(page.getByTestId("run-rate-limit")).toHaveText("呼び出し回数の制限には当たっていません");
    await expect(page.getByTestId("run-api-calls")).toContainText("API の呼び出し 362 回");
    await expect(page.getByTestId("run-stopped-reason")).toHaveText("時間の上限（210 秒）に達したため");

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/imports/runs/${await runId("D")}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    expect(problems).toEqual([]);
  });

  test("API（C2-9）と 404（C2-10）", async ({ page }) => {
    await sql(EXAMPLE_SQL);
    const b = await runId("B");
    const anonymous = await playwrightRequest.newContext({ baseURL: BASE_URL });
    const unauth = await anonymous.get(`/api/ingestion/runs/${b}`);
    expect(unauth.status()).toBe(401);
    expect(unauth.headers()["cache-control"]).toContain("no-store");
    await anonymous.dispose();

    await loginAsOwner(page);
    const res = await page.request.get(`/api/ingestion/runs/${b}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toContain("no-store");
    const body = await res.json();
    expect(body.data.run).toMatchObject({ id: b, target: "daily_quotes", status: "partial", failedCount: 2, partialKind: "failed", apiCalls: 124 });
    expect(body.data.failures).toEqual([
      { itemType: "stock", itemKey: "9N001", code: "9N001", companyName: "検証用株価失敗一株式会社", reason: "http_error", httpStatus: 500, message: "J-Quants から予期しない応答がありました（HTTP 500）" },
      { itemType: "stock", itemKey: "9N002", code: "9N002", companyName: "検証用株価失敗二株式会社", reason: "unreachable", httpStatus: null, message: "J-Quants に接続できませんでした（タイムアウト）" },
    ]);
    expect(body.data.failuresOmitted).toBe(0);
    for (const bad of ["abc", "0"]) {
      const r = await page.request.get(`/api/ingestion/runs/${bad}`);
      expect(r.status()).toBe(400);
      expect(await r.json()).toEqual({ error: "invalid_id" });
    }
    const missing = await page.request.get("/api/ingestion/runs/999999");
    expect(missing.status()).toBe(404);
    expect(await missing.json()).toEqual({ error: "not_found" });

    for (const path of ["/imports/runs/999999", "/imports/runs/abc", "/imports/runs/01"]) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { level: 1, name: "実行が見つかりません" })).toBeVisible();
      await expect(page.getByRole("link", { name: "取り込み状況に戻る" })).toHaveAttribute("href", "/imports");
      await expect(page.getByRole("banner")).toBeVisible();
    }
    await logout(page);
    await page.goto(`/imports/runs/${b}`);
    await expect(page).toHaveURL(new RegExp(`/login\\?next=%2Fimports%2Fruns%2F${b}`));
  });

  test("応答の無い実行の後片付け: 保存済みがあれば一部完了、0件なら旧い文言の失敗（C1-4）", async ({ page }) => {
    await loginAsOwner(page);
    test.skip(await keyConfigured(page), "サーバーの J-Quants のキーが設定済み");
    const { rows } = await sql(
      `insert into public.ingestion_runs (target, trigger, status, started_at, processed_count, last_progress_at)
       values ('daily_quotes', 'cron', 'running', now() - interval '16 minutes', 120, now() - interval '14 minutes') returning id, last_progress_at`,
    );
    const staleId = Number(rows[0].id);
    await page.goto("/imports");
    await page.getByRole("button", { name: "今すぐ取り込み" }).click();
    await expect(page.getByTestId("ingestion-result")).toContainText("失敗");
    const { rows: after } = await sql("select status, stopped_reason, error_message, last_progress_at from public.ingestion_runs where id = $1", [staleId]);
    expect(after[0]).toMatchObject({
      status: "partial",
      stopped_reason: "stale",
      error_message: "応答が無くなったため中断されたものとみなしました（15 分以上）。保存済みの分は残っています。残りは次回の取り込みで処理します",
    });
    expect(after[0].last_progress_at.toISOString()).toBe(rows[0].last_progress_at.toISOString());
    await page.reload();
    const staleRow = page.getByTestId("run-table").locator("tbody tr").filter({ has: page.locator(`a[href="/imports/runs/${staleId}"]`) });
    await expect(staleRow.locator("[data-status=partial]")).toHaveText("一部完了");
    await expect(staleRow).toContainText("応答が無くなったため中断されたものとみなしました");

    await sql("delete from public.ingestion_runs");
    const { rows: zero } = await sql(
      "insert into public.ingestion_runs (target, trigger, status, started_at) values ('financials', 'cron', 'running', now() - interval '16 minutes') returning id",
    );
    await page.goto("/imports");
    await page.getByRole("button", { name: "今すぐ取り込み" }).click();
    await expect(page.getByTestId("ingestion-result")).toContainText("失敗");
    const { rows: zeroAfter } = await sql("select status, stopped_reason, error_message from public.ingestion_runs where id = $1", [zero[0].id]);
    expect(zeroAfter[0]).toEqual({ status: "failed", stopped_reason: null, error_message: "15 分以上応答が無かったため、中断されたものとみなしました" });
  });
});

test.describe("データの鮮度の警告（C4）", () => {
  test("実行が0件なら出ない。47:59 は出ず、48 時間で全画面に出る。ログイン画面には出ない（C4-1・C4-2）", async ({ page }) => {
    await sql("insert into public.stocks (code, company_name, product_category) values ('9N001', '検証用鮮度株式会社', '011')");
    await loginAsOwner(page);
    for (const path of PAGES) {
      await page.goto(path);
      await expect(page.getByRole("banner")).toBeVisible();
      await expect(warning(page)).toHaveCount(0);
    }
    await insertFreshnessRun("daily_quotes", "succeeded", "47 hours 59 minutes");
    await page.goto("/screening");
    await expect(page.getByRole("heading", { level: 1, name: "スクリーニング" })).toBeVisible();
    await expect(warning(page)).toHaveCount(0);

    await sql("update public.ingestion_runs set finished_at = now() - interval '48 hours', started_at = now() - interval '48 hours 3 minutes'");
    const jst = await jstOfFinished("daily_quotes");
    for (const path of [...PAGES, "/stocks/9N001"]) {
      await page.goto(path);
      await expect(warning(page)).toBeVisible();
      await expect(page.getByTestId("stale-data-warning-latest")).toHaveText(`データが古くなっています（最終更新: ${jst}）`);
      await expect(page.getByTestId("stale-data-target")).toHaveCount(1);
      await expect(page.getByTestId("stale-data-target")).toHaveAttribute("data-target", "daily_quotes");
      await expect(page.getByTestId("stale-data-target")).toContainText("株価（初出日）");
    }
    await logout(page);
    await expect(warning(page)).toHaveCount(0);
  });

  test("partial は更新とみなし、failed はみなさない（C4-3）", async ({ page }) => {
    await insertFreshnessRun("daily_quotes", "succeeded", "50 hours");
    await insertFreshnessRun("daily_quotes", "failed", "1 hour");
    await loginAsOwner(page);
    await expect(warning(page)).toBeVisible();
    await insertFreshnessRun("daily_quotes", "partial", "1 hour");
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "ダッシュボード" })).toBeVisible();
    await expect(warning(page)).toHaveCount(0);
  });

  test("複数の target: 最も古い日時と、古い target ごとの内訳。リンクと API（C4-4〜C4-6・C4-8）", async ({ page }) => {
    await insertFreshnessRun("stock_master", "succeeded", "1 hour");
    await insertFreshnessRun("financials", "succeeded", "50 hours");
    await insertFreshnessRun("edinet_reports", "partial", "72 hours");
    const edinet = await jstOfFinished("edinet_reports");
    const financials = await jstOfFinished("financials");
    await loginAsOwner(page);
    await expect(page.getByTestId("stale-data-warning-latest")).toHaveText(`データが古くなっています（最終更新: ${edinet}）`);
    const targets = page.getByTestId("stale-data-target");
    await expect(targets).toHaveCount(2);
    await expect(targets.nth(0)).toHaveAttribute("data-target", "financials");
    await expect(targets.nth(0)).toContainText(financials);
    await expect(targets.nth(1)).toHaveAttribute("data-target", "edinet_reports");
    await expect(targets.nth(1)).toContainText(edinet);
    // 1280 幅で3行以内（1行目 20px＋内訳 16px×2＋余白）
    expect((await warning(page).boundingBox())!.height).toBeLessThanOrEqual(3 * 20 + 16 + 8);

    const api = await (await page.request.get("/api/dashboard")).json();
    expect(api.data.freshness.stale).toBe(true);
    expect(api.data.freshness.targets.filter((t: { stale: boolean }) => t.stale).map((t: { target: string }) => t.target)).toEqual(["financials", "edinet_reports"]);

    await warning(page).getByRole("link", { name: "実行履歴を確認" }).click();
    await expect(page).toHaveURL("/imports#history");

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/screening");
    await expect(warning(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    expect((await warning(page).boundingBox())!.height).toBeLessThanOrEqual(4 * 20 + 16 + 8);

    // 4 target すべてが古いときも、375px では内訳を折りたたむ（R4・レビューの注意3）
    await insertFreshnessRun("daily_quotes", "succeeded", "60 hours");
    await sql("update public.ingestion_runs set finished_at = now() - interval '49 hours', started_at = now() - interval '49 hours 3 minutes' where target = 'stock_master'");
    await page.reload();
    await expect(page.getByTestId("stale-data-details")).not.toHaveAttribute("open", "");
    expect((await warning(page).boundingBox())!.height).toBeLessThanOrEqual(4 * 20 + 16 + 8);
    await page.getByText(/^内訳（4 件）$/).click();
    await expect(page.getByTestId("stale-data-target").filter({ visible: true })).toHaveCount(4);
  });
});

test.describe("取り込み中の検索（C5）", () => {
  test("実行中の注記がスクリーニングと詳細に出る。応答なし・終了済みでは出ない（C5-2・C5-3）", async ({ page }) => {
    await sql(SCREENING_SQL);
    await sql("delete from public.ingestion_runs where target <> 'daily_quotes'");
    await sql("insert into public.ingestion_runs (target, trigger, status, started_at) values ('financials', 'cron', 'running', now() - interval '2 minutes')");
    await loginAsOwner(page);
    for (const path of ["/screening", "/stocks/99990"]) {
      await page.goto(path);
      await expect(page.getByTestId("ingestion-running-note")).toContainText(/^取り込みを実行中です（財務・\d{2}:\d{2} 開始）/);
      await expect(page.getByTestId("ingestion-running-note")).toContainText("1つの銘柄の値が途中まで更新された状態で表示されることはありません");
    }
    await page.goto("/screening");
    await page.getByRole("textbox", { name: "売上CAGR の閾値（%）" }).fill("15");
    await expect(page).toHaveURL(/cagr=15/);
    await expect(page.getByTestId("result-count")).toBeVisible();

    await sql("update public.ingestion_runs set started_at = now() - interval '16 minutes' where status = 'running'");
    await page.goto("/screening");
    await expect(page.getByRole("heading", { level: 1, name: "スクリーニング" })).toBeVisible();
    await expect(page.getByTestId("ingestion-running-note")).toHaveCount(0);
    await sql("delete from public.ingestion_runs where status = 'running'");
    await page.goto("/stocks/99990");
    await expect(page.getByTestId("stock-header")).toBeVisible();
    await expect(page.getByTestId("ingestion-running-note")).toHaveCount(0);
  });

  test("未取得の残り: 最新の実行の残り（C5-4〜C5-6）", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/screening");
    await expect(page.getByRole("heading", { level: 1, name: "スクリーニング" })).toBeVisible();
    await expect(page.getByTestId("ingestion-remaining-note")).toHaveCount(0);

    await sql(EXAMPLE_SQL);
    await page.goto("/screening");
    const note = page.getByTestId("ingestion-remaining-note");
    await expect(note).toHaveText("未取得の残りがあります（財務 20 日分・EDINET 15 件の書類）。残りは次回以降の取り込みで処理します。");
    const api = await (await page.request.get("/api/dashboard")).json();
    expect(api.data.freshness.targets.find((t: { target: string }) => t.target === "financials")).toMatchObject({ remainingCount: 20, remainingUnit: "disclosure_dates" });

    await sql(`insert into public.ingestion_runs (target, trigger, status, started_at, finished_at, remaining_count, remaining_unit, stopped_reason, processed_count, details)
               values ('daily_quotes', 'cron', 'partial', now() - interval '13 minutes', now() - interval '10 minutes', 3000, 'stocks', 'time_budget', 10, '{"fixture":"sprint-12"}')`);
    await page.reload();
    await expect(note).toContainText("未取得の残りがあります（株価 3,000 銘柄・財務 20 日分・EDINET 15 件の書類）");
    await sql(`insert into public.ingestion_runs (target, trigger, status, started_at, finished_at, remaining_count, remaining_unit, details)
               values ('daily_quotes', 'cron', 'succeeded', now() - interval '8 minutes', now() - interval '5 minutes', 0, 'stocks', '{"fixture":"sprint-12"}')`);
    await page.reload();
    await expect(note).toContainText("未取得の残りがあります（財務 20 日分・EDINET 15 件の書類）");
    // 保存0件で残りの無い failed は判定に使わない（レビューの注意1）
    await sql(`insert into public.ingestion_runs (target, trigger, status, started_at, finished_at, details)
               values ('financials', 'cron', 'failed', now() - interval '3 minutes', now() - interval '2 minutes', '{"fixture":"sprint-12"}')`);
    await page.reload();
    await expect(note).toContainText("財務 20 日分");
  });
});

test.describe("上場廃止（C6）", () => {
  test("スクリーニングに出ず、詳細に上場廃止。ダッシュボードに数。戻すと現れる（C6-6〜C6-9）", async ({ page }) => {
    await sql(EXAMPLE_SQL);
    await loginAsOwner(page);
    await page.goto("/screening?off=cagr,margin,years,owner");
    const codes = () => page.getByTestId("results-scroll").locator("tbody tr").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-code")));
    await expect.poll(codes).toEqual(["9N001", "9N002", "9N004"]);
    await expect(page.getByTestId("delisted-excluded-note")).toHaveText("上場廃止の 1 銘柄は検索の対象外です");
    await expect(page.getByTestId("result-summary")).toContainText("銘柄マスタ 3 銘柄中");
    await page.goto("/screening?off=cagr,margin,years,owner&unavailable=include&undeterminable=include");
    await expect.poll(codes).toEqual(["9N001", "9N002", "9N004"]);
    const api = await (await page.request.get("/api/screening?off=cagr,margin,years,owner")).json();
    expect(api.data.rows.map((r: { code: string }) => r.code)).toEqual(["9N001", "9N002", "9N004"]);
    expect(api.data).toMatchObject({ delistedCount: 1, stockCount: 3 });

    await page.goto("/stocks/9N003");
    await expect(page.getByTestId("delisted-badge")).toHaveText("上場廃止");
    await expect(page.getByTestId("delisted-note")).toHaveText("2026-09-18 の銘柄マスタで確認");
    await expect(page.getByTestId("evaluation-inclusion")).toHaveAttribute("data-included", "false");
    await expect(page.getByTestId("evaluation-inclusion")).toHaveAttribute("data-reason", "delisted");
    await expect(page.getByTestId("evaluation-inclusion")).toContainText("含まれない（上場廃止）");
    await page.goto("/stocks/9N003?off=cagr,margin,years,owner");
    await expect(page.getByTestId("evaluation-inclusion")).toContainText("含まれない（上場廃止）");
    const detail = await (await page.request.get("/api/stocks/9N003")).json();
    expect(detail.data.stock.delisted_on).toBe("2026-09-18");
    expect(detail.data.evaluation).toMatchObject({ delisted: true, included: false });
    const listed = await (await page.request.get("/api/stocks/9N001")).json();
    expect(listed.data.evaluation.delisted).toBe(false);
    await page.goto("/stocks/9N001");
    await expect(page.getByTestId("stock-header")).toBeVisible();
    await expect(page.getByTestId("delisted-badge")).toHaveCount(0);

    await page.goto("/");
    await expect(page.getByTestId("dashboard-delisted-count")).toContainText("ほかに上場廃止 1 銘柄"); // Sprint 14: 分母を上場中にそろえた（契約の C11-1 の種類3）
    expect((await (await page.request.get("/api/dashboard")).json()).data.delistedCount).toBe(1);

    await sql("update public.stocks set delisted_on = null where code = '9N003'");
    await page.goto("/screening?off=cagr,margin,years,owner");
    await expect.poll(codes).toEqual(["9N001", "9N002", "9N003", "9N004"]);
    await expect(page.getByTestId("delisted-excluded-note")).toHaveCount(0);
    await page.goto("/stocks/9N003");
    await expect(page.getByTestId("stock-header")).toBeVisible();
    await expect(page.getByTestId("delisted-badge")).toHaveCount(0);
    await page.goto("/");
    await expect(page.getByTestId("stat-stocks")).toBeVisible();
    await expect(page.getByTestId("dashboard-delisted-count")).toHaveCount(0);
  });
});

test.describe("持ち越し（C8-1・C8-2）", () => {
  test("m2: 条件④がオフのとき、④ の印の title に「（手動補正）」を付けない", async ({ page }) => {
    await sql(OWNERSHIP_SQL);
    await loginAsOwner(page);
    const put = await page.request.put("/api/stocks/9U003/ownership-override", {
      data: { verdict: "owner_company", memo: "E2E（Sprint 12 の m2）" },
      headers: { origin: BASE_URL },
    });
    expect(put.status()).toBe(200);
    const mark = page.getByTestId("results-scroll").locator("tbody tr[data-code='9U003']").getByTestId("condition-status-owner");
    await page.goto("/screening");
    await expect(mark).toHaveAttribute("title", /（手動補正）$/);
    await page.goto("/screening?off=owner");
    await expect(mark).toHaveAttribute("data-status", "off");
    await expect(mark).not.toHaveAttribute("title", /手動補正/);
  });

  test("m3: 保存の後は「編集」、取り消しの後は「判定を手動で補正する」にフォーカスが移る", async ({ page }) => {
    await sql(OWNERSHIP_SQL);
    await loginAsOwner(page);
    await page.goto("/stocks/9U003");
    await page.getByTestId("owner-override-open").click();
    await page.getByTestId("owner-override-verdict-owner_company").click();
    await page.getByTestId("owner-override-memo").fill("フォーカスの確認");
    await page.getByTestId("owner-override-save").click();
    await expect(page.getByTestId("owner-override")).toHaveAttribute("data-state", "saved");
    await expect(page.getByTestId("owner-override-edit")).toBeFocused();

    await page.getByTestId("owner-override-delete").click();
    await page.getByTestId("owner-override-delete-confirm").click();
    await expect(page.getByTestId("owner-override")).toHaveAttribute("data-state", "none");
    await expect(page.getByTestId("owner-override-open")).toBeFocused();
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");
  });
});

test.describe("時計のずれ（C9-2）", () => {
  test("サーバーの時計が遅れていても、実行の詳細・404・上場廃止の詳細・警告のある画面でエラーが出ない", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await simulateServerClockBehind(context);
    const page = await context.newPage();
    const problems = collectPageProblems(page);
    await sql(EXAMPLE_SQL);
    await insertFreshnessRun("financials", "succeeded", "3 days");
    await sql("delete from public.ingestion_runs where target = 'financials' and details ->> 'run' = 'C'");
    await loginAsOwner(page);
    const b = await runId("B");
    await page.goto("/imports");
    await page.getByTestId("run-table").locator(`a[href="/imports/runs/${b}"]`).click();
    await expect(page.getByTestId("run-failures")).toBeVisible();
    await page.goto("/imports/runs/999999");
    await expect(page.getByRole("heading", { level: 1, name: "実行が見つかりません" })).toBeVisible();
    await page.getByRole("link", { name: "取り込み状況に戻る" }).click();
    await expect(page).toHaveURL("/imports");
    await page.goto("/stocks/9N003");
    await expect(page.getByTestId("delisted-badge")).toBeVisible();
    await page.goto("/screening");
    await expect(warning(page)).toBeVisible();
    await page.waitForTimeout(500);
    expect(problems).toEqual([]);
    await context.close();
  });
});
