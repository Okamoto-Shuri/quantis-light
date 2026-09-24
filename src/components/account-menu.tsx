"use client";

import { ChevronDown, LogOut, UserRound } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function AccountMenu({ email }: { email: string }) {
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await fetch("/auth/signout", { method: "POST", cache: "no-store" });
    } finally {
      // クライアントのルーターキャッシュを残さないよう、フルリロードでログイン画面へ。
      window.location.replace("/login");
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 min-w-0 max-w-[60vw] gap-2 px-2" aria-label="アカウントメニュー">
          <UserRound className="text-muted-foreground" />
          <span className="truncate text-sm">{email}</span>
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">ログイン中</DropdownMenuLabel>
        <DropdownMenuLabel className="truncate pt-0">{email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={signingOut} onSelect={handleSignOut}>
          <LogOut />
          {signingOut ? "ログアウトしています…" : "ログアウト"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
