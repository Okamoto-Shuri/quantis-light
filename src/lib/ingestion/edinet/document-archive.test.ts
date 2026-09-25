import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { readDocumentArchive } from "./document-archive";

/** 書類取得 API（type=1）の ZIP の構成（EDINET API 仕様書 3-2-2「圧縮ファイルの構成」）。 */
function archive(files: Record<string, string>) {
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])));
}

describe("readDocumentArchive", () => {
  it("XBRL/PublicDoc の *_ixbrl.htm だけを、ファイル名の順（文書の順）に取り出す。監査報告書（AuditDoc）は読まない", () => {
    const bytes = archive({
      "XBRL/PublicDoc/0101010_honbun_jpcrp030000-asr-001_E99999-000_2025-03-31_01_2025-06-27_ixbrl.htm": "<html>本文1</html>",
      "XBRL/PublicDoc/0000000_header_jpcrp030000-asr-001_E99999-000_2025-03-31_01_2025-06-27_ixbrl.htm": "<html>表紙</html>",
      "XBRL/PublicDoc/0104010_honbun_jpcrp030000-asr-001_E99999-000_2025-03-31_01_2025-06-27_ixbrl.htm": "<html>本文4</html>",
      "XBRL/PublicDoc/jpcrp030000-asr-001_E99999-000_2025-03-31_01_2025-06-27.xbrl": "<xbrli:xbrl/>",
      "XBRL/PublicDoc/jpcrp030000-asr-001_E99999-000_2025-03-31_01_2025-06-27_pre.xml": "<link/>",
      "XBRL/PublicDoc/manifest_PublicDoc.xml": "<manifest/>",
      "XBRL/AuditDoc/jpaud-aar-cc-001_E99999-000_2025-03-31_01_2025-06-27_ixbrl.htm": "<html>監査報告書</html>",
    });
    const result = readDocumentArchive(bytes);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.documents.map((d) => d.html)).toEqual(["<html>表紙</html>", "<html>本文1</html>", "<html>本文4</html>"]);
  });

  it("インライン XBRL の無い ZIP は no_xbrl", () => {
    expect(readDocumentArchive(archive({ "XBRL/PublicDoc/x.xbrl": "<xbrli:xbrl/>" }))).toEqual({ kind: "no_xbrl", detail: "no_inline_xbrl" });
    expect(readDocumentArchive(archive({ "PublicDoc/0101010_honbun.htm": "<html/>" }))).toEqual({ kind: "no_xbrl", detail: "no_public_doc" });
  });

  it("ZIP として読めなければ invalid_archive", () => {
    expect(readDocumentArchive(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0]))).toEqual({ kind: "invalid_archive" });
  });
});
