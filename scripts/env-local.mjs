// ローカル Supabase の接続情報から .env.local を生成する。
// 使い方: pnpm env:local（ローカル Supabase が起動している必要がある）
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const envPath = resolve(root, ".env.local");

let status;
try {
  const out = execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  status = JSON.parse(out.slice(out.indexOf("{")));
} catch (error) {
  console.error("ローカル Supabase の状態を取得できませんでした。先に `pnpm db:start` を実行してください。");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const required = ["API_URL", "PUBLISHABLE_KEY", "SECRET_KEY"];
const missing = required.filter((key) => !status[key]);
if (missing.length > 0) {
  console.error(`supabase status の出力に ${missing.join(", ")} がありません。Supabase CLI のバージョンを確認してください。`);
  process.exit(1);
}

const managed = {
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY,
  SUPABASE_SECRET_KEY: status.SECRET_KEY,
};

// 既存の .env.local にある、管理対象外の変数は残す（後続スプリントの API キーなど）。
const preserved = existsSync(envPath)
  ? readFileSync(envPath, "utf8")
      .split("\n")
      .filter((line) => {
        const key = line.split("=")[0]?.trim();
        return line.trim() !== "" && !line.startsWith("#") && !(key in managed);
      })
  : [];

const lines = [
  "# pnpm env:local が生成（ローカル Supabase 用）。git 管理外。",
  ...Object.entries(managed).map(([key, value]) => `${key}=${value}`),
  ...preserved,
  "",
];
writeFileSync(envPath, lines.join("\n"), { mode: 0o600 });
console.log(`.env.local を書き込みました（${Object.keys(managed).join(", ")}）`);
