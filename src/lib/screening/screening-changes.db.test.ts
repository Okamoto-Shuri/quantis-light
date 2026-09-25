/**
 * 新たに該当・外れた（Sprint 14）の結合テスト（契約の C3-4・C4-10・C7-1・C8）。
 * 実行: pnpm test:db（pnpm seed:users 済み）。
 * 前提（R4）: 比較の基準の記録（screening_snapshots）が0件の DB（db:reset 直後）。記録の関数は最新 7 回を残して古い記録を消し、
 *   比較は全体の最新の記録を使うので、テストの外の記録を消さず、期待値を揺らさないため。冒頭で確かめ、そうでなければ前提の失敗として落とす。
 * 作る行: 銘柄コード 9S9xx・性能 S0000〜S3999（社名 DB14…）、実行の details の fixture = 'sprint-14-db'、テストが作った記録（開始時の最大の id より後）、
 *   性能のテストのウォッチリスト（銘柄の削除で連鎖して消える）。後片付けで自分の行だけを消す。
 */
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { CONDITION_KEYS, DEFAULT_CONDITIONS, toScreenStocksParams, type ConditionKey, type ScreeningConditions } from "./params";

const DB_URL = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const db = new Client({ connectionString: DB_URL });
let ownerId = "";
let snapshotIdBefore = 0;

const params = (patch: Partial<ScreeningConditions> = {}) => toScreenStocksParams({ ...DEFAULT_CONDITIONS, ...patch }, { clampPage: false });

async function cleanup() {
  await db.query("delete from public.screening_snapshots where id > $1", [snapshotIdBefore]);
  await db.query("delete from public.stocks where company_name like 'DB14%'");
  await db.query("delete from public.ingestion_runs where details ->> 'fixture' = 'sprint-14-db'");
}

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

/** 巻き戻すトランザクションの中で実行する */
async function rolledBack<T>(fn: () => Promise<T>): Promise<T> {
  await db.query("begin");
  try {
    return await fn();
  } finally {
    await db.query("rollback");
  }
}

type Seed = {
  code: string;
  market?: string;
  sector?: string;
  delisted?: boolean;
  cagr?: number | null;
  margin?: number | null;
  firstPrice?: string | null;
  owner?: { top: boolean; total: number } | "undeterminable" | null;
};

/** 判定の入力を直接入れる（指標・初出日・判定は、保存の経路と同じ表に入れる。銘柄の insert の後に入れる） */
async function seed(stocks: Seed[]) {
  for (const s of stocks) {
    await db.query(
      `insert into public.stocks (code, company_name, market_code, market_name, sector33_code, sector33_name, product_category, delisted_on)
       values ($1, 'DB14' || $1, $2, '市場', $3, '業種', '011', $4)`,
      [s.code, s.market ?? "0113", s.sector ?? "5250", s.delisted ? "2026-09-20" : null],
    );
    await setInputs(s);
  }
}

async function setInputs(s: Seed) {
  await db.query("delete from public.financial_metrics where code = $1", [s.code]);
  await db.query("delete from public.stock_listing_dates where code = $1", [s.code]);
  await db.query("delete from public.ownership_judgments where code = $1", [s.code]);
  if (s.cagr !== undefined || s.margin !== undefined) {
    await db.query(
      `insert into public.financial_metrics (code, revenue_cagr, revenue_cagr_unavailable_reason, operating_margin, operating_margin_unavailable_reason, latest_fiscal_year_end)
       values ($1, $2, case when $2::numeric is null then 'insufficient_periods' end, $3, case when $3::numeric is null then 'operating_profit_not_disclosed' end, '2026-03-31')`,
      [s.code, s.cagr ?? null, s.margin ?? null],
    );
  }
  if (s.firstPrice) {
    await db.query("insert into public.stock_listing_dates (code, first_price_date, data_start_date) values ($1, $2, '2016-09-26')", [s.code, s.firstPrice]);
  }
  if (s.owner === "undeterminable") {
    await db.query("insert into public.ownership_judgments (code, status, undeterminable_reason) values ($1, 'undeterminable', 'president_not_found')", [s.code]);
  } else if (s.owner) {
    await db.query("insert into public.ownership_judgments (code, status, president_is_top_holder, owner_total_pct) values ($1, 'determined', $2, $3)", [
      s.code,
      s.owner.top,
      s.owner.total,
    ]);
  }
}

/** 全部満たす入力（標準の条件） */
const good = (code: string, patch: Partial<Seed> = {}): Seed => ({
  code,
  cagr: 0.25,
  margin: 0.15,
  firstPrice: "2023-09-24",
  owner: { top: true, total: 30 },
  ...patch,
});

async function capture(): Promise<number> {
  return Number((await db.query("select public.capture_screening_snapshot() as id")).rows[0].id);
}

async function changes(p: object) {
  const { rows } = await db.query("select public.screening_changes($1::jsonb) as r", [JSON.stringify(p)]);
  return rows[0].r as {
    status: string;
    snapshotId: number | null;
    added: { code: string; reasons: { kind: string; condition?: string; from?: string; to?: string }[] }[];
    removed: { code: string; reasons: { kind: string; condition?: string; from?: string; to?: string }[] }[];
  };
}

const ours = <T extends { code: string }>(list: T[]) => list.filter((item) => item.code.startsWith("9S9"));
const reasonKeys = (list: { code: string; reasons: { kind: string; condition?: string; from?: string; to?: string }[] }[]) =>
  Object.fromEntries(ours(list).map((item) => [item.code, item.reasons.map((r) => (r.kind === "condition" ? `${r.condition}:${r.from}>${r.to}` : r.kind))]));

async function insertQuotesRun(finishedAtJst: string) {
  await db.query(
    `insert into public.ingestion_runs (target, trigger, status, started_at, finished_at, details)
     values ('daily_quotes', 'manual', 'succeeded', $1::timestamptz - interval '3 minutes', $1::timestamptz, '{"fixture":"sprint-14-db"}')`,
    [finishedAtJst],
  );
}

beforeAll(async () => {
  await db.connect();
  const { rows } = await db.query("select count(*)::int as n, coalesce(max(id), 0)::int as max from public.screening_snapshots");
  expect(rows[0].n, "前提（R4）: 比較の基準の記録が0件の DB（pnpm db:reset の直後。e2e/fixtures/screening-snapshots-cleanup.sql で消せる）").toBe(0);
  snapshotIdBefore = rows[0].max;
  const { rows: users } = await db.query("select id::text from auth.users where email = 'owner@quantis.local'");
  ownerId = users[0]?.id ?? "";
  expect(ownerId, "pnpm seed:users が必要").toBeTruthy();
  const { rows: runs } = await db.query("select count(*)::int as n from public.ingestion_runs where status = 'running'");
  expect(runs[0].n, "前提: 実行中の実行が無い").toBe(0);
  await cleanup();
});

beforeEach(async () => {
  await cleanup();
  await insertQuotesRun("2026-09-24 20:03+09");
});

afterAll(async () => {
  await cleanup();
  await db.end();
});

describe("記録を作る経路（C7-1・C3-4）", () => {
  it("定期実行の銘柄マスタの開始だけが記録を作る。手動・財務・二重実行では作らない", async () => {
    await seed([good("9S901")]);
    const count = async () => (await db.query("select count(*)::int as n from public.screening_snapshots")).rows[0].n as number;
    const before = await count();
    await rolledBack(async () => {
      const { rows } = await db.query("select public.start_ingestion_run('stock_master', 'cron') as r");
      expect(rows[0].r.started).toBe(true);
      expect(await count()).toBe(before + 1);
      const { rows: snap } = await db.query(
        "select s.run_id, s.stock_count, r.details, s.captured_at = r.started_at as same from public.screening_snapshots s join public.ingestion_runs r on r.id = s.run_id order by s.id desc limit 1",
      );
      expect(snap[0].run_id).toBe(String(rows[0].r.runId));
      expect(snap[0].details).toMatchObject({ snapshot: "captured" });
      expect(snap[0].same, "記録の日時は実行の開始と同じ（同じトランザクション）").toBe(true);
      // 二重実行（実行中の行がある）は始めず、記録も作らない
      const { rows: second } = await db.query("select public.start_ingestion_run('stock_master', 'cron') as r");
      expect(second[0].r.started).toBe(false);
      expect(await count()).toBe(before + 1);
    });
    for (const [target, trigger] of [
      ["stock_master", "manual"],
      ["financials", "cron"],
      ["daily_quotes", "cron"],
      ["edinet_reports", "cron"],
    ]) {
      await rolledBack(async () => {
        const { rows } = await db.query("select public.start_ingestion_run($1, $2) as r", [target, trigger]);
        expect(rows[0].r.started).toBe(true);
        expect(await count(), `${target}・${trigger}`).toBe(before);
        const { rows: run } = await db.query("select details from public.ingestion_runs where id = $1", [rows[0].r.runId]);
        expect(run[0].details).toBeNull();
      });
    }
  });

  it("記録は最新 7 回だけが残る", async () => {
    await seed([good("9S901")]);
    const ids: number[] = [];
    for (let i = 0; i < 8; i += 1) ids.push(await capture());
    const { rows } = await db.query("select id from public.screening_snapshots where id > $1 order by id", [snapshotIdBefore]);
    expect(rows.map((r) => Number(r.id))).toEqual(ids.slice(1));
  });

  it("（R2）記録を強制的に失敗させても実行は始まり、details.snapshot は failed。比較は前回の記録", async () => {
    await seed([good("9S901")]);
    const previous = await capture();
    await rolledBack(async () => {
      await db.query("alter table public.screening_snapshot_stocks add constraint db14_fail_snapshot check (false) not valid");
      const { rows } = await db.query("select public.start_ingestion_run('stock_master', 'cron') as r");
      expect(rows[0].r.started).toBe(true);
      const { rows: run } = await db.query("select status, details from public.ingestion_runs where id = $1", [rows[0].r.runId]);
      expect(run[0]).toEqual({ status: "running", details: { snapshot: "failed" } });
      const { rows: snaps } = await db.query("select max(id)::int as max from public.screening_snapshots");
      expect(snaps[0].max).toBe(previous);
      expect((await changes(params({ off: ["owner"] }))).snapshotId).toBe(previous);
    });
  });

  it("（R5）終了の2つの関数は snapshot・snapshotId を残し、ほかのキーは置き換える。記録の無い実行には現れない", async () => {
    await seed([good("9S901")]);
    const start = async (target = "stock_master", trigger = "cron") =>
      (await db.query("select public.start_ingestion_run($1, $2) as r", [target, trigger])).rows[0].r.runId as number;
    const details = async (id: number) => (await db.query("select details from public.ingestion_runs where id = $1", [id])).rows[0].details;

    // 成功 → complete_stock_master_run（details あり）
    await rolledBack(async () => {
      const id = await start();
      const snapshotId = (await details(id)).snapshotId;
      expect(typeof snapshotId).toBe("number");
      await db.query("select public.complete_stock_master_run($1, '[]'::jsonb, $2::jsonb)", [id, JSON.stringify({ fixture: "x", excluded: { a: 1 }, snapshot: "evil" })]);
      const d = await details(id);
      expect(d).toMatchObject({ fixture: "x", excluded: { a: 1 }, snapshot: "captured", snapshotId });
      expect(Object.keys(d).sort()).toEqual(["delistedDetected", "delistingHeld", "excluded", "fixture", "relisted", "snapshot", "snapshotId"]);
    });
    // 成功 → finish_ingestion_run（p_details あり。p_details の snapshot より開始時の値が勝つ）
    await rolledBack(async () => {
      const id = await start();
      const snapshotId = (await details(id)).snapshotId;
      await db.query("select public.finish_ingestion_run($1, 'failed', 0, 'x', $2::jsonb)", [id, JSON.stringify({ fixture: "x", n: 1, snapshot: "evil" })]);
      expect(await details(id)).toEqual({ fixture: "x", n: 1, snapshot: "captured", snapshotId });
    });
    // p_details が NULL なら details を変えない
    await rolledBack(async () => {
      const id = await start();
      const before = await details(id);
      await db.query("select public.finish_ingestion_run($1, 'failed', 0, 'x', null)", [id]);
      expect(await details(id)).toEqual(before);
    });
    // 失敗の記録 → 両方の終了で failed が残り、snapshotId は無い
    for (const finish of ["complete", "finish"] as const) {
      await rolledBack(async () => {
        await db.query("alter table public.screening_snapshot_stocks add constraint db14_fail_snapshot check (false) not valid");
        const id = await start();
        if (finish === "complete") await db.query("select public.complete_stock_master_run($1, '[]'::jsonb, '{\"fixture\":\"x\"}'::jsonb)", [id]);
        else await db.query("select public.finish_ingestion_run($1, 'failed', 0, 'x', '{\"fixture\":\"x\"}'::jsonb)", [id]);
        const d = await details(id);
        expect(d.snapshot, finish).toBe("failed");
        expect(d.snapshotId, finish).toBeUndefined();
        expect(d.fixture, finish).toBe("x");
      });
    }
    // 記録の無い実行（手動・財務）には現れない
    for (const [target, trigger] of [
      ["stock_master", "manual"],
      ["financials", "cron"],
    ]) {
      await rolledBack(async () => {
        const id = await start(target, trigger);
        await db.query("select public.finish_ingestion_run($1, 'succeeded', 0, null, '{\"fixture\":\"x\"}'::jsonb)", [id]);
        expect(await details(id)).toEqual({ fixture: "x" });
      });
    }
  });
});

describe("判定の1か所（C7-1。R3）", () => {
  // 状態の組み合わせ: 満たす・満たさない・算出不可、上場廃止、市場（0112・0113）、④ の判定不能
  const combos: Seed[] = [
    good("9S901"),
    good("9S902", { cagr: 0.1 }),
    good("9S903", { cagr: null }),
    good("9S904", { margin: 0.05, cagr: null }),
    good("9S905", { firstPrice: "2016-09-26" }),
    good("9S906", { firstPrice: null }),
    good("9S907", { owner: "undeterminable" }),
    good("9S908", { owner: null }),
    good("9S909", { cagr: 0.1, owner: "undeterminable" }),
    good("9S910", { cagr: null, owner: "undeterminable" }),
    good("9S911", { delisted: true, cagr: 0.1 }),
    good("9S912", { market: "0112", cagr: 0.1 }),
    good("9S913", { market: "0112" }),
    good("9S914", { owner: { top: false, total: 25 } }),
    good("9S915", { owner: { top: false, total: 10 }, margin: null }),
    good("9S916", { cagr: undefined, margin: undefined }),
  ];

  const offSets: ConditionKey[][] = [];
  for (let mask = 0; mask < 16; mask += 1) offSets.push(CONDITION_KEYS.filter((_, i) => (mask >> i) & 1));

  it("screening_evaluate の included・screen_stocks の結果・stock_detail の included が一致し、除外の件数は変更前の定義と同じ", async () => {
    await seed(combos);
    let checked = 0;
    for (const off of offSets) {
      for (const includeUnavailable of [false, true]) {
        for (const includeUndeterminable of [false, true]) {
          for (const market of [[], ["0113"]] as ("0113")[][]) {
            const p = params({ off, includeUnavailable, includeUndeterminable, market, sort: "code", order: "asc" });
            const body = JSON.stringify({ ...p, pageSize: 500 });
            const { rows: ev } = await db.query(
              "select code, included, exclusion, s_cagr, s_margin, s_years, s_owner, matches_filters, is_delisted from public.screening_evaluate($1::jsonb) where code like '9S9%' order by code",
              [body],
            );
            const { rows: screened } = await db.query("select public.screen_stocks($1::jsonb) as r", [body]);
            const result = screened[0].r;
            const inResult = result.rows.map((row: { code: string }) => row.code).filter((code: string) => code.startsWith("9S9"));
            expect(inResult, JSON.stringify({ off, includeUnavailable, includeUndeterminable, market })).toEqual(ev.filter((r) => r.included).map((r) => r.code));

            // 変更前の定義（Sprint 12 の screen_stocks の ok_a・ok_b）で求めた除外の件数（全銘柄）
            const { rows: all } = await db.query("select * from public.screening_evaluate($1::jsonb)", [body]);
            const passed = all.filter((r) => !r.is_delisted && r.matches_filters && ![r.s_cagr, r.s_margin, r.s_years, r.s_owner].includes("unmet"));
            const okA = (r: (typeof all)[number]) => r.s_cagr !== "unavailable" && r.s_margin !== "unavailable" && r.s_years !== "unavailable";
            const okB = (r: (typeof all)[number]) => r.s_owner !== "unavailable";
            const exclUnavailable = passed.filter((r) => !includeUnavailable && !okA(r)).length;
            const exclUndet = passed.filter((r) => !includeUndeterminable && (includeUnavailable || okA(r)) && !okB(r)).length;
            expect([result.excludedUnavailable, result.excludedUndeterminable]).toEqual([exclUnavailable, exclUndet]);
            expect(all.filter((r) => r.exclusion === "unavailable").length).toBe(exclUnavailable);
            expect(all.filter((r) => r.exclusion === "undeterminable").length).toBe(exclUndet);

            // stock_detail（組み合わせの一部で）
            if (market.length === 0 && off.length <= 1) {
              for (const r of ev) {
                const { rows: detail } = await db.query("select public.stock_detail($1, $2::jsonb) -> 'evaluation' as e", [r.code, body]);
                expect(detail[0].e.included, `${r.code} ${JSON.stringify(off)}`).toBe(r.included);
                expect(detail[0].e.exclusion).toBe(r.exclusion);
              }
            }
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBe(128);
  }, 120_000);

  it("除外の優先順位と blocking（①〜④の順、妨げている条件をすべて）", async () => {
    await seed(combos);
    const { rows } = await db.query("select code, exclusion, blocking from public.screening_evaluate($1::jsonb) where code like '9S9%'", [
      JSON.stringify(params({ market: ["0113"] })),
    ]);
    const by = Object.fromEntries(rows.map((r) => [r.code, r]));
    expect(by["9S911"]).toMatchObject({ exclusion: "delisted", blocking: [{ condition: "cagr", status: "unmet" }] });
    expect(by["9S912"]).toMatchObject({ exclusion: "filters", blocking: [{ condition: "cagr", status: "unmet" }] });
    expect(by["9S909"]).toMatchObject({ exclusion: "unmet", blocking: [{ condition: "cagr", status: "unmet" }, { condition: "owner", status: "unavailable" }] });
    expect(by["9S910"]).toMatchObject({
      exclusion: "unavailable",
      blocking: [{ condition: "cagr", status: "unavailable" }, { condition: "owner", status: "unavailable" }],
    });
    expect(by["9S907"]).toMatchObject({ exclusion: "undeterminable", blocking: [{ condition: "owner", status: "unavailable" }] });
    expect(by["9S904"]).toMatchObject({ exclusion: "unmet", blocking: [{ condition: "cagr", status: "unavailable" }, { condition: "margin", status: "unmet" }] });
    expect(by["9S901"]).toMatchObject({ exclusion: null, blocking: [] });
    // 含める設定がオンなら、算出不可・判定不能は妨げない
    const { rows: incl } = await db.query("select code, exclusion, blocking from public.screening_evaluate($1::jsonb) where code = '9S910'", [
      JSON.stringify(params({ includeUnavailable: true, includeUndeterminable: true })),
    ]);
    expect(incl[0]).toMatchObject({ exclusion: null, blocking: [] });
  });

  it("記録を今と同じ値で作った直後は、どの条件でも変化が無い", async () => {
    await seed(combos);
    await capture();
    for (const off of offSets) {
      for (const includeUnavailable of [false, true]) {
        const r = await changes(params({ off, includeUnavailable, includeUndeterminable: !includeUnavailable, market: off.length % 2 ? ["0113"] : [] }));
        expect(r.status).toBe("ok");
        expect([ours(r.added), ours(r.removed)], JSON.stringify(off)).toEqual([[], []]);
      }
    }
  });
});

describe("変化の理由（C4-10）", () => {
  it("新規・上場廃止から戻った・市場の変更・算出不可 → 満たす・判定不能 → 満たす・複数・上場廃止だけ", async () => {
    await seed([
      good("9S921", { delisted: true }),
      good("9S922", { market: "0112" }),
      good("9S923", { cagr: null }),
      good("9S924", { owner: "undeterminable" }),
      good("9S925", { cagr: 0.1, margin: 0.05 }),
      good("9S926"),
      good("9S927"),
    ]);
    await capture();
    await seed([good("9S920")]);
    await db.query("update public.stocks set delisted_on = null where code = '9S921'");
    await db.query("update public.stocks set market_code = '0113' where code = '9S922'");
    await setInputs(good("9S923"));
    await setInputs(good("9S924"));
    await setInputs(good("9S925"));
    await setInputs(good("9S926", { cagr: 0.1 }));
    await db.query("update public.stocks set delisted_on = '2026-09-25' where code = '9S926'");
    await setInputs(good("9S927", { cagr: 0.1 }));

    const all = await changes(params());
    expect(reasonKeys(all.added)).toEqual({
      "9S920": ["new_stock"],
      "9S921": ["relisted"],
      "9S923": ["cagr:unavailable>met"],
      "9S924": ["owner:unavailable>met"],
      "9S925": ["cagr:unmet>met", "margin:unmet>met"],
    });
    expect(reasonKeys(all.removed)).toEqual({ "9S926": ["delisted"], "9S927": ["cagr:met>unmet"] });

    // 市場区分の変更は、市場で絞り込んだ条件で filters
    const growth = await changes(params({ market: ["0113"] }));
    expect(reasonKeys(growth.added)["9S922"]).toEqual(["filters"]);
    // 算出不可を含めるなら、算出不可 → 満たす は変化にならない
    const include = await changes(params({ includeUnavailable: true }));
    expect(reasonKeys(include.added)["9S923"]).toBeUndefined();

    // すべての銘柄に理由があり、新たに該当 = 今の結果のうち記録で該当しなかったもの
    for (const r of [all, growth, include]) {
      for (const item of [...r.added, ...r.removed]) expect(item.reasons.length, item.code).toBeGreaterThan(0);
    }
    const { rows: screened } = await db.query("select public.screen_stocks($1::jsonb) as r", [JSON.stringify({ ...params(), pageSize: 500 })]);
    const now = new Set(screened[0].r.rows.map((row: { code: string }) => row.code).filter((c: string) => c.startsWith("9S9")));
    for (const item of ours(all.added)) expect(now.has(item.code)).toBe(true);
    for (const item of ours(all.removed)) expect(now.has(item.code)).toBe(false);
    expect([...now].sort()).toEqual(["9S920", "9S921", "9S922", "9S923", "9S924", "9S925"]);
  });

  it("基準日の変化だけで外れる（記録の側は記録の基準日で判定する）", async () => {
    await seed([good("9S930", { firstPrice: "2021-09-24" })]);
    await capture();
    expect(ours((await changes(params())).removed)).toEqual([]);
    await insertQuotesRun("2026-09-25 20:03+09");
    const r = await changes(params());
    expect(reasonKeys(r.removed)).toEqual({ "9S930": ["years:met>unmet"] });
  });
});

describe("性能（C8。4,000 銘柄、authenticated）", () => {
  it("記録 1,000ms・比較 150ms・スクリーニングの表示の合計 250ms・ウォッチリスト 150ms・ダッシュボード 50ms 以内", async () => {
    await db.query(`
      insert into public.stocks (code, company_name, market_code, market_name, sector33_code, sector33_name, product_category)
      select 'S' || lpad(i::text, 4, '0'), 'DB14性能' || i, (array['0111','0112','0113'])[1 + i % 3], '市場', '5250', '業種', '011'
        from generate_series(0, 3999) i`);
    await db.query(`
      insert into public.financial_metrics (code, revenue_cagr, revenue_cagr_unavailable_reason, operating_margin, operating_margin_unavailable_reason, latest_fiscal_year_end)
      select 'S' || lpad(i::text, 4, '0'), case when i % 13 = 0 then null else (i % 40) / 100.0 end, case when i % 13 = 0 then 'insufficient_periods' end,
             (i % 30) / 100.0, null, '2026-03-31'
        from generate_series(0, 3999) i`);
    await db.query(`
      insert into public.stock_listing_dates (code, first_price_date, data_start_date)
      select 'S' || lpad(i::text, 4, '0'), date '2016-09-27' + (i * 7 % 3600), date '2016-09-26' from generate_series(0, 3999) i where i % 17 <> 0`);
    await db.query(`
      insert into public.ownership_judgments (code, status, president_is_top_holder, owner_total_pct, undeterminable_reason)
      select 'S' || lpad(i::text, 4, '0'), case when i % 11 = 0 then 'undeterminable' else 'determined' end,
             case when i % 11 = 0 then null else i % 3 = 0 end, case when i % 11 = 0 then null else i % 50 end,
             case when i % 11 = 0 then 'president_not_found' end
        from generate_series(0, 3999) i`);
    await db.query("analyze public.stocks, public.financial_metrics, public.stock_listing_dates, public.ownership_judgments");

    const t0 = performance.now();
    await capture();
    const captureMs = performance.now() - t0;

    // 800 銘柄の CAGR を動かす（該当・非該当が入れ替わる。変化は約 200 件）
    await db.query(`update public.financial_metrics set revenue_cagr = case when revenue_cagr >= 0.2 then 0.05 else 0.3 end
                     where code like 'S%' and code::text ~ '^S[0-9]{4}$' and substr(code, 2)::int % 5 = 0 and revenue_cagr is not null`);
    await db.query(
      "insert into public.watchlist_items (user_id, code) select $1, 'S' || lpad(i::text, 4, '0') from generate_series(0, 3999, 8) i",
      [ownerId],
    );
    await db.query("analyze public.financial_metrics, public.watchlist_items");

    const p = JSON.stringify(params({ off: ["owner"] }));
    const median = async (fn: () => Promise<unknown>) => {
      const samples: number[] = [];
      for (let i = 0; i < 6; i += 1) {
        const started = performance.now();
        await asUser(ownerId, async () => fn());
        if (i > 0) samples.push(performance.now() - started);
      }
      return samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)]!;
    };
    const changesMs = await median(() => db.query("select public.screening_changes($1::jsonb)", [p]));
    const screenMs = await median(async () => {
      const { rows } = await db.query("select public.screen_stocks($1::jsonb) as r", [p]);
      await db.query("select public.screening_changes($1::jsonb)", [p]);
      const codes = rows[0].r.rows.map((row: { code: string }) => row.code);
      await db.query("select code from public.watchlist_items where code = any($1::text[])", [codes]);
    });
    const watchlistMs = await median(() => db.query("select public.watchlist_entries($1::jsonb)", [p]));
    const dashboardMs = await median(() => db.query("select public.dashboard_summary()"));
    const { rows: changed } = await asUser(ownerId, () => db.query("select public.screening_changes($1::jsonb) as r", [p]));
    const changedCount = changed[0].r.added.length + changed[0].r.removed.length;
    const { rows: entries } = await asUser(ownerId, () => db.query("select jsonb_array_length(public.watchlist_entries($1::jsonb)) as n", [p]));
    await db.query("delete from public.watchlist_items where user_id = $1 and code like 'S%'", [ownerId]);

    console.log(
      `[性能] 記録 ${captureMs.toFixed(1)}ms、比較 ${changesMs.toFixed(1)}ms（変化 ${changedCount} 件）、スクリーニングの表示の合計 ${screenMs.toFixed(1)}ms、` +
        `ウォッチリスト ${watchlistMs.toFixed(1)}ms（${entries[0].n} 件）、ダッシュボード ${dashboardMs.toFixed(1)}ms`,
    );
    expect(changedCount).toBeGreaterThan(100);
    expect(entries[0].n).toBe(500);
    expect(captureMs).toBeLessThan(1000);
    expect(changesMs).toBeLessThan(150);
    expect(screenMs).toBeLessThan(250);
    expect(watchlistMs).toBeLessThan(150);
    expect(dashboardMs).toBeLessThan(50);
  }, 120_000);
});
