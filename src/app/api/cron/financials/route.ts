import type { NextRequest } from "next/server";

import { handleCronRequest, methodNotAllowedForHead } from "@/lib/ingestion/cron";
import { FINANCIALS_CRON_JOB } from "@/lib/ingestion/schedule";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 定期実行（毎日 22:00 JST）: 財務（決算短信）。 */
export async function GET(request: NextRequest) {
  return handleCronRequest(request, FINANCIALS_CRON_JOB.targets, "api/cron/financials");
}

export function HEAD() {
  return methodNotAllowedForHead();
}
