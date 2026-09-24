"use client";

import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { parseTheme, THEME_OPTIONS } from "@/lib/theme";

import { ThemeIcon } from "./theme-icon";
import { useTheme } from "./theme-provider";

/** 設定画面のテーマ選択。ヘッダーのテーマボタンと同じ状態を操作する。 */
export function ThemeSettings() {
  const [theme, setTheme] = useTheme();

  return (
    <RadioGroup
      aria-label="テーマ"
      value={theme}
      onValueChange={(value) => setTheme(parseTheme(value))}
      className="grid gap-2 sm:grid-cols-3"
    >
      {THEME_OPTIONS.map((option) => {
        const id = `theme-${option.value}`;
        return (
          <Label
            key={option.value}
            htmlFor={id}
            className="flex cursor-pointer items-center gap-3 rounded-md border bg-background px-3 py-2.5 font-normal transition-colors hover:bg-accent has-[[data-state=checked]]:border-signal has-[[data-state=checked]]:bg-signal-muted"
          >
            <RadioGroupItem id={id} value={option.value} />
            <ThemeIcon theme={option.value} className="size-4 text-muted-foreground" />
            {option.label}
          </Label>
        );
      })}
    </RadioGroup>
  );
}
