import { describe, expect, it, vi } from "vitest";

import { annualItem, finsItem, finsResponse, forecastRevisionItem, OFFICIAL_SAMPLE_ITEM, quarterItem } from "./__fixtures__/fins-summary";
import { parseFinsSummary, requestFinsSummaryPage, toAnnualStatement } from "./fins-summary";

const FY = { code: "99991", discNo: "20250514000001", discDate: "2025-05-14", fyStart: "2024-04-01", fyEnd: "2025-03-31" };

describe("toAnnualStatement（通期の決算短信の1行）", () => {
  it("連結の短信は Sales・OP の実績を使い、予想の項目は読まない", () => {
    expect(toAnnualStatement(annualItem({ ...FY, sales: "40000000000", op: "6000000000" }))).toEqual({
      code: "99991",
      disclosure_no: "20250514000001",
      disclosed_date: "2025-05-14",
      disclosed_time: "15:00:00",
      document_type: "FYFinancialStatements_Consolidated_JP",
      fiscal_year_start: "2024-04-01",
      fiscal_year_end: "2025-03-31",
      net_sales: "40000000000",
      operating_profit: "6000000000",
    });
  });

  it("空文字は開示なし（null）。連結の短信では NCSales・NCOP に戻らない", () => {
    const row = toAnnualStatement(
      annualItem({ ...FY, docType: "FYFinancialStatements_Consolidated_IFRS", sales: "100", op: "", extra: { NCOP: "5" } }),
    );
    expect(row).toMatchObject({ net_sales: "100", operating_profit: null });
  });

  it("非連結の短信は、項目ごとに Sales・OP が空なら NCSales・NCOP を使う", () => {
    const docType = "FYFinancialStatements_NonConsolidated_JP";
    expect(toAnnualStatement(annualItem({ ...FY, docType, sales: "", op: "", extra: { NCSales: "700", NCOP: "70" } }))).toMatchObject({
      net_sales: "700",
      operating_profit: "70",
    });
    expect(toAnnualStatement(annualItem({ ...FY, docType, sales: "800", op: "", extra: { NCSales: "1", NCOP: "80" } }))).toMatchObject({
      net_sales: "800",
      operating_profit: "80",
    });
  });

  it("開示時刻が空なら null。負の値と小数も受け付ける", () => {
    expect(toAnnualStatement(annualItem({ ...FY, discTime: "", sales: "-5", op: "1.5" }))).toMatchObject({
      disclosed_time: null,
      net_sales: "-5",
      operating_profit: "1.5",
    });
  });

  it.each([
    ["CurPerType が FY でない", { CurPerType: "4Q" }],
    ["DiscNo が空", { DiscNo: "" }],
    ["DiscDate が壊れている", { DiscDate: "2025-02-30" }],
    ["DiscTime が壊れている", { DiscTime: "3pm" }],
    ["CurFYEn が壊れている", { CurFYEn: "2025/03/31" }],
    ["終了日が開始日以前", { CurFYEn: "2024-04-01" }],
    ["売上高が数値でない", { Sales: "1,000" }],
    ["営業利益が数値でない", { OP: "-" }],
    ["コードの形式が違う", { Code: "abc" }],
  ])("%s なら形式の違い（null）", (_label, extra) => {
    expect(toAnnualStatement({ ...annualItem({ ...FY, sales: "1", op: "1" }), ...extra })).toBeNull();
  });
});

describe("parseFinsSummary", () => {
  it("通期の決算短信だけを取り出し、四半期・予想の修正・REIT は読まない。受け取った行数と形式の違いを数える", () => {
    const page = parseFinsSummary(
      finsResponse(
        [
          annualItem({ ...FY, sales: "400", op: "60" }),
          quarterItem("99991", "2025-05-14", "q1"),
          forecastRevisionItem("99991", "2025-05-14", "f1"),
          finsItem({ Code: "89510", DocType: "FYFinancialStatements_Consolidated_REIT", CurPerType: "FY" }),
          OFFICIAL_SAMPLE_ITEM,
          { ...annualItem({ ...FY, discNo: "x2", sales: "1", op: "1" }), CurFYEn: "broken" },
        ],
        "next",
      ),
    );
    expect(page).toEqual({
      kind: "rows",
      annual: [expect.objectContaining({ code: "99991", net_sales: "400", operating_profit: "60" })],
      received: 6,
      invalid: 1,
      paginationKey: "next",
    });
  });

  it("data が配列でない、Code・DocType の欠けた行があれば、応答の形式の違い", () => {
    expect(parseFinsSummary({ data: {} }).kind).toBe("invalid_format");
    expect(parseFinsSummary("x").kind).toBe("invalid_format");
    expect(parseFinsSummary({ data: [{ DocType: "FYFinancialStatements_Consolidated_JP" }] }).kind).toBe("invalid_format");
    expect(parseFinsSummary({ data: [{ Code: "99991" }] }).kind).toBe("invalid_format");
  });
});

describe("requestFinsSummaryPage", () => {
  it("date と pagination_key を付けて x-api-key で要求する", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(finsResponse([])), { status: 200 }));
    await requestFinsSummaryPage({ apiKey: "k", date: "2025-05-14", paginationKey: "p2", fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.jquants.com/v2/fins/summary?date=2025-05-14&pagination_key=p2");
    expect(new Headers(init.headers).get("x-api-key")).toBe("k");
  });

  it.each([
    [403, { message: "The incoming api key is invalid or expired." }, { kind: "key_rejected", status: 403 }],
    [403, { message: "The api key is required." }, { kind: "key_rejected", status: 403 }],
    [403, { message: "Access denied" }, { kind: "http_error", status: 403 }],
    [401, {}, { kind: "unauthorized", status: 401 }],
    [429, {}, { kind: "rate_limited" }],
    [210, {}, { kind: "no_content" }],
    [500, {}, { kind: "http_error", status: 500 }],
  ])("HTTP %s は分類して返す", async (status, body, expected) => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    expect(await requestFinsSummaryPage({ apiKey: "k", date: "2025-05-14", fetchImpl })).toEqual(expected);
  });

  it("接続できなければ unreachable、JSON でなければ invalid_format", async () => {
    const down = vi.fn(async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    });
    expect(await requestFinsSummaryPage({ apiKey: "k", date: "2025-05-14", fetchImpl: down })).toEqual({
      kind: "unreachable",
      reason: "ネットワークエラー: ECONNREFUSED",
    });
    const html = vi.fn(async () => new Response("<html>", { status: 200 }));
    expect(await requestFinsSummaryPage({ apiKey: "k", date: "2025-05-14", fetchImpl: html })).toEqual({ kind: "invalid_format" });
  });
});
