import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const startIngestionRun = vi.fn();
const executeIngestionRun = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/ingestion/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ingestion/runner")>()),
  startIngestionRun,
  executeIngestionRun,
}));

const { GET, maxDuration } = await import("./route");

const SECRET = "local-cron-secret-0123456789";

function get(authorization?: string) {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new NextRequest("http://localhost:3000/api/cron/daily", { headers });
}

describe("GET /api/cron/daily", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", SECRET);
    startIngestionRun.mockResolvedValue({ started: true, runId: 3 });
    executeIngestionRun.mockResolvedValue({ runId: 3, target: "stock_master", status: "failed", processedCount: 0 });
  });

  it("制限時間は 300 秒", () => {
    expect(maxDuration).toBe(300);
  });

  it.each([[undefined], ["Bearer wrong"], [SECRET], [`Bearer ${SECRET}x`], [""]])("Authorization %s は 401 で、実行を記録しない", async (header) => {
    const res = await GET(get(header));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(startIngestionRun).not.toHaveBeenCalled();
  });

  it("CRON_SECRET が未設定・短すぎるなら、どんな値でも 401", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(get("Bearer "))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "short");
    expect((await GET(get("Bearer short"))).status).toBe(401);
    expect(startIngestionRun).not.toHaveBeenCalled();
  });

  it("正しいシークレットなら、完了まで待って結果を返す", async () => {
    const res = await GET(get(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toEqual({
      data: { runs: [{ runId: 3, target: "stock_master", status: "failed", processedCount: 0 }] },
    });
    expect(startIngestionRun).toHaveBeenCalledWith(expect.anything(), "stock_master", "cron");
  });

  it("実行中があれば 409 で、本体を動かさない", async () => {
    startIngestionRun.mockResolvedValue({ started: false, activeRun: null });
    const res = await GET(get(`Bearer ${SECRET}`));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "already_running" });
    expect(executeIngestionRun).not.toHaveBeenCalled();
  });
});
