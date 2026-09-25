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

const { GET, HEAD, maxDuration } = await import("./route");

const SECRET = "local-cron-secret-0123456789";

function get(authorization?: string) {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new NextRequest("http://localhost:3000/api/cron/edinet", { headers });
}

describe("GET /api/cron/edinet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", SECRET);
    startIngestionRun.mockResolvedValue({ started: true, runId: 7 });
    executeIngestionRun.mockResolvedValue({ runId: 7, target: "edinet_reports", status: "failed", processedCount: 0 });
  });

  it("制限時間は 300 秒", () => {
    expect(maxDuration).toBe(300);
  });

  it.each([[undefined], ["Bearer wrong"], [SECRET], [""]])("Authorization %s は 401 で、実行を記録しない", async (header) => {
    const res = await GET(get(header));
    expect(res.status).toBe(401);
    expect(startIngestionRun).not.toHaveBeenCalled();
  });

  it("正しいシークレットなら、有報（EDINET）だけを1回実行し、完了まで待って結果を返す", async () => {
    const before = Date.now();
    const res = await GET(get(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toEqual({
      data: { runs: [{ runId: 7, target: "edinet_reports", status: "failed", processedCount: 0 }] },
    });
    expect(startIngestionRun.mock.calls.map((call) => call.slice(1))).toEqual([["edinet_reports", "cron"]]);
    const deadline = (executeIngestionRun.mock.calls[0][2] as { requestDeadline: number }).requestDeadline;
    expect(deadline).toBeGreaterThanOrEqual(before + 210_000);
  });

  it("実行中があれば 409 で、本体を動かさない", async () => {
    startIngestionRun.mockResolvedValue({ started: false, activeRun: null });
    const res = await GET(get(`Bearer ${SECRET}`));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "already_running" });
    expect(executeIngestionRun).not.toHaveBeenCalled();
  });

  it("HEAD は 405（Allow: GET）", () => {
    const res = HEAD();
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET");
  });
});
