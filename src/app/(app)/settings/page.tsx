import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { ThemeSettings } from "@/components/theme/theme-settings";
import { requireAllowedUser } from "@/lib/auth/guard";
import { formatDateTimeJst } from "@/lib/format";

export const metadata: Metadata = { title: "設定" };

export default async function SettingsPage() {
  const user = await requireAllowedUser();

  return (
    <div className="space-y-6">
      <PageHeader title="設定" />

      <section aria-labelledby="theme-heading" className="max-w-2xl rounded-lg border bg-card">
        <div className="border-b px-4 py-2.5">
          <h2 id="theme-heading" className="text-sm font-medium">
            テーマ
          </h2>
        </div>
        <div className="space-y-3 px-4 py-4">
          <p className="text-sm text-muted-foreground">
            この端末での表示の配色です。ヘッダーのテーマボタンからも切り替えられます。
          </p>
          <ThemeSettings />
        </div>
      </section>

      <section aria-labelledby="account-heading" className="max-w-2xl rounded-lg border bg-card">
        <h2 id="account-heading" className="border-b px-4 py-2.5 text-sm font-medium">
          アカウント
        </h2>
        <dl className="divide-y text-sm">
          <div className="grid grid-cols-[7rem_1fr] gap-3 px-4 py-2.5 sm:grid-cols-[8rem_1fr]">
            <dt className="text-muted-foreground">メールアドレス</dt>
            <dd className="break-all">{user.email}</dd>
          </div>
          <div className="grid grid-cols-[7rem_1fr] gap-3 px-4 py-2.5 sm:grid-cols-[8rem_1fr]">
            <dt className="text-muted-foreground">利用許可</dt>
            <dd className="flex items-center gap-2">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-signal" />
              許可リストに登録済み
            </dd>
          </div>
          <div className="grid grid-cols-[7rem_1fr] gap-3 px-4 py-2.5 sm:grid-cols-[8rem_1fr]">
            <dt className="text-muted-foreground">最終ログイン</dt>
            <dd className="tabular font-mono">{formatDateTimeJst(user.last_sign_in_at) ?? "—"}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
