import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";

import { BASE_URL, collectPageProblems, CRON_SECRET, login, OWNER, simulateServerClockBehind, sql } from "./support";

/**
 * 新たに該当・外れた（F13、Sprint 14）。契約 docs/harness/sprints/sprint-14/contract.md の C3・C4・C6-2・C9・C10。
 * 市場データは Sprint 10 の ownership-example.sql（9U001〜9U014）。比較の基準の記録は定期実行（/api/cron/daily。キーなしでも記録される）
 * か capture_screening_snapshot()、記録の後の変化は screening-changes-after.sql。
 * 前提: 市場データ・実行履歴・プリセット・ウォッチリスト・記録が0件の DB、pnpm seed:users 済み。キーなしのサーバー。
 * 後片付けは各テストの後と afterAll（一時的に付ける制約・外す権限は finally でも戻す）。
 */
test.describe.configure({ mode: "serial" });

const FIXTURES = join(__dirname, "fixtures");
const EXAMPLE_SQL = readFileSync(join(FIXTURES, "ownership-example.sql"), "utf8");
const CLEANUP_SQL = readFileSync(join(FIXTURES, "ownership-cleanup.sql"), "utf8");
const AFTER_SQL = readFileSync(join(FIXTURES, "screening-changes-after.sql"), "utf8");
const WATCHLIST_SQL = readFileSync(join(FIXTURES, "watchlist-example.sql"), "utf8");
const WATCHLIST_CLEANUP_SQL = readFileSync(join(FIXTURES, "watchlist-cleanup.sql"), "utf8");
const PRESETS_SQL = readFileSync(join(FIXTURES, "screening-presets-example.sql"), "utf8");
const PRESETS_CLEANUP_SQL = readFileSync(join(FIXTURES, "screening-presets-cleanup.sql"), "utf8");
const SNAPSHOTS_CLEANUP_SQL = readFileSync(join(FIXTURES, "screening-snapshots-cleanup.sql"), "utf8");
const RELIABILITY_SQL = readFileSync(join(FIXTURES, "ingestion-reliability-example.sql"), "utf8");
const RELIABILITY_CLEANUP_SQL = readFileSync(join(FIXTURES, "ingestion-reliability-cleanup.sql"), "utf8");

const OWNER2 = { email: "owner2@quantis.local", password: "Quantis-Owner2-2026!" };
const STANDARD = "cagr=20&margin=10&years=5&owner=20&ownermode=any&sort=cagr&order=desc";
const STRICT = "cagr=20&margin=10&years=5&owner=40&ownermode=any&sort=owner&order=desc";
const GROWTH = "cagr=20&margin=10&years=5&owner=20&ownermode=any&market=0113&sort=cagr&order=desc";
const NO_OWNER = "cagr=20&margin=10&years=5&owner=20&ownermode=any&off=owner&sort=cagr&order=desc";
const ALL_OFF = "cagr=20&margin=10&years=5&owner=20&ownermode=any&off=cagr,margin,years,owner&unavailable=include&undeterminable=include&sort=code&order=asc";

const rowCodes = (page: Page) => page.getByTestId("results-scroll").locator("tbody tr").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-code")));
const newCodes = (page: Page) =>
  page
    .getByTestId("results-scroll")
    .locator("tbody tr")
    .filter({ has: page.getByTestId("new-badge") })
    .evaluateAll((rows) => rows.map((r) => r.getAttribute("data-code")));
const changeCodes = (page: Page, kind: "added" | "removed") =>
  page.getByTestId(`changes-${kind}`).getByTestId("change-row").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-code")));
const changeRow = (page: Page, kind: "added" | "removed", code: string) =>
  page.getByTestId(`changes-${kind}`).locator(`[data-testid="change-row"][data-code="${code}"]`);
const reasons = (page: Page, kind: "added" | "removed", code: string) =>
  changeRow(page, kind, code).getByTestId("change-reason").evaluateAll((items) => items.map((i) => [i.getAttribute("data-reason"), i.textContent]));

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

async function capture(): Promise<number> {
  return Number((await sql("select public.capture_screening_snapshot() as id")).rows[0].id);
}

async function snapshotCount(): Promise<number> {
  return (await sql("select count(*)::int as n from public.screening_snapshots")).rows[0].n;
}

async function cron(request: APIRequestContext, path = "/api/cron/daily") {
  return request.get(path, { headers: { authorization: `Bearer ${CRON_SECRET}` } });
}

async function changesApi(request: APIRequestContext, query = "") {
  const res = await request.get(`/api/screening/changes${query ? `?${query}` : ""}`);
  expect(res.status()).toBe(200);
  const data = (await res.json()).data;
  return {
    ...data,
    addedCodes: data.added.map((c: { code: string }) => c.code),
    removedCodes: data.removed.map((c: { code: string }) => c.code),
  };
}

async function cleanup() {
  await sql("alter table public.screening_snapshot_stocks drop constraint if exists e2e_fail_snapshot");
  await sql("grant select on public.screening_snapshot_stocks to authenticated");
  await sql(WATCHLIST_CLEANUP_SQL);
  await sql(PRESETS_CLEANUP_SQL);
  await sql("delete from public.ownership_overrides where user_id in (select id from auth.users where email like '%@quantis.local')");
  await sql(CLEANUP_SQL);
  await sql(RELIABILITY_CLEANUP_SQL);
  await sql("delete from public.stocks where code like 'C%' and company_name like '変化検証%'");
  await sql(SNAPSHOTS_CLEANUP_SQL);
  await sql("delete from public.ingestion_runs");
}

test.beforeAll(async () => {
  const { rows } = await sql(
    `select (select count(*) from public.stocks)::int as stocks, (select count(*) from public.ingestion_runs)::int as runs,
            (select count(*) from public.screening_presets)::int as presets,
            (select count(*) from public.watchlist_items)::int as watchlist,
            (select count(*) from public.screening_snapshots)::int as snapshots`,
  );
  expect(rows[0], "E2E の前提: 市場データ・実行履歴・プリセット・ウォッチリスト・記録が0件").toEqual({
    stocks: 0,
    runs: 0,
    presets: 0,
    watchlist: 0,
    snapshots: 0,
  });
});

test.afterEach(cleanup);
test.afterAll(cleanup);

test.describe("比較の基準の記録（C3）", () => {
  test.beforeEach(async () => {
    await sql(EXAMPLE_SQL);
  });

  test("記録が無ければ「比較の基準がまだありません」。NEW は出ない（C3-1）", async ({ page }) => {
    const problems = collectPageProblems(page);
    await loginAs(page, OWNER);
    const section = page.getByTestId("screening-changes");
    await expect(section.getByTestId("changes-no-snapshot")).toContainText("比較の基準がまだありません。毎日 20:00（日本時間）の定期実行が始まると");
    await expect(section.getByTestId("change-row")).toHaveCount(0);
    await expect(section.getByTestId("changes-conditions")).toContainText("判定の条件: 既定の条件");
    await page.goto(`/screening?${STANDARD}`);
    await expect(page.getByTestId("result-count")).toHaveText("7");
    await expect(page.getByTestId("new-badge")).toHaveCount(0);
    await expect(page.getByTestId("new-count-note")).toHaveCount(0);
    const api = await changesApi(page.request);
    expect(api.comparison.status).toBe("no_snapshot");
    expect([api.addedCodes, api.removedCodes]).toEqual([[], []]);
    const screening = (await (await page.request.get(`/api/screening?${STANDARD}`)).json()).data;
    expect(screening.newCount).toBeNull();
    expect(screening.rows.every((row: { isNew: boolean }) => row.isNew === false)).toBe(true);
    expect(problems).toEqual([]);
  });

  test("定期実行（キーなし）で記録され、変化はまだ無い。取り込みの注記が出る（C3-2・C3-5・C3-6・C4-11）", async ({ page, request }) => {
    const res = await cron(request);
    expect(res.status()).toBe(200);
    const { rows: snaps } = await sql(
      `select s.id, s.run_id, s.stock_count, s.reference_date::text, s.cycle_date::text, (s.captured_at at time zone 'Asia/Tokyo')::date::text as jst,
              to_char(s.captured_at at time zone 'Asia/Tokyo', 'HH24:MI') as hm, r.target, r.trigger, r.details
         from public.screening_snapshots s join public.ingestion_runs r on r.id = s.run_id`,
    );
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toMatchObject({ stock_count: 14, reference_date: "2026-09-24", target: "stock_master", trigger: "cron" });
    expect(snaps[0].cycle_date).toBe(snaps[0].jst);
    expect(snaps[0].details).toMatchObject({ snapshot: "captured", snapshotId: Number(snaps[0].id) });
    const stocks = await sql("select code, revenue_cagr::text from public.screening_snapshot_stocks where snapshot_id = $1 order by code", [snaps[0].id]);
    expect(stocks.rows.map((r) => r.code)).toEqual(Array.from({ length: 14 }, (_, i) => `9U0${String(i + 1).padStart(2, "0")}`));
    expect(stocks.rows.find((r) => r.code === "9U011")!.revenue_cagr).toBe("0.1000000000");

    await loginAs(page, OWNER);
    const section = page.getByTestId("screening-changes");
    await expect(section.getByTestId("changes-cycle")).toHaveText(
      `直近の取り込み: ${snaps[0].cycle_date}（${snaps[0].hm} 開始）。その開始時点のデータと、現在のデータを比べています`,
    );
    await expect(section.getByTestId("changes-none")).toHaveCount(2);
    await expect(section.getByTestId("changes-incomplete-note")).toContainText("今回の取り込みで完了していない対象があります（銘柄マスタ・株価）");

    await page.goto(`/imports/runs/${snaps[0].run_id}`);
    await expect(page.getByTestId("run-overview")).toBeVisible();
    await expect(page.getByTestId("run-snapshot-failed")).toHaveCount(0);

    await page.goto(`/screening?${STANDARD}`);
    await expect(page.getByTestId("new-count-note")).toContainText("うち NEW 0 件");
    await expect(page.getByTestId("new-badge")).toHaveCount(0);

    // 後に同じ対象が成功すれば、その対象は数えない（記録の後に始まった実行）
    await sql(
      `insert into public.ingestion_runs (target, trigger, status, started_at, finished_at, processed_count, details)
       values ('stock_master', 'manual', 'succeeded', now(), now(), 14, '{"fixture":"sprint-14"}'),
              ('daily_quotes', 'manual', 'succeeded', now(), now(), 0, '{"fixture":"sprint-14"}')`,
    );
    await page.goto("/");
    await expect(page.getByTestId("changes-incomplete-note")).toHaveCount(0);
    // 実行中なら注記
    await sql("insert into public.ingestion_runs (target, trigger, status, started_at) values ('financials', 'manual', 'running', now() - interval '2 minutes')");
    await page.reload();
    await expect(page.getByTestId("changes-running-note")).toContainText("取り込み中です。一覧は途中の状態です");
  });

  test("記録されない経路: 手動・財務・EDINET・409・401（C3-3）", async ({ page, request }) => {
    await loginAs(page, OWNER);
    const manual = await page.request.post("/api/ingestion/runs", { data: { target: "stock_master" }, headers: { origin: BASE_URL } });
    expect(manual.status()).toBe(202);
    await expect.poll(async () => (await sql("select count(*)::int as n from public.ingestion_runs where status = 'running'")).rows[0].n).toBe(0);
    for (const path of ["/api/cron/financials", "/api/cron/edinet"]) expect((await cron(request, path)).status()).toBe(200);
    expect((await request.get("/api/cron/daily")).status()).toBe(401);
    await sql("insert into public.ingestion_runs (target, trigger, status, started_at) values ('financials', 'manual', 'running', now())");
    expect((await cron(request)).status()).toBe(409);
    expect(await snapshotCount()).toBe(0);
  });

  test("記録の失敗は取り込みを止めず、実行の詳細に出る。比較は前回の記録のまま（C3-5。R5）", async ({ page, request }) => {
    const previous = await capture();
    const { rows: prev } = await sql("select cycle_date::text, to_char(captured_at at time zone 'Asia/Tokyo', 'HH24:MI') as hm from public.screening_snapshots where id = $1", [previous]);
    try {
      await sql("alter table public.screening_snapshot_stocks add constraint e2e_fail_snapshot check (false) not valid");
      const res = await cron(request);
      expect(res.status()).toBe(200);
      const { rows } = await sql("select id, details from public.ingestion_runs where target = 'stock_master' and trigger = 'cron'");
      expect(rows).toHaveLength(1);
      expect(rows[0].details.snapshot).toBe("failed");
      expect(rows[0].details.snapshotId).toBeUndefined();
      expect(await snapshotCount()).toBe(1);

      await loginAs(page, OWNER);
      await expect(page.getByTestId("changes-cycle")).toContainText(`直近の取り込み: ${prev[0].cycle_date}（${prev[0].hm} 開始）`);
      await page.goto(`/imports/runs/${rows[0].id}`);
      await expect(page.getByTestId("run-snapshot-failed")).toHaveText("比較の基準（前回の取り込み時点）を記録できませんでした。前回の記録で比較します");
      const manual = (await sql("select id from public.ingestion_runs where target = 'daily_quotes'")).rows[0].id;
      await page.goto(`/imports/runs/${manual}`);
      await expect(page.getByTestId("run-overview")).toBeVisible();
      await expect(page.getByTestId("run-snapshot-failed")).toHaveCount(0);
    } finally {
      await sql("alter table public.screening_snapshot_stocks drop constraint if exists e2e_fail_snapshot");
    }
  });

  test("空の記録では比較しない（C3-7）", async ({ page }) => {
    await sql(CLEANUP_SQL);
    await capture();
    await sql(EXAMPLE_SQL);
    await loginAs(page, OWNER);
    await expect(page.getByTestId("changes-empty-snapshot")).toContainText("には銘柄データが無かったため、比較できません。次の定期実行から表示します");
    await expect(page.getByTestId("change-row")).toHaveCount(0);
    await page.goto(`/screening?${STANDARD}`);
    await expect(page.getByTestId("new-badge")).toHaveCount(0);
    await expect(page.getByTestId("new-count-note")).toHaveCount(0);
    expect((await changesApi(page.request)).comparison.status).toBe("empty_snapshot");
  });
});

test.describe("新たに該当・外れた（C4。AC13.3・AC13.4）", () => {
  test.beforeEach(async () => {
    await sql(EXAMPLE_SQL);
    await capture();
    await sql(AFTER_SQL);
  });

  test("ダッシュボードの一覧と理由、詳細へのリンク（C4-1・C4-2）", async ({ page }) => {
    const problems = collectPageProblems(page);
    await loginAs(page, OWNER);
    const section = page.getByTestId("screening-changes");
    await expect(section.getByTestId("changes-conditions")).toContainText("判定の条件: 既定の条件");
    await expect(section.getByTestId("changes-cycle")).toContainText("直近の取り込み:");
    await expect.poll(() => changeCodes(page, "added")).toEqual(["9U011", "9U012"]);
    await expect.poll(() => changeCodes(page, "removed")).toEqual(["9U002", "9U006", "9U008"]);
    await expect(section.getByTestId("changes-added-count")).toHaveText("2");
    await expect(section.getByTestId("changes-removed-count")).toHaveText("3");
    expect(await reasons(page, "added", "9U011")).toEqual([["cagr:unmet>met", "① 売上CAGR: 満たさない → 満たす"]]);
    expect(await reasons(page, "added", "9U012")).toEqual([["years:unmet>met", "③ 上場年数: 満たさない → 満たす"]]);
    expect(await reasons(page, "removed", "9U002")).toEqual([["delisted", "上場廃止"]]);
    expect(await reasons(page, "removed", "9U006")).toEqual([["owner:met>unmet", "④ オーナー企業／社長が筆頭株主: 満たす → 満たさない"]]);
    expect(await reasons(page, "removed", "9U008")).toEqual([["margin:met>unmet", "② 営業利益率: 満たす → 満たさない"]]);

    await changeRow(page, "added", "9U011").getByTestId("change-link").click();
    await expect(page).toHaveURL("/stocks/9U011");
    await expect(page.getByTestId("evaluation-cagr")).toHaveAttribute("data-status", "met");
    await page.goto("/stocks/9U002");
    await expect(page.getByTestId("delisted-badge")).toBeVisible();
    await page.goto("/stocks/9U006");
    await expect(page.getByTestId("evaluation-owner")).toHaveAttribute("data-status", "unmet");
    expect(problems).toEqual([]);
  });

  test("スクリーニングの NEW と件数。表示中の条件で判定する（C4-3・C4-4）", async ({ page }) => {
    await loginAs(page, OWNER);
    await page.goto(`/screening?${STANDARD}`);
    await expect.poll(() => rowCodes(page)).toEqual(["9U001", "9U009", "9U010", "9U011", "9U012", "9U014"]);
    await expect.poll(() => newCodes(page)).toEqual(["9U011", "9U012"]);
    await expect(page.getByTestId("new-count-note")).toContainText("うち NEW 2 件（前回の取り込みの開始時点");
    const screening = (await (await page.request.get(`/api/screening?${STANDARD}`)).json()).data;
    expect(screening.newCount).toBe(2);
    expect(screening.comparison.status).toBe("ok");
    expect(screening.rows.filter((row: { isNew: boolean }) => row.isNew).map((row: { code: string }) => row.code)).toEqual(["9U011", "9U012"]);

    // NEW の説明（ポップオーバー）
    await page.getByTestId("results-scroll").locator('tr[data-code="9U011"]').getByTestId("new-badge").click();
    await expect(page.getByTestId("new-badge-detail")).toContainText("① 売上CAGR: 満たさない → 満たす");
    await expect(page).toHaveURL(`/screening?${STANDARD}`);
    await page.keyboard.press("Escape");

    await page.goto(`/screening?${NO_OWNER}`);
    await expect.poll(() => newCodes(page)).toEqual(["9U011", "9U012"]);
    await page.goto(`/screening?${GROWTH}`);
    await expect(page.getByTestId("new-count-note")).toContainText("うち NEW 0 件");
    await expect(page.getByTestId("new-badge")).toHaveCount(0);

    const expected: [string, string[], string[]][] = [
      [STANDARD, ["9U011", "9U012"], ["9U002", "9U006", "9U008"]],
      [STRICT, ["9U011", "9U012"], ["9U008"]],
      [GROWTH, [], ["9U002", "9U008"]],
      [NO_OWNER, ["9U011", "9U012"], ["9U002", "9U008"]],
    ];
    for (const [query, added, removed] of expected) {
      const api = await changesApi(page.request, query);
      expect([api.addedCodes, api.removedCodes], query).toEqual([added, removed]);
    }
    const bad = await page.request.get("/api/screening/changes?cagr=abc");
    expect(bad.status()).toBe(400);
  });

  test("既定のプリセットで判定し、スクリーニングの NEW と一致する。両側に同じ条件を当てる（C4-5）", async ({ page }) => {
    await sql(PRESETS_SQL);
    await sql("update public.screening_presets set is_default = true where name = '厳しめ'");
    await loginAs(page, OWNER);
    await expect(page.getByTestId("changes-conditions")).toContainText("判定の条件: 既定のプリセット『厳しめ』");
    await expect.poll(() => changeCodes(page, "added")).toEqual(["9U011", "9U012"]);
    await expect.poll(() => changeCodes(page, "removed")).toEqual(["9U008"]);
    await expect(page.getByTestId("changes-open-screening")).toHaveAttribute("href", `/screening?${STRICT}`);
    await page.getByTestId("changes-open-screening").click();
    await expect(page).toHaveURL(`/screening?${STRICT}`);
    await expect.poll(() => newCodes(page)).toEqual(["9U012", "9U011"]);

    await sql("update public.screening_presets set is_default = false");
    await sql("update public.screening_presets set is_default = true where name = 'グロースのみ'");
    await page.goto("/");
    await expect(page.getByTestId("changes-added").getByTestId("changes-none")).toHaveText("変化はありません");
    await expect.poll(() => changeCodes(page, "removed")).toEqual(["9U002", "9U008"]);
  });

  test("手動補正は両側に当てる。ユーザーごとの結果（C4-6・C4-7）", async ({ page, browser }) => {
    const owner = await userId(OWNER.email);
    await sql(
      `insert into public.ownership_overrides (user_id, code, verdict, memo) values ($1, '9U003', 'owner_company', '確認'), ($1, '9U009', 'not_matched', '確認')`,
      [owner],
    );
    await sql(PRESETS_SQL);
    await loginAs(page, OWNER);
    await page.goto(`/screening?${STANDARD}`);
    await expect.poll(() => rowCodes(page)).toEqual(["9U001", "9U003", "9U010", "9U011", "9U012", "9U014"]);
    await expect.poll(() => newCodes(page)).toEqual(["9U011", "9U012"]);
    await page.goto("/");
    await expect.poll(() => changeCodes(page, "added")).toEqual(["9U011", "9U012"]);
    await expect.poll(() => changeCodes(page, "removed")).toEqual(["9U002", "9U006", "9U008"]);

    const { context, page: page2 } = await newUserPage(browser, OWNER2);
    try {
      await page2.goto(`/screening?${STANDARD}`);
      await expect.poll(() => rowCodes(page2)).toEqual(["9U001", "9U009", "9U010", "9U011", "9U012", "9U014"]);
      await expect.poll(() => newCodes(page2)).toEqual(["9U011", "9U012"]);
      // owner の既定＝厳しめ、owner2 は既定なし
      await sql("update public.screening_presets set is_default = true where name = '厳しめ'");
      await page2.goto("/");
      await expect(page2.getByTestId("changes-conditions")).toContainText("既定の条件");
      await expect.poll(() => changeCodes(page2, "removed")).toEqual(["9U002", "9U006", "9U008"]);
      await page.goto("/");
      await expect(page.getByTestId("changes-conditions")).toContainText("既定のプリセット『厳しめ』");
      await expect.poll(() => changeCodes(page, "removed")).toEqual(["9U008"]);
    } finally {
      await context.close();
    }
  });

  test("ウォッチリストの印（C4-8）", async ({ page, browser }) => {
    await sql(WATCHLIST_SQL);
    await loginAs(page, OWNER);
    await expect(changeRow(page, "added", "9U011").getByTestId("change-watchlisted")).toBeVisible();
    await expect(changeRow(page, "removed", "9U006").getByTestId("change-watchlisted")).toBeVisible();
    await expect(changeRow(page, "added", "9U012").getByTestId("change-watchlisted")).toHaveCount(0);
    await page.goto("/watchlist");
    const badge = (code: string) => page.locator(`[data-testid="watchlist-row"][data-code="${code}"]`).getByTestId("watchlist-change-badge");
    await expect(badge("9U011")).toHaveAttribute("data-change", "new");
    await expect(badge("9U011")).toHaveText("NEW");
    await expect(badge("9U006")).toHaveAttribute("data-change", "removed");
    await expect(badge("9U006")).toHaveText("外れた");
    await expect(badge("9U001")).toHaveCount(0);
    await expect(badge("9U004")).toHaveCount(0);
    await expect(page.locator('[data-testid="watchlist-row"][data-code="9U011"]').getByTestId("watchlist-inclusion")).toHaveText("該当");
    await expect(page.locator('[data-testid="watchlist-row"][data-code="9U006"]').getByTestId("watchlist-inclusion")).toHaveText("該当しない（条件④）");
    const api = (await (await page.request.get("/api/watchlist")).json()).data;
    expect(api.items.map((item: { code: string; change: string | null }) => [item.code, item.change])).toEqual([
      ["9U001", null],
      ["9U006", "removed"],
      ["9U011", "added"],
      ["9U004", null],
    ]);
    expect((await changesApi(page.request)).added.find((c: { code: string }) => c.code === "9U011").watchlisted).toBe(true);

    const { context, page: page2 } = await newUserPage(browser, OWNER2);
    try {
      await expect.poll(() => changeCodes(page2, "added")).toEqual(["9U011", "9U012"]);
      await expect(page2.getByTestId("change-watchlisted")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("50 行を超えると「ほか N 銘柄」。API は全件（C4-9）", async ({ page }) => {
    await sql(PRESETS_SQL);
    await sql(
      `insert into public.screening_presets (user_id, name, query, is_default)
       select id, '全部', $1, false from auth.users where email = 'owner@quantis.local'`,
      [ALL_OFF],
    );
    await sql("update public.screening_presets set is_default = true where name = '全部'");
    await sql(
      `insert into public.stocks (code, company_name, market_code, market_name, sector33_code, sector33_name, product_category)
       select 'C' || lpad(i::text, 4, '0'), '変化検証' || i, '0113', 'グロース', '5250', '情報・通信業', '011' from generate_series(1, 51) i`,
    );
    await loginAs(page, OWNER);
    await expect(page.getByTestId("changes-added").getByTestId("change-row")).toHaveCount(50);
    await expect(page.getByTestId("changes-added-count")).toHaveText("51");
    await expect(page.getByTestId("changes-added").getByTestId("changes-more")).toContainText("ほか 1 銘柄");
    expect(await reasons(page, "added", "C0001")).toEqual([["new_stock", "新規の銘柄（前回は銘柄データなし）"]]);
    const api = await changesApi(page.request, ALL_OFF);
    expect(api.addedCodes).toHaveLength(51);
  });

  test("dev の時計のずれの下でも、ダッシュボード・スクリーニング・ウォッチリスト・詳細でエラーが出ない（C4-12）", async ({ browser }) => {
    await sql(WATCHLIST_SQL);
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await simulateServerClockBehind(context);
    const page = await context.newPage();
    const problems = collectPageProblems(page);
    try {
      await loginAs(page, OWNER);
      await expect.poll(() => changeCodes(page, "added")).toEqual(["9U011", "9U012"]);
      await page.goto(`/screening?${STANDARD}`);
      await expect.poll(() => newCodes(page)).toEqual(["9U011", "9U012"]);
      await page.goto("/watchlist");
      await expect(page.getByTestId("watchlist-row")).toHaveCount(4);
      await page.goto("/stocks/9U011");
      await expect(page.getByTestId("watchlist-toggle")).toHaveAttribute("aria-pressed", "true");
      expect(problems).toEqual([]);
    } finally {
      await context.close();
    }
  });
});

test.describe("読めないとき（C6-2）", () => {
  test("記録の銘柄を読めないと、ダッシュボードはエラー、スクリーニングは NEW なし、ウォッチリストは注記、API は 500", async ({ page }) => {
    await sql(EXAMPLE_SQL);
    await capture();
    await sql(AFTER_SQL);
    await sql(WATCHLIST_SQL);
    await loginAs(page, OWNER);
    try {
      await sql("revoke select on public.screening_snapshot_stocks from authenticated");
      await page.goto("/");
      await expect(page.getByTestId("changes-error")).toContainText("新たに該当・外れた銘柄を取得できませんでした");
      await expect(page.getByTestId("changes-none")).toHaveCount(0);
      await expect(page.getByTestId("stat-stocks")).toBeVisible();
      await page.goto(`/screening?${STANDARD}`);
      await expect(page.getByTestId("result-count")).toHaveText("6");
      await expect(page.getByTestId("new-load-error")).toHaveText("NEW の判定を取得できませんでした");
      await expect(page.getByTestId("new-badge")).toHaveCount(0);
      await page.goto("/watchlist");
      await expect(page.getByTestId("watchlist-row")).toHaveCount(4);
      await expect(page.getByTestId("watchlist-change-error")).toBeVisible();
      await expect(page.getByTestId("watchlist-change-badge")).toHaveCount(0);
      const res = await page.request.get("/api/screening/changes");
      expect(res.status()).toBe(500);
      expect(await res.json()).toEqual({ error: "internal_error" });
    } finally {
      await sql("grant select on public.screening_snapshot_stocks to authenticated");
    }
    await page.goto("/");
    await expect.poll(() => changeCodes(page, "added")).toEqual(["9U011", "9U012"]);
  });

  test("ウォッチリストを読めなくても、ダッシュボードの一覧は出て、星の印だけが出ない。API は 500（C6-1 の m3）", async ({ page }) => {
    await sql(EXAMPLE_SQL);
    await capture();
    await sql(AFTER_SQL);
    await sql(WATCHLIST_SQL);
    await loginAs(page, OWNER);
    try {
      await sql("revoke select on public.watchlist_items from authenticated");
      await page.goto("/");
      await expect.poll(() => changeCodes(page, "added")).toEqual(["9U011", "9U012"]);
      await expect(page.getByTestId("change-watchlisted")).toHaveCount(0);
      await expect(page.getByTestId("changes-error")).toHaveCount(0);
      const res = await page.request.get("/api/screening/changes");
      expect(res.status()).toBe(500);
    } finally {
      await sql("grant select on public.watchlist_items to authenticated");
    }
  });
});

test.describe("持ち越し（C9）", () => {
  test("件数の分母は上場中（C9-1）", async ({ page }) => {
    await sql(RELIABILITY_SQL);
    await loginAs(page, OWNER);
    await expect(page.getByTestId("stat-stocks")).toContainText("保存済みの銘柄数（上場中）");
    await expect(page.getByTestId("stat-stocks")).toContainText("3 銘柄");
    await expect(page.getByTestId("dashboard-delisted-count")).toHaveText("ほかに上場廃止 1 銘柄（スクリーニングの対象外）");
    const summary = (await (await page.request.get("/api/dashboard")).json()).data;
    expect(summary).toMatchObject({ stockCount: 3, delistedCount: 1 });
    await page.goto("/imports");
    await expect(page.getByTestId("financial-with-statements")).toContainText("上場中の 3 銘柄のうち");
    await expect(page.getByTestId("annual-report-stock-count")).toContainText("/ 3");
  });

  test("上場廃止の無い投入例は今までと同じ数。全銘柄が上場廃止でも空状態にしない（C9-2・C9-3）", async ({ page }) => {
    await sql(EXAMPLE_SQL);
    await loginAs(page, OWNER);
    await expect(page.getByTestId("stat-stocks")).toContainText("14 銘柄");
    await expect(page.getByTestId("dashboard-delisted-count")).toHaveCount(0);
    await page.goto("/imports");
    await expect(page.getByTestId("financial-with-statements")).toContainText("上場中の 14 銘柄のうち");
    await sql("update public.stocks set delisted_on = '2026-09-25' where code like '9U%'");
    await page.goto("/");
    await expect(page.getByTestId("stat-stocks")).toContainText("0 銘柄");
    await expect(page.getByTestId("dashboard-delisted-count")).toHaveText("ほかに上場廃止 14 銘柄（スクリーニングの対象外）");
  });

  test("プリセットの削除の直後の Esc 1回で管理のダイアログが閉じる（C9-5。Sprint 13 の m2）", async ({ page }) => {
    await sql(EXAMPLE_SQL);
    await loginAs(page, OWNER);
    for (const delay of [0, 100]) {
      await sql(PRESETS_SQL);
      await page.goto(`/screening?${STANDARD}`);
      await page.getByTestId("preset-manage-button").click();
      const manage = page.getByTestId("preset-manage-dialog");
      await expect(manage).toBeVisible();
      await manage.getByTestId("preset-row").filter({ hasText: "グロースのみ" }).getByRole("button", { name: "削除" }).click();
      await page.getByTestId("preset-delete-dialog").getByRole("button", { name: "削除" }).click();
      await expect(page.getByTestId("preset-status")).toHaveText("『グロースのみ』を削除しました");
      if (delay > 0) await page.waitForTimeout(delay);
      await page.keyboard.press("Escape");
      await expect(manage, `待ち時間 ${delay}ms`).toHaveCount(0);
      await sql(PRESETS_CLEANUP_SQL);
    }
  });

  test("既定のプリセットに無効な項目・正規形でない形があると、詳細・ダッシュボード・ウォッチリストに注記（C9-6。Sprint 13 の m3）", async ({ page }) => {
    await sql(EXAMPLE_SQL);
    await sql(WATCHLIST_SQL);
    const owner = await userId(OWNER.email);
    await sql("insert into public.screening_presets (user_id, name, query, is_default) values ($1, '範囲外', 'cagr=99999&margin=10&years=5&owner=20&ownermode=any&sort=cagr&order=desc', true)", [owner]);
    await loginAs(page, OWNER);
    const invalid = "既定のプリセット『範囲外』の条件の一部（cagr）が無効なため、既定値で";
    await expect(page.getByTestId("default-preset-invalid-note")).toHaveText(`${invalid}比較しています`);
    await page.goto("/stocks/9U006");
    await expect(page.getByTestId("default-preset-invalid-note")).toHaveText(`${invalid}判定しています`);
    await page.goto("/watchlist");
    await expect(page.getByTestId("default-preset-invalid-note")).toHaveText(`${invalid}判定しています`);

    await sql("update public.screening_presets set is_default = false where user_id = $1", [owner]);
    await sql(
      "insert into public.screening_presets (user_id, name, query, is_default) values ($1, '並び違い', 'cagr=20&margin=10&years=5&owner=20&ownermode=any&market=0113,0111&sort=cagr&order=desc', true)",
      [owner],
    );
    await page.goto("/stocks/9U006");
    await expect(page.getByTestId("default-preset-invalid-note")).toHaveText("既定のプリセット『並び違い』の条件を標準の形に直して判定しています");
  });
});

test.describe("画面のそのほか（C10）", () => {
  test.beforeEach(async () => {
    await sql(EXAMPLE_SQL);
    await capture();
    await sql(AFTER_SQL);
    await sql(WATCHLIST_SQL);
  });

  test("1280×800: スクリーニングの市場区分と注記がスクロールなしで見え、表とウォッチリストは横スクロールしない（C10-2）", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAs(page, OWNER);
    await page.goto(`/screening?${STANDARD}`);
    await expect.poll(() => newCodes(page)).toEqual(["9U011", "9U012"]);
    await expect(page.getByTestId("market-filter").first()).toBeInViewport();
    await expect(page.getByTestId("cagr-supplement-note").filter({ visible: true })).toBeInViewport();
    const scroll = page.getByTestId("results-scroll");
    expect(await scroll.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.goto("/watchlist");
    const wl = page.getByTestId("watchlist-scroll");
    await expect(wl).toBeVisible();
    expect(await wl.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  });

  test("375×812: 各画面が横スクロールせず、確認のダイアログが収まる。スクリーニングの注記はスクロールなしで見える（C10-3）", async ({ browser }) => {
    const { context, page } = await newUserPage(browser, OWNER, { width: 375, height: 812 });
    try {
      for (const path of ["/", `/screening?${STANDARD}`, "/watchlist", "/stocks/9U011"]) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(375);
      }
      await page.goto(`/screening?${STANDARD}`);
      await expect(page.getByTestId("cagr-supplement-note").filter({ visible: true })).toBeInViewport();
      await page.goto("/stocks/9U011");
      await page.getByTestId("watchlist-toggle").click();
      const dialog = page.getByTestId("watchlist-remove-dialog");
      await expect(dialog).toBeInViewport({ ratio: 1 });
      for (const name of ["外す", "キャンセル"]) await expect(dialog.getByRole("button", { name })).toBeInViewport();
      await dialog.getByRole("button", { name: "キャンセル" }).click();
    } finally {
      await context.close();
    }
  });
});
