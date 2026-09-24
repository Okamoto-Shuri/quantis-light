import type { Metadata } from "next";

import { AppDocument } from "./app-document";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Quantis Light", template: "%s | Quantis Light" },
  description: "個人用の日本株スクリーナー",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AppDocument>{children}</AppDocument>;
}
