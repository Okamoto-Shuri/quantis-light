import { describe, expect, it } from "vitest";

import { parseTheme, themeAttribute, themeCookieString } from "./theme";

describe("parseTheme", () => {
  it("light / dark / system をそのまま受け付ける", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("system")).toBe("system");
  });
  it("未設定や不正な値は system（OS に合わせる）として扱う", () => {
    expect(parseTheme(undefined)).toBe("system");
    expect(parseTheme("")).toBe("system");
    expect(parseTheme("<script>")).toBe("system");
    expect(parseTheme("DARK")).toBe("system");
  });
});

describe("themeAttribute", () => {
  it("system のときは data-theme を付けない", () => {
    expect(themeAttribute("system")).toBeUndefined();
    expect(themeAttribute("dark")).toBe("dark");
  });
});

describe("themeCookieString", () => {
  it("1年間、全パスで有効な Cookie にする", () => {
    expect(themeCookieString("dark")).toBe("theme=dark; Path=/; Max-Age=31536000; SameSite=Lax");
  });
});
