import { defineConfig } from "vitest/config";

/** DB 込みの結合テスト。ローカルの Supabase（pnpm db:start）と .env.local（pnpm env:local）が必要。 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/**/*.db.test.ts"],
    setupFiles: ["./vitest.db.setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    // 性能のテストの実測値（console.info）を、成功したテストでも出力に残す（Sprint 11 評価の m5）
    reporters: ["verbose"],
  },
});
