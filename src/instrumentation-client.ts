import { installNegativeMeasureGuard } from "@/lib/dev/measure-guard";

// アプリが操作可能になる前に実行される（Next.js の instrumentation-client）。
// React の開発用パフォーマンス計測の不具合への対策は、開発時だけ入れる（本番の React はこの計測を行わない）。
if (process.env.NODE_ENV === "development" && typeof performance !== "undefined") {
  try {
    installNegativeMeasureGuard(performance);
  } catch (error) {
    console.warn("[dev] performance.measure の対策を入れられませんでした", error);
  }
}
