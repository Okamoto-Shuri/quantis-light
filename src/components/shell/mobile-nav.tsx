"use client";

import { Menu } from "lucide-react";
import { useState } from "react";

import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

import { MainNav } from "./main-nav";

/** 幅 768px 未満で使うナビゲーション（ドロワー）。 */
export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon-lg" aria-label="メニューを開く" className="-ml-1.5 md:hidden">
          <Menu />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 gap-2">
        <SheetHeader className="border-b">
          <SheetTitle>
            <BrandMark />
          </SheetTitle>
          <SheetDescription className="sr-only">画面の切り替え</SheetDescription>
        </SheetHeader>
        <MainNav orientation="vertical" onNavigate={() => setOpen(false)} className="px-2" />
      </SheetContent>
    </Sheet>
  );
}
