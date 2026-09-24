import { AppLink } from "@/components/shell/app-link";
import { MainNav } from "@/components/shell/main-nav";
import { MobileNav } from "@/components/shell/mobile-nav";
import { ThemeMenu } from "@/components/theme/theme-menu";

import { AccountMenu } from "./account-menu";
import { BrandMark } from "./brand-mark";

export function SiteHeader({ email }: { email: string }) {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:px-6">
        <MobileNav />
        <AppLink
          href="/"
          className="shrink-0 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <BrandMark />
        </AppLink>
        <MainNav orientation="horizontal" className="ml-6 hidden md:block" />
        <div className="ml-auto flex min-w-0 items-center gap-1">
          <ThemeMenu />
          <AccountMenu email={email} />
        </div>
      </div>
    </header>
  );
}
