import { describe, expect, it } from "vitest";

import { changeReasonKey, changeReasonText, cycleCaption, incompleteTargets, incompleteTargetsText, screeningChangesSchema } from "./changes";

describe("変化の理由の文言（第2章の9）", () => {
  it("条件の変化は「① 売上CAGR: 満たさない → 満たす」、④ の算出不可は判定不能", () => {
    expect(changeReasonText({ kind: "condition", condition: "cagr", from: "unmet", to: "met" })).toBe("① 売上CAGR: 満たさない → 満たす");
    expect(changeReasonText({ kind: "condition", condition: "owner", from: "unavailable", to: "met" })).toBe(
      "④ オーナー企業／社長が筆頭株主: 判定不能 → 満たす",
    );
    expect(changeReasonText({ kind: "condition", condition: "years", from: "met", to: "unavailable" })).toBe("③ 上場年数: 満たす → 算出不可");
    expect(changeReasonKey({ kind: "condition", condition: "margin", from: "met", to: "unmet" })).toBe("margin:met>unmet");
  });

  it("種類だけの理由", () => {
    expect(
      (["new_stock", "relisted", "delisted", "missing", "filters"] as const).map((kind) => [changeReasonKey({ kind }), changeReasonText({ kind })]),
    ).toEqual([
      ["new_stock", "新規の銘柄（前回は銘柄データなし）"],
      ["relisted", "上場廃止から戻った"],
      ["delisted", "上場廃止"],
      ["missing", "銘柄データなし"],
      ["filters", "市場区分・業種の変更"],
    ]);
  });

  it("直近の取り込みの表示（日本時間）", () => {
    expect(cycleCaption({ cycleDate: "2026-09-26", capturedAt: "2026-09-26T11:02:00+00:00" })).toBe("直近の取り込み: 2026-09-26（20:02 開始）");
  });

  it("DB の戻り値の形（理由の無い銘柄は受け付けない）", () => {
    const base = { status: "ok", snapshotId: 1, capturedAt: null, cycleDate: null, referenceDate: null, previousReferenceDate: null, removed: [] };
    expect(screeningChangesSchema.safeParse({ ...base, added: [{ code: "1", company_name: "x", market_code: null, market_name: null, reasons: [] }] }).success).toBe(false);
    expect(screeningChangesSchema.safeParse({ ...base, added: [] }).success).toBe(true);
  });
});

describe("今回の取り込みで完了していない対象（第4章）", () => {
  const run = (target: string, status: string, startedAt: string) => ({ target, status, started_at: startedAt }) as never;

  it("最後に終わった実行が failed・partial の対象だけ。後の成功で打ち消す。実行中は数えない。表示の順は対象の順", () => {
    const runs = [
      run("daily_quotes", "failed", "1"),
      run("stock_master", "failed", "0"),
      run("financials", "partial", "2"),
      run("financials", "succeeded", "3"),
      run("edinet_reports", "running", "4"),
    ];
    const targets = incompleteTargets([runs[1], runs[0], runs[2], runs[3], runs[4]]);
    expect(targets).toEqual(["stock_master", "daily_quotes"]);
    expect(incompleteTargetsText(targets)).toBe("銘柄マスタ・株価");
    expect(incompleteTargets([])).toEqual([]);
  });
});
