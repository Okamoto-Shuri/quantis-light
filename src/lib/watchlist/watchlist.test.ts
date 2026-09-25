import { describe, expect, it } from "vitest";

import { parseMemoInput } from "./api";
import { watchlistInclusionText } from "./entries";
import { normalizeWatchlistMemo, validateWatchlistMemo, watchlistMemoLength } from "./memo";

describe("メモの規則（第2章の2）", () => {
  it("前後の空白を除いた後のコードポイントで数え、空なら null", () => {
    expect(normalizeWatchlistMemo("　\n メモ \t")).toBe("メモ");
    expect(normalizeWatchlistMemo("　\n ")).toBeNull();
    expect(normalizeWatchlistMemo(null)).toBeNull();
    expect(watchlistMemoLength(` ${"𠮷".repeat(1000)}\n`)).toBe(1000);
    expect(validateWatchlistMemo(` ${"𠮷".repeat(1000)}\n`)).toBeNull();
    expect(validateWatchlistMemo("𠮷".repeat(1001))).toBe("memo_too_long");
  });

  it("PATCH の本文: 文字列・null だけ。1,001 文字は不正", () => {
    expect(parseMemoInput({ memo: " x " })).toEqual({ ok: true, memo: "x" });
    expect(parseMemoInput({ memo: null })).toEqual({ ok: true, memo: null });
    expect(parseMemoInput({ memo: "　" })).toEqual({ ok: true, memo: null });
    for (const body of [{ memo: 1 }, {}, null, [], "x", { memo: "a".repeat(1001) }, { memo: "a\u0000b" }]) expect(parseMemoInput(body)).toEqual({ ok: false });
  });
});

describe("「該当」の列の文言（第2章の6の表）", () => {
  it("DB の分類から作る", () => {
    expect(watchlistInclusionText({ exclusion: null, blocking: [] })).toEqual({ kind: "included", text: "該当" });
    expect(watchlistInclusionText({ exclusion: "delisted", blocking: [] })).toEqual({ kind: "delisted", text: "上場廃止" });
    expect(watchlistInclusionText({ exclusion: "filters", blocking: [] }).text).toBe("該当しない（絞り込みの対象外）");
    expect(
      watchlistInclusionText({
        exclusion: "unmet",
        blocking: [
          { condition: "cagr", status: "unmet" },
          { condition: "margin", status: "unavailable" },
          { condition: "years", status: "unmet" },
          { condition: "owner", status: "unavailable" },
        ],
      }).text,
    ).toBe("該当しない（条件①・条件③）");
    expect(
      watchlistInclusionText({
        exclusion: "unavailable",
        blocking: [
          { condition: "cagr", status: "unavailable" },
          { condition: "owner", status: "unavailable" },
        ],
      }).text,
    ).toBe("該当しない（条件① 算出不可）");
    expect(watchlistInclusionText({ exclusion: "undeterminable", blocking: [{ condition: "owner", status: "unavailable" }] })).toEqual({
      kind: "undeterminable",
      text: "該当しない（条件④ 判定不能）",
    });
  });
});
