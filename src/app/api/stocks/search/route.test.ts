import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getUser = vi.fn();
const rpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser }, rpc }),
}));

const { GET } = await import("./route");

const get = (query = "") => GET(new NextRequest(`http://localhost:3000/api/stocks/search${query}`));

const HIT = { code: "72030", company_name: "トヨタ自動車", market_name: "プライム", sector33_name: "輸送用機器", delisted: false };

/** current_user_is_allowed は許可、search_stocks は result を返す */
function allowUser(result: { data: unknown; error: unknown } = { data: [HIT], error: null }) {
  getUser.mockResolvedValue({ data: { user: { id: "u1", email: "owner@quantis.local" } }, error: null });
  rpc.mockImplementation(async (fn: string) => (fn === "current_user_is_allowed" ? { data: true, error: null } : result));
}

describe("GET /api/stocks/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("セッションが無ければ 401 で、検索しない", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "Auth session missing!" } });
    const res = await get("?q=トヨタ");
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalledWith("search_stocks", expect.anything());
  });

  it("許可リスト外なら 403", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1", email: "intruder@quantis.local" } }, error: null });
    rpc.mockResolvedValue({ data: false, error: null });
    expect((await get("?q=トヨタ")).status).toBe(403);
    expect(rpc).not.toHaveBeenCalledWith("search_stocks", expect.anything());
  });

  it("前後の空白を除いた入力で DB 関数を1回呼び、行の形を変えて返す（no-store）", async () => {
    allowUser();
    const res = await get(`?q=${encodeURIComponent("  とよた ")}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toEqual({
      data: [{ code: "72030", companyName: "トヨタ自動車", marketName: "プライム", sectorName: "輸送用機器", delisted: false }],
    });
    expect(rpc).toHaveBeenCalledWith("search_stocks", { p_query: "とよた", p_limit: 20 });
  });

  it("空・空白だけの入力は DB を呼ばずに 0 件", async () => {
    allowUser();
    for (const query of ["", "?q=", "?q=%20%E3%80%80"]) {
      const res = await get(query);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ data: [] });
    }
    expect(rpc).not.toHaveBeenCalledWith("search_stocks", expect.anything());
  });

  it("50 コードポイントを超える入力は 400 invalid_query（サロゲートペアは1文字と数える）", async () => {
    allowUser();
    expect((await get(`?q=${encodeURIComponent("𠮷".repeat(50))}`)).status).toBe(200);
    const res = await get(`?q=${encodeURIComponent("あ".repeat(51))}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_query" });
  });

  it("DB の失敗は 0 件として扱わず 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    allowUser({ data: null, error: { message: "boom" } });
    const res = await get("?q=トヨタ");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal_error" });
  });
});
