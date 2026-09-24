import { ProtectedShell } from "@/components/protected-shell";
import { requireAllowedUser } from "@/lib/auth/guard";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAllowedUser();
  return <ProtectedShell user={user}>{children}</ProtectedShell>;
}
