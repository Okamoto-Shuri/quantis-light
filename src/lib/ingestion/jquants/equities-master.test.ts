import { describe, expect, it, vi } from "vitest";

import { INGESTION_MESSAGES, IngestionFailure } from "../errors";

import { EQUITIES_MASTER_RESPONSE, masterItem } from "./__fixtures__/equities-master";
import { EQUITIES_MASTER_URL, fetchEquitiesMaster, parseEquitiesMaster } from "./equities-master";

const API_KEY = "qa-secret-key-7f3a9c-do-not-leak";

function expectFailure(fn: () => unknown, message: string) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(IngestionFailure);
    expect((error as Error).message).toBe(message);
    expect((error as Error).message).not.toContain(API_KEY);
    return;
  }
  throw new Error("失敗しなかった");
}

async function expectAsyncFailure(promise: Promise<unknown>, message: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(IngestionFailure);
  expect((error as Error).message).toBe(message);
  expect((error as Error).message).not.toContain(API_KEY);
}

describe("parseEquitiesMaster", () => {
  it("内国株券・3市場・33業種が 9999 以外の行だけを、DB の列に対応づけて保存対象にする", () => {
    const { rows } = parseEquitiesMaster(EQUITIES_MASTER_RESPONSE);
    expect(rows.map((row) => row.code)).toEqual(["86970", "72030", "30000", "130A0"]);
    expect(rows[0]).toEqual({
      code: "86970",
      company_name: "日本取引所グループ",
      company_name_en: "Japan Exchange Group,Inc.",
      market_code: "0111",
      market_name: "プライム",
      sector17_code: "16",
      sector17_name: "金融（除く銀行）",
      sector33_code: "7200",
      sector33_name: "その他金融業",
      scale_category: "TOPIX Large70",
      product_category: "011",
      listed_info_date: "2026-09-24",
    });
  });

  it("空の英語社名は NULL にし、英字を含むコードも保存する", () => {
    const { rows } = parseEquitiesMaster(EQUITIES_MASTER_RESPONSE);
    expect(rows.find((row) => row.code === "30000")).toMatchObject({
      company_name_en: null,
      market_code: "0112",
      market_name: "スタンダード",
    });
    expect(rows.find((row) => row.code === "130A0")).toMatchObject({ market_code: "0113", market_name: "グロース" });
  });

  it("対象外の行を、商品区分 → 市場区分 → 33業種 の順で最初に満たさなかった理由で数える", () => {
    const { details } = parseEquitiesMaster(EQUITIES_MASTER_RESPONSE);
    expect(details).toEqual({
      fetched: 10,
      skipped: 6,
      skippedByProduct: 4, // ETF・REIT・優先出資証券・外国株券
      skippedByMarket: 1, // TOKYO PRO MARKET
      skippedBySector: 1, // 内国株券で 33業種 9999
      listedInfoDate: "2026-09-24",
    });
    expect(details.fetched).toBe(4 + details.skipped);
  });

  it("除外される行（ETF・REIT・優先出資証券・外国株券・TOKYO PRO MARKET・9999）は保存対象に入らない", () => {
    const codes = parseEquitiesMaster(EQUITIES_MASTER_RESPONSE).rows.map((row) => row.code);
    for (const code of ["13060", "89510", "84210", "91890", "92000", "93000"]) expect(codes).not.toContain(code);
  });

  it.each([
    ["data が配列でない", { data: {} }],
    ["data が無い", { items: [] }],
    ["JSON のオブジェクトでない", "not json"],
    ["null", null],
    ["pagination_key が付いている（一部だけの保存を防ぐ）", { ...EQUITIES_MASTER_RESPONSE, pagination_key: "abc" }],
    ["ProdCat が欠けている行がある", { data: [{ ...masterItem({ Code: "10000", CoName: "A" }), ProdCat: undefined }] }],
    ["Code が欠けている行がある", { data: [{ ...masterItem({ Code: "10000", CoName: "A" }), Code: undefined }] }],
    ["Mkt が空の行がある", { data: [masterItem({ Code: "10000", CoName: "A", Mkt: "" })] }],
    ["Date の形式が違う", { data: [masterItem({ Code: "10000", CoName: "A", Date: "20260924" })] }],
    ["保存する行のコードが重複している", { data: [masterItem({ Code: "10000", CoName: "A" }), masterItem({ Code: "10000", CoName: "B" })] }],
    ["保存する行のコードの形式が違う", { data: [masterItem({ Code: "12-34", CoName: "A" })] }],
  ])("形式が想定と違う: %s", (_label, json) => {
    expectFailure(() => parseEquitiesMaster(json), INGESTION_MESSAGES.jquantsInvalidFormat);
  });

  it("保存の対象が0件なら失敗（0件の成功にしない）", () => {
    expectFailure(() => parseEquitiesMaster({ data: [] }), INGESTION_MESSAGES.jquantsNoTargets);
    expectFailure(
      () => parseEquitiesMaster({ data: [masterItem({ Code: "13060", CoName: "ETF", ProdCat: "014" })] }),
      INGESTION_MESSAGES.jquantsNoTargets,
    );
  });
});

describe("fetchEquitiesMaster", () => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("x-api-key ヘッダーを付けて /v2/equities/master を呼び、JSON を返す", async () => {
    const fetchImpl = vi.fn(async () => json(200, EQUITIES_MASTER_RESPONSE));
    await expect(fetchEquitiesMaster({ apiKey: API_KEY, fetchImpl })).resolves.toEqual(EQUITIES_MASTER_RESPONSE);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.jquants.com/v2/equities/master");
    expect(url).toBe(EQUITIES_MASTER_URL);
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe(API_KEY);
  });

  it.each([
    [401, INGESTION_MESSAGES.jquantsUnauthorized(401)],
    [403, INGESTION_MESSAGES.jquantsUnauthorized(403)],
    [429, INGESTION_MESSAGES.jquantsRateLimited],
    [500, INGESTION_MESSAGES.jquantsUnexpectedStatus(500)],
    [210, INGESTION_MESSAGES.jquantsUnexpectedStatus(210)],
    [400, INGESTION_MESSAGES.jquantsUnexpectedStatus(400)],
  ])("HTTP %i は決まったメッセージの失敗になる（応答の本文やキーを含めない）", async (status, message) => {
    const fetchImpl = vi.fn(async () => json(status, { message: `The incoming api key is invalid ${API_KEY}` }));
    await expectAsyncFailure(fetchEquitiesMaster({ apiKey: API_KEY, fetchImpl }), message);
  });

  it("403 のメッセージは実際の文言どおり", () => {
    expect(INGESTION_MESSAGES.jquantsUnauthorized(403)).toBe(
      "J-Quants の API キーが無効か、契約プランでは利用できません（HTTP 403）",
    );
  });

  it("タイムアウトは「接続できませんでした（タイムアウト）」", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    await expectAsyncFailure(
      fetchEquitiesMaster({ apiKey: API_KEY, fetchImpl, timeoutMs: 20 }),
      INGESTION_MESSAGES.jquantsUnreachable("タイムアウト"),
    );
  });

  it("接続できないときは、原因のコードだけを添える", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed", { cause: Object.assign(new Error(`getaddrinfo ${API_KEY}`), { code: "ENOTFOUND" }) });
    });
    await expectAsyncFailure(
      fetchEquitiesMaster({ apiKey: API_KEY, fetchImpl }),
      "J-Quants に接続できませんでした（ネットワークエラー: ENOTFOUND）",
    );
  });

  it("200 でも JSON でなければ形式の失敗", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>maintenance</html>", { status: 200 }));
    await expectAsyncFailure(fetchEquitiesMaster({ apiKey: API_KEY, fetchImpl }), INGESTION_MESSAGES.jquantsInvalidFormat);
  });
});
