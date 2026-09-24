import { notFound } from "next/navigation";

/** 未実装・存在しないパス。ログイン後にアプリのレイアウト内で 404 を表示する。 */
export default function UnknownPage() {
  notFound();
}
