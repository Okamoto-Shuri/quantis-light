/**
 * 株価の初出日の取り込みの結合テスト（ローカルの DB に実際に書き込む）。外部 API（fetch）と時計だけを差し替える。
 * 実行: pnpm test:db（pnpm db:start と pnpm env:local が済み、銘柄マスタが0件の DB であること）
 * テストの銘柄コードは 9999x（`like '9999%'`）。作った stocks（初出日は連鎖して消える）と ingestion_runs の行は後片付けする。
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { createAdminClient } = await import("@/lib/supabase/admin");
const { executeIngestionRun, startIngestionRun } = await import("./runner");
const { barItem, barsResponse, INVALID_KEY_BODY, MISSING_KEY_BODY, OUT_OF_PLAN_BODY } = await import(
  "./jquants/__fixtures__/bars-daily"
);

const DB_URL = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const ENV = { JQUANTS_API_KEY: "db-test-key" };
/** 実行日: 2026-09-24 20:00 JST。探索は 2016-09-25（日曜）から。 */
const RUN_AT = Date.parse("2026-09-24T11:00:00Z");
const DAY1 = "2016-09-25";
const W = "2016-09-26";

const db = new Client({ connectionString: DB_URL });
let admin: SupabaseClient;
let firstRunId = 0;

type Reply = { status?: number; body?: unknown };
type Route = (url: URL) => Reply | undefined | Promise<Reply | undefined>;

/** 差し替えの fetch。呼ばれた URL（J-Quants のパス以降）と、x-api-key を記録する。 */
function fakeJQuants(route: Route) {
  const calls: { url: string; apiKey: string | null }[] = [];
  const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    calls.push({ url: `${url.pathname}${url.search}`, apiKey: new Headers(init?.headers).get("x-api-key") });
    const reply = (await route(url)) ?? { body: barsResponse([]) };
    return new Response(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body ?? {}), {
      status: reply.status ?? 200,
    });
  });
  return { fetchImpl, calls };
}

/** 時計: 要求のたびに進む。sleep は待った分だけ進める。 */
function fakeClock(start = RUN_AT) {
  let now = start;
  const sleeps: number[] = [];
  return {
    clock: {
      now: () => now,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        now += ms;
      },
    },
    advance: (ms: number) => {
      now += ms;
    },
    sleeps,
  };
}

async function insertStocks(codes: string[]) {
  for (const code of codes) {
    await db.query(
      `insert into public.stocks (code, company_name, market_code, market_name, sector33_code, sector33_name, product_category)
       values ($1, $2, '0113', 'グロース', '5250', '情報・通信業', '011')`,
      [code, `初出日テスト${code}株式会社`],
    );
  }
}

async function listing() {
  const { rows } = await db.query(
    `select code, first_price_date::text, data_start_date::text, determined_at, run_id::int
       from public.stock_listing_dates where code like '9999%' order by code`,
  );
  return rows;
}

async function run(id: number) {
  const { rows } = await db.query(
    "select status, processed_count, error_message, details from public.ingestion_runs where id = $1",
    [id],
  );
  return rows[0];
}

async function start(): Promise<number> {
  const result = await startIngestionRun(admin, "daily_quotes", "manual");
  if (!result.started) throw new Error("実行中の実行が残っています");
  return result.runId;
}

async function ingest(route: Route, options: { clock?: ReturnType<typeof fakeClock>; env?: Record<string, string>; admin?: SupabaseClient; saveBatchSize?: number } = {}) {
  const jq = fakeJQuants(route);
  const clock = options.clock ?? fakeClock();
  const runId = await start();
  const requestDeadline = clock.clock.now() + 210_000;
  const outcome = await executeIngestionRun(runId, "daily_quotes", {
    admin: options.admin ?? admin,
    fetchImpl: jq.fetchImpl,
    env: options.env ?? ENV,
    clock: clock.clock,
    requestDeadline,
    saveBatchSize: options.saveBatchSize,
  });
  return { runId, outcome, calls: jq.calls, clock, row: await run(runId) };
}

/** 初回のシナリオ（C4-1）の J-Quants。 */
const initialRoute: Route = (url) => {
  const date = url.searchParams.get("date");
  const code = url.searchParams.get("code");
  if (date === DAY1) return { body: barsResponse([]) }; // 休場日
  if (date === W) {
    return { body: barsResponse([barItem("99991", W), barItem("99992", W, { halted: true }), barItem("13010", W)]) };
  }
  if (code === "99993") {
    // 2ページ。最も古い日付は2ページ目にある
    return url.searchParams.get("pagination_key") === "p2"
      ? { body: barsResponse([barItem("99993", "2021-03-17"), barItem("99993", "2021-03-18")]) }
      : { body: barsResponse([barItem("99993", "2021-03-19"), barItem("99993", "2021-03-22")], "p2") };
  }
  if (code === "99994") {
    // 日付の降順で返る
    return { body: barsResponse([barItem("99994", "2024-06-03"), barItem("99994", "2023-12-20"), barItem("99994", "2023-12-19")]) };
  }
  if (code === "99995") return { body: barsResponse([]) }; // 株価データなし
  if (code === "99996") return { status: 500, body: {} }; // 取得に失敗
  return undefined;
};

beforeAll(async () => {
  await db.connect();
  admin = createAdminClient();
  const { rows: running } = await db.query("select count(*)::int as n from public.ingestion_runs where status = 'running'");
  if (running[0].n > 0) throw new Error("実行中の実行が残っているため、結合テストを始められません");
  const { rows: others } = await db.query("select count(*)::int as n from public.stocks where code not like '9999%'");
  if (others[0].n > 0) {
    throw new Error("銘柄マスタにテスト以外の銘柄があるため、株価の結合テストを始められません（pnpm db:reset 直後の DB で実行してください）");
  }
  const { rows: seq } = await db.query("select coalesce(max(id), 0)::bigint + 1 as next from public.ingestion_runs");
  firstRunId = Number(seq[0].next);
});

beforeEach(async () => {
  await db.query("delete from public.stocks where code like '9999%'");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await db.query("delete from public.ingestion_runs where id >= $1 and status = 'running'", [firstRunId]);
  vi.restoreAllMocks();
});

afterAll(async () => {
  await db.query("delete from public.stocks where code like '9999%'");
  await db.query("delete from public.ingestion_runs where id >= $1", [firstRunId]);
  await db.end();
});

describe("株価の初出日の取り込み（DB 込み）", () => {
  it("初回: W の一覧に出た銘柄はデータ期間開始以前、残りはコード別の最も古い日付（C4-1）", async () => {
    await insertStocks(["99991", "99992", "99993", "99994", "99995", "99996"]);
    const { runId, outcome, calls, row } = await ingest(initialRoute);

    expect(outcome).toEqual({ runId, target: "daily_quotes", status: "partial", processedCount: 4 });
    expect(row).toMatchObject({
      status: "partial",
      processed_count: 4,
      error_message: "1 銘柄で株価を取得できませんでした。次回の取り込みで再試行します",
    });
    expect(row.details).toEqual({
      pending: 6,
      dataStartDate: W,
      savedBeforeDataStart: 2,
      savedWithinDataPeriod: 2,
      noPriceData: 1,
      failed: 1,
      remaining: 0,
      apiCalls: 7,
      stoppedReason: null,
      dataStartProbe: [
        { date: DAY1, status: 200, rows: 0 },
        { date: W, status: 200, rows: 3 },
      ],
    });
    expect(await listing()).toEqual([
      { code: "99991", first_price_date: W, data_start_date: W, determined_at: expect.any(Date), run_id: runId },
      { code: "99992", first_price_date: W, data_start_date: W, determined_at: expect.any(Date), run_id: runId },
      { code: "99993", first_price_date: "2021-03-17", data_start_date: W, determined_at: expect.any(Date), run_id: runId },
      { code: "99994", first_price_date: "2023-12-19", data_start_date: W, determined_at: expect.any(Date), run_id: runId },
    ]);
    expect(calls.map((call) => call.url)).toEqual([
      `/v2/equities/bars/daily?date=${DAY1}`,
      `/v2/equities/bars/daily?date=${W}`,
      `/v2/equities/bars/daily?code=99993&from=${W}`,
      `/v2/equities/bars/daily?code=99993&from=${W}&pagination_key=p2`,
      `/v2/equities/bars/daily?code=99994&from=${W}`,
      `/v2/equities/bars/daily?code=99995&from=${W}`,
      `/v2/equities/bars/daily?code=99996&from=${W}`,
    ]);
    expect(calls.every((call) => call.apiKey === "db-test-key")).toBe(true);
    // 銘柄マスタに無い 13010 は保存されない
    expect((await db.query("select count(*)::int as n from public.stock_listing_dates where code = '13010'")).rows[0].n).toBe(0);
  });

  it("2回目: 確定済みの銘柄は API を呼ばず、行も変わらない。未確定の銘柄だけが追加される（C4-2、AC4.4）", async () => {
    await insertStocks(["99991", "99992", "99993", "99994", "99995", "99996"]);
    await ingest(initialRoute);
    const before = await listing();

    // 2回目: W を1日ずらし、確定済みの銘柄の最も古い日付を変える。99995 に株価が出る
    const W2 = "2016-09-27";
    const second = await ingest(
      (url) => {
        const date = url.searchParams.get("date");
        const code = url.searchParams.get("code");
        if (date && date < W2) return { body: barsResponse([]) };
        if (date === W2) return { body: barsResponse(["99991", "99992", "99993", "99994"].map((c) => barItem(c, W2))) };
        if (code === "99995") return { body: barsResponse([barItem("99995", "2026-09-24")]) };
        if (code === "99996") return { status: 500, body: {} };
        if (code) return { body: barsResponse([barItem(code, "2019-01-04")]) };
        return undefined;
      },
      { clock: fakeClock(RUN_AT + 86_400_000) },
    );

    const after = await listing();
    expect(after.slice(0, 4)).toEqual(before.slice(0, 4));
    expect(after[4]).toMatchObject({ code: "99995", first_price_date: "2026-09-24", data_start_date: W2, run_id: second.runId });
    expect(after).toHaveLength(5); // 99996 は今回も取得に失敗
    // コード別の要求は、未確定だった 99995・99996 だけ
    expect(second.calls.filter((call) => call.url.includes("code=")).map((call) => call.url)).toEqual([
      `/v2/equities/bars/daily?code=99995&from=${W2}`,
      `/v2/equities/bars/daily?code=99996&from=${W2}`,
    ]);
    expect(second.row).toMatchObject({ status: "partial", processed_count: 1 });
  });

  it("すべて確定済みなら fetch を呼ばず成功（C4-3）", async () => {
    await insertStocks(["99991"]);
    await db.query(
      "insert into public.stock_listing_dates (code, first_price_date, data_start_date) values ('99991', '2020-01-06', '2016-09-26')",
    );
    const { outcome, calls, row } = await ingest(initialRoute);
    expect(calls).toEqual([]);
    expect(outcome.status).toBe("succeeded");
    expect(row).toMatchObject({ status: "succeeded", processed_count: 0, error_message: null });
    expect(row.details.pending).toBe(0);
  });

  it("キー未設定なら fetch を呼ばず失敗（C4-4）", async () => {
    await insertStocks(["99991"]);
    const { calls, row } = await ingest(initialRoute, { env: {} });
    expect(calls).toEqual([]);
    expect(row).toMatchObject({ status: "failed", processed_count: 0, error_message: "J-Quants の API キーが設定されていません" });
  });

  it("銘柄マスタが0件なら fetch を呼ばず失敗（C4-5）", async () => {
    const { calls, row } = await ingest(initialRoute);
    expect(calls).toEqual([]);
    expect(row).toMatchObject({
      status: "failed",
      error_message: "銘柄マスタが未取り込みのため、株価の初出日を取り込めません。先に銘柄マスタを取り込んでください",
    });
  });

  describe("403・210・400 の扱い（C4-6）", () => {
    it("(a) 探索の1日目がキー以外の 403 なら次の日へ進み、2日目を W にする", async () => {
      await insertStocks(["99991"]);
      const { row } = await ingest((url) => {
        const date = url.searchParams.get("date");
        if (date === DAY1) return { status: 403, body: OUT_OF_PLAN_BODY };
        if (date === W) return { body: barsResponse([barItem("99991", W)]) };
        return undefined;
      });
      expect(row).toMatchObject({ status: "succeeded", processed_count: 1, error_message: null });
      expect(row.details.dataStartProbe).toEqual([
        { date: DAY1, status: 403, rows: 0 },
        { date: W, status: 200, rows: 1 },
      ]);
      expect(row.details.dataStartDate).toBe(W);
    });

    it("(b) 1日目が 210、2日目が 400 なら、3日目を W にする", async () => {
      await insertStocks(["99991"]);
      const W3 = "2016-09-27";
      const { row } = await ingest((url) => {
        const date = url.searchParams.get("date");
        if (date === DAY1) return { status: 210, body: {} };
        if (date === W) return { status: 400, body: { message: "bad request" } };
        if (date === W3) return { body: barsResponse([barItem("99991", W3)]) };
        return undefined;
      });
      expect(row.status).toBe("succeeded");
      expect(row.details.dataStartDate).toBe(W3);
      expect(row.details.dataStartProbe.map((p: { status: number }) => p.status)).toEqual([210, 400, 200]);
    });

    it("(c) コード別の取得の 210 は株価データなしに数え、失敗に数えない", async () => {
      await insertStocks(["99991", "99992"]);
      const { row } = await ingest((url) => {
        if (url.searchParams.get("date") === W) return { body: barsResponse([barItem("99991", W)]) };
        if (url.searchParams.get("code") === "99992") return { status: 210, body: {} };
        return undefined;
      });
      expect(row).toMatchObject({ status: "succeeded", processed_count: 1, error_message: null });
      expect(row.details).toMatchObject({ noPriceData: 1, failed: 0, remaining: 0 });
      expect((await listing()).map((r) => r.code)).toEqual(["99991"]);
    });

    it.each([
      ["無効", INVALID_KEY_BODY],
      ["欠如", MISSING_KEY_BODY],
    ])("(d) 探索の1日目がキーの%sの本文の 403 なら、要求1回で失敗", async (_label, body) => {
      await insertStocks(["99991"]);
      const { calls, row } = await ingest(() => ({ status: 403, body }));
      expect(calls).toHaveLength(1);
      expect(row).toMatchObject({
        status: "failed",
        processed_count: 0,
        error_message: "J-Quants の API キーが無効か、契約プランでは利用できません（HTTP 403）",
      });
      expect(row.details).toMatchObject({ apiCalls: 1, stoppedReason: "unauthorized" });
    });

    it("(d) 本文が JSON でない 403 は、キー以外の 403 と同じく次の日へ", async () => {
      await insertStocks(["99991"]);
      const { row } = await ingest((url) => {
        const date = url.searchParams.get("date");
        if (date === DAY1) return { status: 403, body: "<html>Forbidden</html>" };
        if (date === W) return { body: barsResponse([barItem("99991", W)]) };
        return undefined;
      });
      expect(row.status).toBe("succeeded");
    });

    it("(e) コード別の取得の途中でキーの無効の 403 なら打ち切り、保存済みは残って一部失敗。キー以外の 403 はその銘柄だけ失敗", async () => {
      await insertStocks(["99991", "99992", "99993", "99994"]);
      const { calls, row } = await ingest(
        (url) => {
          if (url.searchParams.get("date") === W) return { body: barsResponse([]) };
          if (url.searchParams.get("date")) return { body: barsResponse([barItem("99991", url.searchParams.get("date")!)]) };
          const code = url.searchParams.get("code");
          if (code === "99992") return { status: 403, body: OUT_OF_PLAN_BODY };
          if (code === "99993") return { status: 403, body: INVALID_KEY_BODY };
          return undefined;
        },
        { saveBatchSize: 1 },
      );
      // 探索: DAY1 で 99991 が出るので W = DAY1
      expect(row.details.dataStartDate).toBe(DAY1);
      expect(calls.some((call) => call.url.includes("code=99994"))).toBe(false);
      expect(row).toMatchObject({
        status: "partial",
        processed_count: 1,
        error_message:
          "J-Quants の API キーが無効か、契約プランでは利用できません（HTTP 403）。残り 2 銘柄は次回の取り込みで処理します。1 銘柄で株価を取得できませんでした。次回の取り込みで再試行します",
      });
      expect(row.details).toMatchObject({ failed: 1, remaining: 2, stoppedReason: "unauthorized" });
    });

    it("(f) エラーメッセージ・details に応答の本文（message の文字列）が含まれない", async () => {
      await insertStocks(["99991"]);
      const { row } = await ingest(() => ({ status: 403, body: INVALID_KEY_BODY }));
      const text = JSON.stringify(row);
      expect(text).not.toContain(INVALID_KEY_BODY.message);
      expect(text).not.toContain("db-test-key");
    });
  });

  it("コード別の取得の途中で 429 なら打ち切り、それ以降の要求は無く、保存済みは残って一部失敗（C4-7）", async () => {
    await insertStocks(["99991", "99992", "99993", "99994"]);
    const { calls, row } = await ingest(
      (url) => {
        if (url.searchParams.get("date") === W) return { body: barsResponse([]) };
        if (url.searchParams.get("date") === DAY1) return { body: barsResponse([barItem("99990", DAY1)]) };
        const code = url.searchParams.get("code");
        if (code === "99991") return { body: barsResponse([barItem("99991", "2020-01-06")]) };
        if (code === "99992") return { status: 429, body: {} };
        return undefined;
      },
    );
    expect(calls.map((call) => call.url).filter((u) => u.includes("code="))).toEqual([
      `/v2/equities/bars/daily?code=99991&from=${DAY1}`,
      `/v2/equities/bars/daily?code=99992&from=${DAY1}`,
    ]);
    expect(row).toMatchObject({
      status: "partial",
      processed_count: 1,
      error_message:
        "J-Quants の呼び出し回数の上限に達しました（HTTP 429）。しばらくしてから再実行してください。残り 3 銘柄は次回の取り込みで処理します",
    });
    expect(row.details).toMatchObject({ remaining: 3, stoppedReason: "rate_limited" });
    expect((await listing()).map((r) => r.code)).toEqual(["99991"]);
  });

  it("14 日すべてで行が無ければ失敗し、要求はちょうど 14 回。最後の状態コードを文言に入れる（C4-8）", async () => {
    await insertStocks(["99991"]);
    let n = 0;
    const { calls, row } = await ingest(() => {
      n += 1;
      if (n % 4 === 1) return { status: 210, body: {} };
      if (n % 4 === 2) return { status: 400, body: {} };
      if (n % 4 === 3) return { status: 403, body: OUT_OF_PLAN_BODY };
      return { body: barsResponse([]) };
    });
    expect(calls).toHaveLength(14);
    expect(row).toMatchObject({
      status: "failed",
      error_message: "株価データの取得可能期間の開始日を特定できませんでした（14 日分を試し、最後の応答は HTTP 400）",
    });
    expect(row.details.dataStartProbe).toHaveLength(14);

    // 最後が行0件の 200 のとき
    await db.query("delete from public.ingestion_runs where id >= $1", [firstRunId]);
    const empty = await ingest(() => ({ body: barsResponse([]) }));
    expect(empty.row.error_message).toBe(
      "株価データの取得可能期間の開始日を特定できませんでした（14 日分を試し、最後の応答は HTTP 200（0件））",
    );
  });

  it("時間切れ: 期限を過ぎたら新しい要求を始めず一部失敗。次の実行で残りから処理する（C4-9）", async () => {
    await insertStocks(["99991", "99992", "99993", "99994"]);
    const clock = fakeClock();
    const route: Route = (url) => {
      clock.advance(60_000); // 1回の要求に 60 秒かかる
      if (url.searchParams.get("date") === DAY1) return { body: barsResponse([barItem("99990", DAY1)]) };
      const code = url.searchParams.get("code");
      if (code) return { body: barsResponse([barItem(code, "2022-04-01")]) };
      return undefined;
    };
    const first = await ingest(route, { clock });
    // 探索1回 + コード別3回 = 240 秒を過ぎた時点で、4つ目は始めない
    expect(first.calls).toHaveLength(4);
    expect(first.row).toMatchObject({
      status: "partial",
      processed_count: 3,
      error_message: "時間内に処理しきれなかったため、残り 1 銘柄は次回の取り込みで処理します",
    });
    expect(first.row.details).toMatchObject({ remaining: 1, stoppedReason: "time_budget" });

    const second = await ingest(route, { clock: fakeClock() });
    expect(second.calls.filter((call) => call.url.includes("code=")).map((call) => call.url)).toEqual([
      `/v2/equities/bars/daily?code=99994&from=${DAY1}`,
    ]);
    expect(second.row).toMatchObject({ status: "succeeded", processed_count: 1 });
  });

  it("要求の間には 600 ミリ秒以上の間隔をあける（C4-10）", async () => {
    await insertStocks(["99991", "99992", "99993"]);
    const clock = fakeClock();
    const times: number[] = [];
    await ingest(
      (url) => {
        times.push(clock.clock.now());
        if (url.searchParams.get("date") === DAY1) return { body: barsResponse([barItem("99990", DAY1)]) };
        return { body: barsResponse([barItem(url.searchParams.get("code")!, "2022-04-01")]) };
      },
      { clock },
    );
    expect(times).toHaveLength(4);
    for (let i = 1; i < times.length; i += 1) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(600);
    expect(clock.sleeps.every((ms) => ms > 0 && ms <= 600)).toBe(true);
  });

  describe("形式の違い（C4-11）", () => {
    it("W の一覧に Date の無い行があれば失敗", async () => {
      await insertStocks(["99991"]);
      const { row } = await ingest(() => ({ body: { data: [{ Code: "99991" }] } }));
      expect(row).toMatchObject({ status: "failed", error_message: "J-Quants の応答の形式が想定と異なります" });
    });

    it("コード別の取得に別のコードの行が混ざったら、その銘柄を失敗に数える。売買の無い日（四本値 null）の行は初出日に使う", async () => {
      await insertStocks(["99991", "99992"]);
      const { row } = await ingest((url) => {
        if (url.searchParams.get("date") === DAY1) return { body: barsResponse([barItem("99990", DAY1)]) };
        const code = url.searchParams.get("code");
        if (code === "99991") return { body: barsResponse([barItem("99991", "2022-04-01"), barItem("99990", "2022-03-01")]) };
        if (code === "99992") {
          return { body: barsResponse([barItem("99992", "2022-04-04", { halted: true }), barItem("99992", "2022-04-05")]) };
        }
        return undefined;
      });
      expect(row.details).toMatchObject({ failed: 1, savedWithinDataPeriod: 1 });
      expect(await listing()).toEqual([expect.objectContaining({ code: "99992", first_price_date: "2022-04-04" })]);
    });
  });

  it("後片付けされた実行（failed に変えられた）には、それ以降保存せず、上書きもしない（C4-12）", async () => {
    await insertStocks(["99991", "99992", "99993"]);
    const { row } = await ingest(
      async (url) => {
        if (url.searchParams.get("date") === DAY1) return { body: barsResponse([barItem("99990", DAY1)]) };
        const code = url.searchParams.get("code")!;
        if (code === "99992") {
          // 1銘柄目を保存した後に、実行を後片付けされたことにする
          await db.query(
            "update public.ingestion_runs set status = 'failed', finished_at = now(), error_message = '評価者が終了' where status = 'running'",
          );
        }
        return { body: barsResponse([barItem(code, "2022-04-01")]) };
      },
      { saveBatchSize: 1 },
    );
    expect(row).toMatchObject({ status: "failed", error_message: "評価者が終了", processed_count: 1 });
    expect((await listing()).map((r) => r.code)).toEqual(["99991"]);
  });

  it("途中の保存: 予期しない例外で終わっても、それまでに保存した行と processed_count が残る（C4-13）", async () => {
    await insertStocks(["99991", "99992", "99993", "99994", "99995"]);
    let saves = 0;
    const flaky = {
      rpc: (fn: string, args: Record<string, unknown>) => {
        if (fn === "save_stock_listing_dates") {
          saves += 1;
          if (saves === 3) throw new Error("接続が切れた");
        }
        return admin.rpc(fn, args);
      },
    } as unknown as SupabaseClient;
    const { outcome, row } = await ingest(
      (url) => {
        if (url.searchParams.get("date") === DAY1) return { body: barsResponse([barItem("99990", DAY1)]) };
        return { body: barsResponse([barItem(url.searchParams.get("code")!, "2022-04-01")]) };
      },
      { admin: flaky, saveBatchSize: 2 },
    );
    expect(outcome.status).toBe("failed");
    expect(row).toMatchObject({
      status: "failed",
      processed_count: 4,
      error_message: "予期しないエラーで取り込みを完了できませんでした",
    });
    expect((await listing()).map((r) => r.code)).toEqual(["99991", "99992", "99993", "99994"]);
  });
});
