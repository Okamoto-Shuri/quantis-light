import { describe, expect, it } from "vitest";

import { jstDateTimeToIso, parseDocumentList } from "./documents-list";

/** 書類一覧 API（type=2）の1行。項目は EDINET API 仕様書（Version 2）3-1-2-2 のとおり。 */
function row(overrides: Record<string, unknown> = {}) {
  return {
    seqNumber: 1,
    docID: "S100AAAA",
    edinetCode: "E10001",
    secCode: "10000",
    JCN: "6000012010023",
    filerName: "エディネット株式会社",
    fundCode: null,
    ordinanceCode: "010",
    formCode: "030000",
    docTypeCode: "120",
    periodStart: "2024-04-01",
    periodEnd: "2025-03-31",
    submitDateTime: "2025-06-25 15:00",
    docDescription: "有価証券報告書－第10期(令和6年4月1日－令和7年3月31日)",
    issuerEdinetCode: null,
    subjectEdinetCode: null,
    subsidiaryEdinetCode: null,
    currentReportReason: null,
    parentDocID: null,
    opeDateTime: null,
    withdrawalStatus: "0",
    docInfoEditStatus: "0",
    disclosureStatus: "0",
    xbrlFlag: "1",
    pdfFlag: "1",
    attachDocFlag: "1",
    englishDocFlag: "0",
    csvFlag: "1",
    legalStatus: "1",
    ...overrides,
  };
}

function list(results: unknown[], count = results.length, status = "200") {
  return {
    metadata: {
      title: "提出された書類を把握するための API",
      parameter: { date: "2025-06-25", type: "2" },
      resultset: { count },
      processDateTime: "2025-06-25 18:00",
      status,
      message: "OK",
    },
    results,
  };
}

/** 取り下げられた書類の行（日次更新の後。連番・書類管理番号・親書類管理番号・取下区分以外は null。仕様書 3-1-5）。 */
function withdrawnRow(docID: string, parentDocID: string | null = null) {
  const nulls = Object.fromEntries(Object.keys(row()).map((key) => [key, null]));
  return { ...nulls, seqNumber: 9, docID, parentDocID, withdrawalStatus: "2", docInfoEditStatus: "0", disclosureStatus: "0", xbrlFlag: "0", legalStatus: "0" };
}

describe("parseDocumentList", () => {
  it("有報・訂正有報は証券コードがあるものだけ、届出書は証券コードが無くても edinet_code 付きで保存する", () => {
    const parsed = parseDocumentList(
      list([
        row(),
        row({ docID: "S100AAAB", docTypeCode: "130", formCode: "030001", periodStart: null, periodEnd: null, parentDocID: "S100AAAA", submitDateTime: "2025-07-10 09:05" }),
        row({ docID: "S100AAAC", docTypeCode: "030", formCode: "020000", secCode: null, edinetCode: "E20002", periodStart: null, periodEnd: null }),
        row({ docID: "S100AAAD", docTypeCode: "040", secCode: "20000" }),
        row({ docID: "S100AAAE", secCode: null }), // 証券コードの無い有報
        row({ docID: "S100AAAF", docTypeCode: "140" }), // 四半期報告書
        row({ docID: "S100AAAG", ordinanceCode: "030", docTypeCode: "120" }), // 特定有価証券（ファンド）
        row({ docID: "S100AAAH", xbrlFlag: "0" }),
      ]),
    );
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") return;
    expect(parsed.documents.map((d) => [d.doc_id, d.doc_type_code, d.sec_code, d.edinet_code])).toEqual([
      ["S100AAAA", "120", "10000", "E10001"],
      ["S100AAAB", "130", "10000", "E10001"],
      ["S100AAAC", "030", null, "E20002"],
      ["S100AAAD", "040", "20000", "E10001"],
      ["S100AAAH", "120", "10000", "E10001"],
    ]);
    expect(parsed.documents[0]).toMatchObject({
      period_start: "2024-04-01",
      period_end: "2025-03-31",
      submitted_at: "2025-06-25T15:00:00+09:00",
      xbrl_available: true,
      withheld: false,
    });
    expect(parsed.documents[1]).toMatchObject({ period_end: null, parent_doc_id: "S100AAAA", submitted_at: "2025-07-10T09:05:00+09:00" });
    expect(parsed.documents[4].xbrl_available).toBe(false);
    expect(parsed.skipped).toBe(3);
    expect(parsed.received).toBe(8);
  });

  it("取り下げ: 取り下げられた書類（\"2\"。項目が null）と、取下書（\"1\"）の親書類を取り下げの対象にする。取下書は保存しない", () => {
    const parsed = parseDocumentList(
      list([
        withdrawnRow("S100W001", null),
        row({ docID: "S100W003", docTypeCode: "120", withdrawalStatus: "1", parentDocID: "S100W002", secCode: null, edinetCode: null }),
      ]),
    );
    if (parsed.kind !== "ok") throw new Error("ok でない");
    expect(parsed.withdrawn.sort()).toEqual(["S100W001", "S100W002"]);
    expect(parsed.documents).toEqual([]);
    expect(parsed.invalidRows).toBe(0);
  });

  it("不開示の開始（\"1\"）・解除（\"3\"）の情報は操作日時つきで返し、不開示とされている書類（\"2\"）は withheld で保存する", () => {
    const parsed = parseDocumentList(
      list([
        row({ docID: "S100D001", disclosureStatus: "1", opeDateTime: "2025-06-26 19:30" }),
        row({ docID: "S100D002", disclosureStatus: "3", opeDateTime: "2025-06-27 10:00" }),
        row({ docID: "S100D003", disclosureStatus: "2" }),
      ]),
    );
    if (parsed.kind !== "ok") throw new Error("ok でない");
    expect(parsed.disclosure).toEqual([
      { doc_id: "S100D001", withheld: true, ope_at: "2025-06-26T19:30:00+09:00" },
      { doc_id: "S100D002", withheld: false, ope_at: "2025-06-27T10:00:00+09:00" },
    ]);
    expect(parsed.documents.map((d) => [d.doc_id, d.withheld])).toEqual([
      ["S100D001", true],
      ["S100D002", false],
      ["S100D003", true],
    ]);
  });

  it.each([
    ["metadata.status のエラー", list([], 0, "404")],
    ["件数の食い違い", list([row()], 2)],
    ["results が無い", { metadata: { status: "200", resultset: { count: 0 } } }],
    ["StatusCode の本文", { StatusCode: 401, message: "Access denied" }],
    ["HTML を JSON にしたようなもの", "<html></html>"],
  ])("%s は形式の違い（成功・0件にしない）", (_label, json) => {
    expect(parseDocumentList(json)).toEqual({ kind: "invalid_format", status: null });
  });

  it("必須の項目（提出日時・EDINET コード）の欠けた行は数えて除く", () => {
    const parsed = parseDocumentList(list([row({ submitDateTime: null }), row({ docID: "S100OK01" })]));
    if (parsed.kind !== "ok") throw new Error("ok でない");
    expect(parsed.invalidRows).toBe(1);
    expect(parsed.documents.map((d) => d.doc_id)).toEqual(["S100OK01"]);
  });
});

describe("jstDateTimeToIso", () => {
  it("日本時間の YYYY-MM-DD hh:mm を +09:00 の ISO 8601 にする", () => {
    expect(jstDateTimeToIso("2025-06-25 15:00")).toBe("2025-06-25T15:00:00+09:00");
    expect(jstDateTimeToIso("2025/06/25")).toBeNull();
    expect(jstDateTimeToIso(null)).toBeNull();
  });
});
