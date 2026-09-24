import { config } from "dotenv";
import { resolve } from "node:path";

/**
 * .env.local を読み込む。シェルで渡した環境変数が優先される（dotenv は既存の値を上書きしない）。
 */
export function loadEnv(): void {
  config({ path: resolve(import.meta.dirname, "../../.env.local"), quiet: true });
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new UsageError(`環境変数 ${name} が設定されていません。ローカルでは \`pnpm env:local\` を実行してください。`);
  }
  return value;
}

export class UsageError extends Error {}
