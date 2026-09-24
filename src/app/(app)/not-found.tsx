import { NotFoundContent } from "@/components/not-found-content";

/** 保護画面の中の 404。認証とアプリの枠は (app)/layout.tsx が担う。 */
export default function NotFound() {
  return <NotFoundContent />;
}
