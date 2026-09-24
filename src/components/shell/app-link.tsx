"use client";

import Link from "next/link";
import { createContext, useContext } from "react";

const DocumentNavigationContext = createContext(false);

/**
 * global-not-found（ルートレイアウトの外にある別の文書）の中では、next/link のクライアント遷移で
 * 画面が切り替わらない（URL だけ変わり、404 の表示が残る）。その中ではリンクを通常の文書遷移にする。
 */
export function DocumentNavigationProvider({ children }: { children: React.ReactNode }) {
  return <DocumentNavigationContext.Provider value={true}>{children}</DocumentNavigationContext.Provider>;
}

/** global-not-found（404 の画面）の中かどうか。 */
export function useIsNotFoundDocument(): boolean {
  return useContext(DocumentNavigationContext);
}

/** アプリ内のリンク。通常は next/link、global-not-found の中では <a>。 */
export function AppLink(props: React.ComponentProps<"a"> & { href: string }) {
  const documentNavigation = useContext(DocumentNavigationContext);
  return documentNavigation ? <a {...props} /> : <Link {...props} />;
}
