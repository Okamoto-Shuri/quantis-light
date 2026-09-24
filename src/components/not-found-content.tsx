import { AppLink } from "@/components/shell/app-link";

export function NotFoundContent() {
  return (
    <div className="flex flex-col items-start gap-3 py-16">
      <p className="font-mono text-sm text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">ページが見つかりません</h1>
      <p className="text-sm text-muted-foreground">URL が正しいか確認してください。</p>
      <AppLink href="/" className="text-sm font-medium text-signal underline-offset-4 hover:underline">
        ダッシュボードに戻る
      </AppLink>
    </div>
  );
}
