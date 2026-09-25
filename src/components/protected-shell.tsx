import type { User } from "@supabase/supabase-js";

import { StaleDataWarning } from "./shell/stale-data-warning";
import { SiteHeader } from "./site-header";

/** ログイン後の画面の共通の枠（ヘッダーと本文）。 */
export function ProtectedShell({ user, children }: { user: User; children: React.ReactNode }) {
  return (
    <>
      <SiteHeader email={user.email ?? ""} />
      <StaleDataWarning />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 has-[[data-layout=wide]]:max-w-7xl">{children}</main>
    </>
  );
}
