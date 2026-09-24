/**
 * スクリーニング（DB 関数 public.screen_stocks・listing_first_date_cutoff・screening_filter_options）の結合テスト
 * （契約の C10・C11）。実行: pnpm test:db。
 * 投入するコード: 9999x と 9Z001〜9Z120（契約の第5章の投入例）、性能のテストは P0000〜P3999。
 * どれも afterAll（失敗しても実行される）で、このファイルが作った行だけを消す（ほかのテストのコードの接頭辞を消さない）。
 * 前提: 市場データと株価の成功の実行が無い DB（pnpm db:reset 直後）。基準日のための実行は、このファイルの中で作って消す。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_CONDITIONS, parseScreeningParams, searchParamsToRecord, toScreenStocksParams } from "./params";
import { screeningResultSchema, type ScreeningResult } from "./result";

const DB_URL = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const db = new Client({ connectionString: DB_URL });

/** 契約の第5章の投入例（e2e と共有する SQL）。 */
const EXAMPLE_SQL = readFileSync(join(__dirname, "../../../e2e/fixtures/screening-example.sql"), "utf8");
const PAGING_SQL = readFileSync(join(__dirname, "../../../e2e/fixtures/screening-paging.sql"), "utf8");

let firstRunId = 0;
let ownerId = "";
let intruderId = "";

async function cleanup() {
  await db.query("delete from public.stocks where code like '9999%' or code like '9Z%' or code like 'P%'");
  await db.query("delete from public.ingestion_runs where id >= $1", [firstRunId]);
}

/** URL と同じ形のクエリで screen_stocks を呼ぶ（postgres のまま。RLS を迂回する）。 */
async function screen(query: string, clampPage = false): Promise<ScreeningResult> {
  const { conditions, invalidFields } = parseScreeningParams(searchParamsToRecord(new URLSearchParams(query)));
  expect(invalidFields).toEqual([]);
  const { rows } = await db.query("select public.screen_stocks($1::jsonb) as r", [JSON.stringify(toScreenStocksParams(conditions, { clampPage }))]);
  return screeningResultSchema.parse(rows[0].r);
}

const codes = (result: ScreeningResult) => result.rows.map((row) => row.code);
const statusOf = (result: ScreeningResult, code: string) => result.rows.find((row) => row.code === code)?.status;

/** 許可リストのユーザー（authenticated）として、1つのトランザクションの中で実行する。 */
async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  await db.query("begin");
  try {
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
    const value = await fn();
    await db.query("commit");
    return value;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
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
    throw new Error("市場データか株価の成功の実行が残っているため、スクリーニングのテストを始められません（pnpm db:reset 直後の DB で実行してください）");
  }
  const { rows: users } = await db.query("select id::text, email from auth.users where email in ('owner@quantis.local', 'intruder@quantis.local')");
  ownerId = users.find((u) => u.email === "owner@quantis.local")?.id ?? "";
  intruderId = users.find((u) => u.email === "intruder@quantis.local")?.id ?? "";
  if (!ownerId || !intruderId) throw new Error("評価用ユーザーがいません（pnpm seed:users を実行してください）");
  await db.query(EXAMPLE_SQL);
});

afterAll(async () => {
  await cleanup();
  const { rows } = await db.query(
    `select (select count(*) from public.stocks where code like '9999%' or code like '9Z%' or code like 'P%')::int as stocks,
            (select count(*) from public.ingestion_runs where id >= $1)::int as runs`,
    [firstRunId],
  );
  await db.end();
  expect(rows[0]).toEqual({ stocks: 0, runs: 0 });
});

describe("第5章の10銘柄（C1〜C8 の組み合わせ）", () => {
  it("既定の条件: 99991・99990 の2件、除外 4 件、基準日", async () => {
    const result = await screen("");
    expect(codes(result)).toEqual(["99991", "99990"]);
    expect(result).toMatchObject({ total: 2, stockCount: 10, excludedUnavailable: 4, referenceDate: "2026-09-24", page: 1, totalPages: 1 });
    const row = result.rows[0]!;
    expect(row).toMatchObject({
      revenue_cagr: 0.25,
      revenue_cagr_display_pct: 25,
      operating_margin: 0.15,
      operating_margin_display_pct: 15,
      first_price_date: "2022-09-24",
      estimated_listing_years: 4,
      listed_before_data_start: false,
      status: { cagr: "met", margin: "met", years: "met" },
    });
    expect(statusOf(result, "99990")).toEqual({ cagr: "met", margin: "met", years: "met" });
  });

  it("閾値（C2）: CAGR 15 で 99992 が加わる。境界は含む", async () => {
    expect(codes(await screen("cagr=15"))).toEqual(["99991", "99990", "99992"]);
    expect(codes(await screen("cagr=20.1"))).toEqual(["99991"]);
    expect(codes(await screen("margin=10.1"))).toEqual(["99991"]);
    expect(codes(await screen("years=4.9"))).toEqual(["99991"]);
    expect(codes(await screen("years=8"))).toEqual(["99991", "99994", "99990"]);
    expect(codes(await screen("years=10"))).toEqual(["99991", "99994", "99990"]);
  });

  it("オン／オフ（C3-1〜C3-3・C3-5）", async () => {
    const marginOff = await screen("off=margin");
    expect([...codes(marginOff)].sort()).toEqual(["99990", "99991", "99993", "99997"]);
    expect(statusOf(marginOff, "99997")).toEqual({ cagr: "met", margin: "off", years: "met" });
    expect(marginOff.excludedUnavailable).toBe(3);

    const yearsOff = await screen("off=years");
    expect([...codes(yearsOff)].sort()).toEqual(["99990", "99991", "99994", "99995", "99999"]);
    expect(statusOf(yearsOff, "99999")?.years).toBe("off");
    expect(yearsOff.excludedUnavailable).toBe(3);

    for (const include of ["", "&unavailable=include"]) {
      const allOff = await screen(`off=cagr,margin,years${include}`);
      expect(allOff.total).toBe(10);
      for (const row of allOff.rows) expect(row.status).toEqual({ cagr: "off", margin: "off", years: "off" });
    }
  });

  it("算出不可を含める（C4）", async () => {
    const result = await screen("unavailable=include");
    expect([...codes(result)].sort()).toEqual(["99990", "99991", "99996", "99997", "99998", "99999"]);
    expect(result.excludedUnavailable).toBe(0);
    expect(statusOf(result, "99996")).toEqual({ cagr: "unavailable", margin: "met", years: "met" });
    expect(result.rows.find((row) => row.code === "99996")).toMatchObject({ revenue_cagr: null, revenue_cagr_unavailable_reason: "insufficient_periods" });
    expect(statusOf(result, "99997")).toEqual({ cagr: "met", margin: "unavailable", years: "met" });
    expect(result.rows.find((row) => row.code === "99997")).toMatchObject({ operating_margin_unavailable_reason: "operating_profit_not_disclosed" });
    expect(statusOf(result, "99998")).toEqual({ cagr: "unavailable", margin: "unavailable", years: "met" });
    expect(result.rows.find((row) => row.code === "99998")?.has_financials).toBe(false);
    expect(statusOf(result, "99999")).toEqual({ cagr: "met", margin: "met", years: "unavailable" });

    const strict = await screen("unavailable=include&cagr=30");
    expect(codes(strict)).toContain("99996");
    expect(codes(strict)).not.toContain("99997");
  });

  it("データ期間開始以前は、算出不可を含めても条件③を満たさない", async () => {
    const result = await screen("off=cagr,margin&unavailable=include");
    expect(codes(result)).not.toContain("99995");
    const off = await screen("off=years");
    expect(off.rows.find((row) => row.code === "99995")).toMatchObject({ listed_before_data_start: true, listing_years_lower_bound: 9, estimated_listing_years: null });
  });

  it("並べ替え（C5-3）", async () => {
    const base = "off=cagr,margin,years&unavailable=include";
    expect(codes(await screen(`${base}&sort=cagr&order=desc`))).toEqual(["99995", "99993", "99991", "99997", "99994", "99999", "99990", "99992", "99996", "99998"]);
    expect(codes(await screen(`${base}&sort=cagr&order=asc`))).toEqual(["99992", "99990", "99999", "99994", "99991", "99997", "99993", "99995", "99996", "99998"]);
    expect(codes(await screen(`${base}&sort=years&order=asc`))).toEqual(["99998", "99996", "99993", "99997", "99991", "99992", "99990", "99994", "99995", "99999"]);
    expect(codes(await screen(`${base}&sort=years&order=desc`))).toEqual(["99995", "99994", "99990", "99991", "99992", "99993", "99997", "99996", "99998", "99999"]);
    expect(codes(await screen(`${base}&sort=margin&order=desc`))).toEqual(["99995", "99994", "99996", "99991", "99992", "99999", "99990", "99993", "99997", "99998"]);
    expect(codes(await screen(`${base}&sort=margin&order=asc`))).toEqual(["99993", "99990", "99999", "99992", "99991", "99996", "99994", "99995", "99997", "99998"]);
    expect(codes(await screen(`${base}&sort=code&order=desc`))).toEqual(["99999", "99998", "99997", "99996", "99995", "99994", "99993", "99992", "99991", "99990"]);
    const market = codes(await screen(`${base}&sort=market&order=asc`));
    expect(market).toEqual(["99990", "99994", "99995", "99997", "99992", "99999", "99991", "99993", "99996", "99998"]);
    const sector = codes(await screen(`${base}&sort=sector&order=asc`));
    expect(sector).toEqual(["99992", "99994", "99999", "99990", "99991", "99993", "99995", "99996", "99998", "99997"]);
    const names = codes(await screen(`${base}&sort=name&order=asc`));
    expect(names).toHaveLength(10);
  });

  it("市場区分・業種（C7）", async () => {
    expect(codes(await screen("market=0113"))).toEqual(["99991"]);
    expect(codes(await screen("market=0111,0113"))).toEqual(["99991", "99990"]);
    expect(codes(await screen("cagr=15&sector=3050"))).toEqual(["99992"]);
    expect(codes(await screen("off=cagr,margin,years&sector=7050"))).toEqual(["99997"]);
    expect((await screen("sector=0050")).total).toBe(0);

    const { rows } = await db.query("select public.screening_filter_options() as r");
    expect(rows[0].r).toEqual({
      sectors: [
        { code: "3050", name: "食料品", count: 3 },
        { code: "5250", name: "情報・通信業", count: 6 },
        { code: "7050", name: "銀行業", count: 1 },
      ],
      markets: { "0111": 4, "0112": 2, "0113": 4 },
    });
  });

  it("0件（C8-1）", async () => {
    const result = await screen("cagr=500");
    expect(result).toMatchObject({ total: 0, rows: [], totalPages: 1 });
  });

  it("ページ送り（C8-4・C8-5）と件数", async () => {
    await db.query(PAGING_SQL);
    try {
      const page1 = await screen("");
      expect(page1).toMatchObject({ total: 122, page: 1, totalPages: 2 });
      expect(page1.rows).toHaveLength(100);
      const page2 = await screen("page=2");
      expect(page2.rows).toHaveLength(22);
      const all = [...codes(page1), ...codes(page2)];
      expect(new Set(all).size).toBe(122);
      expect((await screen("page=99")).rows).toEqual([]);
      const clamped = await screen("page=99", true);
      expect(clamped.page).toBe(2);
      expect(clamped.rows).toHaveLength(22);
      // total はページに関係なく、excludedUnavailable は「含める」との差
      const include = await screen("unavailable=include&page=2");
      expect(include.total - page2.total).toBe(page2.excludedUnavailable);
    } finally {
      await db.query("delete from public.stocks where code like '9Z%'");
    }
  });
});

describe("表示と保存の一致（C10-2。財務）", () => {
  it("「満たす」⇔「表示 ≥ X」⇔「保存 ≥ X/100」", async () => {
    // 売上CAGR が 0.2・0.1999855321・0.15・負、営業利益率が 0.1・0.0999・−0.01025・0.2 などの銘柄を作る
    const cases: [string, number[], number][] = [
      ["99981", [100, 120, 144, 172.8, 207.36], 0.1],
      ["99982", [100, 120, 144, 172.8, 207.35], 0.0999],
      ["99983", [100, 115, 132.25, 152.0875, 174.900625], -0.01025],
      ["99984", [100, 99, 98, 97, 95.9], 0.2],
      ["99985", [100, 110, 121, 133.1, 146.41], 0.199],
    ];
    for (const [code, sales, margin] of cases) {
      await db.query(
        `insert into public.stocks (code, company_name, market_code, market_name, sector33_code, sector33_name, product_category)
         values ($1, '一致テスト株式会社', '0113', 'グロース', '5250', '情報・通信業', '011')`,
        [code],
      );
      for (const [i, s] of sales.entries()) {
        await db.query(
          `insert into public.financial_statements (code, disclosure_no, disclosed_date, document_type, fiscal_year_start, fiscal_year_end, net_sales, operating_profit)
           values ($1, $2, make_date(2021 + $3::int, 5, 14), 'FYFinancialStatements_Consolidated_JP', make_date(2020 + $3::int, 4, 1), make_date(2021 + $3::int, 3, 31),
                   $4::numeric * 100000000, $4::numeric * $5::numeric * 100000000)`,
          [code, `EQ${code}${i}`, i, String(s), String(margin)],
        );
      }
    }
    try {
      for (const x of ["-5", "-1.1", "-1", "0", "10", "15", "19.9", "20", "20.1"]) {
        for (const key of ["cagr", "margin"] as const) {
          const other = key === "cagr" ? "margin" : "cagr";
          const result = await screen(`${key}=${x}&off=${other},years&unavailable=include&market=0113&sector=5250`);
          const { rows } = await db.query(
            `select code, ${key === "cagr" ? "revenue_cagr" : "operating_margin"} >= $1::numeric / 100 as stored,
                    ${key === "cagr" ? "revenue_cagr_display_pct" : "operating_margin_display_pct"} >= $1::numeric as shown
               from public.financial_metrics where code like '9998%'`,
            [x],
          );
          for (const row of rows) {
            const status = statusOf(result, row.code);
            const met = status?.[key] === "met";
            expect({ code: row.code, key, x, met }).toEqual({ code: row.code, key, x, met: row.stored });
            expect(row.shown).toBe(row.stored);
          }
        }
      }
    } finally {
      await db.query("delete from public.stocks where code like '9998%'");
    }
  });
});

describe("表示と正確な値の一致（C10-3。上場年数）", () => {
  it.each(["2026-09-24", "2024-02-29", "2025-02-28", "2028-02-29"])("基準日 %s: 下限日との比較 ⇔ 正確 ≤ Z ⇔ 表示 ≤ Z（11年分のすべての日）", async (reference) => {
    const { rows } = await db.query(
      `with z(v) as (select unnest(array[0.1, 0.5, 1.0, 2.9, 3.0, 4.9, 5.0, 9.9, 10.0]::numeric[])),
            f(d) as (select g::date from generate_series($1::date - interval '11 years', $1::date, interval '1 day') g),
            y as (select f.d, x.exact_years, x.rounded_up_years from f cross join lateral public.listing_years_between(f.d, $1::date) x)
       select z.v::text as z, count(*)::int as n,
              count(*) filter (where (y.d >= public.listing_first_date_cutoff($1::date, z.v)) is distinct from (y.exact_years <= z.v))::int as cutoff_mismatch,
              count(*) filter (where (y.rounded_up_years <= z.v) is distinct from (y.exact_years <= z.v))::int as shown_mismatch
         from z cross join y group by z.v order by z.v`,
      [reference],
    );
    expect(rows).toHaveLength(9);
    for (const row of rows) {
      expect(row.n).toBeGreaterThan(4000);
      expect({ z: row.z, cutoff: row.cutoff_mismatch, shown: row.shown_mismatch }).toEqual({ z: row.z, cutoff: 0, shown: 0 });
    }
  });

  it("負や NULL の閾値・基準日では下限日が無い", async () => {
    const { rows } = await db.query(
      "select public.listing_first_date_cutoff('2026-09-24', -1) as a, public.listing_first_date_cutoff(null, 5) as b, public.listing_first_date_cutoff('2026-09-24', 5)::text as c",
    );
    expect(rows[0]).toEqual({ a: null, b: null, c: "2021-09-24" });
  });

  it("screen_stocks の条件③は、境界の前後で正確な値と一致する", async () => {
    const dates = ["2021-09-22", "2021-09-23", "2021-09-24", "2021-09-25", "2016-09-27", "2016-09-26"];
    for (const [i, d] of dates.entries()) {
      const code = `9997${i}`;
      await db.query("insert into public.stocks (code, company_name, market_code, product_category) values ($1, '境界テスト株式会社', '0112', '011')", [code]);
      await db.query("insert into public.stock_listing_dates (code, first_price_date, data_start_date) values ($1, $2, '2016-09-26')", [code, d]);
    }
    try {
      for (const z of ["5", "5.1", "4.9", "9.9", "10"]) {
        const result = await screen(`years=${z}&off=cagr,margin&market=0112`);
        const { rows } = await db.query(
          `select a.code, (a.listing_years_exact <= $1::numeric) as expected
             from public.stock_listing_ages a where a.code like '9997%'`,
          [z],
        );
        for (const row of rows) expect({ code: row.code, z, met: codes(result).includes(row.code) }).toEqual({ code: row.code, z, met: row.expected === true });
      }
    } finally {
      await db.query("delete from public.stocks where code like '9997%'");
    }
  });
});

describe("性能（C11。許可リストの authenticated ユーザーとして測る）", () => {
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

  async function timeScreen(params: object): Promise<number> {
    const body = JSON.stringify({ ...toScreenStocksParams(DEFAULT_CONDITIONS, { clampPage: false }), ...params });
    const samples: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const started = performance.now();
      await asUser(ownerId, () => db.query("select public.screen_stocks($1::jsonb)", [body]));
      if (i > 0) samples.push(performance.now() - started); // 最初の1回はウォームアップ
    }
    return median(samples);
  }

  it("4,000 銘柄で、各場合の中央値が 100ms 以内。年数の関数はページの行数以下。RLS が効いている", async () => {
    // 一部は算出不可（4期だけ・営業利益なし）、一部はデータ期間開始以前、一部は初出日なし
    await db.query(`
      insert into public.stocks (code, company_name, market_code, market_name, sector33_code, sector33_name, product_category)
      select 'P' || lpad(i::text, 4, '0'), '性能テスト' || i || '株式会社',
             (array['0111','0112','0113'])[1 + i % 3], (array['プライム','スタンダード','グロース'])[1 + i % 3],
             (array['3050','5250','7050','9050'])[1 + i % 4], (array['食料品','情報・通信業','銀行業','サービス業'])[1 + i % 4], '011'
        from generate_series(0, 3999) as i`);
    await db.query(`
      insert into public.stock_listing_dates (code, first_price_date, data_start_date)
      select 'P' || lpad(i::text, 4, '0'),
             case when i % 10 = 0 then date '2016-09-26' else date '2016-09-27' + (i * 7 % 3600) end, date '2016-09-26'
        from generate_series(0, 3999) as i where i % 17 <> 0`);
    await db.query(`
      insert into public.financial_statements (code, disclosure_no, disclosed_date, document_type, fiscal_year_start, fiscal_year_end, net_sales, operating_profit)
      select 'P' || lpad(i::text, 4, '0'), 'PF' || i || '-' || y, make_date(y, 5, 14), 'FYFinancialStatements_Consolidated_JP',
             make_date(y - 1, 4, 1), make_date(y, 3, 31),
             1000000000::numeric * power(1 + (i % 40) / 100.0, y - 2021)::numeric,
             case when i % 13 = 0 then null else 1000000000::numeric * (i % 30) / 100 end
        from generate_series(0, 3999) as i, generate_series(2021, 2025) as y
       where not (i % 11 = 0 and y = 2021)`);
    await db.query(
      "insert into public.ingestion_runs (target, trigger, status, started_at, finished_at) values ('daily_quotes', 'manual', 'succeeded', now() - interval '1 minute', now())",
    );

    // RLS: owner は全件、許可リスト外は 0 件
    const ownerCount = await asUser(ownerId, () => db.query("select count(*)::int as n from public.stocks"));
    expect(ownerCount.rows[0].n).toBeGreaterThanOrEqual(4000);
    const intruderCount = await asUser(intruderId, () => db.query("select count(*)::int as n from public.stocks"));
    expect(intruderCount.rows[0].n).toBe(0);
    const intruderScreen = await asUser(intruderId, () => db.query("select public.screen_stocks($1::jsonb) as r", [JSON.stringify(toScreenStocksParams(DEFAULT_CONDITIONS, { clampPage: false }))]));
    expect(intruderScreen.rows[0].r).toMatchObject({ total: 0, stockCount: 0, rows: [] });

    const allOff = { cagrOn: false, marginOn: false, yearsOn: false, includeUnavailable: true };
    const scenarios: [string, object][] = [
      ["既定の条件", {}],
      ["3条件オフ・売上CAGR", { ...allOff, sort: "cagr", order: "desc" }],
      ["3条件オフ・営業利益率", { ...allOff, sort: "margin", order: "asc" }],
      ["3条件オフ・推定上場年数", { ...allOff, sort: "years", order: "asc" }],
      ["3条件オフ・社名", { ...allOff, sort: "name", order: "asc" }],
      ["市場・業種", { markets: ["0113", "0111"], sectors: ["5250", "3050"], includeUnavailable: true }],
      ["最終ページ", { ...allOff, sort: "years", order: "desc", page: 40 }],
    ];
    const timings: string[] = [];
    for (const [label, params] of scenarios) {
      const ms = await timeScreen(params);
      timings.push(`${label} ${ms.toFixed(1)}ms`);
      expect(ms, `${label} の中央値 ${ms}ms`).toBeLessThan(100);
    }

    const all = await asUser(ownerId, () =>
      db.query("select public.screen_stocks($1::jsonb) as r", [JSON.stringify({ ...toScreenStocksParams(DEFAULT_CONDITIONS, { clampPage: false }), ...allOff })]),
    );
    expect(all.rows[0].r.total).toBe(4010);

    // 年数の関数の呼び出しは、ページの行数（100）以下。
    // pg_stat_get_xact_function_calls は未反映の統計（前のトランザクションの分を含むことがある）を読むので、同じトランザクションの中で前後の差を取る
    await db.query("set track_functions = 'all'");
    const readCalls = () =>
      db.query("select coalesce(pg_stat_get_xact_function_calls('public.listing_years_between(date,date)'::regprocedure), 0)::int as n").then((r) => r.rows[0].n as number);
    const measureCalls = (sqlText: string, values: unknown[] = []) =>
      asUser(ownerId, async () => {
        const before = await readCalls();
        await db.query(sqlText, values);
        return (await readCalls()) - before;
      });
    const screenSql = "select public.screen_stocks($1::jsonb)";
    const base = toScreenStocksParams(DEFAULT_CONDITIONS, { clampPage: false });
    const calls = await measureCalls(screenSql, [JSON.stringify({ ...base, ...allOff, sort: "years", order: "asc" })]);
    // 条件③がオンのときは、下限日を求める二分探索の分（行数に依存しない。十数回）だけ増える
    const withYears = await measureCalls(screenSql, [
      JSON.stringify({ ...base, cagrOn: false, marginOn: false, includeUnavailable: true, sort: "years", order: "asc" }),
    ]);
    const cutoffCalls = await measureCalls("select public.listing_first_date_cutoff(r.reference_date, 5) from public.listing_reference_date r");
    await db.query("reset track_functions");
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(100);
    expect(cutoffCalls).toBeLessThan(20);
    expect(withYears - cutoffCalls).toBeLessThanOrEqual(100);

    const { rows: def } = await db.query("select pg_get_functiondef('public.screen_stocks(jsonb)'::regprocedure) as d");
    expect(def[0].d).not.toContain("stock_listing_ages");
    console.log(`[性能] ${timings.join("、")}、年数の関数 ${calls} 回（条件③オンでは ${withYears} 回、うち下限日 ${cutoffCalls} 回）`);
  }, 120_000);
});
