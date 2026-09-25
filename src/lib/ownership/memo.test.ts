import { describe, expect, it } from "vitest";

import { MEMO_WHITESPACE_CLASS, memoLength, trimMemo, validateMemo } from "./memo";

describe("メモの規則（Sprint 11。契約の第2章の6）", () => {
  it("空白の文字集合は JavaScript の \\s と同じ（U+0000〜U+FFFF のすべてで一致）", () => {
    const ours = new RegExp(`^${MEMO_WHITESPACE_CLASS}$`, "u");
    const differences: string[] = [];
    for (let cp = 0; cp <= 0xffff; cp++) {
      const ch = String.fromCharCode(cp);
      if (ours.test(ch) !== /^\s$/.test(ch)) differences.push(cp.toString(16));
    }
    expect(differences).toEqual([]);
  });

  it("前後の空白（全角空白・改行・タブ）を除き、途中は保つ", () => {
    expect(trimMemo("　\n 理由\n2行目 \t　")).toBe("理由\n2行目");
    expect(trimMemo("\n\n")).toBe("");
  });

  it("コードポイントで数える（「𠮷」は1文字）", () => {
    expect(memoLength("𠮷".repeat(1000))).toBe(1000);
    expect("𠮷".repeat(1000).length).toBe(2000);
  });

  it("空白だけ・改行だけは必須の違反、1,001 文字は上限の違反、末尾の改行は数えない", () => {
    expect(validateMemo(" ")).toBe("memo_required");
    expect(validateMemo("　　")).toBe("memo_required");
    expect(validateMemo("\n\n")).toBe("memo_required");
    expect(validateMemo("\t　\n")).toBe("memo_required");
    expect(validateMemo("a".repeat(1001))).toBe("memo_too_long");
    expect(validateMemo("𠮷".repeat(1001))).toBe("memo_too_long");
    expect(validateMemo("𠮷".repeat(1000))).toBeNull();
    expect(validateMemo(`${"a".repeat(1000)}\n`)).toBeNull();
  });
});
