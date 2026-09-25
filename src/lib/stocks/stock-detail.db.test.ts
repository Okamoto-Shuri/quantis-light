/**
 * 銘柄詳細（DB 関数 public.stock_detail・screening_evaluate）の結合テスト（Sprint 7 の契約の C10）。実行: pnpm test:db。
 * 投入するコード: 9999x（Sprint 6 の投入例）と 9Y001〜9Y004（Sprint 7 の投入例）。afterAll（失敗しても実行される）で、
 * このファイルが作った行だけを消す。
 * 前提: 市場データと株価の成功の実行が無い DB（pnpm db:reset 直後）。基準日のための実行は投入例の中で作り、ここで消す。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Client, types } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { financialPeriodSchema, type FinancialPeriod } from "@/lib/financials/display";
import { CONDITION_KEYS, parseScreeningParams, searchParamsToRecord, toScreenStocksParams, type ConditionKey } from "@/lib/screening/params";
import { screeningResultSchema } from "@/lib/screening/result";

import { stockDetailSchema, type StockDetail } from "./detail";
import { buildFiscalSlots, consecutiveSlotCount } from "./slots";

const DB_URL = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
// date 型は文字列のまま受け取る（JS の Date にするとタイムゾーンで日付がずれるため）
const db = new Client({
  connectionString: DB_URL,
  types: { getTypeParser: ((oid: number, format?: "text" | "binary") => (oid === 1082 ? (value: string) => value : types.getTypeParser(oid, format))) as typeof types.getTypeParser },
});

const FIXTURES = join(__dirname, "../../../e2e/fixtures");
const SCREENING_SQL = readFileSync(join(FIXTURES, "screening-example.sql"), "utf8");
const DETAIL_SQL = readFileSync(join(FIXTURES, "stock-detail-example.sql"), "utf8");

const CODES = ["99990", "99991", "99992", "99993", "99994", "99995", "99996", "99997", "99998", "99999", "9Y001", "9Y002", "9Y003", "9Y004"];

let firstRunId = 0;
let ownerId = "";
let intruderId = "";

async function cleanup() {
  await db.query("delete from public.stocks where code like '9999%' or code like '9Y%'");
  await db.query("delete from public.ingestion_runs where id >= $1", [firstRunId]);
}

/** Sprint 10: 条件①〜③だけを確かめるので、条件④はオフにする（有報の無い投入例の銘柄が判定不能で除かれるため。契約の C12-1 の種類1） */
function withOwnerOff(query: string): URLSearchParams {
  const search = new URLSearchParams(query);
  search.set("off", [search.get("off"), "owner"].filter(Boolean).join(","));
  return search;
}

function paramsOf(query: string, pageSize = 100) {
  const { conditions, invalidFields } = parseScreeningParams(searchParamsToRecord(withOwnerOff(query)));
  expect(invalidFields).toEqual([]);
  return { conditions, params: { ...toScreenStocksParams(conditions, { clampPage: false }), pageSize } };
}

async function detailsFor(query: string): Promise<Map<string, StockDetail>> {
  const { params } = paramsOf(query);
  const { rows } = await db.query("select c as code, public.stock_detail(c, $1::jsonb) as d from unnest($2::text[]) c", [
    JSON.stringify(params),
    CODES,
  ]);
  return new Map(rows.map((row) => [row.code as string, stockDetailSchema.parse(row.d)]));
}

async function screenAll(query: string) {
  const { params } = paramsOf(query, 500);
  const { rows } = await db.query("select public.screen_stocks($1::jsonb) as r", [JSON.stringify(params)]);
  return screeningResultSchema.parse(rows[0].r);
}

/** 投入した値から、契約の定義どおりに状態を求める（DB の判定とは独立の参照実装）。 */
type Facts = {
  revenueCagr: number | null;
  operatingMargin: number | null;
  exact: number | null;
  listedBefore: boolean | null;
  market: string;
  sector: string;
};
let facts = new Map<string, Facts>();

function expectedStatus(key: ConditionKey, f: Facts, query: URLSearchParams): string {
  const off = (query.get("off") ?? "").split(",").includes(key);
  if (off || key === "owner") return "off";
  const threshold = Number(query.get(key) ?? { cagr: "20", margin: "10", years: "5" }[key]);
  if (key === "cagr") return f.revenueCagr === null ? "unavailable" : f.revenueCagr >= threshold / 100 - 1e-12 ? "met" : "unmet";
  if (key === "margin") return f.operatingMargin === null ? "unavailable" : f.operatingMargin >= threshold / 100 - 1e-12 ? "met" : "unmet";
  if (f.listedBefore === null) return "unavailable";
  if (f.listedBefore) return "unmet";
  return f.exact! <= threshold + 1e-12 ? "met" : "unmet";
}

beforeAll(async () => {
  await db.connect();
  const { rows } = await db.query("select coalesce(max(id), 0)::bigint + 1 as next from public.ingestion_runs");
  firstRunId = Number(rows[0].next);
  const { rows: pre } = await db.query(
    `select (select count(*) from public.stocks)::int as stocks,
            (select count(*) from public.ingestion_runs where target = 'daily_quotes' and status in ('succeeded', 'partial'))::int as runs`,
  );
  if (pre[0].stocks > 0 || pre[0].runs > 0) {
    throw new Error("市場データか株価の成功の実行が残っているため、銘柄詳細のテストを始められません（pnpm db:reset 直後の DB で実行してください）");
  }
  const { rows: users } = await db.query("select id::text, email from auth.users where email in ('owner@quantis.local', 'intruder@quantis.local')");
  ownerId = users.find((u) => u.email === "owner@quantis.local")?.id ?? "";
  intruderId = users.find((u) => u.email === "intruder@quantis.local")?.id ?? "";
  if (!ownerId || !intruderId) throw new Error("評価用ユーザーがいません（pnpm seed:users を実行してください）");
  await db.query(SCREENING_SQL);
  await db.query(DETAIL_SQL);

  const { rows: factRows } = await db.query(
    `select s.code, s.market_code, s.sector33_code, m.revenue_cagr::float8 as cagr, m.operating_margin::float8 as margin,
            a.listing_years_exact::float8 as exact, a.listed_before_data_start as before
       from public.stocks s
       left join public.financial_metrics m on m.code = s.code
       left join public.stock_listing_ages a on a.code = s.code
      where s.code = any($1)`,
    [CODES],
  );
  facts = new Map(
    factRows.map((r) => [
      r.code,
      { revenueCagr: r.cagr, operatingMargin: r.margin, exact: r.exact, listedBefore: r.before, market: r.market_code, sector: r.sector33_code },
    ]),
  );
});

afterAll(async () => {
  await cleanup();
  const { rows } = await db.query(
    `select (select count(*) from public.stocks where code like '9999%' or code like '9Y%')::int as stocks,
            (select count(*) from public.ingestion_runs where id >= $1)::int as runs`,
    [firstRunId],
  );
  await db.end();
  expect(rows[0]).toEqual({ stocks: 0, runs: 0 });
});

describe("判定がスクリーニングと一致する（C10-1）", () => {
  const cagrs = ["15", "15.1", "20", "20.1", "30"];
  const margins = ["-5", "10", "10.1"];
  const years = ["1", "4.9", "5", "10"];
  const offs = ["", "cagr", "margin", "years", "cagr,margin", "cagr,years", "margin,years", "cagr,margin,years"];
  const includes = [false, true];
  const filters = ["", "market=0113", "market=0113&sector=5250", "sector=3050", "market=0111,0112"];

  it("閾値・オン／オフ・算出不可を含める・市場と業種の組み合わせ", async () => {
    let combos = 0;
    for (const cagr of cagrs)
      for (const margin of margins)
        for (const year of years)
          for (const off of offs)
            for (const include of includes)
              for (const filter of filters) {
                // 絞り込みの組は閾値の組の一部でだけ試す（件数を抑える。オン／オフ・算出不可を含めるとの組み合わせは網羅する）
                if (filter !== "" && !(margin === "10" && year === "5")) continue;
                const query = [`cagr=${cagr}`, `margin=${margin}`, `years=${year}`, off && `off=${off}`, include && "unavailable=include", filter]
                  .filter(Boolean)
                  .join("&");
                const search = new URLSearchParams(query);
                const [details, screened] = await Promise.all([detailsFor(query), screenAll(query)]);
                const inResult = new Map(screened.rows.map((row) => [row.code, row]));
                for (const code of CODES) {
                  const detail = details.get(code)!;
                  const f = facts.get(code)!;
                  const label = `${code} ?${query}`;
                  // 状態は参照実装と一致し、結果にある行ではスクリーニングの status とも一致する
                  for (const key of CONDITION_KEYS) expect(detail.evaluation.status[key], `${label} ${key}`).toBe(expectedStatus(key, f, search));
                  const row = inResult.get(code);
                  if (row) expect(row.status, label).toEqual(detail.evaluation.status);
                  // 絞り込みと「結果に含まれるか」は screen_stocks の全件の結果と一致する
                  const markets = (search.get("market") ?? "").split(",").filter(Boolean);
                  const sectors = (search.get("sector") ?? "").split(",").filter(Boolean);
                  const matches = (markets.length === 0 || markets.includes(f.market)) && (sectors.length === 0 || sectors.includes(f.sector));
                  expect(detail.evaluation.matchesFilters, label).toBe(matches);
                  expect(detail.evaluation.included, label).toBe(inResult.has(code));
                }
                combos += 1;
              }
    expect(combos).toBeGreaterThan(900);
  }, 180_000);

  it("第5章の期待値（既定の条件）", async () => {
    const details = await detailsFor("");
    const summary = Object.fromEntries(
      CODES.map((code) => {
        const e = details.get(code)!.evaluation;
        return [code, `${e.status.cagr}/${e.status.margin}/${e.status.years}/${e.included}`];
      }),
    );
    expect(summary).toEqual({
      "99990": "met/met/met/true",
      "99991": "met/met/met/true",
      "99992": "unmet/met/met/false",
      "99993": "met/unmet/met/false",
      "99994": "met/met/unmet/false",
      "99995": "met/met/unmet/false",
      "99996": "unavailable/met/met/false",
      "99997": "met/unavailable/met/false",
      "99998": "unavailable/unavailable/met/false",
      "99999": "met/met/unavailable/false",
      "9Y001": "met/met/met/true",
      "9Y002": "unavailable/met/unmet/false",
      "9Y003": "unavailable/met/unmet/false",
      "9Y004": "met/unmet/met/false",
    });
    expect((await screenAll("")).rows.map((row) => row.code)).toEqual(["9Y001", "99991", "99990"]);
  });
});

describe("基本情報・年数・権限（C10-2）", () => {
  it("年数は stock_listing_ages と一致する", async () => {
    const details = await detailsFor("");
    const { rows } = await db.query(
      "select code, reference_date, first_price_date, data_start_date, listed_before_data_start, listing_years_exact::text as exact, estimated_listing_years::text as est, listing_years_lower_bound as lb from public.stock_listing_ages where code = any($1)",
      [CODES],
    );
    for (const row of rows) {
      const detail = details.get(row.code)!;
      expect(detail.referenceDate).toBe("2026-09-24");
      if (row.first_price_date === null) {
        expect(detail.listing, row.code).toBeNull();
        continue;
      }
      expect(detail.listing, row.code).toMatchObject({
        listed_before_data_start: row.listed_before_data_start,
        listing_years_exact: row.exact === null ? null : Number(row.exact),
        estimated_listing_years: row.est === null ? null : Number(row.est),
        listing_years_lower_bound: row.lb,
      });
    }
    expect(details.get("99995")!.listing).toMatchObject({ listed_before_data_start: true, listing_years_lower_bound: 9 });
    expect(details.get("9Y001")!.listing).toMatchObject({ first_price_date: "2022-09-24", estimated_listing_years: 4 });
    expect(details.get("9Y001")!.stock).toEqual({
      code: "9Y001",
      company_name: "検証用六期訂正株式会社",
      market_code: "0113",
      market_name: "グロース",
      sector33_code: "5250",
      sector33_name: "情報・通信業",
      // Sprint 12: 上場廃止を確認した日（契約 C10-1 の種類5）
      delisted_on: null,
    });
  });

  it("無いコードは NULL", async () => {
    const { params } = paramsOf("");
    const { rows } = await db.query("select public.stock_detail('99989', $1::jsonb) as d", [JSON.stringify(params)]);
    expect(rows[0].d).toBeNull();
  });

  it("許可リストのユーザー（authenticated）は読め、許可リスト外は NULL", async () => {
    const { params } = paramsOf("");
    const run = async (userId: string) => {
      await db.query("begin");
      try {
        await db.query("set local role authenticated");
        await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
        const { rows } = await db.query("select public.stock_detail('99991', $1::jsonb) as d", [JSON.stringify(params)]);
        return rows[0].d;
      } finally {
        await db.query("rollback");
      }
    };
    expect(stockDetailSchema.parse(await run(ownerId)).evaluation.included).toBe(true);
    expect(await run(intruderId)).toBeNull();
  });

  it("listing_first_date_cutoff は極端に大きい閾値でもエラーにならない", async () => {
    const { rows } = await db.query("select public.listing_first_date_cutoff('2026-09-24', 1000000000) as d");
    expect(rows[0].d).not.toBeNull();
  });
});

describe("5期の枠が DB の期の連続の判定と一致する（C10-3）", () => {
  it("FY0 から連続する枠の数 = revenue_cagr_period_count、算出できた CAGR の FY-4 = revenue_cagr_base_fiscal_year_end", async () => {
    const { rows: periodRows } = await db.query("select * from public.financial_periods where code = any($1) order by fiscal_year_end", [CODES]);
    const { rows: metrics } = await db.query(
      "select code, revenue_cagr_period_count, revenue_cagr_base_fiscal_year_end::text as base, revenue_cagr_unavailable_reason as reason from public.financial_metrics where code = any($1)",
      [CODES],
    );
    const byCode = new Map<string, FinancialPeriod[]>();
    for (const row of periodRows) {
      const period = financialPeriodSchema.parse(row);
      byCode.set(period.code, [...(byCode.get(period.code) ?? []), period]);
    }
    expect(metrics.length).toBe(13);
    for (const m of metrics) {
      const slots = buildFiscalSlots(byCode.get(m.code) ?? []);
      expect(consecutiveSlotCount(slots), m.code).toBe(m.revenue_cagr_period_count);
      if (m.reason === null) expect(slots[0]!.fiscalYearEnd, m.code).toBe(m.base);
    }
    const missing = (code: string) =>
      buildFiscalSlots(byCode.get(code)!).map((slot) => `${slot.position}:${slot.fiscalYearEnd}:${slot.period ? "有" : "無"}`);
    expect(missing("9Y002")).toEqual(["FY-4:2021-03-31:有", "FY-3:2022-03-31:無", "FY-2:2023-03-31:有", "FY-1:2024-03-31:有", "FY0:2025-03-31:有"]);
    expect(missing("99996")).toEqual(["FY-4:2019-03-31:無", "FY-3:2020-03-31:無", "FY-2:2021-03-31:有", "FY-1:2022-03-31:有", "FY0:2023-03-31:有"]);
  });
});
