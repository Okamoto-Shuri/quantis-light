import { requireApiUser } from "@/lib/auth/api";
import { fetchDashboardSummary } from "@/lib/dashboard/summary";
import { jsonNoStore } from "@/lib/http/no-store";

export const dynamic = "force-dynamic";

/** ダッシュボードの集計（データの鮮度と件数）。ユーザー自身のセッションで集計する（RLS が効く経路）。 */
export async function GET() {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const result = await fetchDashboardSummary(auth.supabase);
  if (!result.ok) return jsonNoStore({ error: "internal_error" }, { status: 500 });
  return jsonNoStore({ data: result.summary });
}
