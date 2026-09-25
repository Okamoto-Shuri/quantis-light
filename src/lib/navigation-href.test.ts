import { describe, expect, it } from "vitest";

import { navItemHref } from "./navigation-href";

describe("ナビゲーションの「スクリーニング」のリンク先（AC7.6・C7-5）", () => {
  it("銘柄詳細では受け取った条件の正規形を付ける", () => {
    expect(navItemHref("/screening", "/stocks/99991", "cagr=15&off=margin&unavailable=include&sort=years&order=asc")).toBe(
      "/screening?cagr=15&margin=10&years=5&owner=20&ownermode=any&off=margin&unavailable=include&sort=years&order=asc",
    );
  });

  it("クエリが無ければ /screening。未知のパラメータ・不正な項目は含めない", () => {
    expect(navItemHref("/screening", "/stocks/99991", "")).toBe("/screening");
    expect(navItemHref("/screening", "/stocks/99991", "foo=1")).toBe("/screening");
    expect(navItemHref("/screening", "/stocks/99991", "cagr=abc&foo=1")).toBe("/screening?cagr=20&margin=10&years=5&owner=20&ownermode=any&sort=cagr&order=desc");
  });

  it("ほかの画面・ほかの項目は変えない", () => {
    expect(navItemHref("/screening", "/", "cagr=15")).toBe("/screening");
    expect(navItemHref("/screening", "/imports", "cagr=15")).toBe("/screening");
    expect(navItemHref("/screening", "/stocks/99991/zzz", "cagr=15")).toBe("/screening");
    expect(navItemHref("/imports", "/stocks/99991", "cagr=15")).toBe("/imports");
  });
});
