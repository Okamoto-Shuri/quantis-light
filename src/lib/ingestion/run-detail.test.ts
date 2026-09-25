import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { parseRunId } = await import("./run-detail");

describe("parseRunId（C2-9・C2-10）", () => {
  it("正の整数だけ", () => {
    expect(parseRunId("1")).toBe(1);
    expect(parseRunId("999999")).toBe(999999);
    for (const raw of ["abc", "0", "-1", "1.5", "01", "", "1e3", " 1", "99999999999999999"]) {
      expect(parseRunId(raw), raw).toBeNull();
    }
  });
});
