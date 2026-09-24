import { requireApiUser } from "@/lib/auth/api";
import { jsonNoStore } from "@/lib/http/no-store";

export const dynamic = "force-dynamic";

const PAGE_LIMIT = 100;

/** 銘柄マスタの一覧。ユーザー自身のセッションで読む（RLS が効く経路）。 */
export async function GET() {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase
    .from("stocks")
    .select("code, company_name, market_name, sector33_name, updated_at")
    .order("code", { ascending: true })
    .limit(PAGE_LIMIT);

  if (error) {
    console.error("[api/stocks] 銘柄の取得に失敗しました", error.message);
    return jsonNoStore({ error: "internal_error" }, { status: 500 });
  }
  return jsonNoStore({ data });
}
