import { CardSkeleton, PageSkeleton } from "@/components/shell/page-skeleton";

/** 設定の読み込み中（テーマとアカウントの2つのカード）。 */
export default function SettingsLoading() {
  return (
    <PageSkeleton title="設定" description={false} className="space-y-6">
      <CardSkeleton className="max-w-2xl" lines={2} />
      <CardSkeleton className="max-w-2xl" lines={3} />
    </PageSkeleton>
  );
}
