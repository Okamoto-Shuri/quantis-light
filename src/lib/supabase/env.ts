/** ブラウザにも公開してよい Supabase の接続情報（公開キー）。 */
export function getPublicSupabaseEnv(): { url: string; publishableKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY が設定されていません（ローカルでは `pnpm env:local`）。",
    );
  }
  return { url, publishableKey };
}
