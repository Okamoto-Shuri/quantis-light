import { describe, expect, it } from "vitest";

import { buildLoginPath, sanitizeNextPath } from "./next-path";

describe("sanitizeNextPath", () => {
  it.each([
    ["/", "/"],
    ["/stocks/72030", "/stocks/72030"],
    ["/foo?a=1", "/foo?a=1"],
    ["/screening?cagr=15#result", "/screening?cagr=15#result"],
    ["/foo/../bar", "/bar"],
  ])("アプリ内のパス %s は採用する", (input, expected) => {
    expect(sanitizeNextPath(input)).toBe(expected);
  });

  // 値は URLSearchParams でデコードされた後の文字列（C2-4 の表の「デコード後」列）
  it.each([
    ["https://example.com"],
    ["//example.com"],
    ["/\\example.com"],
    ["%2F%5Cexample.com"], // 二重エンコードのデコード後
    ["/\t/example.com"],
    ["/\n/example.com"],
    ["/\r/example.com"],
    ["/foo\u0000"],
    ["/foo\u007F"],
    ["https:example.com"],
    ["javascript:alert(1)"],
    ["\\\\example.com"],
    ["/foo\\bar"],
    [" /foo"],
    [""],
  ])("外部や不正な値 %j は / にする", (input) => {
    expect(sanitizeNextPath(input)).toBe("/");
  });

  it.each([[null], [undefined], [123], [{}]])("文字列でない値 %j は / にする", (input) => {
    expect(sanitizeNextPath(input)).toBe("/");
  });

  it("実際のクエリ文字列からデコードした値でも外部に出ない", () => {
    const cases = [
      "next=https%3A%2F%2Fexample.com",
      "next=%2F%2Fexample.com",
      "next=%2F%5Cexample.com",
      "next=%252F%255Cexample.com",
      "next=/%09/example.com",
      "next=%2F%0A%2Fexample.com",
      "next=https%3Aexample.com",
      "next=javascript%3Aalert(1)",
    ];
    for (const query of cases) {
      expect(sanitizeNextPath(new URLSearchParams(query).get("next"))).toBe("/");
    }
  });
});

describe("buildLoginPath", () => {
  it("元のパスを next に付ける", () => {
    expect(buildLoginPath("/screening")).toBe("/login?next=%2Fscreening");
    expect(buildLoginPath("/foo", "?a=1")).toBe("/login?next=%2Ffoo%3Fa%3D1");
  });

  it("ルートや不正なパスでは next を付けない", () => {
    expect(buildLoginPath("/")).toBe("/login");
    expect(buildLoginPath("//evil.example")).toBe("/login");
  });
});
