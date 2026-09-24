/**
 * テーマの設定。端末ごとに Cookie に保存し、サーバーが <html data-theme> を出力する（リロード時にちらつかない）。
 * system のときは data-theme を付けず、CSS の prefers-color-scheme に任せる。
 */
export const THEME_COOKIE = "theme";
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const THEME_OPTIONS = [
  { value: "light", label: "ライト" },
  { value: "dark", label: "ダーク" },
  { value: "system", label: "OS に合わせる" },
] as const;

export type ThemePreference = (typeof THEME_OPTIONS)[number]["value"];

export function parseTheme(value: string | null | undefined): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

/** <html> の data-theme 属性の値。system のときは属性を付けない。 */
export function themeAttribute(theme: ThemePreference): "light" | "dark" | undefined {
  return theme === "system" ? undefined : theme;
}

export function themeCookieString(theme: ThemePreference): string {
  return `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`;
}
