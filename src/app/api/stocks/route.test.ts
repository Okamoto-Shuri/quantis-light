import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getUser = vi.fn();
const rpc = vi.fn();
/** from(table) の呼び出しと、各テーブルが返す結果。 */
const fromCalls: { table: string; filters: unknown[][] }[] = [];
const results: Record<string, { data: unknown; error: unknown }> = {};

function builder(table: string) {
  const call = { table, filters: [] as unknown[][] };
  fromCalls.push(call);
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order", "limit"]) {
    chain[method] = (...args: unknown[]) => {
      call.filters.push([method, ...args]);
      return chain;
    };
  }
  chain.then = (resolve: (value: unknown) => unknown) => resolve(results[table] ?? { data: [], error: null });
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser }, rpc, from: builder }),
}));

const { GET } = await import("./route");

const STOCK = {
  code: "99991",
  company_name: "検証用銘柄株式会社",
  market_name: "グロース",
  sector33_name: "情報・通信業",
  updated_at: "2026-09-24T00:00:00Z",
};
const AGE = {
  code: "99991",
  first_price_date: "2023-09-24",
  data_start_date: "2016-09-26",
  reference_date: "2026-09-24",
  listed_before_data_start: false,
  listing_years_exact: "3.00000000000000000000",
  estimated_listing_years: "3.0",
  listing_years_lower_bound: null,
};

const get = (query = "") => GET(new NextRequest(`http://localhost:3000/api/stocks${query}`));

function allowUser() {
  getUser.mockResolvedValue({ data: { user: { id: "u1", email: "owner@quantis.local" } }, error: null });
  rpc.mockResolvedValue({ data: true, error: null });
}

describe("GET /api/stocks（proxy を通らない場合もハンドラー自身が保護する）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fromCalls.length = 0;
    results.stocks = { data: [STOCK], error: null };
    results.stock_listing_ages = { data: [AGE], error: null };
    results.listing_reference_date = { data: [{ reference_date: "2026-09-24" }], error: null };
  });

  it("セッションが無ければ 401 で、データを含まない", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "Auth session missing!" } });
    const res = await get();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(fromCalls).toEqual([]);
  });

  it("Auth に到達できなければ 503 で、データを含まない（fail closed）", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getUser.mockRejectedValue(new TypeError("fetch failed"));
    const res = await get();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "auth_unavailable" });
    expect(fromCalls).toEqual([]);
  });

  it("Auth が接続エラーを返した場合も 503", async () => {
    getUser.mockResolvedValue({
      data: { user: null },
      error: Object.assign(new Error("fetch failed"), { name: "AuthRetryableFetchError", status: 0 }),
    });
    expect((await get()).status).toBe(503);
    expect(fromCalls).toEqual([]);
  });

  it("ログイン中でも許可リスト外なら 403 で、データを含まない", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1", email: "intruder@quantis.local" } }, error: null });
    rpc.mockResolvedValue({ data: false, error: null });
    const res = await get();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(fromCalls).toEqual([]);
  });

  it("許可ユーザーには、銘柄と初出日・推定上場年数、基準日を返す", async () => {
    allowUser();
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: [
        {
          ...STOCK,
          first_price_date: "2023-09-24",
          data_start_date: "2016-09-26",
          listed_before_data_start: false,
          listing_years_exact: 3,
          estimated_listing_years: 3,
          listing_years_lower_bound: null,
        },
      ],
      meta: { referenceDate: "2026-09-24" },
    });
    expect(rpc).toHaveBeenCalledWith("current_user_is_allowed");
  });

  it("初出日の行が無い銘柄は、年数の項目がすべて null", async () => {
    allowUser();
    results.stock_listing_ages = { data: [{ ...AGE, first_price_date: null, data_start_date: null, listed_before_data_start: null, listing_years_exact: null, estimated_listing_years: null }], error: null };
    const body = await (await get()).json();
    expect(body.data[0]).toMatchObject({ first_price_date: null, listed_before_data_start: null, estimated_listing_years: null });
  });

  it("?code= は正規化して1銘柄に絞る（4文字は末尾に 0）。形式の違うコードは 400", async () => {
    allowUser();
    await get("?code=9999");
    expect(fromCalls.find((call) => call.table === "stocks")?.filters).toContainEqual(["eq", "code", "99990"]);
    for (const bad of ["abc", "123456", "", "%3Cscript%3E"]) {
      const res = await get(`?code=${bad}`);
      expect(res.status, bad).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_code" });
    }
  });

  it("読み出しに失敗したら 500（0 件として扱わない）", async () => {
    allowUser();
    vi.spyOn(console, "error").mockImplementation(() => {});
    results.stock_listing_ages = { data: null, error: { message: "boom" } };
    expect((await get()).status).toBe(500);
  });
});
