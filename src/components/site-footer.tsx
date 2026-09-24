/** 全画面共通のフッター。データ出典と「投資助言ではない」旨の注記（コンプライアンス要件）。 */
export function SiteFooter() {
  return (
    <footer className="border-t bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-4 text-xs leading-relaxed text-muted-foreground sm:px-6">
        <p>データ出典: J-Quants API（日本取引所グループ）／EDINET（金融庁）</p>
        <p>本アプリは情報提供を目的とした個人用ツールであり、投資助言ではありません。</p>
      </div>
    </footer>
  );
}
