/**
 * EDINET の書類の表示の共通部分（銘柄詳細の大株主・役員（Sprint 8）と、財務の期の出典（Sprint 9）で使う）。
 * 取り込み（lib/ingestion）には依存しない。
 */

/** EDINET の書類閲覧ページ（書類の詳細）の URL。公開の閲覧サイトで、この形の URL が書類を表示することを確かめた。 */
export function edinetViewerUrl(docId: string): string {
  return `https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx?${encodeURIComponent(docId)},,`;
}

export const DOC_TYPE_LABELS: Record<string, string> = {
  "120": "有価証券報告書",
  "130": "訂正有価証券報告書",
  "030": "有価証券届出書",
  "040": "訂正有価証券届出書",
};

export function docTypeLabel(code: string): string {
  return DOC_TYPE_LABELS[code] ?? `書類（${code}）`;
}

/** 訂正の書類（訂正有価証券報告書・訂正有価証券届出書） */
export function isAmendmentDocType(code: string | null): boolean {
  return code === "130" || code === "040";
}
