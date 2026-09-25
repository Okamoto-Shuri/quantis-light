import { describe, expect, it, vi } from "vitest";

import type { FetchLike } from "../jquants/equities-master";

import { requestEdinetJson, requestEdinetZip, statusFromBody } from "./http";

const KEY = "edinet-test-key-SECRET-0123";

/** 実 API の本文（EDINET API 仕様書 3-3。キー無しの要求で HTTP 200 と StatusCode 401 が返ることは実際に確かめた）。 */
const BODY_401 = { StatusCode: 401, message: "Access denied due to invalid subscription key.Make sure to provide a valid key for an active subscription." };
const BODY_429 = { StatusCode: 429, message: "Too Many Requests" };
const BODY_404 = { metadata: { title: "提出された書類を把握するための API", status: "404", message: "Not Found" } };
const BODY_500 = { metadata: { title: "提出された書類を把握するための API", status: "500", message: "Internal Server Error" } };
const LIST_OK = { metadata: { status: "200", message: "OK", resultset: { count: 0 } }, results: [] };
const ZIP_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

function listRequest(fetchImpl: unknown) {
  return requestEdinetJson({ path: "/documents.json", params: { date: "2025-06-25", type: "2" }, apiKey: KEY, fetchImpl: fetchImpl as FetchLike });
}

function zipRequest(fetchImpl: unknown) {
  return requestEdinetZip({ path: "/documents/S100TEST", params: { type: "1" }, apiKey: KEY, fetchImpl: fetchImpl as FetchLike });
}

describe("requestEdinetJson（書類一覧 API）", () => {
  it("キーはクエリの Subscription-Key で送り、リダイレクトは追わない（redirect: manual）", async () => {
    const fetchImpl = vi.fn(async () => json(LIST_OK));
    await listRequest(fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.edinet-fsa.go.jp/api/v2/documents.json?date=2025-06-25&type=2&Subscription-Key=${KEY}`);
    expect(init.redirect).toBe("manual");
  });

  it.each([
    ["200 の JSON", json(LIST_OK), { kind: "ok", json: LIST_OK }],
    ["200＋本文 StatusCode 401", json(BODY_401), { kind: "unauthorized", status: 401 }],
    ["HTTP 401", json(BODY_401, 401), { kind: "unauthorized", status: 401 }],
    ["200＋本文 StatusCode 429", json(BODY_429), { kind: "rate_limited", status: 429 }],
    ["HTTP 503", new Response("", { status: 503 }), { kind: "rate_limited", status: 503 }],
    ["200＋本文 metadata.status 404", json(BODY_404), { kind: "not_found", status: 404 }],
    ["200＋本文 metadata.status 500", json(BODY_500), { kind: "http_error", status: 500 }],
    ["HTTP 400", json(BODY_404, 400), { kind: "http_error", status: 400 }],
    ["302（リダイレクト）", new Response(null, { status: 302, headers: { location: "https://example.com/" } }), { kind: "redirect", status: 302 }],
    ["200 の HTML（メンテナンスの画面）", new Response("<html>Sorry</html>", { status: 200, headers: { "content-type": "text/html" } }), { kind: "invalid_format", status: 200 }],
  ])("%s", async (_label, response, expected) => {
    const result = await listRequest(vi.fn(async () => response));
    expect(result).toEqual(expected);
  });

  it("opaqueredirect（redirect: manual のブラウザ互換の応答）もリダイレクトとして扱う", async () => {
    const opaque = { type: "opaqueredirect", status: 0 } as Response;
    expect(await listRequest(vi.fn(async () => opaque))).toEqual({ kind: "redirect", status: 302 });
  });

  it("接続できない・タイムアウト。例外（cause に URL を含む）の中身は結果に出さない", async () => {
    const error = new TypeError("fetch failed", { cause: Object.assign(new Error(`connect ECONNREFUSED https://api.edinet-fsa.go.jp/?Subscription-Key=${KEY}`), { code: "ECONNREFUSED" }) });
    const unreachable = await listRequest(vi.fn(async () => Promise.reject(error)));
    expect(unreachable).toEqual({ kind: "unreachable", reason: "ネットワークエラー: ECONNREFUSED" });
    expect(JSON.stringify(unreachable)).not.toContain(KEY);

    const timeout = Object.assign(new Error("timeout"), { name: "TimeoutError" });
    expect(await listRequest(vi.fn(async () => Promise.reject(timeout)))).toEqual({ kind: "unreachable", reason: "タイムアウト" });
  });
});

describe("requestEdinetZip（書類取得 API）", () => {
  it("本文の先頭が ZIP のシグネチャなら成功（Content-Type だけでは判定しない）", async () => {
    const result = await zipRequest(vi.fn(async () => new Response(ZIP_BYTES, { status: 200, headers: { "content-type": "application/json" } })));
    expect(result).toEqual({ kind: "ok", bytes: ZIP_BYTES });
  });

  it.each([
    ["200＋本文 StatusCode 401（キーの無効。書類ごとの失敗にしない）", json(BODY_401), { kind: "unauthorized", status: 401 }],
    ["200＋本文 metadata.status 404", json(BODY_404), { kind: "not_found", status: 404 }],
    ["200＋本文 429", json(BODY_429), { kind: "rate_limited", status: 429 }],
    ["200＋本文 500", json(BODY_500), { kind: "http_error", status: 500 }],
    ["200 の HTML", new Response("<html>Sorry</html>", { status: 200, headers: { "content-type": "text/html" } }), { kind: "invalid_format", status: 200 }],
    ["200 の PDF（不開示の書類）", new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), { status: 200, headers: { "content-type": "application/pdf" } }), { kind: "pdf_returned" }],
    ["HTTP 404", new Response("", { status: 404 }), { kind: "not_found", status: 404 }],
    ["HTTP 500", new Response("", { status: 500 }), { kind: "http_error", status: 500 }],
    ["301（リダイレクト）", new Response(null, { status: 301, headers: { location: "https://old.example/" } }), { kind: "redirect", status: 301 }],
  ])("%s", async (_label, response, expected) => {
    expect(await zipRequest(vi.fn(async () => response))).toEqual(expected);
  });

  it("URL に書類IDと type=1 を付ける", async () => {
    const fetchImpl = vi.fn(async () => new Response(ZIP_BYTES));
    await zipRequest(fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.edinet-fsa.go.jp/api/v2/documents/S100TEST?type=1&Subscription-Key=${KEY}`);
    expect(init.redirect).toBe("manual");
  });
});

describe("statusFromBody", () => {
  it("StatusCode（数値）と metadata.status（文字列）を読む", () => {
    expect(statusFromBody(BODY_401)).toBe(401);
    expect(statusFromBody(BODY_404)).toBe(404);
    expect(statusFromBody(LIST_OK)).toBe(200);
    expect(statusFromBody({ foo: 1 })).toBeNull();
    expect(statusFromBody(null)).toBeNull();
  });
});
