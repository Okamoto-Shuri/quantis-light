import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getUser = vi.fn();
const rpcResults: Record<string, { data: unknown; error: unknown }> = {};
const rpc = vi.fn(async (name: string) => rpcResults[name] ?? { data: null, error: null });
let stocks: { data: unknown; error: unknown } = { data: [{ code: "9U003" }], error: null };

function builder() {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "limit"]) chain[method] = () => chain;
  chain.then = (resolve: (value: unknown) => unknown) => resolve(stocks);
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser }, rpc, from: builder }),
}));

const { GET, PUT, DELETE } = await import("./route");
const { POST } = await import("./acknowledge/route");

const OVERRIDE = {
  verdict: "owner_company",
  memo: "理由",
  created_at: "2026-09-25T01:00:00+00:00",
  updated_at: "2026-09-25T02:30:00+00:00",
  auto_changed: false,
  auto_at_override: {
    status: "determined",
    undeterminable_reason: null,
    president_is_top_holder: false,
    owner_total_pct: "0",
    shareholders_doc_id: "SXTEST03",
    officers_doc_id: "SXTEST03",
    result: "not_matched",
  },
  auto_current: {
    status: "determined",
    undeterminable_reason: null,
    president_is_top_holder: false,
    owner_total_pct: "0",
    shareholders_doc_id: "SXTEST03",
    officers_doc_id: "SXTEST03",
    result: "not_matched",
  },
};

const ORIGIN = "http://localhost:3000";

function request(method: string, code: string, body?: string, origin: string | null = ORIGIN) {
  const headers: Record<string, string> = { host: "localhost:3000" };
  if (origin) headers.origin = origin;
  return [new NextRequest(`${ORIGIN}/api/stocks/${code}/ownership-override`, { method, headers, body }), { params: Promise.resolve({ code }) }] as const;
}

function allowUser() {
  getUser.mockResolvedValue({ data: { user: { id: "u1", email: "owner@quantis.local" } }, error: null });
  rpcResults.current_user_is_allowed = { data: true, error: null };
}

describe("/api/stocks/[code]/ownership-override（Sprint 11。C4-6〜C4-8）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(rpcResults)) delete rpcResults[key];
    stocks = { data: [{ code: "9U003" }], error: null };
  });

  it("未ログインは 401（書き込みの関数を呼ばない）", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "Auth session missing!" } });
    for (const res of [await GET(...request("GET", "9U003")), await PUT(...request("PUT", "9U003", "{}")), await DELETE(...request("DELETE", "9U003")), await POST(...request("POST", "9U003"))]) {
      expect(res.status).toBe(401);
      expect(res.headers.get("cache-control")).toContain("no-store");
    }
    expect(rpc).not.toHaveBeenCalledWith("owner_override_save", expect.anything());
  });

  it("別のオリジン・Origin なしの書き込みは 403 cross_origin", async () => {
    allowUser();
    for (const origin of ["https://evil.example", null]) {
      for (const res of [
        await PUT(...request("PUT", "9U003", JSON.stringify({ verdict: "not_matched", memo: "x" }), origin)),
        await DELETE(...request("DELETE", "9U003", undefined, origin)),
        await POST(...request("POST", "9U003", undefined, origin)),
      ]) {
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: "cross_origin" });
      }
    }
    expect(rpc).not.toHaveBeenCalledWith("owner_override_save", expect.anything());
  });

  it("PUT: 本文の検証（JSON でない・選択肢・メモ）と、正規化したコード・前後の空白を除いたメモで保存", async () => {
    allowUser();
    expect(await (await PUT(...request("PUT", "9U003", "{not json"))).json()).toEqual({ error: "invalid_body" });
    const bad = await PUT(...request("PUT", "9U003", JSON.stringify({ verdict: "met", memo: "　\n" })));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_override", fields: ["verdict", "memo"] });
    expect((await PUT(...request("PUT", "ABC!", JSON.stringify({ verdict: "not_matched", memo: "x" })))).status).toBe(400);

    rpcResults.owner_override_save = { data: OVERRIDE, error: null };
    const ok = await PUT(...request("PUT", "9u003", JSON.stringify({ verdict: "owner_company", memo: " 理由\n" })));
    expect(ok.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("owner_override_save", { p_code: "9U003", p_verdict: "owner_company", p_memo: "理由" });
    const body = await ok.json();
    expect(body.data).toMatchObject({ verdict: "owner_company", created_at: "2026-09-25T10:00:00+09:00", updated_at: "2026-09-25T11:30:00+09:00" });

    rpcResults.owner_override_save = { data: null, error: null };
    const missing = await PUT(...request("PUT", "9U999", JSON.stringify({ verdict: "owner_company", memo: "x" })));
    expect(missing.status).toBe(404);
  });

  it("DELETE: 消したかを返す。銘柄が無ければ 404", async () => {
    allowUser();
    rpcResults.owner_override_delete = { data: false, error: null };
    expect(await (await DELETE(...request("DELETE", "9U003"))).json()).toEqual({ deleted: false });
    rpcResults.owner_override_delete = { data: true, error: null };
    expect(await (await DELETE(...request("DELETE", "9U003"))).json()).toEqual({ deleted: true });
    stocks = { data: [], error: null };
    expect((await DELETE(...request("DELETE", "9U999"))).status).toBe(404);
  });

  it("GET と確認済み: 補正が無ければ GET は null、確認済みは 404 override_not_found", async () => {
    allowUser();
    rpcResults.owner_override_summary = { data: null, error: null };
    expect(await (await GET(...request("GET", "9U003"))).json()).toEqual({ data: null });
    rpcResults.owner_override_acknowledge = { data: null, error: null };
    const ack = await POST(...request("POST", "9U003"));
    expect(ack.status).toBe(404);
    expect(await ack.json()).toEqual({ error: "override_not_found" });
    rpcResults.owner_override_acknowledge = { data: OVERRIDE, error: null };
    expect((await (await POST(...request("POST", "9U003"))).json()).data.verdict).toBe("owner_company");
  });
});
