import { NextResponse } from "next/server";

export const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" } as const;

export function jsonNoStore(body: unknown, init?: { status?: number; headers?: Record<string, string> }): NextResponse {
  return NextResponse.json(body, { status: init?.status ?? 200, headers: { ...NO_STORE_HEADERS, ...init?.headers } });
}
