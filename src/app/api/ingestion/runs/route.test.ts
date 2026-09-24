import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requireApiUser = vi.fn();
const startIngestionRun = vi.fn();
const executeIngestionRun = vi.fn();
const afterCallbacks: (() => Promise<void>)[] = [];

vi.mock("@/lib/auth/api", () => ({ requireApiUser }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/ingestion/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ingestion/runner")>()),
  startIngestionRun,
  executeIngestionRun,
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (callback: () => Promise<void>) => afterCallbacks.push(callback),
}));

const { POST, maxDuration } = await import("./route");
const { jsonNoStore } = await import("@/lib/http/no-store");

const ORIGIN = "http://localhost:3000";

function post(body?: string, origin: string | null = ORIGIN) {
  const headers = new Headers({ "content-type": "application/json" });
  if (origin) headers.set("origin", origin);
  return new NextRequest(`${ORIGIN}/api/ingestion/runs`, { method: "POST", headers, body });
}

describe("POST /api/ingestion/runs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    afterCallbacks.length = 0;
    requireApiUser.mockResolvedValue({ ok: true, supabase: {} });
    startIngestionRun.mockResolvedValue({ started: true, runId: 42 });
    executeIngestionRun.mockResolvedValue({ runId: 42, target: "stock_master", status: "failed", processedCount: 0 });
  });

  it("制限時間は 300 秒（after の処理もこの中で動く）", () => {
    expect(maxDuration).toBe(300);
  });

  it("未ログイン・許可リスト外は、ガードの応答をそのまま返し、実行を記録しない", async () => {
    requireApiUser.mockResolvedValue({ ok: false, response: jsonNoStore({ error: "unauthorized" }, { status: 401 }) });
    expect((await POST(post('{"target":"stock_master"}'))).status).toBe(401);
    requireApiUser.mockResolvedValue({ ok: false, response: jsonNoStore({ error: "forbidden" }, { status: 403 }) });
    expect((await POST(post('{"target":"stock_master"}'))).status).toBe(403);
    expect(startIngestionRun).not.toHaveBeenCalled();
  });

  it.each([[null], ["https://evil.example"], ["http://localhost:3001"]])("Origin が %s なら 403", async (origin) => {
    const res = await POST(post('{"target":"stock_master"}', origin));
    expect(res.status).toBe(403);
    expect(startIngestionRun).not.toHaveBeenCalled();
  });

  it.each([['{"target":"financials"}'], ['{"target":"zzz"}'], ['{"target":1}']])("未対応の対象 %s は 400", async (body) => {
    const res = await POST(post(body));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unsupported_target" });
    expect(startIngestionRun).not.toHaveBeenCalled();
  });

  it("JSON でない本文は 400", async () => {
    expect((await POST(post("not json"))).status).toBe(400);
    expect(startIngestionRun).not.toHaveBeenCalled();
  });

  it("本文が無ければ銘柄マスタとして開始し、202 を返してから after で本体を動かす", async () => {
    const res = await POST(post(undefined));
    expect(res.status).toBe(202);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toEqual({ data: { runId: 42, status: "running" } });
    expect(startIngestionRun).toHaveBeenCalledWith(expect.anything(), "stock_master", "manual");
    expect(executeIngestionRun).not.toHaveBeenCalled();
    await afterCallbacks[0]?.();
    expect(executeIngestionRun).toHaveBeenCalledWith(42, "stock_master", expect.anything());
  });

  it("実行中があれば 409 で、本体を動かさない", async () => {
    const activeRun = { id: 7, target: "stock_master", trigger: "cron", status: "running" };
    startIngestionRun.mockResolvedValue({ started: false, activeRun });
    const res = await POST(post('{"target":"stock_master"}'));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "already_running", data: { activeRun } });
    expect(afterCallbacks).toHaveLength(0);
  });
});
