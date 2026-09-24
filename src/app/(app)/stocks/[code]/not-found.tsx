import { StockNotFound } from "@/components/stocks/stock-not-found";

/** 銘柄詳細で notFound() が呼ばれたとき（コードの形が不正・銘柄マスタに無い）。保護画面の枠の中に表示し、HTTP 404 を返す。 */
export default function StockNotFoundPage() {
  return <StockNotFound />;
}
