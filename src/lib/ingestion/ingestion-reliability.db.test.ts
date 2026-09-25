/**
 * Sprint 12（日次取り込みの信頼性）の取り込みの結合テスト。外部 API（fetch）と時計だけを差し替え、実際の DB に対して動かす。
 * - 株価: 期限での一部完了と、次の実行での再開（C1-1）。一部の銘柄の失敗と失敗の行（C2-1・C2-5）。続けての失敗の打ち切り（C2-2）
 *   呼び出しの制限の待機と再試行（C3-1・C3-2・C3-3）
 * - 銘柄マスタ: 上場廃止の確認・再上場・大量の消失の保留（C6-1〜C6-3）。呼び出しの制限の再試行（C3-5）
 * 実行: pnpm test:db（pnpm db:reset 直後の DB。銘柄マスタにテスト以外の銘柄が無く、株価の成功の実行が無いこと）
 * 作る行: 銘柄 9N9xx（上場廃止の保護は 9N9 + 3桁で 150 銘柄）、実行は開始時の最大 id より後。後片付けはこれらだけを消す。
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { createAdminClient } = await import("@/lib/supabase/admin");
const { executeIngestionRun, startIngestionRun } = await import("./runner");
const { barItem, barsResponse } = await import("./jquants/__fixtures__/bars-daily");
const { masterItem } = await import("./jquants/__fixtures__/equities-master");

const DB_URL = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const ENV = { JQUANTS_API_KEY: "db-test-key-sprint12" };
const RUN_AT = Date.parse("2026-09-24T11:00:00Z");
/** データ期間の開始日の探索の1日目。ここに行があれば W = この日 */
const W = "2016-09-25";

const db = new Client({ connectionString: DB_URL });
let admin: SupabaseClient;
let firstRunId = 0;

type Reply = { status?: number; body?: unknown; headers?: Record<string, string>; error?: Error };
type Route = (url: URL) => Reply | undefined;

function fakeClock(start = RUN_AT) {
  let now = start;
  const sleeps: number[] = [];
  return {
    sleeps,
    clock: {
      now: () => now,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        now += ms;
      },
    },
  };
}

function fakeJQuants(route: Route, clock: { now(): number }) {
  const calls: { path: string; code: string | null; at: number }[] = [];
  const fetchImpl = vi.fn(async (input: string) => {
    const url = new URL(input);
    calls.push({ path: `${url.pathname}${url.search}`, code: url.searchParams.get("code"), at: clock.now() });
    const reply = route(url) ?? { body: barsResponse([]) };
    if (reply.error) throw reply.error;
    return new Response(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body ?? {}), {
      status: reply.status ?? 200,
      headers: reply.headers,
    });
  });
  return { fetchImpl, calls };
}

async function insertStocks(codes: string[]) {
  await db.query(
    `insert into public.stocks (code, company_name, market_code, market_name, sector33_code, sector33_name, product_category, listed_info_date)
     select c, '信頼性テスト' || c || '株式会社', '0113', 'グロース', '5250', '情報・通信業', '011', '2026-09-23' from unnest($1::text[]) c`,
    [codes],
  );
}

async function runRow(id: number) {
  const { rows } = await db.query(
    `select status, processed_count, error_message, details, stopped_reason, remaining_count, remaining_unit, failed_count, last_progress_at
       from public.ingestion_runs where id = $1`,
    [id],
  );
  return rows[0];
}

async function failuresOf(id: number) {
  const { rows } = await db.query(
    "select item_type, item_key, code, reason, http_status, network_error from public.ingestion_run_failures where run_id = $1 order by id",
    [id],
  );
  return rows;
}

async function ingest(
  target: "daily_quotes" | "stock_master",
  route: Route,
  options: { deadlineMs?: number; clock?: ReturnType<typeof fakeClock> } = {},
) {
  const clock = options.clock ?? fakeClock();
  const jq = fakeJQuants(route, clock.clock);
  const start = await startIngestionRun(admin, target, "manual");
  if (!start.started) throw new Error("実行中の実行が残っています");
  const outcome = await executeIngestionRun(start.runId, target, {
    admin,
    fetchImpl: jq.fetchImpl,
    env: ENV,
    clock: clock.clock,
    requestDeadline: clock.clock.now() + (options.deadlineMs ?? 1_000_000),
  });
  return { runId: start.runId, outcome, calls: jq.calls, clock, row: await runRow(start.runId) };
}

/** W の日に行がある（13010 はテスト外の銘柄で、どの銘柄も「データ期間開始以前」にならない）。コードごとの応答は codeReply */
function barsRoute(codeReply: (code: string) => Reply | undefined): Route {
  return (url) => {
    if (url.searchParams.get("date") === W) return { body: barsResponse([barItem("13010", W)]) };
    const code = url.searchParams.get("code");
    if (code) return codeReply(code) ?? { body: barsResponse([barItem(code, "2022-04-01")]) };
    return undefined;
  };
}

const codeCalls = (calls: { code: string | null }[]) => calls.filter((c) => c.code !== null).map((c) => c.code);

beforeAll(async () => {
  await db.connect();
  admin = createAdminClient();
  const { rows: running } = await db.query("select count(*)::int as n from public.ingestion_runs where status = 'running'");
  if (running[0].n > 0) throw new Error("実行中の実行が残っているため、結合テストを始められません");
  const { rows: others } = await db.query("select count(*)::int as n from public.stocks where code not like '9N9%'");
  if (others[0].n > 0) {
    throw new Error("銘柄マスタにテスト以外の銘柄があるため、結合テストを始められません（pnpm db:reset 直後の DB で実行してください）");
  }
  const { rows: seq } = await db.query("select coalesce(max(id), 0)::bigint + 1 as next from public.ingestion_runs");
  firstRunId = Number(seq[0].next);
});

beforeEach(async () => {
  await db.query("delete from public.stocks where code like '9N9%'");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await db.query("delete from public.ingestion_runs where id >= $1 and status = 'running'", [firstRunId]);
  vi.restoreAllMocks();
});

afterAll(async () => {
  await db.query("delete from public.stocks where code like '9N9%'");
  await db.query("delete from public.ingestion_runs where id >= $1", [firstRunId]);
  await db.end();
});

const TEN = Array.from({ length: 10 }, (_, i) => `9N9${String(i).padStart(2, "0")}`);

describe("株価の初出日（Sprint 12）", () => {
  it("期限で止まると一部完了（残りの銘柄数を記録）。次の実行は残りの銘柄だけを要求して終える（C1-1）", async () => {
    await insertStocks(TEN);
    // 要求の間隔 600ms: 探索 0ms、銘柄 600・1200・1800・2400ms。2400ms で期限（新しい要求を始めない）
    const first = await ingest("daily_quotes", barsRoute(() => undefined), { deadlineMs: 2_400 });
    expect(first.outcome).toMatchObject({ status: "partial", processedCount: 4 });
    expect(first.row).toMatchObject({
      status: "partial",
      processed_count: 4,
      stopped_reason: "time_budget",
      remaining_count: 6,
      remaining_unit: "stocks",
      failed_count: 0,
      error_message: "時間内に処理しきれなかったため、残り 6 銘柄は次回の取り込みで処理します",
    });
    expect(first.row.last_progress_at).not.toBeNull();
    const saved = codeCalls(first.calls);
    expect(saved).toEqual(TEN.slice(0, 4));

    const second = await ingest("daily_quotes", barsRoute(() => undefined));
    expect(codeCalls(second.calls)).toEqual(TEN.slice(4));
    expect(second.row).toMatchObject({ status: "succeeded", processed_count: 6, remaining_count: 0, stopped_reason: null, failed_count: 0 });
  });

  it("一部の銘柄の失敗（500・タイムアウト）はほかの銘柄を止めず、失敗の行に残る。次の実行は失敗した銘柄だけ（C2-1・C2-5）", async () => {
    const codes = TEN.slice(0, 5);
    await insertStocks(codes);
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    const route = barsRoute((code) =>
      code === "9N901" ? { status: 500, body: { message: "SECRET-BODY-MARKER-500" } } : code === "9N903" ? { error: timeout } : undefined,
    );
    const first = await ingest("daily_quotes", route);
    expect(first.row).toMatchObject({ status: "partial", processed_count: 3, failed_count: 2, stopped_reason: null, remaining_count: 0 });
    expect(await failuresOf(first.runId)).toEqual([
      { item_type: "stock", item_key: "9N901", code: "9N901", reason: "http_error", http_status: 500, network_error: null },
      { item_type: "stock", item_key: "9N903", code: "9N903", reason: "unreachable", http_status: null, network_error: "timeout" },
    ]);
    const stored = JSON.stringify(first.row) + JSON.stringify(await failuresOf(first.runId));
    expect(stored).not.toContain("SECRET-BODY-MARKER");
    expect(stored).not.toContain(ENV.JQUANTS_API_KEY);

    const second = await ingest("daily_quotes", barsRoute(() => undefined));
    expect(codeCalls(second.calls)).toEqual(["9N901", "9N903"]);
    expect(second.row).toMatchObject({ status: "succeeded", failed_count: 0 });
  });

  it("5銘柄続けて失敗したら、6銘柄目を要求せずに打ち切る。成功を挟めば数え直す（C2-2）", async () => {
    await insertStocks(TEN.slice(0, 7));
    const all500 = await ingest("daily_quotes", barsRoute(() => ({ status: 500, body: {} })));
    expect(codeCalls(all500.calls)).toHaveLength(5);
    expect(all500.row).toMatchObject({
      status: "failed",
      stopped_reason: "consecutive_failures",
      failed_count: 5,
      error_message: "株価の取得に5回続けて失敗したため中断しました（最後の応答は HTTP 500）",
    });

    await db.query("delete from public.stocks where code like '9N9%'");
    await insertStocks(TEN.slice(0, 7));
    // 失敗・失敗・成功・失敗×4 → 打ち切らない
    const pattern = (code: string) => (code === "9N902" ? undefined : { status: 500, body: {} });
    const mixed = await ingest("daily_quotes", barsRoute(pattern));
    expect(codeCalls(mixed.calls)).toHaveLength(7);
    expect(mixed.row).toMatchObject({ status: "partial", stopped_reason: null, failed_count: 6, processed_count: 1 });
  });

  it("429 を2回受けてから回復: 15・30 秒待って再試行し、回復後の間隔は 1,200ms 以上（C3-1）", async () => {
    await insertStocks(TEN.slice(0, 3));
    let limited = 0;
    const route = barsRoute((code) => (code === "9N901" && limited++ < 2 ? { status: 429, body: {} } : undefined));
    const result = await ingest("daily_quotes", route);
    expect(result.row.status).toBe("succeeded");
    expect(result.row.details.rateLimit).toEqual({ hits: 2, retries: 2, waitedMs: 45_000, exhausted: false });
    expect(result.clock.sleeps).toContain(15_000);
    expect(result.clock.sleeps).toContain(30_000);
    const byCode = result.calls.filter((c) => c.code !== null);
    expect(byCode.map((c) => c.code)).toEqual(["9N900", "9N901", "9N901", "9N901", "9N902"]);
    expect(byCode[4].at - byCode[3].at).toBeGreaterThanOrEqual(1_200);
  });

  it("Retry-After: 7 なら 7 秒待つ。600 なら 120 秒に収める（C3-3）", async () => {
    await insertStocks(["9N900"]);
    let n = 0;
    const seven = await ingest("daily_quotes", barsRoute(() => (n++ === 0 ? { status: 429, headers: { "retry-after": "7" }, body: {} } : undefined)));
    expect(seven.clock.sleeps).toContain(7_000);
    await db.query("delete from public.stocks where code like '9N9%'");
    await insertStocks(["9N900"]);
    let m = 0;
    const capped = await ingest("daily_quotes", barsRoute(() => (m++ === 0 ? { status: 429, headers: { "retry-after": "600" }, body: {} } : undefined)));
    expect(capped.clock.sleeps).toContain(120_000);
    expect(capped.row.details.rateLimit).toMatchObject({ hits: 1, retries: 1, waitedMs: 120_000 });
  });

  it("待ちの終わりが期限を超えるなら待たずに打ち切る（C3-4）", async () => {
    await insertStocks(TEN.slice(0, 2));
    const result = await ingest("daily_quotes", barsRoute((code) => (code === "9N901" ? { status: 429, body: {} } : undefined)), {
      deadlineMs: 10_000,
    });
    expect(result.clock.sleeps.every((ms) => ms < 15_000)).toBe(true);
    expect(result.row).toMatchObject({ status: "partial", stopped_reason: "rate_limited", processed_count: 1 });
    expect(result.row.error_message).toContain("待ち時間が取り込みの時間の上限を超えるため中断しました");
  });
});

describe("銘柄マスタと上場廃止（Sprint 12）", () => {
  const master = (codes: string[], date = "2026-09-24", extra: object[] = []) => ({
    data: [...codes.map((code) => masterItem({ Code: code, CoName: `信頼性テスト${code}株式会社`, Date: date, Mkt: "0113", MktNm: "グロース" })), ...extra],
  });
  const delisted = async () =>
    (await db.query("select code, delisted_on::text from public.stocks where code like '9N9%' and delisted_on is not null order by code")).rows;

  it("一覧から消えた銘柄は上場廃止（行は残る）。再び現れたら戻る。対象外になった銘柄も上場廃止（C6-1・C6-2）", async () => {
    await insertStocks(["9N901", "9N902", "9N903", "9N904"]);
    const first = await ingest("stock_master", () => ({ body: master(["9N901", "9N902"], "2026-09-18", [masterItem({ Code: "9N904", CoName: "市場変更", Mkt: "0109", MktNm: "その他", Date: "2026-09-18" })]) }));
    expect(first.row).toMatchObject({ status: "succeeded", stopped_reason: null });
    expect(first.row.details).toMatchObject({ delistedDetected: 2, relisted: 0, delistingHeld: 0 });
    expect(await delisted()).toEqual([
      { code: "9N903", delisted_on: "2026-09-18" },
      { code: "9N904", delisted_on: "2026-09-18" },
    ]);
    expect((await db.query("select company_name from public.stocks where code = '9N903'")).rows[0].company_name).toBe("信頼性テスト9N903株式会社");

    const second = await ingest("stock_master", () => ({ body: master(["9N901", "9N902", "9N903"], "2026-09-19") }));
    expect(second.row.details).toMatchObject({ delistedDetected: 0, relisted: 1 });
    expect(await delisted()).toEqual([{ code: "9N904", delisted_on: "2026-09-18" }]);
  });

  it("1回で 101 銘柄が消えたら上場廃止を反映せず一部失敗（保留）。100 銘柄ちょうどなら反映する（C6-3）", async () => {
    const codes = Array.from({ length: 150 }, (_, i) => `9N9${i.toString(36).toUpperCase().padStart(2, "0")}`);
    await insertStocks(codes);
    // 150 銘柄のうち 49 銘柄だけが一覧にある → 101 銘柄が消える
    const held = await ingest("stock_master", () => ({ body: master(codes.slice(0, 49)) }));
    expect(held.outcome.status).toBe("partial");
    expect(held.row).toMatchObject({
      status: "partial",
      stopped_reason: "delisting_held",
      error_message: "銘柄マスタから一度に 101 銘柄が消えたため、上場廃止の反映を保留しました",
      processed_count: 49,
    });
    expect(held.row.details).toMatchObject({ delistedDetected: 0, delistingHeld: 101 });
    expect(await delisted()).toEqual([]);

    // 50 銘柄が一覧にある → 100 銘柄が消える → 反映する
    const applied = await ingest("stock_master", () => ({ body: master(codes.slice(0, 50)) }));
    expect(applied.row).toMatchObject({ status: "succeeded", stopped_reason: null });
    expect(applied.row.details).toMatchObject({ delistedDetected: 100 });
    expect(await delisted()).toHaveLength(100);
  });

  it("銘柄マスタの 429 は待って再試行し、回復すれば成功（C3-5）", async () => {
    let n = 0;
    const result = await ingest("stock_master", () => (n++ < 1 ? { status: 429, body: {} } : { body: master(["9N901"]) }));
    expect(result.row).toMatchObject({ status: "succeeded", processed_count: 1 });
    expect(result.row.details).toMatchObject({ apiCalls: 2, rateLimit: { hits: 1, retries: 1, waitedMs: 15_000, exhausted: false } });
    const exhausted = await ingest("stock_master", () => ({ status: 429, body: {} }));
    expect(exhausted.row).toMatchObject({
      status: "failed",
      stopped_reason: "rate_limited",
      error_message: "J-Quants の呼び出し回数の上限に達しました（HTTP 429）。3 回待って再試行しましたが解消しなかったため中断しました",
    });
    expect(exhausted.calls).toHaveLength(4);
  });
});
