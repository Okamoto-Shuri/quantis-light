import { requireApiUser } from "@/lib/auth/api";
import { jsonNoStore } from "@/lib/http/no-store";

export const dynamic = "force-dynamic";

/** 存在しない /api パス。未ログインには存在の有無を漏らさず 401 を返す。 */
async function handle() {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  return jsonNoStore({ error: "not_found" }, { status: 404 });
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
