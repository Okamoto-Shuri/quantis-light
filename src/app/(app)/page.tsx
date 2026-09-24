import type { Metadata } from "next";

import { requireAllowedUser } from "@/lib/auth/guard";
import { formatDateTimeJst } from "@/lib/format";

export const metadata: Metadata = { title: "ダッシュボード" };

export default async function DashboardPage() {
  const user = await requireAllowedUser();
  const lastSignIn = formatDateTimeJst(user.last_sign_in_at);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">ダッシュボード</h1>
        <p className="text-sm text-muted-foreground">
          <span className="text-foreground">{user.email}</span> でログインしています。
        </p>
      </header>

      <section aria-labelledby="account-heading" className="max-w-xl rounded-lg border bg-card">
        <h2 id="account-heading" className="border-b px-4 py-2.5 text-sm font-medium">
          アカウント
        </h2>
        <dl className="divide-y text-sm">
          <div className="grid grid-cols-[8rem_1fr] gap-3 px-4 py-2.5">
            <dt className="text-muted-foreground">メールアドレス</dt>
            <dd className="break-all">{user.email}</dd>
          </div>
          <div className="grid grid-cols-[8rem_1fr] gap-3 px-4 py-2.5">
            <dt className="text-muted-foreground">利用許可</dt>
            <dd className="flex items-center gap-2">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-signal" />
              許可リストに登録済み
            </dd>
          </div>
          <div className="grid grid-cols-[8rem_1fr] gap-3 px-4 py-2.5">
            <dt className="text-muted-foreground">最終ログイン</dt>
            <dd className="tabular font-mono">{lastSignIn ?? "—"}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
