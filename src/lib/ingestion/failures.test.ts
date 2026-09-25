import { describe, expect, it } from "vitest";

import { failureMessage, FailureLog, FAILURE_ROWS_LIMIT } from "./failures";

describe("failureMessage（契約 sprint-12 の第2章の2）", () => {
  it("理由のコードから決まった文言を作る", () => {
    expect(failureMessage({ itemType: "stock", reason: "http_error", httpStatus: 500, networkError: null })).toBe(
      "J-Quants から予期しない応答がありました（HTTP 500）",
    );
    expect(failureMessage({ itemType: "stock", reason: "unreachable", httpStatus: null, networkError: "timeout" })).toBe(
      "J-Quants に接続できませんでした（タイムアウト）",
    );
    expect(failureMessage({ itemType: "disclosure_date", reason: "invalid_format", httpStatus: null, networkError: null })).toBe(
      "応答の形式が想定と異なります",
    );
    expect(failureMessage({ itemType: "stock", reason: "row_mismatch", httpStatus: null, networkError: null })).toBe(
      "応答に別の銘柄の行が含まれていました",
    );
    expect(failureMessage({ itemType: "document", reason: "not_found", httpStatus: 404, networkError: null })).toBe(
      "EDINET から書類を取得できませんでした（HTTP 404）",
    );
    expect(failureMessage({ itemType: "list_date", reason: "http_error", httpStatus: 500, networkError: null })).toBe(
      "EDINET から予期しない応答がありました（HTTP 500）",
    );
    expect(failureMessage({ itemType: "document", reason: "pdf_returned", httpStatus: null, networkError: null })).toBe(
      "PDF の応答（不開示の書類など）",
    );
    expect(failureMessage({ itemType: "document", reason: "invalid_archive", httpStatus: null, networkError: null })).toBe(
      "ZIP を読めませんでした",
    );
    expect(failureMessage({ itemType: "document", reason: "unreachable", httpStatus: null, networkError: "network" })).toBe(
      "EDINET に接続できませんでした（ネットワークエラー）",
    );
  });
});

describe("FailureLog", () => {
  it("1,000 件を超えた分は数えるだけ。同じ対象は1回（C2-6）", () => {
    const log = new FailureLog();
    for (let i = 0; i < FAILURE_ROWS_LIMIT + 1; i++) {
      log.add({ itemType: "stock", itemKey: `C${i}`, code: `C${i}`, reason: "http_error", httpStatus: 500, networkError: null });
    }
    log.add({ itemType: "stock", itemKey: "C0", code: "C0", reason: "http_error", httpStatus: 500, networkError: null });
    expect(log.records).toHaveLength(1_000);
    expect(log.total).toBe(1_001);
  });
});
