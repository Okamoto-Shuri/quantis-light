import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getUser = vi.fn();
const rpc = vi.fn();
const limit = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    rpc,
    from: () => ({ select: () => ({ order: () => ({ limit }) }) }),
  }),
}));

const { GET } = await import("./route");

const STOCK = {
  code: "99990",
  company_name: "検証用銘柄株式会社",
  market_name: "グロース",
  sector33_name: "情報・通信業",
  updated_at: "2026-09-24T00:00:00Z",
};

describe("GET /api/stocks（proxy を通らない場合もハンドラー自身が保護する）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limit.mockResolvedValue({ data: [STOCK], error: null });
  });

  it("セッションが無ければ 401 で、データを含まない", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "Auth session missing!" } });
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(limit).not.toHaveBeenCalled();
  });

  it("Auth に到達できなければ 503 で、データを含まない（fail closed）", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getUser.mockRejectedValue(new TypeError("fetch failed"));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "auth_unavailable" });
    expect(limit).not.toHaveBeenCalled();
  });

  it("Auth が接続エラーを返した場合も 503", async () => {
    getUser.mockResolvedValue({
      data: { user: null },
      error: Object.assign(new Error("fetch failed"), { name: "AuthRetryableFetchError", status: 0 }),
    });
    const res = await GET();
    expect(res.status).toBe(503);
    expect(limit).not.toHaveBeenCalled();
  });

  it("ログイン中でも許可リスト外なら 403 で、データを含まない", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1", email: "intruder@quantis.local" } }, error: null });
    rpc.mockResolvedValue({ data: false, error: null });
    const res = await GET();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(limit).not.toHaveBeenCalled();
  });

  it("許可ユーザーには銘柄を返す", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1", email: "owner@quantis.local" } }, error: null });
    rpc.mockResolvedValue({ data: true, error: null });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [STOCK] });
    expect(rpc).toHaveBeenCalledWith("current_user_is_allowed");
  });
});
