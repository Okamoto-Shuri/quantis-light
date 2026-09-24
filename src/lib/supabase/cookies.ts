/** Supabase のセッション Cookie（分割された `.0` `.1` なども含む）かどうか。 */
export function isSupabaseAuthCookie(name: string): boolean {
  return /^sb-.+-auth-token(\.\d+)?$/.test(name) || /^sb-.+-auth-token-code-verifier$/.test(name);
}
