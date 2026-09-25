// ローカル専用: 評価用ユーザーを作成する（冪等）。
// - owner@quantis.local    … 許可リストに登録
// - owner2@quantis.local   … 許可リストに登録（別の許可ユーザー。Sprint 11 の手動補正がユーザーごとであることの確認用）
// - intruder@quantis.local … アカウントはあるが許可リストに登録しない
import { loadEnv, requireEnv, UsageError } from "./lib/env";
import { createAdminClient, ensureUser, setAllowed } from "./lib/users";

const SEED_USERS = [
  { email: "owner@quantis.local", password: "Quantis-Owner-2026!", allowed: true },
  { email: "owner2@quantis.local", password: "Quantis-Owner2-2026!", allowed: true },
  { email: "intruder@quantis.local", password: "Quantis-Intruder-2026!", allowed: false },
] as const;

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function assertLocal(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new UsageError(`NEXT_PUBLIC_SUPABASE_URL を URL として解釈できません: ${url}`);
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new UsageError(`ローカル以外の Supabase には評価用ユーザーを作成できません（接続先: ${host}）`);
  }
}

async function main() {
  loadEnv();
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  assertLocal(url); // ネットワークに接続する前に判定する
  const admin = createAdminClient(url, requireEnv("SUPABASE_SECRET_KEY"));

  for (const user of SEED_USERS) {
    await ensureUser(admin, user.email, user.password, { resetPassword: true });
    await setAllowed(admin, user.email, user.allowed);
    console.log(`${user.email}: 作成済み（許可リスト: ${user.allowed ? "登録あり" : "登録なし"}）`);
  }
}

main().catch((error: unknown) => {
  console.error(`エラー: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
