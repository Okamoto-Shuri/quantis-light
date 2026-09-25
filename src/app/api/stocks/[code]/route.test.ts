import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getUser = vi.fn();
/** rpc(name, args) の応答。current_user_is_allowed と stock_detail を名前で分ける。 */
const rpcResults: Record<string, { data: unknown; error: unknown }> = {};
const rpc = vi.fn(async (name: string) => rpcResults[name] ?? { data: null, error: null });
const fromCalls: string[] = [];
const results: Record<string, { data: unknown; error: unknown }> = {};

function builder(table: string) {
  fromCalls.push(table);
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order", "limit"]) chain[method] = () => chain;
  chain.then = (resolve: (value: unknown) => unknown) => resolve(results[table] ?? { data: [], error: null });
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser }, rpc, from: builder }),
}));

const { GET } = await import("./route");

const DETAIL = {
  stock: { code: "99991", company_name: "検証用銘柄株式会社", market_code: "0113", market_name: "グロース", sector33_code: "5250", sector33_name: "情報・通信業", delisted_on: null },
  referenceDate: "2026-09-24",
  listing: {
    first_price_date: "2022-09-24",
    data_start_date: "2016-09-26",
    listed_before_data_start: false,
    listing_years_exact: 4,
    estimated_listing_years: 4.0,
    listing_years_lower_bound: null,
  },
  evaluation: { status: { cagr: "met", margin: "met", years: "met", owner: "met" }, ownerResult: "president_top", ownerAutoResult: "president_top", ownerOverride: null, matchesFilters: true, delisted: false, included: true },
  ownership: {
    status: "determined",
    undeterminable_reason: null,
    undeterminable_detail: null,
    result: "president_top",
    auto_result: "president_top",
    override: null,
    president_is_top_holder: true,
    owner_total_pct: "30.00",
    owner_total_display_pct: "30.0",
    category_pct: { president: "30.00", officer: "0", family: "0", asset_company: "0", other: "10.00" },
    top_holders: [{ rank: 1, name: "山田 太郎", ratio_pct: "30.00", ratio_decimals: 2, category: "president" }],
    presidents: [{ seq: 1, name: "山田太郎", title: "代表取締役社長", basis: "title", surname: "山田", surname_key: "山田", surname_source: "shareholder" }],
    pending_doc_id: null,
    holders: [
      { rank: 1, name: "山田 太郎", ratio_pct: "30.00", ratio_decimals: 2, category: "president", reason_code: "president_name", reason: { president_name: "山田太郎" } },
    ],
    documents: [{ role: "shareholders", doc_id: "S100TEST", doc_type_code: "120", submitted_at: "2026-06-25T06:00:00+00:00" }],
  },
};

const period = (end: number) => ({
  code: "99991",
  fiscal_year_start: `${end - 1}-04-01`,
  fiscal_year_end: `${end}-03-31`,
  period_days: 365,
  period_months: 12,
  is_irregular: false,
  net_sales: "10000000000",
  operating_profit: "1500000000",
  consolidated: true,
  accounting_standard: "JP",
  document_type: "FYFinancialStatements_Consolidated_JP",
  source: "tdnet_summary",
  source_priority: 1,
  source_document_id: `S${end}`,
  source_document_date: `${end}-05-14`,
  disclosure_no: `S${end}`,
  disclosed_date: `${end}-05-14`,
  disclosure_count: 1,
  source_document_type_code: null,
  source_submitted_at: null,
  revenue_element: null,
});

const get = (path: string) => {
  const url = new URL(`http://localhost:3000/api/stocks/${path}`);
  const code = decodeURIComponent(url.pathname.split("/").pop() ?? "");
  return GET(new NextRequest(url), { params: Promise.resolve({ code }) });
};

function allowUser() {
  getUser.mockResolvedValue({ data: { user: { id: "u1", email: "owner@quantis.local" } }, error: null });
  rpcResults.current_user_is_allowed = { data: true, error: null };
}

describe("GET /api/stocks/[code]（契約の C8・C10-4）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fromCalls.length = 0;
    for (const key of Object.keys(rpcResults)) delete rpcResults[key];
    results.financial_metrics = { data: [], error: null };
    results.financial_periods = { data: [2023, 2024, 2025].map(period), error: null };
    rpcResults.stock_detail = { data: DETAIL, error: null };
  });

  it("セッションが無ければ 401 で、データを含まない", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "Auth session missing!" } });
    const res = await get("99991");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(rpc).not.toHaveBeenCalledWith("stock_detail", expect.anything());
    expect(fromCalls).toEqual([]);
  });

  it("許可リスト外は 403 で、データを含まない", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u2", email: "intruder@quantis.local" } }, error: null });
    rpcResults.current_user_is_allowed = { data: false, error: null };
    const res = await get("99991");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(fromCalls).toEqual([]);
  });

  it("コードの形が不正なら 400 invalid_code", async () => {
    allowUser();
    for (const bad of ["abc-1", "123456", "%3Cscript%3E"]) {
      const res = await get(bad);
      expect(res.status, bad).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_code" });
    }
  });

  it("不正な条件のクエリは既定値に置き換えずに 400 invalid_params", async () => {
    allowUser();
    const res = await get("99991?cagr=abc&years=0");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_params", fields: ["cagr", "years"] });
  });

  it("銘柄マスタに無ければ 404 not_found", async () => {
    allowUser();
    rpcResults.stock_detail = { data: null, error: null };
    const res = await get("99989");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("4文字・小文字のコードは正規化して読む（リダイレクトしない）", async () => {
    allowUser();
    expect((await get("9999")).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("stock_detail", expect.objectContaining({ p_code: "99990" }));
    await get("9y001");
    expect(rpc).toHaveBeenCalledWith("stock_detail", expect.objectContaining({ p_code: "9Y001" }));
  });

  it("許可ユーザーには、判定・期・5期の枠を返す。条件のクエリが無ければ source は default", async () => {
    allowUser();
    const res = await get("99991");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.stock).toEqual(DETAIL.stock);
    expect(body.data.evaluation).toEqual({
      conditions: {
        cagr: "20",
        margin: "10",
        years: "5",
        owner: "20",
        ownermode: "any",
        off: [],
        unavailable: "exclude",
        undeterminable: "exclude",
        market: [],
        sector: [],
        sort: "cagr",
        order: "desc",
      },
      source: "default",
      status: { cagr: "met", margin: "met", years: "met", owner: "met" },
      ownerResult: "president_top",
      ownerAutoResult: "president_top",
      ownerOverride: null,
      matchesFilters: true,
      // Sprint 12: 上場廃止（契約 C10-1 の種類5）
      delisted: false,
      included: true,
    });
    expect(body.data.slots).toEqual([
      { position: "FY-4", fiscal_year_end: "2021-03-31", missing: true },
      { position: "FY-3", fiscal_year_end: "2022-03-31", missing: true },
      { position: "FY-2", fiscal_year_end: "2023-03-31", missing: false },
      { position: "FY-1", fiscal_year_end: "2024-03-31", missing: false },
      { position: "FY0", fiscal_year_end: "2025-03-31", missing: false },
    ]);
    expect(body.data.periods).toHaveLength(3);
  });

  it("条件のクエリがあれば source は screening で、条件を DB に渡す", async () => {
    allowUser();
    const body = await (await get("99991?cagr=30&off=margin")).json();
    expect(body.data.evaluation).toMatchObject({ source: "screening", conditions: { cagr: "30", off: ["margin"] } });
    expect(rpc).toHaveBeenCalledWith(
      "stock_detail",
      expect.objectContaining({ p_params: expect.objectContaining({ cagr: "30", marginOn: false }) }),
    );
  });

  it("読み出しに失敗したら 500", async () => {
    allowUser();
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpcResults.stock_detail = { data: null, error: { message: "boom" } };
    expect((await get("99991")).status).toBe(500);
  });
});
