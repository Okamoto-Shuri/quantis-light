/**
 * 推定上場年数の算出（DB の関数 public.listing_years_between とビュー public.stock_listing_ages）の結合テスト。
 * 実行: pnpm test:db。テストの銘柄コードは 9999x。作った行は後片付けする。
 */
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { describeListingAge, listingAgeSchema } from "./ages";

const DB_URL = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const db = new Client({ connectionString: DB_URL });
let firstRunId = 0;

async function years(from: string, to: string) {
  const { rows } = await db.query(
    "select whole_years, exact_years::text, rounded_up_years::text from public.listing_years_between($1::date, $2::date)",
    [from, to],
  );
  return rows[0] ? { whole: rows[0].whole_years, exact: Number(rows[0].exact_years), shown: rows[0].rounded_up_years } : null;
}

async function insertRun(status: string, finishedAt: string, target = "daily_quotes") {
  await db.query(
    `insert into public.ingestion_runs (target, trigger, status, started_at, finished_at)
     values ($1, 'manual', $2, $3::timestamptz - interval '1 minute', $3::timestamptz)`,
    [target, status, finishedAt],
  );
}

async function referenceDate() {
  const { rows } = await db.query("select reference_date::text from public.listing_reference_date");
  return rows[0].reference_date;
}

beforeAll(async () => {
  await db.connect();
  const { rows } = await db.query("select coalesce(max(id), 0)::bigint + 1 as next from public.ingestion_runs");
  firstRunId = Number(rows[0].next);
  const { rows: others } = await db.query(
    "select count(*)::int as n from public.ingestion_runs where target = 'daily_quotes' and status in ('succeeded', 'partial')",
  );
  if (others[0].n > 0) throw new Error("株価の成功の実行が残っているため、基準日のテストを始められません（pnpm db:reset 直後の DB で実行してください）");
});

beforeEach(async () => {
  await db.query("delete from public.ingestion_runs where id >= $1", [firstRunId]);
  await db.query("delete from public.stocks where code like '9999%'");
});

afterAll(async () => {
  await db.query("delete from public.ingestion_runs where id >= $1", [firstRunId]);
  await db.query("delete from public.stocks where code like '9999%'");
  await db.end();
});

describe("listing_years_between（暦の年、表示は小数1桁の切り上げ）", () => {
  it.each([
    ["ちょうど3年", "2023-09-24", "2026-09-24", 3, "3.0"],
    ["3年−1日", "2023-09-25", "2026-09-24", 2, "3.0"],
    ["3年＋1日", "2023-09-23", "2026-09-24", 3, "3.1"],
    ["ちょうど5年", "2021-09-24", "2026-09-24", 5, "5.0"],
    ["5年−1日", "2021-09-25", "2026-09-24", 4, "5.0"],
    ["5年＋1日", "2021-09-23", "2026-09-24", 5, "5.1"],
    ["うるう日 → 2月28日", "2024-02-29", "2027-02-28", 3, "3.0"],
    ["うるう日 → 3月1日", "2024-02-29", "2027-03-01", 3, "3.1"],
    ["うるう日 → 2月27日", "2024-02-29", "2027-02-27", 2, "3.0"],
    ["うるう年をまたぐ1年", "2023-06-01", "2024-06-01", 1, "1.0"],
    ["初出日＝基準日", "2026-09-24", "2026-09-24", 0, "0.0"],
    ["初出日が基準日より後", "2026-10-01", "2026-09-24", 0, "0.0"],
    ["9.99…年", "2016-09-27", "2026-09-24", 9, "10.0"],
  ])("%s", async (_label, from, to, whole, shown) => {
    const result = await years(from, to);
    expect(result).toMatchObject({ whole, shown });
  });

  it("正確な年数は丸める前の値（5年＋1日 = 5 + 1/365）", async () => {
    const result = await years("2021-09-23", "2026-09-24");
    expect(result!.exact).toBeCloseTo(5 + 1 / 365, 12);
    expect((await years("2024-02-29", "2027-03-01"))!.exact).toBeCloseTo(3 + 1 / 366, 12);
  });

  it("データ期間開始以前の N（整数部分。切り上げない）", async () => {
    expect((await years("2016-09-26", "2026-09-24"))!.whole).toBe(9);
    expect((await years("2016-09-24", "2026-09-24"))!.whole).toBe(10);
  });

  it("どちらかが NULL なら行を返さない", async () => {
    const { rows } = await db.query("select * from public.listing_years_between(null, '2026-09-24'::date)");
    expect(rows).toEqual([]);
  });

  it("閾値 X（小数1桁）に対して「表示 ≤ X」と「正確な年数 ≤ X」が一致する", async () => {
    const dates = ["2023-09-24", "2023-09-25", "2023-09-23", "2021-09-24", "2021-09-25", "2021-09-23", "2026-03-24", "2025-09-25", "2022-03-25", "2022-03-23", "2016-09-27"];
    for (const from of dates) {
      const r = (await years(from, "2026-09-24"))!;
      for (const x of [0.5, 1, 3, 4.5, 5, 9.9]) {
        expect(Number(r.shown) <= x, `${from} X=${x}`).toBe(r.exact <= x);
      }
    }
  });

  it("毎日の日付で、切り上げが正確な値の10倍の切り上げと一致する（境界のずれが無い）", async () => {
    const { rows } = await db.query(
      `select d::date::text as from_date, y.exact_years::text as exact, y.rounded_up_years::text as shown
         from generate_series('2019-09-24'::date, '2026-09-24'::date, interval '1 day') d
         cross join lateral public.listing_years_between(d::date, '2026-09-24'::date) y`,
    );
    for (const row of rows) {
      // exact は numeric の文字列。10倍して切り上げ、1桁の文字列にする（浮動小数点を使わずに比べる）
      const [int, frac = ""] = row.exact.split(".");
      const tenths = Number.parseInt(int, 10) * 10 + Number.parseInt((frac + "0")[0], 10);
      const up = tenths + (/[1-9]/.test(frac.slice(1)) ? 1 : 0);
      expect(row.shown, row.from_date).toBe(`${Math.floor(up / 10)}.${up % 10}`);
    }
  });
});

describe("基準日とビュー stock_listing_ages", () => {
  it("daily_quotes の成功・一部失敗のうち、最新の終了日時の日本時間の日付（C1-6、C1-7）", async () => {
    expect(await referenceDate()).toBeNull();
    await insertRun("failed", "2026-09-25 20:00:00+09");
    await insertRun("succeeded", "2026-09-26 20:00:00+09", "stock_master");
    expect(await referenceDate()).toBeNull();
    await insertRun("succeeded", "2026-09-20 20:00:00+09");
    await insertRun("partial", "2026-09-24 08:00:00+09"); // UTC では 9/23 23:00
    expect(await referenceDate()).toBe("2026-09-24");
    await insertRun("succeeded", "2026-09-24 23:30:00+09"); // UTC では 9/24 14:30
    expect(await referenceDate()).toBe("2026-09-24");
  });

  it("投入例の3銘柄: 3.0年、データ期間開始以前（9年超）、未確定", async () => {
    await insertRun("succeeded", "2026-09-24 20:03:00+09");
    await db.query(
      `insert into public.stocks (code, company_name) values ('99991', 'a'), ('99992', 'b'), ('99993', 'c');
       insert into public.stock_listing_dates (code, first_price_date, data_start_date)
       values ('99991', '2023-09-24', '2016-09-26'), ('99992', '2016-09-26', '2016-09-26');`,
    );
    const { rows } = await db.query(
      `select code, first_price_date::text, data_start_date::text, reference_date::text, listed_before_data_start,
              listing_years_exact::text, estimated_listing_years::text, listing_years_lower_bound
         from public.stock_listing_ages where code like '9999%' order by code`,
    );
    const ages = rows.map((row) => listingAgeSchema.parse(row));
    expect(ages.map((age) => describeListingAge(age).text)).toEqual([
      "3.0年",
      "データ期間開始以前から上場（9年超）",
      "未確定（株価の初出日をまだ取り込んでいません）",
    ]);
    expect(ages[0]).toMatchObject({ first_price_date: "2023-09-24", reference_date: "2026-09-24", listed_before_data_start: false, listing_years_exact: 3, estimated_listing_years: 3, listing_years_lower_bound: null });
    expect(ages[1]).toMatchObject({ listed_before_data_start: true, listing_years_exact: null, estimated_listing_years: null, listing_years_lower_bound: 9 });
    expect(ages[2]).toMatchObject({ listed_before_data_start: null, first_price_date: null, estimated_listing_years: null });
  });

  it("初出日がデータ期間の開始日より前の行は制約で入れられない", async () => {
    await db.query("insert into public.stocks (code, company_name) values ('99991', 'a')");
    await expect(
      db.query("insert into public.stock_listing_dates (code, first_price_date, data_start_date) values ('99991', '2016-09-25', '2016-09-26')"),
    ).rejects.toThrow(/stock_listing_dates_first_after_start/);
  });
});
