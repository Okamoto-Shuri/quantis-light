import { describe, expect, it } from "vitest";

import { isNavItemActive, NAV_ITEMS } from "./navigation";

describe("NAV_ITEMS", () => {
  it("実装済みの画面だけを、仕様の順序で並べる", () => {
    expect(NAV_ITEMS.map((item) => item.label)).toEqual(["ダッシュボード", "スクリーニング", "ウォッチリスト", "取り込み状況", "設定"]);
  });
});

describe("isNavItemActive", () => {
  it("ダッシュボードは / のときだけ", () => {
    expect(isNavItemActive("/", "/")).toBe(true);
    expect(isNavItemActive("/imports", "/")).toBe(false);
  });
  it("配下のパスでも現在の項目にする", () => {
    expect(isNavItemActive("/imports", "/imports")).toBe(true);
    expect(isNavItemActive("/imports/12", "/imports")).toBe(true);
  });
  it("前方一致だけの別の画面は対象外", () => {
    expect(isNavItemActive("/importsx", "/imports")).toBe(false);
    expect(isNavItemActive("/nope", "/settings")).toBe(false);
  });
});
