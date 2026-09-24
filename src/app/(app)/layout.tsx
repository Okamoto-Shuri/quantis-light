import { SiteHeader } from "@/components/site-header";
import { requireAllowedUser } from "@/lib/auth/guard";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAllowedUser();

  return (
    <>
      <SiteHeader email={user.email ?? ""} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </>
  );
}
