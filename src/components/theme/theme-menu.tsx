"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { parseTheme, THEME_OPTIONS } from "@/lib/theme";

import { ThemeIcon } from "./theme-icon";
import { useTheme } from "./theme-provider";

/** ヘッダーのテーマ切り替え（ライト／ダーク／OS に合わせる）。 */
export function ThemeMenu() {
  const [theme, setTheme] = useTheme();
  const current = THEME_OPTIONS.find((option) => option.value === theme)?.label;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-lg" aria-label={`テーマ（現在: ${current}）`} title="テーマ">
          <ThemeIcon theme={theme} className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">テーマ</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(parseTheme(value))}>
          {THEME_OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              <ThemeIcon theme={option.value} />
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
