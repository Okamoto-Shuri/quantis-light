import { Monitor, Moon, Sun } from "lucide-react";

import type { ThemePreference } from "@/lib/theme";

export function ThemeIcon({ theme, className }: { theme: ThemePreference; className?: string }) {
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  return <Icon aria-hidden="true" className={className} />;
}
