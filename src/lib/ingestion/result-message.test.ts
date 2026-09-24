import { describe, expect, it } from "vitest";

import { formatRunResult } from "./result-message";

describe("formatRunResult", () => {
  it("成功は保存した件数を3桁区切りで示す", () => {
    expect(formatRunResult({ status: "succeeded", processedCount: 4123, errorMessage: null })).toBe(
      "成功: 4,123 件を保存しました",
    );
    expect(formatRunResult({ status: "succeeded", processedCount: 7, errorMessage: null })).toBe(
      "成功: 7 件を保存しました",
    );
  });

  it("失敗はエラーメッセージをそのまま示す", () => {
    expect(
      formatRunResult({ status: "failed", processedCount: 0, errorMessage: "J-Quants の API キーが設定されていません" }),
    ).toBe("失敗: J-Quants の API キーが設定されていません");
    expect(formatRunResult({ status: "failed", processedCount: 0, errorMessage: null })).toBe("失敗: 原因不明のエラー");
  });

  it("実行中と一部失敗", () => {
    expect(formatRunResult({ status: "running", processedCount: 0, errorMessage: null })).toBe("実行中…");
    expect(formatRunResult({ status: "partial", processedCount: 1200, errorMessage: "3 銘柄で失敗" })).toBe(
      "一部失敗: 1,200 件を保存しました（3 銘柄で失敗）",
    );
  });
});
