import { strFromU8, unzipSync } from "fflate";

/**
 * 書類取得 API（type=1: 提出本文書及び監査報告書）の ZIP から、提出本文書のインライン XBRL を取り出す。
 * EDINET API 仕様書（Version 2）の「圧縮ファイルの構成」: XBRL/PublicDoc が提出本文書（インライン XBRL・マニフェスト・
 * タクソノミ）、XBRL/AuditDoc が監査報告書。読むのは XBRL/PublicDoc 直下の *_ixbrl.htm だけ（監査報告書は読まない）。
 * ファイル名の順（0000000_header → 0101010_honbun → …）が文書の順。
 */

export type ArchiveResult =
  | { kind: "ok"; documents: { name: string; html: string }[] }
  /** 提出本文書のインライン XBRL が無い（XBRL 自体が無い、またはインラインでない XBRL だけ） */
  | { kind: "no_xbrl"; detail: "no_public_doc" | "no_inline_xbrl" }
  /** ZIP として読めない */
  | { kind: "invalid_archive" };

const PUBLIC_DOC_IXBRL = /^XBRL\/PublicDoc\/[^/]+_ixbrl\.x?html?$/i;
const PUBLIC_DOC_ANY = /^XBRL\/PublicDoc\//i;

/** 1ファイルの上限（解凍後）。有報の本文の1ファイルは数 MB まで。 */
const MAX_FILE_BYTES = 30 * 1024 * 1024;

export function readDocumentArchive(bytes: Uint8Array): ArchiveResult {
  let hasPublicDoc = false;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (file) => {
        if (PUBLIC_DOC_ANY.test(file.name)) hasPublicDoc = true;
        return PUBLIC_DOC_IXBRL.test(file.name) && file.originalSize <= MAX_FILE_BYTES;
      },
    });
  } catch {
    return { kind: "invalid_archive" };
  }
  const names = Object.keys(files).sort();
  if (names.length === 0) return { kind: "no_xbrl", detail: hasPublicDoc ? "no_inline_xbrl" : "no_public_doc" };
  return { kind: "ok", documents: names.map((name) => ({ name, html: strFromU8(files[name]) })) };
}
