/**
 * 財務の取り込みの結合テスト（ローカルの DB に実際に書き込む）。外部 API（fetch）と時計だけを差し替える（契約の C5）。
 * 実行: pnpm test:db（pnpm db:start と pnpm env:local が済み、銘柄マスタが0件の DB であること）
 * テストの銘柄コードは 9999x。作った stocks（通期実績と指標は連鎖して消える）、取得済みの開示日、ingestion_runs の行は後片付けする。
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { createAdminClient } = await import("@/lib/supabase/admin");
const { executeIngestionRun, startIngestionRun } = await import("./runner");
const { annualItem, calendarResponse, finsResponse, forecastRevisionItem, OFFICIAL_SAMPLE_ITEM, quarterItem } = await import(
  "./jquants/__fixtures__/fins-summary"
);
const { weekdaysBetween } = await import("./financials-period");

const DB_URL = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const ENV = { JQUANTS_API_KEY: "db-test-key" };
/** 実行日: 2026-09-24（木）22:00 JST。 */
const RUN_AT = Date.parse("2026-09-24T13:00:00Z");
const WINDOW_START = "2020-09-24";
const INVALID_KEY_BODY = { message: "The incoming api key is invalid or expired." };
const MISSING_KEY_BODY = { message: "The api key is required." };

const db = new Client({ connectionString: DB_URL });
let admin: SupabaseClient;
let firstRunId = 0;

type Reply = { status?: number; body?: unknown; delayMs?: number };
type Route = (url: URL) => Reply | undefined | Promise<Reply | undefined>;

/**
 * 取引カレンダー: 取得範囲の平日のうち、09-21（月）と 09-23（水）を非営業日（0）、09-19（土）を 3 にする。
 * それ以外の平日は営業日（1）、土日は 0。
 */
function calendarDays(extraHolidays: string[] = []) {
  const weekdays = new Set(weekdaysBetween(WINDOW_START, "2026-09-24"));
  const holidays = new Set(["2026-09-21", "2026-09-23", ...extraHolidays]);
  const days: { date: string; holDiv: string }[] = [];
  for (let date = WINDOW_START; date <= "2026-09-24"; ) {
    days.push({ date, holDiv: date === "2026-09-19" ? "3" : weekdays.has(date) && !holidays.has(date) ? "1" : "0" });
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    date = d.toISOString().slice(0, 10);
  }
  return days;
}

/** 営業日（新しい順）。 */
function businessDays(extraHolidays: string[] = []) {
  return calendarDays(extraHolidays)
    .filter((day) => day.holDiv === "1")
    .map((day) => day.date)
    .reverse();
}

/** 差し替えの fetch と時計。呼ばれた URL・x-api-key・開始時刻を記録する。 */
function fakeJQuants(route: Route, clock: ReturnType<typeof fakeClock>) {
  const calls: { url: string; apiKey: string | null; at: number }[] = [];
  const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    calls.push({ url: `${url.pathname}${url.search}`, apiKey: new Headers(init?.headers).get("x-api-key"), at: clock.clock.now() });
    let reply = await route(url);
    if (!reply && url.pathname === "/v2/markets/calendar") reply = { body: calendarResponse(calendarDays()) };
    reply ??= { body: finsResponse([]) };
    if (reply.delayMs) clock.advance(reply.delayMs);
    return new Response(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200 });
  });
  return { fetchImpl, calls };
}

function fakeClock(start = RUN_AT) {
  let now = start;
  return {
    clock: {
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
      },
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

async function insertStocks(codes: string[]) {
  for (const code of codes) {
    await db.query(
      `insert into public.stocks (code, company_name, market_code, market_name, sector33_code, sector33_name, product_category)
       values ($1, $2, '0113', 'グロース', '5250', '情報・通信業', '011') on conflict do nothing`,
      [code, `財務テスト${code}株式会社`],
    );
  }
}

async function run(id: number) {
  const { rows } = await db.query("select status, processed_count, error_message, details from public.ingestion_runs where id = $1", [id]);
  return rows[0];
}

async function statements() {
  const { rows } = await db.query(
    `select code, disclosure_no, net_sales::text, operating_profit::text, document_type, run_id::int
       from public.financial_statements where code like '9999%' order by code, disclosure_no`,
  );
  return rows;
}

async function fetchedDates() {
  const { rows } = await db.query("select disclosure_date::text as d from public.financial_fetched_dates order by 1 desc");
  return rows.map((row) => row.d as string);
}

async function ingest(
  route: Route,
  options: { clock?: ReturnType<typeof fakeClock>; env?: Record<string, string>; deadlineMs?: number } = {},
) {
  const clock = options.clock ?? fakeClock();
  const jq = fakeJQuants(route, clock);
  const start = await startIngestionRun(admin, "financials", "manual");
  if (!start.started) throw new Error("実行中の実行が残っています");
  const runId = start.runId;
  const outcome = await executeIngestionRun(runId, "financials", {
    admin,
    fetchImpl: jq.fetchImpl,
    env: options.env ?? ENV,
    clock: clock.clock,
    requestDeadline: clock.clock.now() + (options.deadlineMs ?? 210_000),
  });
  return { runId, outcome, calls: jq.calls, row: await run(runId) };
}

const finsDate = (url: URL) => (url.pathname === "/v2/fins/summary" ? url.searchParams.get("date") : null);

/** 取得範囲をすべて取得済みにする（2回目以降のテスト用）。 */
async function markAllFetched(except: string[] = []) {
  await db.query(
    `insert into public.financial_fetched_dates (disclosure_date, received_count)
     select d::date, 0 from unnest($1::text[]) as d on conflict do nothing`,
    [businessDays().filter((date) => !except.includes(date))],
  );
}

beforeAll(async () => {
  await db.connect();
  admin = createAdminClient();
  const { rows: running } = await db.query("select count(*)::int as n from public.ingestion_runs where status = 'running'");
  if (running[0].n > 0) throw new Error("実行中の実行が残っているため、結合テストを始められません");
  const { rows: others } = await db.query(
    "select (select count(*) from public.stocks where code not like '9999%')::int + (select count(*) from public.financial_fetched_dates)::int as n",
  );
  if (others[0].n > 0) {
    throw new Error("テスト以外の銘柄または取得済みの開示日があるため、財務の結合テストを始められません（pnpm db:reset 直後の DB で実行してください）");
  }
  const { rows: seq } = await db.query("select coalesce(max(id), 0)::bigint + 1 as next from public.ingestion_runs");
  firstRunId = Number(seq[0].next);
});

beforeEach(async () => {
  await db.query("delete from public.stocks where code like '9999%'");
  await db.query("delete from public.financial_fetched_dates");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await db.query("delete from public.ingestion_runs where id >= $1 and status = 'running'", [firstRunId]);
  vi.restoreAllMocks();
});

afterAll(async () => {
  await db.query("delete from public.stocks where code like '9999%'");
  await db.query("delete from public.financial_fetched_dates");
  await db.query("delete from public.ingestion_runs where id >= $1", [firstRunId]);
  await db.end();
});

const FY25 = { fyStart: "2024-04-01", fyEnd: "2025-03-31" };

describe("財務の取り込み（DB 込み）", () => {
  it("初回（C5-1）: カレンダーの営業日だけを要求し、通期の決算短信だけを保存する。四半期・予想・未知のコード・壊れた行は保存しない", async () => {
    await insertStocks(["99991", "99992", "99993", "99994"]);
    const route: Route = (url) => {
      if (finsDate(url) !== "2026-09-24") return undefined;
      if (url.searchParams.get("pagination_key") === "p2") {
        return {
          body: finsResponse([
            annualItem({ code: "13010", discNo: "D5", discDate: "2026-09-24", ...FY25, sales: "5", op: "1" }),
            { ...annualItem({ code: "99994", discNo: "D6", discDate: "2026-09-24", ...FY25, sales: "5", op: "1" }), CurFYEn: "2025/03/31" },
            OFFICIAL_SAMPLE_ITEM,
          ]),
        };
      }
      return {
        body: finsResponse(
          [
            annualItem({ code: "99991", discNo: "D1", discDate: "2026-09-24", ...FY25, sales: "40000000000", op: "6000000000" }),
            annualItem({
              code: "99992",
              discNo: "D2",
              discDate: "2026-09-24",
              docType: "FYFinancialStatements_NonConsolidated_JP",
              ...FY25,
              sales: "",
              op: "",
              extra: { NCSales: "100000000000", NCOP: "12000000000" },
            }),
            quarterItem("99993", "2026-09-24", "D3"),
            forecastRevisionItem("99993", "2026-09-24", "D4"),
          ],
          "p2",
        ),
      };
    };
    const { runId, outcome, calls, row } = await ingest(route, { deadlineMs: 15_000 });

    expect(await statements()).toEqual([
      { code: "99991", disclosure_no: "D1", net_sales: "40000000000", operating_profit: "6000000000", document_type: "FYFinancialStatements_Consolidated_JP", run_id: runId },
      { code: "99992", disclosure_no: "D2", net_sales: "100000000000", operating_profit: "12000000000", document_type: "FYFinancialStatements_NonConsolidated_JP", run_id: runId },
    ]);
    const { rows: metrics } = await db.query(
      "select code, operating_margin_display_pct::text as pct from public.financial_metrics where code like '9999%' order by code",
    );
    expect(metrics).toEqual([
      { code: "99991", pct: "15.0" },
      { code: "99992", pct: "12.0" },
    ]);

    // 最初は取引カレンダー、続いて直近7日の営業日（09-24、09-22、09-18）。土日・祝日（09-19〜21、09-23）は要求しない
    expect(calls[0].url).toBe(`/v2/markets/calendar?from=${WINDOW_START}&to=2026-09-24`);
    expect(calls.slice(1, 5).map((call) => call.url)).toEqual([
      "/v2/fins/summary?date=2026-09-24",
      "/v2/fins/summary?date=2026-09-24&pagination_key=p2",
      "/v2/fins/summary?date=2026-09-22",
      "/v2/fins/summary?date=2026-09-18",
    ]);
    const requested = calls.filter((call) => call.url.startsWith("/v2/fins/summary")).map((call) => call.url.slice(-10));
    for (const holiday of ["2026-09-19", "2026-09-20", "2026-09-21", "2026-09-23"]) expect(requested).not.toContain(holiday);
    expect(calls.every((call) => call.apiKey === "db-test-key")).toBe(true);

    // 15 秒の期限で打ち切り（時間切れ）: 1回目の実行は一部失敗
    expect(outcome.status).toBe("partial");
    expect(row.processed_count).toBe(2);
    expect(row.error_message).toMatch(/^時間内に処理しきれなかったため、残り [\d,]+ 日分の開示日は次回の取り込みで処理します。1 件の開示は形式が想定と異なるため保存しませんでした$/);
    expect(row.details).toMatchObject({
      windowStart: WINDOW_START,
      windowEnd: "2026-09-24",
      calendar: "jquants",
      datesInWindow: businessDays().length,
      datesFetchedBefore: 0,
      recentDates: 3,
      annualRows: 3,
      savedStatements: 2,
      skippedUnknownCode: 1,
      invalidRows: 1,
      stoppedReason: "time_budget",
      rowsReceived: 7,
    });
    expect(row.details.datesFetched).toBe((await fetchedDates()).length);
    expect(row.details.datesRemaining).toBe(businessDays().length - row.details.datesFetched);
    expect(row.details.apiCalls).toBe(calls.length);
  });

  it("続きから（C5-2）: 取得済みの日は飛ばし、未取得の日を新しい順に要求する。すべて取得すると成功で、以降は直近の分だけ", async () => {
    await insertStocks(["99991"]);
    const all = businessDays();
    // 1回目: 直近3日と、その先の2日だけ
    await ingest(() => undefined, { deadlineMs: 6 * 1_100 });
    expect(await fetchedDates()).toEqual(all.slice(0, 5));

    const second = await ingest(() => undefined, { deadlineMs: 6 * 1_100 });
    const urls = second.calls.map((call) => call.url);
    expect(urls.slice(1)).toEqual([...all.slice(0, 3), ...all.slice(5, 7)].map((date) => `/v2/fins/summary?date=${date}`));

    // 残りを取得済みにして、最後の1日だけ未取得にする
    await markAllFetched([all.at(-1)!]);
    const third = await ingest(() => undefined);
    expect(third.outcome.status).toBe("succeeded");
    expect(third.row.error_message).toBeNull();
    expect(third.calls.slice(1).map((call) => call.url)).toEqual(
      [...all.slice(0, 3), all.at(-1)!].map((date) => `/v2/fins/summary?date=${date}`),
    );
    expect(third.row.details).toMatchObject({ datesRemaining: 0, stoppedReason: null });

    const fourth = await ingest(() => undefined);
    expect(fourth.calls).toHaveLength(4); // カレンダーと直近3日
    expect(fourth.outcome).toMatchObject({ status: "succeeded", processedCount: 0 });
  });

  it("取り直しと上書き（C5-3）: 同じ開示番号の値が変われば上書きして指標も計算し直す。値が同じなら件数に数えない", async () => {
    await insertStocks(["99991"]);
    await markAllFetched();
    let sales = "100000000000";
    const route: Route = (url) =>
      finsDate(url) === "2026-09-22"
        ? { body: finsResponse([annualItem({ code: "99991", discNo: "R1", discDate: "2026-09-22", ...FY25, sales, op: "10000000000" })]) }
        : undefined;
    expect((await ingest(route)).outcome).toMatchObject({ status: "succeeded", processedCount: 1 });
    expect((await ingest(route)).outcome).toMatchObject({ status: "succeeded", processedCount: 0 });
    sales = "50000000000";
    expect((await ingest(route)).outcome).toMatchObject({ status: "succeeded", processedCount: 1 });
    const { rows } = await db.query("select operating_margin_display_pct::text as pct from public.financial_metrics where code = '99991'");
    expect(rows[0].pct).toBe("20.0");
  });

  it("キー未設定（C5-4）・銘柄マスタが0件（C5-5）は fetch を呼ばずに失敗", async () => {
    const noKey = await ingest(() => undefined, { env: {} });
    expect(noKey.calls).toHaveLength(0);
    expect(noKey.row).toMatchObject({ status: "failed", processed_count: 0, error_message: "J-Quants の API キーが設定されていません" });

    const empty = await ingest(() => undefined);
    expect(empty.calls).toHaveLength(0);
    expect(empty.row).toMatchObject({
      status: "failed",
      error_message: "銘柄マスタが未取り込みのため、財務情報を取り込めません。先に銘柄マスタを取り込んでください",
    });
  });

  it("403・401・429（C5-6）: キーの無効・欠如は要求1回で失敗。キー以外の 403 はその日だけ。途中の 429・401 は打ち切り。本文は残さない", async () => {
    await insertStocks(["99991"]);
    for (const body of [INVALID_KEY_BODY, MISSING_KEY_BODY]) {
      const { calls, row } = await ingest(() => ({ status: 403, body }));
      expect(calls).toHaveLength(1);
      expect(row).toMatchObject({ status: "failed", error_message: "J-Quants の API キーが無効か、契約プランでは利用できません（HTTP 403）" });
      expect(JSON.stringify(row)).not.toContain(body.message);
    }

    const plan = await ingest((url) => (finsDate(url) === "2026-09-22" ? { status: 403, body: { message: "Access denied by plan" } } : undefined), {
      deadlineMs: 5 * 1_100,
    });
    expect(plan.row.details).toMatchObject({ datesFailed: 1, lastFailedStatus: 403 });
    expect(JSON.stringify(plan.row)).not.toContain("Access denied by plan");
    expect(await fetchedDates()).not.toContain("2026-09-22");

    await db.query("delete from public.financial_fetched_dates");
    const limited = await ingest((url) => (finsDate(url) === "2026-09-18" ? { status: 429 } : undefined));
    expect(limited.calls.map((call) => call.url.slice(-10))).toEqual(["2026-09-24", "2026-09-24", "2026-09-22", "2026-09-18"]);
    expect(limited.row.status).toBe("partial");
    expect(limited.row.error_message).toMatch(/^J-Quants の呼び出し回数の上限に達しました（HTTP 429）。しばらくしてから再実行してください。残り [\d,]+ 日分の開示日は次回の取り込みで処理します$/);
    expect(limited.row.details.stoppedReason).toBe("rate_limited");

    const unauthorized = await ingest((url) => (finsDate(url) ? { status: 401 } : undefined));
    expect(unauthorized.row).toMatchObject({ status: "failed", error_message: "J-Quants の API キーが無効か、契約プランでは利用できません（HTTP 401）" });
    expect(unauthorized.calls).toHaveLength(2);
  });

  it("開示日ごとの失敗と連続失敗（C5-7）: 1日だけの 500、2ページ目の 500、210・400、5回続けば打ち切り", async () => {
    await insertStocks(["99991"]);
    await markAllFetched();
    const one = await ingest((url) => (finsDate(url) === "2026-09-22" ? { status: 500 } : undefined));
    expect(one.row).toMatchObject({
      status: "partial",
      error_message: "1 日分の開示日で財務情報を取得できませんでした。次回の取り込みで再試行します",
    });

    // 2ページ目だけ 500 なら、1ページ目の行も保存しない
    const paged = await ingest((url) => {
      if (finsDate(url) !== "2026-09-24") return undefined;
      if (url.searchParams.get("pagination_key")) return { status: 500 };
      return { body: finsResponse([annualItem({ code: "99991", discNo: "P1", discDate: "2026-09-24", ...FY25, sales: "1", op: "1" })], "p2") };
    });
    expect(paged.row.details.datesFailed).toBe(1);
    expect(await statements()).toEqual([]);

    const mixed = await ingest((url) => (finsDate(url) === "2026-09-24" ? { status: 210 } : finsDate(url) === "2026-09-22" ? { status: 400 } : undefined));
    expect(mixed.row.details).toMatchObject({ datesFailed: 2, datesFetched: 1 });
    expect(mixed.row.error_message).toBe("2 日分の開示日で財務情報を取得できませんでした。次回の取り込みで再試行します");

    await db.query("delete from public.financial_fetched_dates");
    const failing = await ingest((url) => (finsDate(url) ? { status: 500 } : undefined));
    expect(failing.calls).toHaveLength(1 + 5);
    expect(failing.row).toMatchObject({
      status: "failed",
      error_message: "財務情報の取得に5回続けて失敗したため中断しました（最後の応答は HTTP 500）",
    });
    expect(failing.row.details.stoppedReason).toBe("consecutive_failures");
  });

  it("形式の違い（C5-8）: data が配列でない・JSON でない・Code の欠けた行は、その日の失敗", async () => {
    await insertStocks(["99991"]);
    await markAllFetched();
    const result = await ingest((url) => {
      const date = finsDate(url);
      if (date === "2026-09-24") return { body: { data: {} } };
      if (date === "2026-09-22") return { body: "<html>" };
      if (date === "2026-09-18") return { body: { data: [{ DocType: "FYFinancialStatements_Consolidated_JP" }] } };
      return undefined;
    });
    expect(result.row.details).toMatchObject({ datesFailed: 3, datesFetched: 0 });
    expect(result.row.status).toBe("failed");
  });

  it("要求の間隔（C5-9。R6）: 開始から開始までが 1,100 ミリ秒以上。応答に 1,500 ミリ秒かかれば待たない", async () => {
    await insertStocks(["99991"]);
    await markAllFetched();
    const slow = await ingest((url) => (finsDate(url) === "2026-09-24" ? { delayMs: 1_500 } : undefined));
    const gaps = slow.calls.slice(1).map((call, i) => call.at - slow.calls[i].at);
    expect(gaps.every((gap) => gap >= 1_100)).toBe(true);
    // 09-24 の要求（1,500 ミリ秒）の直後の要求は、待たずに始まる（間隔は 1,500 ミリ秒ちょうど）
    expect(gaps[1]).toBe(1_500);
  });

  it("後片付けされた実行（C5-10）: 途中で failed にされたら、それ以降は保存せず、行は上書きしない", async () => {
    await insertStocks(["99991"]);
    await markAllFetched();
    let runIdToKill = 0;
    const route: Route = async (url) => {
      if (finsDate(url) === "2026-09-22") {
        await db.query("update public.ingestion_runs set status = 'failed', finished_at = now(), error_message = 'stale' where id = $1", [
          runIdToKill,
        ]);
        return { body: finsResponse([annualItem({ code: "99991", discNo: "K1", discDate: "2026-09-22", ...FY25, sales: "1", op: "1" })]) };
      }
      return undefined;
    };
    const { rows } = await db.query("select coalesce(max(id), 0)::int + 1 as next from public.ingestion_runs");
    runIdToKill = rows[0].next;
    const result = await ingest(route);
    expect(result.runId).toBe(runIdToKill);
    expect(result.outcome.status).toBe("failed");
    expect(result.row).toMatchObject({ status: "failed", error_message: "stale" });
    expect(await statements()).toEqual([]);
  });

  it("保存の単位（C5-11）: 例外で止まっても、それまでの開示日の行・記録・件数は残り、例外の日のものは残らない", async () => {
    await insertStocks(["99991", "99992"]);
    await markAllFetched();
    const route: Route = (url) => {
      const date = finsDate(url);
      if (date === "2026-09-24") return { body: finsResponse([annualItem({ code: "99991", discNo: "U1", discDate: date, ...FY25, sales: "1", op: "1" })]) };
      if (date === "2026-09-22") return { body: finsResponse([annualItem({ code: "99992", discNo: "U2", discDate: date, ...FY25, sales: "1", op: "1" })]) };
      return undefined;
    };
    const original = admin.rpc.bind(admin);
    let saves = 0;
    const spy = vi.spyOn(admin, "rpc").mockImplementation(((fn: string, args?: Record<string, unknown>) => {
      if (fn === "save_financial_statements") {
        saves += 1;
        if (saves === 2) throw new Error("connection reset");
      }
      return original(fn, args);
    }) as typeof admin.rpc);
    const result = await ingest(route);
    spy.mockRestore();
    expect(result.row).toMatchObject({ status: "failed", processed_count: 1, error_message: "予期しないエラーで取り込みを完了できませんでした" });
    expect((await statements()).map((row) => row.disclosure_no)).toEqual(["U1"]);
    const { rows } = await db.query("select received_count, run_id::int from public.financial_fetched_dates where disclosure_date = '2026-09-24'");
    expect(rows).toEqual([{ received_count: 1, run_id: result.runId }]);
  });

  it("取引カレンダー（C5-12。R1）: 500・形式の違いなら平日で代用して続ける。キーの無効なら要求1回で失敗", async () => {
    await insertStocks(["99991"]);
    await markAllFetched();
    for (const reply of [{ status: 500 }, { body: { data: "x" } }]) {
      const result = await ingest((url) => (url.pathname === "/v2/markets/calendar" ? reply : undefined));
      expect(result.row.status).toBe("succeeded");
      expect(result.row.details.calendar).toBe("weekdays_fallback");
      // 平日で代用するので、祝日（09-21、09-23）も要求する
      expect(result.calls.slice(1).map((call) => call.url.slice(-10))).toEqual(["2026-09-24", "2026-09-23", "2026-09-22", "2026-09-21", "2026-09-18"]);
    }
    const rejected = await ingest((url) => (url.pathname === "/v2/markets/calendar" ? { status: 403, body: INVALID_KEY_BODY } : undefined));
    expect(rejected.calls).toHaveLength(1);
    expect(rejected.row).toMatchObject({ status: "failed", error_message: "J-Quants の API キーが無効か、契約プランでは利用できません（HTTP 403）" });
  });
});
