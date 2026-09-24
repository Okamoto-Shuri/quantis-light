import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // 開発時の Next.js インジケーターがフッターの注記に重なるため表示しない。
  devIndicators: false,
  async headers() {
    return [
      {
        // 画面と API は常にキャッシュさせない（ログアウト後に「戻る」で保護画面が表示されないようにする）。
        // 静的アセット（/_next/static）は除外する。
        source: "/((?!_next/static/|_next/image).*)",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
