import { describe, expect, it, vi } from "vitest";

import { apiOverrideResponse, OverrideShapeError, toApiOverride } from "./override";

describe("toApiOverride・apiOverrideResponse（Sprint 11 評価の m6。契約 sprint-12 の C8-3）", () => {
  it("形の違う値を黙って null にせず、例外にする", () => {
    expect(() => toApiOverride({ verdict: "owner_company" })).toThrow(OverrideShapeError);
  });

  it("API は形が違えば 500 internal_error にしてログを残す。null は data: null", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = apiOverrideResponse({ verdict: "owner_company" });
    expect(bad.status).toBe(500);
    expect(await bad.json()).toEqual({ error: "internal_error" });
    expect(error).toHaveBeenCalled();
    const none = apiOverrideResponse(null);
    expect(none.status).toBe(200);
    expect(await none.json()).toEqual({ data: null });
  });
});
