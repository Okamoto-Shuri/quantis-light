import type { NextRequest } from "next/server";

import { handleCronRequest, methodNotAllowedForHead } from "@/lib/ingestion/cron";
import { EDINET_CRON_JOB } from "@/lib/ingestion/schedule";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 定期実行（毎日 0:00 JST）: EDINET（有報の大株主・役員と、有報・届出書の主要な経営指標等）。 */
export async function GET(request: NextRequest) {
  return handleCronRequest(request, EDINET_CRON_JOB.targets, "api/cron/edinet");
}

export function HEAD() {
  return methodNotAllowedForHead();
}
