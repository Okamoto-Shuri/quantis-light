// 許可リストへの追加とユーザー作成を同時に行う運用コマンド。
// 使い方: pnpm auth:add-user --email <メールアドレス> --password <パスワード> [--reset-password]
import { parseArgs } from "node:util";

import { isValidEmail, normalizeEmail, MIN_PASSWORD_LENGTH } from "../src/lib/auth/email";
import { loadEnv, requireEnv, UsageError } from "./lib/env";
import { createAdminClient, ensureUser, setAllowed } from "./lib/users";

const USAGE = `使い方: pnpm auth:add-user --email <メールアドレス> --password <パスワード> [--reset-password]

  --email           許可リストに追加するメールアドレス（小文字に正規化して保存）
  --password        新規作成時のパスワード（${MIN_PASSWORD_LENGTH} 文字以上）
  --reset-password  既存ユーザーのパスワードも指定した値に更新する（省略時は変更しない）`;

function parse() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        email: { type: "string" },
        password: { type: "string" },
        "reset-password": { type: "boolean", default: false },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    throw new UsageError(`引数を解釈できません: ${error instanceof Error ? error.message : String(error)}`);
  }
  const { email, password } = values;
  if (!email) throw new UsageError("--email を指定してください。");
  if (!password) throw new UsageError("--password を指定してください。");
  if (!isValidEmail(email)) throw new UsageError(`メールアドレスの形式が正しくありません: ${email}`);
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new UsageError(`パスワードは ${MIN_PASSWORD_LENGTH} 文字以上にしてください。`);
  }
  return { email: normalizeEmail(email), password, resetPassword: values["reset-password"] ?? false };
}

async function main() {
  const { email, password, resetPassword } = parse();
  loadEnv();
  const admin = createAdminClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SECRET_KEY"));

  // ユーザー作成に失敗したときに許可リストだけが残らないよう、作成を先に行う。
  const result = await ensureUser(admin, email, password, { resetPassword });
  await setAllowed(admin, email, true);

  console.log(`許可リストに登録しました: ${email}`);
  if (result === "created") console.log("ユーザーを作成しました。");
  if (result === "unchanged") console.log("既存のユーザーです。パスワードは変更していません（変更する場合は --reset-password を付けてください）。");
  if (result === "password-updated") console.log("既存のユーザーのパスワードを更新しました。");
}

main().catch((error: unknown) => {
  if (error instanceof UsageError) {
    console.error(`エラー: ${error.message}\n\n${USAGE}`);
    process.exit(2);
  }
  console.error(`エラー: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
