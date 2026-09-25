import { describe, expect, it } from "vitest";

import { fractionDigits, padFraction, parseDecimal, shiftDecimal } from "./decimal";

describe("shiftDecimal（浮動小数点を経由しない）", () => {
  it.each([
    ["0.3210", 2, "32.10"],
    ["0.0057", 2, "0.57"],
    ["0.0129", 2, "1.29"],
    ["0.12345", 2, "12.345"],
    ["0.096", 2, "9.6"],
    ["9.6", -2, "0.096"],
    ["7554", 3, "7554000"],
    ["18.23", -2, "0.1823"],
    ["1", 0, "1"],
    ["-1.5", 1, "-15"],
    ["0", 2, "0"],
    ["100", -2, "1.00"],
  ])("%s を %i 桁ずらすと %s", (value, places, expected) => {
    expect(shiftDecimal(value, places)).toBe(expected);
  });

  it("number で 100 倍すると誤差が出る値でも、文字列では正確", () => {
    expect(0.0057 * 100).not.toBe(0.57);
    expect(shiftDecimal("0.0057", 2)).toBe("0.57");
  });

  it("数でなければ null", () => {
    expect(shiftDecimal("1,000", 0)).toBeNull();
    expect(shiftDecimal("abc", 2)).toBeNull();
    expect(shiftDecimal("", 2)).toBeNull();
  });
});

describe("parseDecimal・fractionDigits・padFraction", () => {
  it("十進の数の文字列だけを受け付ける", () => {
    expect(parseDecimal("0012.340")).toEqual({ negative: false, int: "12", frac: "340" });
    expect(parseDecimal("1e3")).toBeNull();
    expect(parseDecimal("1.")).toBeNull();
  });

  it("小数部の桁数", () => {
    expect(fractionDigits("32.10")).toBe(2);
    expect(fractionDigits("5")).toBe(0);
  });

  it("桁をそろえる（0 以外の桁は落とさない）", () => {
    expect(padFraction("32.1", 2)).toBe("32.10");
    expect(padFraction("12.3450", 3)).toBe("12.345");
    expect(padFraction("12.3456", 2)).toBe("12.3456");
    expect(padFraction("9.6", 1)).toBe("9.6");
  });
});
