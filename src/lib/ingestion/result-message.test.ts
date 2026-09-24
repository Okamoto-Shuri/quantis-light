import { describe, expect, it } from "vitest";

import { formatRunResult } from "./result-message";

const master = { target: "stock_master" as const };
const quotes = { target: "daily_quotes" as const };

describe("formatRunResult", () => {
  it("銘柄マスタの成功は保存した件数を3桁区切りで示す", () => {
    expect(formatRunResult({ ...master, status: "succeeded", processedCount: 4123, errorMessage: null })).toBe(
      "成功: 4,123 件を保存しました",
    );
    expect(formatRunResult({ ...master, status: "succeeded", processedCount: 7, errorMessage: null })).toBe(
      "成功: 7 件を保存しました",
    );
  });

  it("失敗はエラーメッセージをそのまま示す", () => {
    expect(
      formatRunResult({ ...master, status: "failed", processedCount: 0, errorMessage: "J-Quants の API キーが設定されていません" }),
    ).toBe("失敗: J-Quants の API キーが設定されていません");
    expect(formatRunResult({ ...quotes, status: "failed", processedCount: 0, errorMessage: null })).toBe("失敗: 原因不明のエラー");
  });

  it("実行中と一部失敗", () => {
    expect(formatRunResult({ ...master, status: "running", processedCount: 0, errorMessage: null })).toBe("実行中…");
    expect(formatRunResult({ ...master, status: "partial", processedCount: 1200, errorMessage: "3 銘柄で失敗" })).toBe(
      "一部失敗: 1,200 件を保存しました（3 銘柄で失敗）",
    );
  });

  it("株価（初出日）の成功・一部失敗", () => {
    expect(formatRunResult({ ...quotes, status: "succeeded", processedCount: 1234, errorMessage: null, details: { noPriceData: 0 } })).toBe(
      "成功: 1,234 銘柄の初出日を保存しました",
    );
    expect(formatRunResult({ ...quotes, status: "succeeded", processedCount: 1234, errorMessage: null, details: { noPriceData: 3 } })).toBe(
      "成功: 1,234 銘柄の初出日を保存しました（株価データがまだ無い銘柄: 3）",
    );
    expect(formatRunResult({ ...quotes, status: "succeeded", processedCount: 0, errorMessage: null, details: { pending: 0 } })).toBe(
      "成功: 新たに初出日を保存した銘柄はありません（すべて確定済み）",
    );
    expect(
      formatRunResult({
        ...quotes,
        status: "partial",
        processedCount: 300,
        errorMessage: "時間内に処理しきれなかったため、残り 812 銘柄は次回の取り込みで処理します",
      }),
    ).toBe("一部失敗: 300 銘柄の初出日を保存しました（時間内に処理しきれなかったため、残り 812 銘柄は次回の取り込みで処理します）");
  });

  it("財務（決算短信）の成功・一部失敗", () => {
    const fin = { target: "financials" as const };
    expect(formatRunResult({ ...fin, status: "succeeded", processedCount: 1234, errorMessage: null, details: { datesFetched: 185 } })).toBe(
      "成功: 通期決算 1,234 件を保存しました（開示日 185 日分を取得）",
    );
    expect(formatRunResult({ ...fin, status: "succeeded", processedCount: 0, errorMessage: null, details: { datesFetched: 5 } })).toBe(
      "成功: 新しい通期決算はありません（開示日 5 日分を確認）",
    );
    expect(
      formatRunResult({
        ...fin,
        status: "partial",
        processedCount: 800,
        errorMessage: "時間内に処理しきれなかったため、残り 1,380 日分の開示日は次回の取り込みで処理します",
      }),
    ).toBe("一部失敗: 通期決算 800 件を保存しました（時間内に処理しきれなかったため、残り 1,380 日分の開示日は次回の取り込みで処理します）");
  });
});
