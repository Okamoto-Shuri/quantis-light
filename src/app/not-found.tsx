import type { Metadata } from "next";

import { NotFoundContent } from "@/components/not-found-content";
import { ProtectedShell } from "@/components/protected-shell";
import { requireAllowedUser } from "@/lib/auth/guard";

export const metadata: Metadata = { title: "ページが見つかりません" };

/**
 * 存在しない URL の 404。ログイン後の画面と同じ枠で表示する。
 * proxy を通らない場合に備えて、ここでも許可ユーザーであることを検証する。
 */
export default async function NotFound() {
  const user = await requireAllowedUser();
  return (
    <ProtectedShell user={user}>
      <NotFoundContent />
    </ProtectedShell>
  );
}
