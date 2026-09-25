"use client";

import { useEffect, useState } from "react";

const WIDE_QUERY = "(min-width: 640px)";

/**
 * 鮮度の警告の内訳（古いデータの一覧）。幅 640px 以上では常に開き（「内訳」の見出しは出さない）、
 * それ未満では折りたたむ（375px で警告の高さを 4 行以内にする。契約 sprint-12 の第2章の4）。
 */
export function StaleDataTargets({ count, children }: { count: number; children: React.ReactNode }) {
  const [wide, setWide] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(WIDE_QUERY);
    const update = () => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return (
    <details
      className="group mt-0.5"
      open={wide || open}
      onToggle={(event) => {
        if (!wide) setOpen(event.currentTarget.open);
      }}
      data-testid="stale-data-details"
    >
      <summary
        className="w-fit cursor-pointer rounded-sm text-xs underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 sm:hidden"
        onClick={(event) => {
          if (wide) event.preventDefault();
        }}
      >
        内訳（{count} 件）
      </summary>
      <div className="mt-0.5 sm:mt-0">{children}</div>
    </details>
  );
}
