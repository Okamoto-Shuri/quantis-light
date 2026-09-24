import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { Client } from "pg";

import { BASE_URL, collectPageProblems, CRON_SECRET, DB_URL, insertRun, jstOfRun, loginAsOwner, sql } from "./support";

/**
 * 取り込み基盤（F3、Sprint 3）。
 * 前提: 市場データと実行履歴が0件の DB。J-Quants の API キーが未設定のサーバー（キーがあるサーバーでは、
 * キー未設定を前提にしたテストをスキップする）。定期実行のシークレットは playwright.config.ts の CRON_SECRET。
 * テストが作った実行履歴は、各テストの後に削除する。
 */
test.describe.configure({ mode: "serial" });

const KEY_MISSING = "J-Quants の API キーが設定されていません";
const STALE_MESSAGE = "15 分以上応答が無かったため、中断されたものとみなしました";

async function runCount(): Promise<number> {
  const { rows } = await sql("select count(*)::int as n from public.ingestion_runs");
  return rows[0].n;
}

async function ingestionStatus(request: APIRequestContext) {
  const res = await request.get("/api/ingestion");
  expect(res.status()).toBe(200);
  return (await res.json()).data as {
    sources: { id: string; configured: boolean }[];
    cron: { configured: boolean; schedule: string };
  };
}

/** J-Quants のキーが設定されたサーバーでは、キー未設定を前提にしたテストをスキップする。 */
async function skipIfJQuantsConfigured(page: Page) {
  const status = await ingestionStatus(page.request);
  const configured = status.sources.find((source) => source.id === "jquants")?.configured;
  if (configured) console.log("[e2e] サーバーの J-Quants が「設定済み」のため、キー未設定を前提にしたテストをスキップします");
  test.skip(configured === true, "サーバーの J-Quants のキーが設定済み");
}

/**
 * 要求を確実に同時に競合させる。コミットしていない「実行中」の行で一意インデックスを押さえている間に
 * 要求を送ると、どの要求の開始も待たされる。押さえを取り消すと一斉に開始し、1つだけが記録される
 * （キーが無いと取り込みはすぐ終わるため、単に並列に送るだけでは順番に成功してしまうことがある）。
 */
async function whileStartIsBlocked<T>(send: () => Promise<T>): Promise<T> {
  const blocker = new Client({ connectionString: DB_URL });
  await blocker.connect();
  try {
    await blocker.query("begin");
    await blocker.query("insert into public.ingestion_runs (target, trigger, status) values ('stock_master', 'manual', 'running')");
    const pending = send();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await blocker.query("rollback");
    return await pending;
  } finally {
    await blocker.end();
  }
}

const manualButton = (page: Page) => page.getByRole("button", { name: /今すぐ取り込み|実行中/ });

test.beforeAll(async () => {
  const { rows } = await sql(
    "select (select count(*) from public.stocks)::int as stocks, (select count(*) from public.ingestion_runs)::int as runs",
  );
  expect(rows[0], "E2E の前提: 市場データと実行履歴が0件").toEqual({ stocks: 0, runs: 0 });
});

test.afterEach(async () => {
  await sql("delete from public.ingestion_runs");
});

test.describe("データソースの設定状態（AC3.1）", () => {
  test("J-Quants・EDINET が「未設定」で環境変数の名前が添えられ、定期実行は「毎日 20:00（日本時間）」", async ({ page }) => {
    const problems = collectPageProblems(page);
    await loginAsOwner(page);
    await skipIfJQuantsConfigured(page);
    await page.goto("/imports");

    const jquants = page.getByTestId("source-jquants");
    await expect(jquants).toContainText("J-Quants");
    await expect(jquants).toContainText("未設定");
    await expect(jquants).toContainText("JQUANTS_API_KEY");
    const edinet = page.getByTestId("source-edinet");
    const edinetConfigured = (await ingestionStatus(page.request)).sources.find((s) => s.id === "edinet")?.configured;
    await expect(edinet).toContainText(edinetConfigured ? "設定済み" : "未設定");
    await expect(edinet).toContainText("EDINET_API_KEY");

    const cron = page.getByTestId("cron-settings");
    await expect(cron).toContainText("毎日 20:00（日本時間）");
    await expect(cron).toContainText("銘柄マスタ");
    await expect(cron).toContainText("設定済み");
    expect(problems).toEqual([]);
  });

  test("GET /api/ingestion は設定状態を真偽値だけで返し、未ログインは 401", async ({ page, request }) => {
    const unauth = await request.get("/api/ingestion");
    expect(unauth.status()).toBe(401);
    expect(await unauth.text()).not.toContain("runs");

    await loginAsOwner(page);
    const res = await page.request.get("/api/ingestion");
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toContain("no-store");
    const body = await res.json();
    expect(Object.keys(body.data).sort()).toEqual(["activeRun", "cron", "hasMore", "runs", "sources"]);
    expect(body.data.sources.map((s: { id: string }) => s.id)).toEqual(["jquants", "edinet"]);
    for (const source of body.data.sources) expect(Object.keys(source).sort()).toEqual(["configured", "id"]);
    expect(body.data.cron).toEqual({ configured: true, schedule: "0 11 * * *" });
    expect(body.data.activeRun).toBeNull();
    expect(body.data.runs).toEqual([]);
    // シークレットの値はどこにも出ない
    expect(JSON.stringify(body)).not.toContain(CRON_SECRET);
    const html = await (await page.request.get("/imports")).text();
    expect(html).not.toContain(CRON_SECRET);
  });
});

test.describe("キー未設定での手動取り込み（AC3.2、AC3.3）", () => {
  test("押すと「失敗」が記録され、理由が明示される。リロードしても残り、もう一度押すと2行になる", async ({ page }) => {
    const problems = collectPageProblems(page);
    await loginAsOwner(page);
    await skipIfJQuantsConfigured(page);
    await page.goto("/imports");
    await expect(page.getByText("実行履歴はまだありません")).toBeVisible();

    await manualButton(page).click();
    await expect(page.getByTestId("ingestion-result")).toHaveText(`失敗: ${KEY_MISSING}`);
    await expect(page.getByRole("status")).toContainText(KEY_MISSING);
    await expect(manualButton(page)).toHaveText("今すぐ取り込み");
    await expect(manualButton(page)).not.toHaveAttribute("aria-disabled", "true");

    const { rows } = await sql(
      "select id, target, trigger, status, processed_count, error_message, finished_at is not null as finished from public.ingestion_runs",
    );
    expect(rows).toEqual([
      expect.objectContaining({
        target: "stock_master",
        trigger: "manual",
        status: "failed",
        processed_count: 0,
        error_message: KEY_MISSING,
        finished: true,
      }),
    ]);
    expect((await sql("select count(*)::int as n from public.stocks")).rows[0].n).toBe(0);

    await page.reload();
    const table = page.getByTestId("run-table");
    await expect(table.locator("tbody tr")).toHaveCount(1);
    const row = table.locator("tbody tr").first();
    await expect(row).toContainText(await jstOfRun(Number(rows[0].id), "started_at"));
    await expect(row).toContainText("銘柄マスタ");
    await expect(row).toContainText("手動");
    await expect(row).toContainText("失敗");
    await expect(row.locator("td").nth(5)).toHaveText("0");
    await expect(row).toContainText(KEY_MISSING);

    // ダッシュボードは空状態のまま、直近の実行に失敗が出る
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "まだデータが取り込まれていません" })).toBeVisible();
    await expect(page.getByTestId("latest-run")).toContainText(KEY_MISSING);

    await page.goto("/imports");
    await manualButton(page).click();
    await expect(page.getByTestId("ingestion-result")).toHaveText(`失敗: ${KEY_MISSING}`);
    await expect(page.getByTestId("run-table").locator("tbody tr")).toHaveCount(2);
    expect(await runCount()).toBe(2);
    expect(problems).toEqual([]);
  });

  test("キーボードで操作でき、結果は role=status で伝わる", async ({ page }) => {
    await loginAsOwner(page);
    await skipIfJQuantsConfigured(page);
    await page.goto("/imports");
    await manualButton(page).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toContainText(`失敗: ${KEY_MISSING}`);
  });

  test("375px でも横スクロールせず、ボタンと結果がはみ出さない", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await context.newPage();
    await loginAsOwner(page);
    await skipIfJQuantsConfigured(page);
    await insertRun({
      target: "stock_master",
      trigger: "cron",
      status: "failed",
      startedAgo: "1 hour",
      finishedAgo: "59 minutes",
      errorMessage: "長いエラーメッセージの確認。".repeat(20),
    });
    await page.goto("/imports");
    await manualButton(page).click();
    await expect(page.getByTestId("ingestion-result")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    const box = await manualButton(page).boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    await context.close();
  });
});

test.describe("手動取り込みの API（POST /api/ingestion/runs）", () => {
  test("未ログインは 401、別オリジン・Origin 無しは 403、未対応の対象は 400、GET は 405。いずれも記録しない", async ({
    page,
    request,
  }) => {
    expect((await request.post("/api/ingestion/runs", { data: { target: "stock_master" } })).status()).toBe(401);

    await loginAsOwner(page);
    const evil = await page.request.post("/api/ingestion/runs", {
      data: { target: "stock_master" },
      headers: { origin: "https://evil.example" },
    });
    expect(evil.status()).toBe(403);
    const noOrigin = await page.request.post("/api/ingestion/runs", { data: { target: "stock_master" } });
    expect(noOrigin.status()).toBe(403);
    for (const target of ["financials", "zzz"]) {
      const res = await page.request.post("/api/ingestion/runs", { data: { target }, headers: { origin: BASE_URL } });
      expect(res.status()).toBe(400);
      expect(await res.json()).toEqual({ error: "unsupported_target" });
    }
    expect((await page.request.get("/api/ingestion/runs")).status()).toBe(405);
    expect(await runCount()).toBe(0);
  });

  test("受け付けると 202 で、その時点で running の行があり、処理が終わると failed になる", async ({ page }) => {
    await loginAsOwner(page);
    await skipIfJQuantsConfigured(page);
    const res = await page.request.post("/api/ingestion/runs", { headers: { origin: BASE_URL } }); // 本文無し＝銘柄マスタ
    expect(res.status()).toBe(202);
    const body = await res.json();
    expect(body).toEqual({ data: { runId: expect.any(Number), status: "running" } });
    await expect
      .poll(async () => (await sql("select status from public.ingestion_runs where id = $1", [body.data.runId])).rows[0]?.status)
      .toBe("failed");
  });
});

test.describe("二重実行の防止（AC3.7）", () => {
  test("実行中の行があると、ボタンは「実行中…」で無効、API は 409。終わると再読み込みせずに戻る", async ({ page }) => {
    const problems = collectPageProblems(page);
    await loginAsOwner(page);
    const id = await insertRun({ target: "stock_master", trigger: "manual", status: "running", startedAgo: "0 seconds", finishedAgo: null });
    await page.goto("/imports");

    await expect(manualButton(page)).toHaveText("実行中…");
    await expect(manualButton(page)).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByTestId("active-run")).toContainText("銘柄マスタ");
    await expect(page.getByTestId("active-run")).toContainText(await jstOfRun(id, "started_at"));
    const row = page.getByTestId("run-table").locator("tbody tr").first();
    await expect(row).toContainText("実行中");
    await expect(row.locator("td").nth(1)).toHaveText("—");

    await manualButton(page).click({ force: true });
    const status = await page.evaluate(() =>
      fetch("/api/ingestion/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"target":"stock_master"}',
      }).then((res) => res.status),
    );
    expect(status).toBe(409);
    expect(await runCount()).toBe(1);

    await sql("update public.ingestion_runs set status = 'failed', finished_at = now(), error_message = '評価者が終了' where id = $1", [id]);
    await expect(manualButton(page)).toHaveText("今すぐ取り込み", { timeout: 4000 });
    await expect(manualButton(page)).not.toHaveAttribute("aria-disabled", "true");
    // 409 のコンソールエラーは、上で意図的に送った要求のもの
    expect(problems.filter((p) => !p.includes("409"))).toEqual([]);
  });

  test("同時に5回送ると、202 はちょうど1つで、行は1行だけ増える", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/imports");
    const statuses = await whileStartIsBlocked(() =>
      page.evaluate(() =>
        Promise.all(
          Array.from({ length: 5 }, () =>
            fetch("/api/ingestion/runs", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: '{"target":"stock_master"}',
            }).then((res) => res.status),
          ),
        ),
      ),
    );
    expect(statuses.filter((s) => s === 202)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(4);
    expect(await runCount()).toBe(1);
  });

  test("手動と定期実行を同時に送っても、新しい行は1行だけ", async ({ page, request }) => {
    await loginAsOwner(page);
    await page.goto("/imports");
    const [manual, cron] = await whileStartIsBlocked(() =>
      Promise.all([
        page.evaluate(() => fetch("/api/ingestion/runs", { method: "POST" }).then((res) => res.status)),
        request.get("/api/cron/daily", { headers: { authorization: `Bearer ${CRON_SECRET}` } }).then((res) => res.status()),
      ]),
    );
    test.skip(cron === 401, "サーバーの CRON_SECRET が E2E_CRON_SECRET と異なる");
    expect([manual, cron].filter((s) => s === 409)).toHaveLength(1);
    expect(await runCount()).toBe(1);
  });

  test("15 分以上たった実行中は「応答がありません」と表示され、押すと失敗にしてから新しい実行を始める", async ({ page }) => {
    await loginAsOwner(page);
    await skipIfJQuantsConfigured(page);
    const staleId = await insertRun({ target: "stock_master", trigger: "cron", status: "running", startedAgo: "20 minutes", finishedAgo: null });
    await page.goto("/imports");

    await expect(page.getByTestId("stale-run-note").first()).toHaveText("応答がありません（15 分以上）");
    await expect(manualButton(page)).toHaveText("今すぐ取り込み");
    await manualButton(page).click();
    await expect(page.getByTestId("ingestion-result")).toHaveText(`失敗: ${KEY_MISSING}`);

    const { rows } = await sql("select id, status, error_message from public.ingestion_runs order by id");
    expect(rows).toEqual([
      { id: String(staleId), status: "failed", error_message: STALE_MESSAGE },
      { id: expect.any(String), status: "failed", error_message: KEY_MISSING },
    ]);
  });

  test("DB の一意制約: 実行中の行は2行入れられない", async () => {
    await sql("insert into public.ingestion_runs (target, trigger, status) values ('stock_master', 'manual', 'running')");
    await expect(
      sql("insert into public.ingestion_runs (target, trigger, status) values ('financials', 'cron', 'running')"),
    ).rejects.toThrow(/ingestion_runs_single_running_idx/);
  });
});

test.describe("定期実行のエンドポイント（AC3.4）", () => {
  test("正しいシークレットが無ければ 401 で、実行履歴は増えない", async ({ page, request }) => {
    const cases: Record<string, string>[] = [
      {},
      { authorization: "Bearer wrong" },
      { authorization: CRON_SECRET },
      { authorization: `Bearer ${CRON_SECRET}x` },
      { authorization: "Bearer " },
    ];
    for (const headers of cases) {
      const res = await request.get("/api/cron/daily", { headers });
      expect(res.status(), JSON.stringify(headers)).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
    expect((await request.get(`/api/cron/daily?secret=${CRON_SECRET}`)).status()).toBe(401);

    // ログインのセッションでは起動できない
    await loginAsOwner(page);
    expect((await page.request.get("/api/cron/daily")).status()).toBe(401);
    expect((await page.request.post("/api/cron/daily", { headers: { authorization: `Bearer ${CRON_SECRET}` } })).status()).toBe(405);
    expect(await runCount()).toBe(0);
  });

  test("正しいシークレットなら完了まで待って 200、「定期実行」の行が1行増える。実行中なら 409", async ({ page, request }) => {
    await loginAsOwner(page);
    const status = await ingestionStatus(page.request);
    test.skip(!status.cron.configured, "サーバーに CRON_SECRET が設定されていない");
    const res = await request.get("/api/cron/daily", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    test.skip(res.status() === 401, "サーバーの CRON_SECRET が E2E_CRON_SECRET と異なる");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.runs).toHaveLength(1);
    expect(body.data.runs[0]).toMatchObject({ runId: expect.any(Number), target: "stock_master" });
    const { rows } = await sql("select trigger, status, error_message from public.ingestion_runs");
    expect(rows).toHaveLength(1);
    expect(rows[0].trigger).toBe("cron");
    expect(rows[0].status).not.toBe("running");
    if (!status.sources.find((s) => s.id === "jquants")?.configured) {
      expect(body.data.runs[0]).toMatchObject({ status: "failed", processedCount: 0 });
      expect(rows[0]).toEqual({ trigger: "cron", status: "failed", error_message: KEY_MISSING });
    }

    await insertRun({ target: "stock_master", trigger: "manual", status: "running", startedAgo: "0 seconds", finishedAgo: null });
    const busy = await request.get("/api/cron/daily", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(busy.status()).toBe(409);
    expect(await busy.json()).toEqual({ error: "already_running" });
    expect(await runCount()).toBe(2);
  });

  test("proxy が外すのは /api/cron/ の配下だけ。ほかの似たパスは未ログインで 401 になり、データを返さない", async ({ request }) => {
    for (const path of [
      "/api/cron",
      "/api/cronx",
      "/api/cron-daily",
      "/api/cron/..%2Fingestion",
      "/api/cron/%2e%2e/ingestion",
      "/API/cron/daily",
      "/api/cron/zzz",
      "/api/ingestion",
      "/api/dashboard",
      "/api/stocks",
      "/api/zzz",
    ]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect([401, 404], path).toContain(res.status());
      const text = await res.text();
      expect(text, path).not.toContain('"runs"');
      expect(text, path).not.toContain("stockCount");
    }
    expect(await runCount()).toBe(0);
  });
});
