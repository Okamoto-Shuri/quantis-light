import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";

/** ダッシュボードの読み込み中（遷移の直後に出す）。route group にあるのは、配下の画面（銘柄詳細など）の 404 の HTTP 状態を変えないため。 */
export default function DashboardLoading() {
  return <DashboardSkeleton />;
}
