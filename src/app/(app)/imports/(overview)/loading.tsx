import { ImportsSkeleton } from "@/components/imports/imports-skeleton";

/** 取り込み状況の読み込み中。route group にあるのは、実行の詳細（imports/runs/[id]）の 404 の HTTP 状態を変えないため。 */
export default function ImportsLoading() {
  return <ImportsSkeleton />;
}
