import { describe, expect, it } from "vitest";

import { isSelfAuthenticatedPath } from "./proxy-paths";

describe("isSelfAuthenticatedPath（proxy の未ログイン判定から外すパス）", () => {
  it("/api/cron/ の配下だけを外す", () => {
    expect(isSelfAuthenticatedPath("/api/cron/daily")).toBe(true);
    expect(isSelfAuthenticatedPath("/api/cron/zzz")).toBe(true);
  });

  it.each(["/api/cron", "/api/cronx", "/api/cron-daily", "/API/cron/daily", "/api/Cron/daily", "/api/ingestion", "/api/dashboard", "/", "/imports", "/cron/daily"])(
    "%s は外さない",
    (path) => {
      expect(isSelfAuthenticatedPath(path)).toBe(false);
    },
  );
});
