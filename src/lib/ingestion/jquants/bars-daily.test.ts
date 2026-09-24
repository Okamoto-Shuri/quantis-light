import { describe, expect, it, vi } from "vitest";

import { BARS_DAILY_URL, requestBarsPage } from "./bars-daily";
import { barItem, barsResponse, INVALID_KEY_BODY, MISSING_KEY_BODY, OUT_OF_PLAN_BODY } from "./__fixtures__/bars-daily";

const json = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("requestBarsPage", () => {
  it("date= と code=&from= と pagination_key を URL に付け、x-api-key を送る", async () => {
    const fetchImpl = json(barsResponse([]));
    await requestBarsPage({ apiKey: "k", query: { date: "2016-09-26" }, fetchImpl });
    await requestBarsPage({ apiKey: "k", query: { code: "99991", from: "2016-09-26" }, paginationKey: "p1", fetchImpl });
    const calls = fetchImpl.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][0]).toBe(`${BARS_DAILY_URL}?date=2016-09-26`);
    expect(calls[1][0]).toBe(`${BARS_DAILY_URL}?code=99991&from=2016-09-26&pagination_key=p1`);
    expect(new Headers(calls[0][1].headers).get("x-api-key")).toBe("k");
  });

  it("行の Date と Code だけを取り出す。四本値が null の行（売買の無い日）も行として数える", async () => {
    const page = await requestBarsPage({
      apiKey: "k",
      query: { date: "2016-09-26" },
      fetchImpl: json(barsResponse([barItem("99991", "2016-09-26"), barItem("99992", "2016-09-26", { halted: true })], "next")),
    });
    expect(page).toEqual({
      kind: "rows",
      rows: [
        { date: "2016-09-26", code: "99991" },
        { date: "2016-09-26", code: "99992" },
      ],
      paginationKey: "next",
    });
  });

  it("四本値などの項目が欠けていても、Date と Code があれば受け付ける", async () => {
    const page = await requestBarsPage({ apiKey: "k", query: { date: "2016-09-26" }, fetchImpl: json({ data: [{ Date: "2016-09-26", Code: "13010" }] }) });
    expect(page.kind).toBe("rows");
  });

  it.each([
    ["210", 210, {}, { kind: "no_content" }],
    ["401", 401, {}, { kind: "unauthorized", status: 401 }],
    ["キーの無効の本文の 403", 403, INVALID_KEY_BODY, { kind: "key_rejected", status: 403 }],
    ["キーの欠如の本文の 403", 403, MISSING_KEY_BODY, { kind: "key_rejected", status: 403 }],
    ["キー以外の本文の 403", 403, OUT_OF_PLAN_BODY, { kind: "http_error", status: 403 }],
    ["400", 400, { message: "bad" }, { kind: "http_error", status: 400 }],
    ["429", 429, {}, { kind: "rate_limited" }],
    ["500", 500, {}, { kind: "http_error", status: 500 }],
  ])("%s を分類する", async (_label, status, body, expected) => {
    expect(await requestBarsPage({ apiKey: "k", query: { date: "2016-09-26" }, fetchImpl: json(body, status) })).toEqual(expected);
  });

  it("本文が JSON でない 403 はキー以外の 403 として扱う", async () => {
    const fetchImpl = vi.fn(async () => new Response("Forbidden", { status: 403 }));
    expect(await requestBarsPage({ apiKey: "k", query: { date: "2016-09-26" }, fetchImpl })).toEqual({ kind: "http_error", status: 403 });
  });

  it.each([
    ["JSON でない", "not json"],
    ["data が配列でない", JSON.stringify({ data: {} })],
    ["Date が無い行", JSON.stringify({ data: [{ Code: "99991" }] })],
    ["Date の形式が違う", JSON.stringify({ data: [{ Date: "20160926", Code: "99991" }] })],
    ["Code の形式が違う", JSON.stringify({ data: [{ Date: "2016-09-26", Code: "99-1" }] })],
  ])("%s 応答は形式の違い", async (_label, body) => {
    const fetchImpl = vi.fn(async () => new Response(body, { status: 200 }));
    expect(await requestBarsPage({ apiKey: "k", query: { date: "2016-09-26" }, fetchImpl })).toEqual({ kind: "invalid_format" });
  });

  it("接続できない・タイムアウトは unreachable（キーは含めない）", async () => {
    const timeout = vi.fn(async () => {
      throw Object.assign(new Error("t"), { name: "TimeoutError" });
    });
    expect(await requestBarsPage({ apiKey: "secret-key", query: { date: "2016-09-26" }, fetchImpl: timeout })).toEqual({
      kind: "unreachable",
      reason: "タイムアウト",
    });
    const dns = vi.fn(async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
    });
    const page = await requestBarsPage({ apiKey: "secret-key", query: { date: "2016-09-26" }, fetchImpl: dns });
    expect(page).toEqual({ kind: "unreachable", reason: "ネットワークエラー: ENOTFOUND" });
  });
});
