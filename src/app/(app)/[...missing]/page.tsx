import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "ページが見つかりません" };

/**
 * どのルートにも一致しない URL。保護画面のレイアウト（認証ガードとアプリの枠）の中で 404 を描画するため、
 * ルートの not-found ではなく、このルートグループの not-found に渡す。
 */
export default function MissingPage(): never {
  notFound();
}
