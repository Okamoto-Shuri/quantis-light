import Link from "next/link";

import { AccountMenu } from "./account-menu";
import { BrandMark } from "./brand-mark";

export function SiteHeader({ email }: { email: string }) {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="shrink-0 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <BrandMark />
        </Link>
        <AccountMenu email={email} />
      </div>
    </header>
  );
}
