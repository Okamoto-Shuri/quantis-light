import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getUser = vi.fn();
const rpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser }, rpc }),
}));

const { GET } = await import("./route");

const SUMMARY = {
  stockCount: 3,
  // Sprint 12: 上場廃止の数（契約 C10-1 の種類5）
  delistedCount: 0,
  financialMetrics: { anyCount: 2, revenueCagrCount: 1, operatingMarginCount: 2 },
  ownershipDeterminedCount: 1,
  lastCompletedRun: null,
  latestRun: null,
};

/** current_user_is_allowed と dashboard_summary の rpc を振り分ける。 */
function mockRpc(allowed: boolean, summary: { data: unknown; error: unknown }) {
  rpc.mockImplementation(async (fn: string) =>
    fn === "current_user_is_allowed" ? { data: allowed, error: null } : summary,
  );
}

describe("GET /api/dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("未ログインは 401 で、集計しない", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "Auth session missing!" } });
    const res = await GET();
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalledWith("dashboard_summary");
  });

  it("許可リスト外は 403 で、集計しない", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    mockRpc(false, { data: SUMMARY, error: null });
    const res = await GET();
    expect(res.status).toBe(403);
    expect(rpc).not.toHaveBeenCalledWith("dashboard_summary");
  });

  it("許可ユーザーには集計を no-store で返す", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    mockRpc(true, { data: SUMMARY, error: null });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    // Sprint 12: 鮮度（data_freshness）を加えた。この mock では形が違うので freshness は null（200 のまま。契約 C4-11）
    expect(await res.json()).toEqual({ data: { ...SUMMARY, freshness: null } });
  });

  it("集計に失敗したら 500 で、件数を含まない", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    mockRpc(true, { data: null, error: { message: "permission denied" } });
    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal_error" });
  });
});
