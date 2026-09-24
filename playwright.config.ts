import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

// 公開キーだけでの DB アクセスを確かめるテストが、ローカル Supabase の接続情報を使う
config({ path: ".env.local", quiet: true });

/** E2E の対象のポート（既定 3000）。ほかのアプリが 3000 を使っているときは E2E_PORT=3100 などで変える。 */
const PORT = Number(process.env.E2E_PORT ?? 3000);
/** 定期実行のエンドポイントの E2E に使うシークレット（自動で起動するサーバーにも同じ値を渡す）。 */
const CRON_SECRET = process.env.E2E_CRON_SECRET ?? "e2e-local-cron-secret-0123456789";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1, // 許可リストなど共有状態を変更するテストがあるため直列に実行する
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "ja-JP",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm dev -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: true,
    timeout: 120_000,
    env: { CRON_SECRET },
  },
});
