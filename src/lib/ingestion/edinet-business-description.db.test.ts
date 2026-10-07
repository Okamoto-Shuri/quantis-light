/**
 * EDINET の取り込みのうち、事業の内容（Sprint 16。F16）の結合テスト（契約の C8）。
 * 外部 API（fetch）と時計だけを差し替え、ローカルの DB に実際に書き込む。
 * 実行: pnpm test:db（pnpm db:reset 直後の DB。銘柄マスタ・EDINET の書類にテスト以外の行が無いこと）
 * テストの銘柄コードは 9R9xx、書類IDは S16DB…、提出者は E9R…。時計は 2007-07-01 0:00 JST（一覧の期間は 2006-04-07〜2007-07-01）。
 * 後片付けでは、それらと list_date が 2006〜2007 年の取得済みの日、作った ingestion_runs の行、テストの手動補正だけを消す。
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { strToU8, zipSync } from "fflate";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { createAdminClient } = await import("@/lib/supabase/admin");
const { executeIngestionRun, startIngestionRun } = await import("./runner");
const synthetic = await import("./edinet/__fixtures__/synthetic");

const DB_URL = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const KEY = "edinet-bd-db-test-KEY-5e90";
/** 実行日: 2007-07-01 0:00 JST */
const RUN_AT = Date.parse("2007-06-30T15:00:00Z");

const db = new Client({ connectionString: DB_URL });
let admin: SupabaseClient;
let firstRunId = 0;
let ownerId = "";

type ListRow = Record<string, unknown>;

function row(docID: string, overrides: ListRow = {}): ListRow {
  return {
    seqNumber: 1,
    docID,
    edinetCode: "E9R901",
    secCode: "9R901",
    JCN: null,
    filerName: "事業内容テスト株式会社",
    fundCode: null,
    ordinanceCode: "010",
    formCode: "030000",
    docTypeCode: "120",
    periodStart: "2006-04-01",
    periodEnd: "2007-03-31",
    submitDateTime: "2007-06-26 15:00",
    docDescription: "有価証券報告書",
    parentDocID: null,
    opeDateTime: null,
    withdrawalStatus: "0",
    docInfoEditStatus: "0",
    disclosureStatus: "0",
    xbrlFlag: "1",
    ...overrides,
  };
}

function listBody(date: string, results: ListRow[]) {
  return {
    metadata: { title: "提出された書類を把握するための API", parameter: { date, type: "2" }, resultset: { count: results.length }, status: "200", message: "OK" },
    results: results.map((r, i) => ({ ...r, seqNumber: i + 1 })),
  };
}

/** 書類取得 API の ZIP（本文のインライン XBRL を章ごとに入れる）。 */
function documentZip(...htmls: string[]) {
  const files: Record<string, Uint8Array> = {
    "XBRL/PublicDoc/0000000_header_jpcrp-001_E9R900-000_2007-03-31_01_2007-06-26_ixbrl.htm": strToU8(synthetic.ixbrlDocument({ contexts: [], body: "<p>表紙</p>" })),
  };
  htmls.forEach((html, i) => {
    files[`XBRL/PublicDoc/010${i + 1}010_honbun_jpcrp-001_E9R900-000_2007-03-31_01_2007-06-26_ixbrl.htm`] = strToU8(html);
  });
  return zipSync(files);
}

/** 大株主1名・役員1名の区画。 */
function annualHtml(name = "山田　太郎") {
  return synthetic.ixbrlDocument({
    contexts: [synthetic.shareholderContext(1), synthetic.officerContext("YamadaTaroMember")],
    body: `<table>${synthetic.shareholderRow(1, name, "東京都", "3,210", "32.10")}</table><table>${synthetic.officerRow(
      "YamadaTaroMember",
      "<p>代表取締役社長</p>",
      name,
    )}</table>`,
  });
}

/** 主要な経営指標等（売上高1期。百万円）。 */
function businessHtml(sales: string) {
  return synthetic.ixbrlDocument({
    contexts: [synthetic.yearContext("CurrentYearDuration", "2006-04-01", "2007-03-31")],
    body: `<table><tr><td>${synthetic.amount("NetSalesSummaryOfBusinessResults", "CurrentYearDuration", sales)}</td></tr></table>`,
  });
}

const descriptionHtml = (paragraph: string) => synthetic.businessDescriptionDocument(`<p>(1) 事業の概要</p><p>　${paragraph}</p><p>次の段落です。</p>`);

function fakeClock(start = RUN_AT) {
  let now = start;
  return { clock: { now: () => now, sleep: async (ms: number) => void (now += ms) } };
}

function fakeEdinet(lists: Record<string, ListRow[]>, documents: Record<string, Uint8Array>) {
  const calls: { path: string }[] = [];
  const fetchImpl = vi.fn(async (input: string) => {
    const url = new URL(input);
    calls.push({ path: url.pathname });
    if (url.pathname === "/api/v2/documents.json") {
      const date = url.searchParams.get("date")!;
      return new Response(JSON.stringify(listBody(date, lists[date] ?? [])), { headers: { "content-type": "application/json" } });
    }
    const id = url.pathname.split("/").at(-1)!;
    const doc = documents[id];
    if (!doc) return new Response(JSON.stringify({ metadata: { status: "404", message: "Not Found" } }), { headers: { "content-type": "application/json" } });
    return new Response(new Blob([doc as Uint8Array<ArrayBuffer>]), { headers: { "content-type": "application/octet-stream" } });
  });
  return { fetchImpl, calls };
}

async function ingest(lists: Record<string, ListRow[]>, documents: Record<string, Uint8Array>, { deadlineMs = 10_000_000 } = {}) {
  const clock = fakeClock();
  const edinet = fakeEdinet(lists, documents);
  const start = await startIngestionRun(admin, "edinet_reports", "manual");
  if (!start.started) throw new Error("実行中の実行が残っています");
  const outcome = await executeIngestionRun(start.runId, "edinet_reports", {
    admin,
    fetchImpl: edinet.fetchImpl,
    env: { EDINET_API_KEY: KEY },
    clock: clock.clock,
    requestDeadline: clock.clock.now() + deadlineMs,
  });
  const { rows } = await db.query(
    "select status, processed_count, error_message, details, remaining_count, remaining_unit, stopped_reason from public.ingestion_runs where id = $1",
    [start.runId],
  );
  return { outcome, calls: edinet.calls, row: rows[0] };
}

const docCalls = (calls: { path: string }[]) => calls.filter((c) => c.path.startsWith("/api/v2/documents/")).map((c) => c.path.split("/").at(-1));

async function insertStock(code: string) {
  await db.query(
    `insert into public.stocks (code, company_name, market_code, market_name, sector33_code, sector33_name, product_category)
     values ($1, $2, '0113', 'グロース', '5250', '情報・通信業', '011') on conflict do nothing`,
    [code, `事業内容テスト${code}株式会社`],
  );
}

/** 一覧の期間の古い日を取得済みにする（直近7日は毎回取り直す）。一覧の取得を短くするため。 */
async function markListFetched() {
  await db.query(
    `insert into public.edinet_list_fetched_dates (list_date)
     select d::date from generate_series('2006-04-07'::date, '2007-06-24'::date, '1 day') d on conflict do nothing`,
  );
}

/** 導入前に、大株主・役員と主要な経営指標等を処理済みの有報（事業の内容は未処理）。 */
async function insertProcessedReport(code: string, docId: string, name: string, sales: number) {
  await insertStock(code);
  await db.query(
    `insert into public.edinet_documents (doc_id, sec_code, edinet_code, filer_name, doc_type_code, ordinance_code, form_code, period_start,
       period_end, submitted_at, parent_doc_id, withdrawn, withheld, xbrl_available, list_date)
     values ($1, $2, 'E9R' || $2, '導入前テスト', '120', '010', '030000', '2006-04-01', '2007-03-31', '2007-06-20 15:00+09', null, false, false, true, '2007-06-20')`,
    [docId, code],
  );
  await db.query(
    `insert into public.annual_report_extractions (doc_id, processed_at, shareholders_status, officers_status, officers_basis, officers_order_source)
     values ($1, '2007-06-21 10:00+09', 'ok', 'ok', 'filing_date', 'inline_document')`,
    [docId],
  );
  await db.query(
    `insert into public.annual_report_shareholders (doc_id, rank, name, address, shares_held, ratio_pct, ratio_decimals)
     values ($1, 1, $2, '東京都', 3000000, 30.00, 2), ($1, 2, '日本マスタートラスト信託銀行株式会社（信託口）', '東京都', 500000, 5.00, 2)`,
    [docId, name],
  );
  await db.query(`insert into public.annual_report_officers (doc_id, seq, name, title) values ($1, 1, $2, '代表取締役社長')`, [docId, name]);
  await db.query(
    `insert into public.business_results_extractions (doc_id, processed_at, status, period_count) values ($1, '2007-06-21 10:00+09', 'ok', 1)`,
    [docId],
  );
  await db.query(
    `insert into public.business_results_periods (doc_id, fiscal_year_start, fiscal_year_end, consolidated, accounting_standard, net_sales, revenue_element)
     values ($1, '2002-04-01', '2003-03-31', true, 'JP', $2, 'NetSalesSummaryOfBusinessResults')`,
    [docId, sales],
  );
}

/** 決算短信の通期（億円）。 */
async function insertStatements(code: string, periods: [start: string, end: string, sales: number][]) {
  for (const [i, [start, end, sales]] of periods.entries()) {
    await db.query(
      `insert into public.financial_statements (code, disclosure_no, disclosed_date, disclosed_time, document_type, fiscal_year_start, fiscal_year_end, net_sales, operating_profit)
       values ($1, $2, $3::date + 45, '15:00', 'FYFinancialStatements_Consolidated_JP', $4, $3, $5, $6)`,
      [code, `S16DBT${code}${i}`, end, start, sales * 1e8, sales * 1e7],
    );
  }
}

/** 導入の前後で変わらないはずの値（契約の C8-1）。 */
async function snapshot(codes: string[]) {
  const q = async (text: string) => (await db.query(text, [codes])).rows;
  const json = (table: string, key: string) =>
    q(`select to_jsonb(t) as r from public.${table} t where t.doc_id in (select doc_id from public.edinet_documents where sec_code = any($1)) order by ${key}`);
  const owner = async () => {
    await db.query("begin");
    try {
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ownerId, role: "authenticated" })]);
      const { rows } = await db.query(
        `select public.screen_stocks('{"cagr":"0","margin":"0","years":"100","owner":"20","ownerMode":"any","includeUnavailable":true,"includeUndeterminable":true,"sort":"code","order":"asc","page":1,"pageSize":100}'::jsonb) as s`,
      );
      return rows[0].s;
    } finally {
      await db.query("rollback");
    }
  };
  return {
    detail: await q(`select public.annual_report_detail(c) as d from unnest($1::text[]) c order by c`),
    extractions: await json("annual_report_extractions", "t.doc_id"),
    shareholders: await json("annual_report_shareholders", "t.doc_id, t.rank"),
    officers: await json("annual_report_officers", "t.doc_id, t.seq"),
    businessExtractions: await json("business_results_extractions", "t.doc_id"),
    businessPeriods: await json("business_results_periods", "t.doc_id, t.fiscal_year_end"),
    periods: await q(`select to_jsonb(p) as r from public.financial_periods p where p.code = any($1) order by p.code, p.fiscal_year_end`),
    metrics: await q(`select to_jsonb(m) as r from public.financial_metrics m where m.code = any($1) order by m.code`),
    judgments: await q(`select to_jsonb(j) as r from public.ownership_judgments j where j.code = any($1) order by j.code`),
    classifications: await q(`select to_jsonb(c) as r from public.ownership_holder_classifications c where c.code = any($1) order by c.code, c.rank`),
    overrides: await q(`select to_jsonb(o) as r from public.ownership_overrides o where o.code = any($1) order by o.code`),
    screening: await owner(),
  };
}

async function descriptions() {
  const { rows } = await db.query(
    `select doc_id, status, detail, paragraph, processed_at from public.business_description_extractions where doc_id like 'S16DB%' order by doc_id`,
  );
  return rows;
}

async function cleanup() {
  await db.query("delete from public.ownership_overrides where code like '9R9%'");
  await db.query("delete from public.edinet_documents where doc_id like 'S16DB%'");
  await db.query("delete from public.edinet_filers where edinet_code like 'E9R9%'");
  await db.query("delete from public.edinet_list_fetched_dates where list_date between '2006-01-01' and '2007-12-31'");
  await db.query("delete from public.financial_statements where code like '9R9%'");
  await db.query("delete from public.stocks where code like '9R9%'");
}

beforeAll(async () => {
  await db.connect();
  admin = createAdminClient();
  const { rows: running } = await db.query("select count(*)::int as n from public.ingestion_runs where status = 'running'");
  if (running[0].n > 0) throw new Error("実行中の実行が残っているため、結合テストを始められません");
  const { rows: others } = await db.query(
    `select (select count(*) from public.stocks where code not like '9R9%')::int
          + (select count(*) from public.edinet_documents where doc_id not like 'S16DB%')::int
          + (select count(*) from public.edinet_list_fetched_dates where list_date not between '2006-01-01' and '2007-12-31')::int as n`,
  );
  if (others[0].n > 0) {
    throw new Error("テスト以外の銘柄・EDINET の書類・一覧の取得済みの日があるため、結合テストを始められません（pnpm db:reset 直後の DB で実行してください）");
  }
  const { rows: users } = await db.query("select id::text from auth.users where email = 'owner@quantis.local'");
  ownerId = users[0]?.id ?? "";
  if (!ownerId) throw new Error("評価用ユーザーがいません（pnpm seed:users を実行してください）");
  const { rows: seq } = await db.query("select coalesce(max(id), 0)::bigint + 1 as next from public.ingestion_runs");
  firstRunId = Number(seq[0].next);
  await cleanup();
});

beforeEach(async () => {
  await markListFetched();
});

afterEach(async () => {
  await cleanup();
  await db.query("delete from public.ingestion_runs where id >= $1", [firstRunId]);
});

afterAll(async () => {
  await cleanup();
  await db.query("delete from public.ingestion_runs where id >= $1", [firstRunId]);
  await db.end();
});

describe("事業の内容の取り込み（DB 込み。契約の C8）", () => {
  it("C8-1・C8-2: 導入前に処理済みの有報は事業の内容だけを読み、ほかの値は導入の前後で変わらない。2回目は取り直さない", async () => {
    await insertProcessedReport("9R901", "S16DB0001", "山田　太郎", 50e8);
    await insertProcessedReport("9R902", "S16DB0002", "佐藤　花子", 60e8);
    await insertProcessedReport("9R903", "S16DB0003", "鈴木　一郎", 70e8);
    await insertStatements("9R901", [
      ["2003-04-01", "2004-03-31", 100],
      ["2004-04-01", "2005-03-31", 110],
      ["2005-04-01", "2006-03-31", 120],
      ["2006-04-01", "2007-03-31", 130],
    ]);
    await db.query(
      `insert into public.ownership_overrides (user_id, code, verdict, memo) values ($1, '9R902', 'owner_company', '導入前の補正のメモ')`,
      [ownerId],
    );
    const codes = ["9R901", "9R902", "9R903"];
    const before = await snapshot(codes);
    expect(before.judgments).toHaveLength(3);
    expect(before.overrides).toHaveLength(1);
    expect((before.metrics[0].r as { code: string }).code).toBe("9R901");
    // 比べる値が空でないこと（スクリーニングの結果に3銘柄、大株主・役員の詳細・期が入っている）
    expect(JSON.stringify(before.screening)).toContain("9R902");
    expect(before.detail.every((d) => d.d !== null)).toBe(true);
    expect(before.businessPeriods).toHaveLength(3);
    expect(before.classifications.length).toBeGreaterThan(0);

    const documents = {
      S16DB0001: documentZip(annualHtml("別人　一号"), businessHtml("9,999"), synthetic.readBusinessDescriptionFixture("S100W7OT")),
      S16DB0002: documentZip(annualHtml("別人　二号"), descriptionHtml("当社は、検証用の二番目の会社であります。")),
      S16DB0003: documentZip(descriptionHtml("当社グループは、検証用の三番目の会社で構成されております。")),
    };
    const first = await ingest({}, documents);
    expect(first.row.status).toBe("succeeded");
    expect(first.row.processed_count).toBe(3);
    expect(first.row.details.businessDescription).toEqual({ ok: 3 });
    expect(first.row.details.documentsTargetedByKind).toEqual({ annualReport: 0, businessResults: 0, businessDescription: 3 });
    expect(docCalls(first.calls).sort()).toEqual(["S16DB0001", "S16DB0002", "S16DB0003"]);
    expect((await descriptions()).map((d) => [d.doc_id, d.status, d.paragraph])).toEqual([
      ["S16DB0001", "ok", "当社グループ（当社及び当社の関係会社）は、当社（株式会社ニップン）及び子会社58社、関連会社20社で構成されております。"],
      ["S16DB0002", "ok", "当社は、検証用の二番目の会社であります。"],
      ["S16DB0003", "ok", "当社グループは、検証用の三番目の会社で構成されております。"],
    ]);
    // 大株主・役員・主要な経営指標等・指標・判定・補正・スクリーニングは変わらない（ZIP の中の別の値は読まない）
    expect(await snapshot(codes)).toEqual(before);

    const second = await ingest({}, documents);
    expect(docCalls(second.calls)).toEqual([]);
    expect(second.row.processed_count).toBe(0);
    expect(second.row.status).toBe("succeeded");
  });

  it("C8-3・C8-4・C8-5: 新しい有報は1回の要求で3つの処理を行う。大株主・役員だけ未処理なら事業の内容は書き換えない。届出書は対象外", async () => {
    await insertStock("9R901");
    await insertStock("9R904");
    // 9R904: 事業の内容と主要な経営指標等は処理済み、大株主・役員だけ未処理
    await db.query(
      `insert into public.edinet_documents (doc_id, sec_code, edinet_code, doc_type_code, ordinance_code, form_code, period_start, period_end,
         submitted_at, withdrawn, withheld, xbrl_available, list_date)
       values ('S16DB0004', '9R904', 'E9R904', '120', '010', '030000', '2006-04-01', '2007-03-31', '2007-06-20 15:00+09', false, false, true, '2007-06-20'),
              ('S16DB0005', '9R904', 'E9R904', '030', '010', '020000', null, null, '2007-06-22 15:00+09', false, false, true, '2007-06-22')`,
    );
    await db.query(
      `insert into public.business_description_extractions (doc_id, processed_at, status, paragraph) values ('S16DB0004', '2007-06-21 10:00+09', 'ok', '処理済みの段落です。')`,
    );
    await db.query(`insert into public.business_results_extractions (doc_id, processed_at, status) values ('S16DB0004', '2007-06-21 10:00+09', 'section_not_found')`);

    const { rows: state } = await db.query("select public.edinet_ingestion_state('2006-04-07', '2007-07-01') as s");
    const targets = state[0].s.targets as { docId: string; needsAnnualReport: boolean; needsBusinessDescription: boolean }[];
    expect(targets.find((t) => t.docId === "S16DB0004")).toMatchObject({ needsAnnualReport: true, needsBusinessDescription: false });
    // 届出書（030）は事業の内容の対象にしない
    expect(targets.filter((t) => t.docId === "S16DB0005").every((t) => t.needsBusinessDescription === false)).toBe(true);

    const lists = { "2007-06-26": [row("S16DB0006")] };
    const documents = {
      S16DB0004: documentZip(annualHtml(), descriptionHtml("取り直されてはいけない段落です。")),
      S16DB0005: documentZip(synthetic.ixbrlDocument({ contexts: [], body: "<p>届出書</p>" })),
      S16DB0006: documentZip(annualHtml(), businessHtml("1,234"), descriptionHtml("当社は、新しい有報の会社であります。")),
    };
    const result = await ingest(lists, documents);
    expect(docCalls(result.calls).filter((d) => d === "S16DB0006")).toHaveLength(1);
    const { rows } = await db.query(
      `select d.doc_id, a.shareholders_status as annual, b.status as business, e.status as description, e.paragraph, e.processed_at
         from public.edinet_documents d
         left join public.annual_report_extractions a on a.doc_id = d.doc_id
         left join public.business_results_extractions b on b.doc_id = d.doc_id
         left join public.business_description_extractions e on e.doc_id = d.doc_id
        where d.doc_id in ('S16DB0004', 'S16DB0005', 'S16DB0006') order by d.doc_id`,
    );
    expect(rows.map((r) => [r.doc_id, r.annual, r.business, r.description, r.paragraph])).toEqual([
      ["S16DB0004", "ok", "section_not_found", "ok", "処理済みの段落です。"],
      ["S16DB0005", null, expect.anything(), null, null],
      ["S16DB0006", "ok", "ok", "ok", "当社は、新しい有報の会社であります。"],
    ]);
    expect(new Date(rows[0].processed_at).toISOString()).toBe(new Date("2007-06-21T01:00:00Z").toISOString());
  });

  it("C8-6: 期限で処理されなかった書類は残りに数え、次の実行で処理される", async () => {
    for (let i = 1; i <= 6; i++) await insertProcessedReport(`9R91${i}`, `S16DB01${i}`, `期限　${i}郎`, 10e8);
    const documents = Object.fromEntries(
      Array.from({ length: 6 }, (_, k) => [`S16DB01${k + 1}`, documentZip(descriptionHtml(`当社は、期限のテストの${k + 1}番目の会社であります。`))]),
    );
    // 直近7日の一覧（7回）の後、本文を数通だけ始められる期限
    const first = await ingest({}, documents, { deadlineMs: 9_500 });
    expect(first.row.status).toBe("partial");
    expect(first.row.stopped_reason).toBe("time_budget");
    expect(first.row.processed_count).toBeGreaterThan(0);
    expect(first.row.processed_count).toBeLessThan(6);
    expect(first.row.remaining_unit).toBe("documents");
    expect(first.row.remaining_count).toBe(6 - first.row.processed_count);
    const second = await ingest({}, documents);
    expect(second.row.processed_count).toBe(6 - first.row.processed_count);
    expect((await descriptions()).filter((d) => d.status === "ok")).toHaveLength(6);
  });

  it("C8-7（R1）: 訂正有報に区画が無ければ section_not_found、元の有報の段落を使い fallback。大株主・役員の区画の選択は従来どおり", async () => {
    await insertStock("9R901");
    const lists = {
      "2007-06-26": [row("S16DB0021")],
      "2007-06-28": [
        row("S16DB0022", { docTypeCode: "130", formCode: "030001", periodStart: null, periodEnd: null, parentDocID: "S16DB0021", submitDateTime: "2007-06-28 15:00" }),
      ],
    };
    const original = "当社グループは、訂正のテストの元の有報の会社であります。";
    const documents = {
      S16DB0021: documentZip(annualHtml("元有報　太郎"), descriptionHtml(original)),
      // 訂正: 大株主・役員はあるが、DescriptionOfBusinessTextBlock が無い
      S16DB0022: documentZip(annualHtml("訂正　太郎")),
    };
    const result = await ingest(lists, documents);
    expect(result.row.status).toBe("succeeded");
    expect((await descriptions()).map((d) => [d.doc_id, d.status, d.paragraph])).toEqual([
      ["S16DB0021", "ok", original],
      ["S16DB0022", "section_not_found", null],
    ]);
    const { rows } = await db.query("select public.business_description_detail('9R901') as d");
    expect(rows[0].d).toMatchObject({
      status: "ok",
      paragraph: original,
      fallback: true,
      document: { doc_id: "S16DB0021" },
      latest: { doc_id: "S16DB0022", status: "section_not_found" },
    });
    const { rows: sections } = await db.query(
      "select shareholders_doc_id, officers_doc_id from public.annual_report_sections where code = '9R901'",
    );
    expect(sections[0]).toEqual({ shareholders_doc_id: "S16DB0022", officers_doc_id: "S16DB0022" });
  });
});
