import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getCronSecret, getIngestionConfigStatus, isAuthorizedCronRequest } = await import("./config");

const SECRET = "local-cron-secret-0123456789";

describe("getIngestionConfigStatus", () => {
  afterEach(() => vi.restoreAllMocks());

  it("環境変数が無い、または空白だけなら未設定", () => {
    expect(getIngestionConfigStatus({})).toEqual({
      sources: [
        { id: "jquants", configured: false },
        { id: "edinet", configured: false },
      ],
      cron: { configured: false },
    });
    expect(getIngestionConfigStatus({ JQUANTS_API_KEY: "  ", EDINET_API_KEY: "", CRON_SECRET: " " }).sources).toEqual([
      { id: "jquants", configured: false },
      { id: "edinet", configured: false },
    ]);
  });

  it("値があれば設定済み。結果には値も長さも含まれない", () => {
    const status = getIngestionConfigStatus({
      JQUANTS_API_KEY: "qa-dummy-key-7f3a9c",
      EDINET_API_KEY: "qa-edinet-key-5b21e8",
      CRON_SECRET: SECRET,
    });
    expect(status).toEqual({
      sources: [
        { id: "jquants", configured: true },
        { id: "edinet", configured: true },
      ],
      cron: { configured: true },
    });
    const text = JSON.stringify(status);
    for (const fragment of ["qa-d", "7f3a9c", "qa-e", "5b21e8", "local-cron", "19", "28"]) expect(text).not.toContain(fragment);
  });

  it("16 文字未満の CRON_SECRET は未設定として扱い、警告を出す", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getCronSecret({ CRON_SECRET: "short" })).toBeNull();
    expect(getCronSecret({ CRON_SECRET: "a".repeat(15) })).toBeNull();
    expect(getCronSecret({ CRON_SECRET: "a".repeat(16) })).toBe("a".repeat(16));
    expect(getIngestionConfigStatus({ CRON_SECRET: "short" }).cron.configured).toBe(false);
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0]?.[0])).not.toContain("short");
  });
});

describe("isAuthorizedCronRequest", () => {
  it("`Bearer <CRON_SECRET>` と完全に一致するときだけ許可する", () => {
    expect(isAuthorizedCronRequest(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it.each([
    ["ヘッダー無し", null],
    ["空", ""],
    ["誤った値", "Bearer wrong"],
    ["長さの違う値", `Bearer ${SECRET}x`],
    ["前方だけ一致", `Bearer ${SECRET.slice(0, 10)}`],
    ["Bearer 無し", SECRET],
    ["小文字の bearer", `bearer ${SECRET}`],
    ["Bearer の後に空白が2つ", `Bearer  ${SECRET}`],
    ["Bearer だけ", "Bearer "],
  ])("%s は拒否する", (_label, header) => {
    expect(isAuthorizedCronRequest(header, SECRET)).toBe(false);
  });

  it("シークレットが未設定なら、どんなヘッダーでも拒否する", () => {
    expect(isAuthorizedCronRequest("Bearer ", null)).toBe(false);
    expect(isAuthorizedCronRequest("Bearer null", null)).toBe(false);
    expect(isAuthorizedCronRequest("", null)).toBe(false);
  });
});
