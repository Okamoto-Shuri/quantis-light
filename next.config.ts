import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // 開発時の Next.js インジケーターがフッターの注記に重なるため表示しない。
  devIndicators: false,
  // 開発サーバーを 127.0.0.1 で開いた場合も、開発用のリソース（HMR など）を使えるようにする（本番には影響しない）。
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    // 一致しない URL の 404 を、notFound() を投げずに描画する（src/app/global-not-found.tsx）。
    globalNotFound: true,
  },
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
