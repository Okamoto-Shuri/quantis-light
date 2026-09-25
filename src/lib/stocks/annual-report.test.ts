import { describe, expect, it } from "vitest";

import { edinetViewerUrl, formatRatioPct, formatShares, jstDateOf, sectionReason, toJstIso } from "./annual-report";

describe("大株主・役員の表示", () => {
  it("持株比率は小数点以下を最低2桁、記載がそれより細かければその桁まで（丸めない）", () => {
    expect(formatRatioPct("32.10", 2)).toBe("32.10%");
    expect(formatRatioPct("32.1", 2)).toBe("32.10%");
    expect(formatRatioPct("9.6", 1)).toBe("9.60%");
    expect(formatRatioPct("0.57", 2)).toBe("0.57%");
    expect(formatRatioPct("12.345", 3)).toBe("12.345%");
    expect(formatRatioPct("5.100", 3)).toBe("5.100%");
    expect(formatRatioPct("40", 0)).toBe("40.00%");
  });

  it("所有株式数は株の3桁区切り", () => {
    expect(formatShares("3210000")).toBe("3,210,000");
    expect(formatShares("57050")).toBe("57,050");
    expect(formatShares(null)).toBeNull();
  });

  it("EDINET の書類閲覧ページの URL（公開の閲覧サイトで表示を確かめた形）", () => {
    expect(edinetViewerUrl("S100W7OT")).toBe("https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx?S100W7OT,,");
  });

  it("日時は日本時間で表示する", () => {
    expect(toJstIso("2025-07-10T06:00:00+00:00")).toBe("2025-07-10T15:00:00+09:00");
    expect(jstDateOf("2025-06-30T16:00:00+00:00")).toBe("2025-07-01");
  });

  it("抽出できなかった理由", () => {
    expect(sectionReason("shareholders", "invalid_values", "ratio_not_numeric")).toBe(
      "『大株主の状況』の記載を読み取れませんでした（持株比率が数値でない行があります）",
    );
    expect(sectionReason("officers", "section_not_found", null)).toBe("書類から『役員の状況』の項目を見つけられませんでした");
    expect(sectionReason("officers", "no_xbrl", null)).toBe("書類に XBRL（機械で読めるデータ）が含まれていません");
    expect(sectionReason("shareholders", "section_not_found", "other_table_only")).toBe("所有株式数の割合による大株主の表が見つかりません");
    expect(sectionReason("shareholders", "ok", null)).toBeNull();
  });
});
