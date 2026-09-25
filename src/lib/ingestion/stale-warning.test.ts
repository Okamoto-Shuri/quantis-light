import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

const { StaleDataWarning } = await import("@/components/shell/stale-data-warning");

describe("鮮度の警告（契約 C4-11）", () => {
  it("data_freshness() の取得に失敗したら、例外を投げずに何も描画しない", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    await expect(StaleDataWarning()).resolves.toBeNull();
    rpc.mockRejectedValue(new TypeError("fetch failed"));
    await expect(StaleDataWarning()).resolves.toBeNull();
    rpc.mockResolvedValue({ data: { stale: "yes" }, error: null });
    await expect(StaleDataWarning()).resolves.toBeNull();
  });

  it("古くなければ何も描画せず、古ければ警告を返す", async () => {
    rpc.mockResolvedValue({ data: { stale: false, lastUpdatedAt: null, targets: [] }, error: null });
    await expect(StaleDataWarning()).resolves.toBeNull();
    rpc.mockResolvedValue({
      data: {
        stale: true,
        lastUpdatedAt: "2026-09-22T12:00:00+00:00",
        targets: [{ target: "daily_quotes", lastUpdatedAt: "2026-09-22T12:00:00+00:00", stale: true, remainingCount: null, remainingUnit: null }],
      },
      error: null,
    });
    await expect(StaleDataWarning()).resolves.not.toBeNull();
  });
});
