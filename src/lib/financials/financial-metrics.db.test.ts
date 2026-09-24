/**
 * 財務指標の算出（DB の関数 public.financial_metrics_from_periods・recalculate_financial_metrics、ビュー public.financial_periods、
 * financial_statements のトリガー）の結合テスト（契約の C3・C4・C12、C15-4）。
 * 実行: pnpm test:db。テストの銘柄コードは 9999x（性能のテストは 0000Z〜3999Z）。作った行は後片付けする。
 */
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const DB_URL = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const db = new Client({ connectionString: DB_URL });

type Stmt = {
  no?: string;
  start: string;
  end: string;
  sales: number | null;
  op?: number | null;
  doc?: string;
  disclosed?: string;
  time?: string | null;
};

let seq = 0;

async function insertStock(code: string) {
  await db.query(
    `insert into public.stocks (code, company_name, market_code, market_name, sector33_code, sector33_name, product_category)
     values ($1, $2, '0113', 'グロース', '5250', '情報・通信業', '011') on conflict do nothing`,
    [code, `財務テスト${code}株式会社`],
  );
}

/** 通期の開示を投入する（金額は円）。 */
async function insertStatements(code: string, statements: Stmt[]) {
  await insertStock(code);
  for (const s of statements) {
    seq += 1;
    await db.query(
      `insert into public.financial_statements
         (code, disclosure_no, disclosed_date, disclosed_time, document_type, fiscal_year_start, fiscal_year_end, net_sales, operating_profit)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        code,
        s.no ?? `T${String(seq).padStart(8, "0")}`,
        s.disclosed ?? `${Number(s.end.slice(0, 4)) + (s.end.slice(5, 7) > "05" ? 1 : 0)}-05-14`,
        s.time === undefined ? "15:00:00" : s.time,
        s.doc ?? "FYFinancialStatements_Consolidated_JP",
        s.start,
        s.end,
        s.sales,
        s.op === undefined ? (s.sales === null ? null : s.sales / 10) : s.op,
      ],
    );
  }
}

/** 3月決算の連続した期（終了年の配列と売上高）。 */
function marchYears(years: number[], sales: (number | null)[], op?: (number | null)[]): Stmt[] {
  return years.map((year, i) => ({
    start: `${year - 1}-04-01`,
    end: `${year}-03-31`,
    sales: sales[i],
    op: op ? op[i] : undefined,
  }));
}

async function metrics(code: string) {
  const { rows } = await db.query(
    `select revenue_cagr::text, revenue_cagr_display_pct::text as cagr_pct, revenue_cagr_unavailable_reason as cagr_reason,
            revenue_cagr_base_fiscal_year_end::text as base_end, revenue_cagr_period_count as chain, revenue_cagr_mixed_basis as mixed,
            operating_margin::text, operating_margin_display_pct::text as margin_pct, operating_margin_unavailable_reason as margin_reason,
            latest_fiscal_year_end::text as latest_end, annual_period_count as periods, calculated_at
       from public.financial_metrics where code = $1`,
    [code],
  );
  return rows[0] ?? null;
}

async function cleanup() {
  await db.query("delete from public.stocks where code like '9999%' or code like '%Z'");
}

beforeAll(async () => {
  await db.connect();
});

beforeEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await db.end();
});

describe("売上CAGR と営業利益率（AC5.1〜AC5.4、C4）", () => {
  it("AC5.1: 100 → 150 → 200 → 300 → 400 は 41.4%（保存は小数点以下10桁）", async () => {
    await insertStatements("99991", marchYears([2021, 2022, 2023, 2024, 2025], [100, 150, 200, 300, 400], [10, 15, 20, 40, 60]));
    expect(await metrics("99991")).toMatchObject({
      revenue_cagr: "0.4142135624",
      cagr_pct: "41.4",
      cagr_reason: null,
      base_end: "2021-03-31",
      chain: 5,
      mixed: false,
      operating_margin: "0.1500000000",
      margin_pct: "15.0",
      latest_end: "2025-03-31",
      periods: 5,
    });
  });

  it("AC5.2・AC5.3: 4期だけなら CAGR は「5期未満」、売上 1,000・営業利益 120 の営業利益率は 12.0%", async () => {
    await insertStatements("99992", marchYears([2022, 2023, 2024, 2025], [700, 800, 900, 1000], [70, 90, 100, 120]));
    expect(await metrics("99992")).toMatchObject({
      revenue_cagr: null,
      cagr_reason: "insufficient_periods",
      chain: 4,
      margin_pct: "12.0",
      operating_margin: "0.1200000000",
    });
  });

  it("FY-4 の売上が 0・負なら「FY-4 の売上高が0以下」", async () => {
    await insertStatements("99993", marchYears([2021, 2022, 2023, 2024, 2025], [0, 50, 80, 100, 120]));
    await insertStatements("99994", marchYears([2021, 2022, 2023, 2024, 2025], [-10, 50, 80, 100, 120]));
    expect((await metrics("99993")).cagr_reason).toBe("base_revenue_not_positive");
    expect((await metrics("99994")).cagr_reason).toBe("base_revenue_not_positive");
    expect((await metrics("99993")).margin_pct).toBe("10.0");
  });

  it("変則決算: 9か月の期、15か月の期、FY0 自身が変則", async () => {
    await insertStatements("99991", [
      ...marchYears([2021, 2022], [100, 110]),
      { start: "2022-04-01", end: "2022-12-31", sales: 90 },
      { start: "2023-01-01", end: "2023-12-31", sales: 130 },
      { start: "2024-01-01", end: "2024-12-31", sales: 150 },
      { start: "2025-01-01", end: "2025-12-31", sales: 160, op: 16 },
    ]);
    await insertStatements("99992", [
      ...marchYears([2021, 2022, 2023], [100, 110, 120]),
      { start: "2023-04-01", end: "2024-06-30", sales: 160 },
      { start: "2024-07-01", end: "2025-06-30", sales: 150 },
    ]);
    await insertStatements("99995", [
      ...marchYears([2021, 2022, 2023, 2024], [100, 110, 120, 130]),
      { start: "2024-04-01", end: "2024-12-31", sales: 100, op: 10 },
    ]);
    expect(await metrics("99991")).toMatchObject({ cagr_reason: "irregular_period", margin_pct: "10.0", chain: 5 });
    expect((await metrics("99992")).cagr_reason).toBe("irregular_period");
    // FY0 が変則でも、営業利益率は算出する
    expect(await metrics("99995")).toMatchObject({ cagr_reason: "irregular_period", margin_pct: "10.0" });
  });

  it("期の長さの境界: 357 日は変則、358・364・365・366・371 日は12か月、372 日は変則", async () => {
    const { rows } = await db.query(`
      select d, public.financial_metrics_from_periods(jsonb_build_array(
        jsonb_build_object('fiscal_year_start', '2024-01-01'::date, 'fiscal_year_end', '2024-01-01'::date + (d - 1), 'net_sales', 100, 'operating_profit', 10),
        jsonb_build_object('fiscal_year_start', '2023-01-01', 'fiscal_year_end', '2023-12-31', 'net_sales', 100, 'operating_profit', 10),
        jsonb_build_object('fiscal_year_start', '2022-01-01', 'fiscal_year_end', '2022-12-31', 'net_sales', 100, 'operating_profit', 10),
        jsonb_build_object('fiscal_year_start', '2021-01-01', 'fiscal_year_end', '2021-12-31', 'net_sales', 100, 'operating_profit', 10),
        jsonb_build_object('fiscal_year_start', '2020-01-01', 'fiscal_year_end', '2020-12-31', 'net_sales', 100, 'operating_profit', 10)
      )) ->> 'revenue_cagr_unavailable_reason' as reason
      from unnest(array[357, 358, 364, 365, 366, 371, 372]) as d order by d`);
    expect(rows.map((row) => [row.d, row.reason])).toEqual([
      [357, "irregular_period"],
      [358, null],
      [364, null],
      [365, null],
      [366, null],
      [371, null],
      [372, "irregular_period"],
    ]);
  });

  it("連続の判定: 欠けた期・重なった期は「連続していない」、途切れた先に期が無ければ「5期未満」", async () => {
    await insertStatements("99991", marchYears([2020, 2021, 2022, 2024, 2025], [60, 70, 80, 90, 100], [5, 5, 6, 7, 8]));
    await insertStatements("99992", [
      ...marchYears([2021, 2022, 2023, 2024], [100, 110, 120, 130]),
      { start: "2024-03-01", end: "2025-02-28", sales: 140 }, // 前の期と重なる
    ]);
    expect(await metrics("99991")).toMatchObject({ cagr_reason: "non_consecutive_periods", chain: 2, margin_pct: "8.0" });
    expect(await metrics("99992")).toMatchObject({ cagr_reason: "non_consecutive_periods", chain: 1 });
    await insertStatements("99993", marchYears([2023, 2024, 2025], [1, 2, 3]));
    expect(await metrics("99993")).toMatchObject({ cagr_reason: "insufficient_periods", chain: 3 });
  });

  it("理由の優先順位: 4期で1期が変則なら「変則決算」、売上の開示なしと FY-4 が0以下が同時なら「売上高の開示がない期がある」", async () => {
    await insertStatements("99991", [
      ...marchYears([2022, 2023], [100, 110]),
      { start: "2023-04-01", end: "2023-12-31", sales: 90 },
      { start: "2024-01-01", end: "2024-12-31", sales: 150 },
    ]);
    await insertStatements("99992", marchYears([2021, 2022, 2023, 2024, 2025], [0, 50, null, 100, 120]));
    expect((await metrics("99991")).cagr_reason).toBe("irregular_period");
    expect((await metrics("99992")).cagr_reason).toBe("revenue_not_disclosed");
  });

  it("FY0 の売上が 0 なら CAGR は -100.0%、営業利益率は「売上高が0以下」。FY0 が負なら「直近期の売上高がマイナス」", async () => {
    await insertStatements("99991", marchYears([2021, 2022, 2023, 2024, 2025], [100, 150, 200, 300, 0], [1, 1, 1, 1, 0]));
    await insertStatements("99992", marchYears([2021, 2022, 2023, 2024, 2025], [100, 150, 200, 300, -5], [1, 1, 1, 1, 1]));
    expect(await metrics("99991")).toMatchObject({ revenue_cagr: "-1.0000000000", cagr_pct: "-100.0", margin_reason: "revenue_not_positive" });
    expect(await metrics("99992")).toMatchObject({ cagr_reason: "latest_revenue_negative", margin_reason: "revenue_not_positive" });
  });

  it("営業利益率の理由: 営業利益の開示なし（IFRS）、売上高の開示なし。営業赤字は負の値", async () => {
    await insertStatements(
      "99991",
      marchYears([2021, 2022, 2023, 2024, 2025], [100, 120, 144, 172.8, 207.36], [null, null, null, null, null]).map((s) => ({
        ...s,
        doc: "FYFinancialStatements_Consolidated_IFRS",
      })),
    );
    await insertStatements("99992", marchYears([2024, 2025], [100, null], [1, 5]));
    await insertStatements("99993", marchYears([2025], [120], [-1.23]));
    expect(await metrics("99991")).toMatchObject({ revenue_cagr: "0.2000000000", cagr_pct: "20.0", margin_reason: "operating_profit_not_disclosed" });
    expect(await metrics("99992")).toMatchObject({ margin_reason: "revenue_not_disclosed", cagr_reason: "insufficient_periods" });
    expect(await metrics("99993")).toMatchObject({ operating_margin: "-0.0102500000", margin_pct: "-1.1" });
  });

  it("丸め: 比が 1.2^4・1.1^4・1.15^4 ならちょうど 0.2・0.1・0.15。表示 ≥ X と保存 ≥ X/100 が一致する", async () => {
    const cases: [string, number, number][] = [
      ["99991", 10000, 20736],
      ["99992", 10000, 14641],
      ["99993", 100000000, 174900625],
      ["99994", 100, 400],
      ["99995", 100, 207.35],
      ["99996", 100, 90],
    ];
    for (const [code, base, latest] of cases) {
      await insertStatements(code, marchYears([2021, 2022, 2023, 2024, 2025], [base, base, base, base, latest]));
    }
    expect((await metrics("99991")).revenue_cagr).toBe("0.2000000000");
    expect((await metrics("99992")).revenue_cagr).toBe("0.1000000000");
    expect((await metrics("99993")).revenue_cagr).toBe("0.1500000000");
    expect((await metrics("99995")).cagr_pct).toBe("19.9");
    const { rows } = await db.query(
      "select revenue_cagr, revenue_cagr_display_pct from public.financial_metrics where code like '9999%' and revenue_cagr is not null",
    );
    for (const row of rows) {
      for (const x of [0, 10, 15, 20, 41.4, -5]) {
        expect(Number(row.revenue_cagr_display_pct) >= x, `${row.revenue_cagr} vs ${x}`).toBe(Number(row.revenue_cagr) * 100 >= x - 1e-12);
      }
    }
  });

  it("基準の混在（連結 → 単体、日本基準 → IFRS）は revenue_cagr_mixed_basis = true で、算出不可にはしない", async () => {
    const years = marchYears([2021, 2022, 2023, 2024, 2025], [100, 110, 120, 130, 140]);
    await insertStatements("99991", years.map((s, i) => ({ ...s, doc: i < 2 ? "FYFinancialStatements_NonConsolidated_JP" : "FYFinancialStatements_Consolidated_JP" })));
    await insertStatements("99992", years.map((s, i) => ({ ...s, doc: i < 2 ? "FYFinancialStatements_Consolidated_JP" : "FYFinancialStatements_Consolidated_IFRS" })));
    expect(await metrics("99991")).toMatchObject({ mixed: true, cagr_reason: null });
    expect(await metrics("99992")).toMatchObject({ mixed: true, cagr_reason: null });
  });
});

describe("直近5期・訂正・通期実績だけ（AC5.5、AC5.8、C3）", () => {
  it("AC5.8: 6期・7期あっても FY-5 以前を変えたり消したりしても CAGR は変わらない（calculated_at は更新）", async () => {
    await insertStatements("99996", marchYears([2019, 2020, 2021, 2022, 2023, 2024, 2025], [30, 50, 100, 110, 121, 133.1, 146.41]));
    const before = await metrics("99996");
    expect(before).toMatchObject({ revenue_cagr: "0.1000000000", periods: 7 });
    await db.query("update public.financial_statements set net_sales = 1 where code = '99996' and fiscal_year_end = '2020-03-31'");
    const after = await metrics("99996");
    expect(after.revenue_cagr).toBe("0.1000000000");
    expect(after.calculated_at.getTime()).toBeGreaterThanOrEqual(before.calculated_at.getTime());
    await db.query("update public.financial_statements set net_sales = null where code = '99996' and fiscal_year_end = '2019-03-31'");
    await db.query("delete from public.financial_statements where code = '99996' and fiscal_year_end = '2020-03-31'");
    expect((await metrics("99996")).revenue_cagr).toBe("0.1000000000");
  });

  it("訂正: 開示日の新しい方、同じ日なら時刻の新しい方、同じ日時なら開示番号の大きい方を使う", async () => {
    const base = marchYears([2021, 2022, 2023, 2024], [100, 110, 121, 133.1]);
    await insertStatements("99991", [
      ...base,
      { no: "A1", start: "2024-04-01", end: "2025-03-31", sales: 140, op: 20, disclosed: "2025-05-14" },
      { no: "A2", start: "2024-04-01", end: "2025-03-31", sales: 146.41, op: 14.641, disclosed: "2025-05-20" },
    ]);
    expect(await metrics("99991")).toMatchObject({ revenue_cagr: "0.1000000000", margin_pct: "10.0" });
    const { rows } = await db.query(
      "select source, source_priority, source_document_id, source_document_date::text, disclosure_count from public.financial_periods where code = '99991' and fiscal_year_end = '2025-03-31'",
    );
    expect(rows).toEqual([
      { source: "tdnet_summary", source_priority: 1, source_document_id: "A2", source_document_date: "2025-05-20", disclosure_count: 2 },
    ]);
    await db.query("delete from public.financial_statements where disclosure_no = 'A2'");
    expect(await metrics("99991")).toMatchObject({ cagr_pct: "8.7", margin_pct: "14.2" });

    await insertStatements("99992", [
      ...base,
      { no: "B9", start: "2024-04-01", end: "2025-03-31", sales: 1, disclosed: "2025-05-14", time: "12:00:00" },
      { no: "B1", start: "2024-04-01", end: "2025-03-31", sales: 146.41, disclosed: "2025-05-14", time: "15:30:00" },
      { no: "B0", start: "2024-04-01", end: "2025-03-31", sales: 2, disclosed: "2025-05-14", time: null },
    ]);
    expect((await metrics("99992")).revenue_cagr).toBe("0.1000000000");
    await insertStatements("99993", [
      ...base,
      { no: "C1", start: "2024-04-01", end: "2025-03-31", sales: 1, disclosed: "2025-05-14", time: "15:00:00" },
      { no: "C2", start: "2024-04-01", end: "2025-03-31", sales: 146.41, disclosed: "2025-05-14", time: "15:00:00" },
    ]);
    expect((await metrics("99993")).revenue_cagr).toBe("0.1000000000");
  });

  it("訂正の開示で空欄になった項目は、同じ期の開示のうち値のある最新のものを使う（R2。実データで確認した形）", async () => {
    const base = marchYears([2021, 2022, 2023, 2024], [100, 110, 121, 133.1]);
    await insertStatements("99991", [
      ...base,
      { no: "F1", start: "2024-04-01", end: "2025-03-31", sales: 146.41, op: 20, disclosed: "2025-05-08" },
      { no: "F2", start: "2024-04-01", end: "2025-03-31", sales: 146.41, op: null, disclosed: "2025-05-18" },
    ]);
    expect(await metrics("99991")).toMatchObject({ revenue_cagr: "0.1000000000", margin_pct: "13.6", margin_reason: null });
    const { rows } = await db.query(
      "select source_document_id, operating_profit::text from public.financial_periods where code = '99991' and fiscal_year_end = '2025-03-31'",
    );
    expect(rows).toEqual([{ source_document_id: "F2", operating_profit: "20" }]);
  });

  it("四半期・業績予想の修正・REIT の行は、制約で入れられない（AC5.5 の DB 側）", async () => {
    await insertStock("99991");
    for (const doc of ["3QFinancialStatements_Consolidated_JP", "EarnForecastRevision", "FYFinancialStatements_Consolidated_REIT", "OtherPeriodFinancialStatements_Consolidated_JP"]) {
      await expect(
        insertStatements("99991", [{ start: "2024-04-01", end: "2025-03-31", sales: 1, doc }]),
        doc,
      ).rejects.toThrow(/financial_statements_annual_document/);
    }
  });

  it("トリガーは同じトランザクションの中で再計算し、通期実績をすべて消すと指標の行も消える", async () => {
    await insertStatements("99991", marchYears([2021, 2022, 2023, 2024, 2025], [100, 150, 200, 300, 400]));
    await db.query("begin");
    await db.query("update public.financial_statements set net_sales = 800 where code = '99991' and fiscal_year_end = '2025-03-31'");
    expect((await metrics("99991")).cagr_pct).toBe("68.1");
    await db.query("rollback");
    expect((await metrics("99991")).cagr_pct).toBe("41.4");
    await db.query("delete from public.financial_statements where code = '99991'");
    expect(await metrics("99991")).toBeNull();
  });

  it("R7: stocks を削除すると、トリガーのエラー無しで financial_statements と financial_metrics まで連鎖して消える", async () => {
    await insertStatements("99991", marchYears([2024, 2025], [100, 120]));
    await insertStatements("99992", marchYears([2024, 2025], [100, 120]));
    await db.query("delete from public.stocks where code like '9999%'");
    const { rows } = await db.query(
      "select (select count(*) from public.financial_statements where code like '9999%')::int as s, (select count(*) from public.financial_metrics where code like '9999%')::int as m",
    );
    expect(rows[0]).toEqual({ s: 0, m: 0 });
  });
});

describe("出典に依存しない算出（仕様の改訂2、C3-7）", () => {
  const PERIODS = [
    ["2020-04-01", "2021-03-31", 100],
    ["2021-04-01", "2022-03-31", 150],
    ["2022-04-01", "2023-03-31", 200],
    ["2023-04-01", "2024-03-31", 300],
    ["2024-04-01", "2025-03-31", 400],
  ].map(([start, end, sales]) => ({
    fiscal_year_start: start,
    fiscal_year_end: end,
    net_sales: sales,
    operating_profit: Number(sales) / 10,
    consolidated: true,
    accounting_standard: "JP",
  }));

  async function compute(periods: unknown[]) {
    const { rows } = await db.query("select public.financial_metrics_from_periods($1::jsonb) as r", [JSON.stringify(periods)]);
    return rows[0].r;
  }

  it("出典の項目を加えても、要素の順を入れ替えても、結果は完全に一致する", async () => {
    const plain = await compute(PERIODS);
    expect(plain).toMatchObject({ revenue_cagr: 0.4142135624, revenue_cagr_unavailable_reason: null, annual_period_count: 5 });
    const withSources = PERIODS.map((period, i) => ({
      ...period,
      source: i < 2 ? "edinet_registration" : i < 4 ? "edinet_annual_report" : "tdnet_summary",
      source_priority: i < 2 ? 3 : 2,
      source_document_id: `S${i}`,
    }));
    expect(await compute(withSources)).toEqual(plain);
    expect(await compute([...PERIODS].reverse())).toEqual(plain);
  });

  it("financial_metrics の値は、financial_periods の行を算出の核に渡した結果と一致する（同じ核を使っている）", async () => {
    await insertStatements("99991", marchYears([2021, 2022, 2023, 2024, 2025], [100, 150, 200, 300, 400], [10, 15, 20, 40, 60]));
    const { rows } = await db.query(`
      select public.financial_metrics_from_periods(jsonb_agg(to_jsonb(p))) as r from public.financial_periods p where p.code = '99991'`);
    const m = await metrics("99991");
    expect(String(rows[0].r.revenue_cagr)).toBe(m.revenue_cagr);
    expect(String(rows[0].r.operating_margin)).toBe("0.15");
    expect(m.operating_margin).toBe("0.1500000000");
    const { rows: sources } = await db.query("select distinct source, source_priority from public.financial_periods where code = '99991'");
    expect(sources).toEqual([{ source: "tdnet_summary", source_priority: 1 }]);
  });
});

describe("性能（C12。値は開発機での目安）", () => {
  it("4,000 銘柄 × 6期の投入、絞り込み、要約、1日分の保存", async () => {
    await db.query(`
      insert into public.stocks (code, company_name, product_category)
      select lpad(i::text, 4, '0') || 'Z', '性能テスト株式会社' || i, '011' from generate_series(0, 3999) as i`);

    let started = Date.now();
    await db.query(`
      insert into public.financial_statements (code, disclosure_no, disclosed_date, document_type, fiscal_year_start, fiscal_year_end, net_sales, operating_profit)
      select lpad(i::text, 4, '0') || 'Z', 'P' || i || '-' || y, make_date(y, 5, 14), 'FYFinancialStatements_Consolidated_JP',
             make_date(y - 1, 4, 1), make_date(y, 3, 31), 1000000000::numeric + i * 1000000::numeric * (y - 2019), (100000000::numeric + i * 50000) * (1 + (i % 7))
        from generate_series(0, 3999) as i, generate_series(2020, 2025) as y`);
    const insertMs = Date.now() - started;
    const { rows: count } = await db.query("select count(*)::int as n from public.financial_metrics where code like '%Z'");
    expect(count[0].n).toBe(4000);
    expect(insertMs, `24,000 行の投入 ${insertMs}ms`).toBeLessThan(15_000);

    const { rows: plan } = await db.query(`
      explain (analyze, format json)
      select code from public.financial_metrics
       where revenue_cagr >= 0.2 and operating_margin >= 0.1
       order by revenue_cagr desc limit 100`);
    const executionMs = plan[0]["QUERY PLAN"][0]["Execution Time"];
    expect(executionMs, `絞り込み ${executionMs}ms`).toBeLessThan(30);
    expect(JSON.stringify(plan[0]["QUERY PLAN"])).not.toMatch(/Function Scan|SubPlan/);

    started = Date.now();
    await db.query("select public.financial_metrics_summary()");
    const summaryMs = Date.now() - started;
    expect(summaryMs, `要約 ${summaryMs}ms`).toBeLessThan(100);

    // 1つの開示日の保存（1,000 行。うち通期 300 行）
    const { rows: run } = await db.query(
      "insert into public.ingestion_runs (target, trigger, status) values ('financials', 'manual', 'running') returning id",
    );
    const rows = Array.from({ length: 300 }, (_, i) => ({
      code: `${String(i).padStart(4, "0")}Z`,
      disclosure_no: `Q${i}`,
      disclosed_date: "2026-05-14",
      disclosed_time: "15:00:00",
      document_type: "FYFinancialStatements_Consolidated_JP",
      fiscal_year_start: "2025-04-01",
      fiscal_year_end: "2026-03-31",
      net_sales: String(2000000000 + i),
      operating_profit: String(300000000 + i),
    }));
    started = Date.now();
    const { rows: saved } = await db.query("select public.save_financial_statements($1, '2026-05-14', $2::jsonb, 1000) as r", [
      run[0].id,
      JSON.stringify(rows),
    ]);
    const saveMs = Date.now() - started;
    expect(saved[0].r).toEqual({ saved: true, savedCount: 300, unknownCodeCount: 0 });
    expect(saveMs, `1日分の保存 ${saveMs}ms`).toBeLessThan(2_000);
    await db.query("delete from public.ingestion_runs where id = $1", [run[0].id]);
    await db.query("delete from public.financial_fetched_dates where disclosure_date = '2026-05-14'");
    console.log(`[性能] 投入 ${insertMs}ms、絞り込み ${executionMs}ms、要約 ${summaryMs}ms、1日の保存 ${saveMs}ms`);
  }, 60_000);
});
