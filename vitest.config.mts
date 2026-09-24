import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    // DB 込みの結合テスト（*.db.test.ts）は pnpm test:db で実行する（ローカルの Supabase が必要）
    exclude: ["**/node_modules/**", "src/**/*.db.test.ts"],
  },
});
