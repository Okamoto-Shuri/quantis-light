"use client";

import { createContext, useCallback, useContext, useSyncExternalStore } from "react";

import { parseTheme, themeAttribute, themeCookieString, type ThemePreference } from "@/lib/theme";

const InitialThemeContext = createContext<ThemePreference>("system");

/** サーバーが Cookie から決めたテーマを、クライアントの初回描画（ハイドレーション）に渡す。 */
export function ThemeProvider({ initialTheme, children }: { initialTheme: ThemePreference; children: React.ReactNode }) {
  return <InitialThemeContext.Provider value={initialTheme}>{children}</InitialThemeContext.Provider>;
}

// <html data-theme> を唯一の状態とし、ヘッダーと設定画面など複数の UI をそれに同期させる。
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

function readTheme(): ThemePreference {
  return parseTheme(document.documentElement.getAttribute("data-theme"));
}

export function useTheme(): [ThemePreference, (theme: ThemePreference) => void] {
  const initialTheme = useContext(InitialThemeContext);
  const theme = useSyncExternalStore(subscribe, readTheme, () => initialTheme);

  const setTheme = useCallback((next: ThemePreference) => {
    document.cookie = themeCookieString(next);
    const attribute = themeAttribute(next);
    if (attribute) document.documentElement.setAttribute("data-theme", attribute);
    else document.documentElement.removeAttribute("data-theme");
  }, []);

  return [theme, setTheme];
}
