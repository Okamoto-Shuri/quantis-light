import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

import { normalizeEmail } from "../../src/lib/auth/email";

export function createAdminClient(url: string, secretKey: string): SupabaseClient {
  return createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function findUserByEmail(admin: SupabaseClient, email: string): Promise<User | null> {
  const perPage = 200;
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`ユーザー一覧の取得に失敗しました: ${error.message}`);
    const found = data.users.find((user) => user.email?.toLowerCase() === email);
    if (found) return found;
    if (data.users.length < perPage) return null;
  }
}

export type EnsureUserResult = "created" | "password-updated" | "unchanged";

/** ユーザーを作成する。既に存在する場合は、resetPassword が true のときだけパスワードを更新する。 */
export async function ensureUser(
  admin: SupabaseClient,
  rawEmail: string,
  password: string,
  options: { resetPassword: boolean },
): Promise<EnsureUserResult> {
  const email = normalizeEmail(rawEmail);
  const existing = await findUserByEmail(admin, email);
  if (!existing) {
    const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(`ユーザーの作成に失敗しました: ${error.message}`);
    return "created";
  }
  if (!options.resetPassword) return "unchanged";
  const { error } = await admin.auth.admin.updateUserById(existing.id, { password });
  if (error) throw new Error(`パスワードの更新に失敗しました: ${error.message}`);
  return "password-updated";
}

export async function setAllowed(admin: SupabaseClient, rawEmail: string, allowed: boolean): Promise<void> {
  const email = normalizeEmail(rawEmail);
  const fn = allowed ? "admin_allow_email" : "admin_disallow_email";
  const { error } = await admin.rpc(fn, { p_email: email });
  if (error) throw new Error(`許可リストの更新に失敗しました: ${error.message}`);
}
