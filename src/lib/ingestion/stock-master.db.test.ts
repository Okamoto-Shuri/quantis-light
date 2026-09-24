/**
 * 取り込み処理の結合テスト（ローカルの DB に実際に書き込む）。外部 API だけを差し替える。
 * 実行: pnpm test:db（pnpm db:start と pnpm env:local が済んでいること）
 * テストの銘柄コードは 99995〜99999。作った stocks と ingestion_runs の行は、テストの最後に削除する。
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { createAdminClient } = await import("@/lib/supabase/admin");
const { executeIngestionRun, startIngestionRun } = await import("./runner");
const { masterItem } = await import("./jquants/__fixtures__/equities-master");

const DB_URL = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const CODES = ["99995", "99996", "99997", "99998", "99999"];
const ENV = { JQUANTS_API_KEY: "db-test-key" };

const db = new Client({ connectionString: DB_URL });
let admin: SupabaseClient;
let firstRunId = 0;

/** 保存される4行と、対象外の1行（ETF）。 */
function fixture(names: Partial<Record<string, string>> = {}, date = "2026-09-24", codes = CODES.slice(0, 4)) {
  return {
    data: [
      ...codes.map((code, i) =>
        masterItem({
          Code: code,
          CoName: names[code] ?? `結合テスト銘柄${i + 1}株式会社`,
          Mkt: ["0111", "0112", "0113", "0111"][i],
          MktNm: ["プライム", "スタンダード", "グロース", "プライム"][i],
          Date: date,
        }),
      ),
      masterItem({ Code: "99999", CoName: "結合テストETF", ProdCat: "014", S33: "9999", S33Nm: "その他", Mkt: "0109", MktNm: "その他", Date: date }),
    ],
  };
}

const respond = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

async function stocks() {
  const { rows } = await db.query(
    `select code, company_name, market_code, market_name, product_category, listed_info_date::text, updated_at
       from public.stocks where code = any($1) order by code`,
    [CODES],
  );
  return rows;
}

async function run(id: number) {
  const { rows } = await db.query(
    "select status, trigger, processed_count, error_message, details, finished_at is not null as finished from public.ingestion_runs where id = $1",
    [id],
  );
  return rows[0];
}

async function start(): Promise<number> {
  const result = await startIngestionRun(admin, "stock_master", "manual");
  if (!result.started) throw new Error("実行中の実行が残っています");
  return result.runId;
}

beforeAll(async () => {
  await db.connect();
  admin = createAdminClient();
  const { rows } = await db.query("select count(*)::int as n from public.ingestion_runs where status = 'running'");
  if (rows[0].n > 0) throw new Error("実行中の実行が残っているため、結合テストを始められません");
  const { rows: seq } = await db.query("select coalesce(max(id), 0)::bigint + 1 as next from public.ingestion_runs");
  firstRunId = Number(seq[0].next);
});

beforeEach(async () => {
  await db.query("delete from public.stocks where code = any($1)", [CODES]);
});

afterEach(async () => {
  // 失敗したテストが「実行中」を残しても、次のテストに影響させない
  await db.query("delete from public.ingestion_runs where id >= $1 and status = 'running'", [firstRunId]);
});

afterAll(async () => {
  await db.query("delete from public.stocks where code = any($1)", [CODES]);
  await db.query("delete from public.ingestion_runs where id >= $1", [firstRunId]);
  await db.end();
});

describe("銘柄マスタの取り込み（DB 込み）", () => {
  it("成功すると、対象の行だけが保存され、実行は succeeded で件数と内訳が記録される", async () => {
    const runId = await start();
    const outcome = await executeIngestionRun(runId, "stock_master", { admin, fetchImpl: respond(fixture()), env: ENV });

    expect(outcome).toEqual({ runId, target: "stock_master", status: "succeeded", processedCount: 4 });
    expect(await run(runId)).toEqual({
      status: "succeeded",
      trigger: "manual",
      processed_count: 4,
      error_message: null,
      details: { fetched: 5, skipped: 1, skippedByProduct: 1, skippedByMarket: 0, skippedBySector: 0, listedInfoDate: "2026-09-24" },
      finished: true,
    });
    const saved = await stocks();
    expect(saved.map((row) => row.code)).toEqual(["99995", "99996", "99997", "99998"]);
    expect(saved[1]).toMatchObject({
      company_name: "結合テスト銘柄2株式会社",
      market_code: "0112",
      market_name: "スタンダード",
      product_category: "011",
      listed_info_date: "2026-09-24",
    });
  });

  it("2回目は同じコードの行を更新し（重複しない）、一覧から消えたコードの行は変えない", async () => {
    await executeIngestionRun(await start(), "stock_master", { admin, fetchImpl: respond(fixture()), env: ENV });
    const before = await stocks();

    // 2回目: 99995 の社名と市場区分を変え、99998 を一覧から外す
    const second = fixture({ "99995": "社名変更後株式会社" }, "2026-09-25", CODES.slice(0, 3));
    second.data[0] = { ...second.data[0], Mkt: "0113", MktNm: "グロース" };
    const runId = await start();
    const outcome = await executeIngestionRun(runId, "stock_master", { admin, fetchImpl: respond(second), env: ENV });
    expect(outcome.processedCount).toBe(3);

    const after = await stocks();
    expect(after).toHaveLength(4);
    expect(after[0]).toMatchObject({ company_name: "社名変更後株式会社", market_code: "0113", listed_info_date: "2026-09-25" });
    expect(after[0].updated_at.getTime()).toBeGreaterThan(before[0].updated_at.getTime());
    // 一覧から消えた 99998 は、削除も変更もされない
    expect(after[3]).toEqual(before[3]);
  });

  it("保存の途中で失敗したら、stocks は1行も変わらず、実行は failed", async () => {
    await executeIngestionRun(await start(), "stock_master", { admin, fetchImpl: respond(fixture()), env: ENV });
    const before = await stocks();

    // 保存の関数に渡る行の最後に、制約（コードの形式）に反する行を混ぜる
    const sabotaged = {
      rpc: (fn: string, args: Record<string, unknown>) => {
        if (fn === "complete_stock_master_run") {
          const rows = args.p_rows as Record<string, unknown>[];
          return admin.rpc(fn, { ...args, p_rows: [...rows, { ...rows[0], code: "bad-code" }] });
        }
        return admin.rpc(fn, args);
      },
    } as unknown as SupabaseClient;
    vi.spyOn(console, "error").mockImplementation(() => {});

    const runId = await start();
    const changed = fixture({ "99995": "保存されてはいけない社名" });
    const outcome = await executeIngestionRun(runId, "stock_master", { admin: sabotaged, fetchImpl: respond(changed), env: ENV });

    expect(outcome.status).toBe("failed");
    expect(await run(runId)).toMatchObject({ status: "failed", processed_count: 0, error_message: "銘柄マスタの保存に失敗しました" });
    expect(await stocks()).toEqual(before);
  });

  it("取得に失敗したら（403）、stocks は変わらず、実行は failed で決まったメッセージ", async () => {
    const runId = await start();
    const outcome = await executeIngestionRun(runId, "stock_master", {
      admin,
      fetchImpl: respond({ message: "The incoming api key is invalid or expired." }, 403),
      env: ENV,
    });
    expect(outcome.status).toBe("failed");
    expect(await run(runId)).toMatchObject({
      status: "failed",
      processed_count: 0,
      error_message: "J-Quants の API キーが無効か、契約プランでは利用できません（HTTP 403）",
      finished: true,
    });
    expect(await stocks()).toEqual([]);
  });

  it("キーが未設定なら failed（処理件数 0）で、外部 API を呼ばない", async () => {
    const runId = await start();
    const fetchImpl = respond(fixture());
    await executeIngestionRun(runId, "stock_master", { admin, fetchImpl, env: {} });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await run(runId)).toMatchObject({
      status: "failed",
      processed_count: 0,
      error_message: "J-Quants の API キーが設定されていません",
    });
  });

  it("遅れて終わった処理は、後片付け済み（failed）の行を上書きせず、何も保存しない", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const runId = await start();
    await db.query(
      "update public.ingestion_runs set status = 'failed', finished_at = now(), error_message = '評価者が終了' where id = $1",
      [runId],
    );

    const outcome = await executeIngestionRun(runId, "stock_master", { admin, fetchImpl: respond(fixture()), env: ENV });
    expect(outcome.status).toBe("failed");
    expect(await run(runId)).toMatchObject({ status: "failed", processed_count: 0, error_message: "評価者が終了" });
    expect(await stocks()).toEqual([]);

    // 失敗の終わり方（キー未設定）でも上書きしない
    await executeIngestionRun(runId, "stock_master", { admin, fetchImpl: respond(fixture()), env: {} });
    expect(await run(runId)).toMatchObject({ status: "failed", error_message: "評価者が終了" });
  });
});

describe("実行の開始（二重実行の防止）", () => {
  it("同時に5回開始しても、記録されるのは1つだけ", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => startIngestionRun(admin, "stock_master", "manual")));
    const started = results.filter((result) => result.started);
    expect(started).toHaveLength(1);
    const blocked = results.filter((result) => !result.started);
    expect(blocked).toHaveLength(4);
    for (const result of blocked) {
      if (!result.started) expect(result.activeRun).toMatchObject({ status: "running", target: "stock_master" });
    }
    const { rows } = await db.query("select count(*)::int as n from public.ingestion_runs where status = 'running'");
    expect(rows[0].n).toBe(1);
  });

  it("開始から 15 分以上たった実行中は「失敗」にしてから、新しい実行を始める。15 分未満なら始めない", async () => {
    const { rows: recent } = await db.query(
      "insert into public.ingestion_runs (target, trigger, status, started_at) values ('stock_master', 'cron', 'running', now() - interval '14 minutes') returning id",
    );
    const blocked = await startIngestionRun(admin, "stock_master", "manual");
    expect(blocked.started).toBe(false);

    await db.query("update public.ingestion_runs set started_at = now() - interval '20 minutes' where id = $1", [recent[0].id]);
    const result = await startIngestionRun(admin, "stock_master", "manual");
    expect(result.started).toBe(true);
    expect(await run(Number(recent[0].id))).toMatchObject({
      status: "failed",
      error_message: "15 分以上応答が無かったため、中断されたものとみなしました",
      finished: true,
    });
  });

  it("DB の一意制約: 実行中の行は2行入れられない", async () => {
    await db.query("insert into public.ingestion_runs (target, trigger, status) values ('stock_master', 'manual', 'running')");
    await expect(
      db.query("insert into public.ingestion_runs (target, trigger, status) values ('financials', 'cron', 'running')"),
    ).rejects.toThrow(/ingestion_runs_single_running_idx/);
  });
});
