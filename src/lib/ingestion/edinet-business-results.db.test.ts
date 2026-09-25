/**
 * EDINET の取り込みのうち、主要な経営指標等の推移（上場前の期の補完。Sprint 9）の結合テスト（契約の C6）。
 * 外部 API（fetch）と時計だけを差し替え、ローカルの DB に実際に書き込む。
 * 実行: pnpm test:db（pnpm db:reset 直後の DB。銘柄マスタ・EDINET の書類にテスト以外の行が無いこと）
 * テストの銘柄コードは 9V9xx、書類IDは S9DB…、提出者は E9DB…。時計は 2004-07-01 0:00 JST（一覧の期間は 2003-04-08〜2004-07-01）。
 * 後片付けでは、それらと list_date が 2003〜2004 年の取得済みの日、作った ingestion_runs の行だけを消す。
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
const KEY = "edinet-br-db-test-KEY-7c21";
/** 実行日: 2004-07-01 0:00 JST */
const RUN_AT = Date.parse("2004-06-30T15:00:00Z");

const db = new Client({ connectionString: DB_URL });
let admin: SupabaseClient;
let firstRunId = 0;

type ListRow = Record<string, unknown>;

function row(docID: string, overrides: ListRow = {}): ListRow {
  return {
    seqNumber: 1,
    docID,
    edinetCode: "E9DB02",
    secCode: "9V902",
    JCN: null,
    filerName: "補完テスト株式会社",
    fundCode: null,
    ordinanceCode: "010",
    formCode: "030000",
    docTypeCode: "120",
    periodStart: "2003-04-01",
    periodEnd: "2004-03-31",
    submitDateTime: "2004-06-25 15:00",
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

const ipo = (docID: string, overrides: ListRow = {}) =>
  row(docID, { edinetCode: "E9DB01", secCode: null, docTypeCode: "030", formCode: "020400", periodStart: null, periodEnd: null, filerName: "上場準備株式会社", ...overrides });

function listBody(date: string, results: ListRow[]) {
  return {
    metadata: { title: "提出された書類を把握するための API", parameter: { date, type: "2" }, resultset: { count: results.length }, status: "200", message: "OK" },
    results: results.map((r, i) => ({ ...r, seqNumber: i + 1 })),
  };
}

/** 書類取得 API の ZIP（本文のインライン XBRL を複数入れられる）。 */
function documentZip(...htmls: string[]) {
  const files: Record<string, Uint8Array> = {
    "XBRL/PublicDoc/0000000_header_jpcrp-001_E9DB00-000_2004-03-31_01_2004-06-25_ixbrl.htm": strToU8(synthetic.ixbrlDocument({ contexts: [], body: "<p>表紙</p>" })),
    "XBRL/AuditDoc/jpaud-aar-cc-001_E9DB00-000_2004-03-31_01_2004-06-25_ixbrl.htm": strToU8("<html>監査報告書</html>"),
  };
  htmls.forEach((html, i) => {
    files[`XBRL/PublicDoc/010${i + 1}010_honbun_jpcrp-001_E9DB00-000_2004-03-31_01_2004-06-25_ixbrl.htm`] = strToU8(html);
  });
  return zipSync(files);
}

/** 主要な経営指標等の推移（売上高。億円で書き、百万円の表示で入れる）。 */
function businessHtml(periods: { id: string; start: string; end: string; sales: number; nonConsolidated?: boolean }[]) {
  return synthetic.ixbrlDocument({
    contexts: periods.map((p) => synthetic.yearContext(p.id, p.start, p.end, { nonConsolidated: p.nonConsolidated })),
    body: `<h3>主要な経営指標等の推移</h3><table><tr>${periods
      .map(
        (p) =>
          `<td>${synthetic.amount("NetSalesSummaryOfBusinessResults", p.nonConsolidated ? `${p.id}_NonConsolidatedMember` : p.id, (p.sales * 100).toLocaleString("en-US"))}</td>`,
      )
      .join("")}</tr></table>`,
  });
}

/** 大株主1名・役員1名の有報の区画。 */
function annualHtml(prefix = "") {
  return synthetic.ixbrlDocument({
    contexts: [synthetic.shareholderContext(1), synthetic.officerContext("YamadaTaroMember")],
    body: `<table>${synthetic.shareholderRow(1, `${prefix}山田　太郎`, "東京都", "3,210", "32.10")}</table><table>${synthetic.officerRow(
      "YamadaTaroMember",
      "<p>代表取締役社長</p>",
      `${prefix}山田　太郎`,
    )}</table>`,
  });
}

function fakeClock(start = RUN_AT) {
  let now = start;
  return { clock: { now: () => now, sleep: async (ms: number) => void (now += ms) } };
}

function fakeEdinet(lists: Record<string, ListRow[]>, documents: Record<string, Uint8Array>) {
  const calls: { path: string; date: string | null }[] = [];
  const fetchImpl = vi.fn(async (input: string) => {
    const url = new URL(input);
    calls.push({ path: url.pathname, date: url.searchParams.get("date") });
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
  const { rows } = await db.query("select status, processed_count, error_message, details from public.ingestion_runs where id = $1", [start.runId]);
  return { outcome, calls: edinet.calls, row: rows[0] };
}

const docCalls = (calls: { path: string }[]) => calls.filter((c) => c.path.startsWith("/api/v2/documents/")).map((c) => c.path.split("/").at(-1));
const listCalls = (calls: { path: string }[]) => calls.filter((c) => c.path === "/api/v2/documents.json").length;

async function insertStock(code: string) {
  await db.query(
    `insert into public.stocks (code, company_name, market_code, market_name, sector33_code, sector33_name, product_category)
     values ($1, $2, '0113', 'グロース', '5250', '情報・通信業', '011') on conflict do nothing`,
    [code, `補完テスト${code}株式会社`],
  );
}

/** 決算短信の通期（億円）。 */
async function insertStatements(code: string, periods: [start: string, end: string, sales: number][]) {
  for (const [i, [start, end, sales]] of periods.entries()) {
    await db.query(
      `insert into public.financial_statements (code, disclosure_no, disclosed_date, disclosed_time, document_type, fiscal_year_start, fiscal_year_end, net_sales, operating_profit)
       values ($1, $2, $3::date + 45, '15:00', 'FYFinancialStatements_Consolidated_JP', $4, $3, $5, $6)`,
      [code, `S9DBT${code}${i}`, end, start, sales * 1e8, sales * 1e7],
    );
  }
}

async function metrics(code: string) {
  const { rows } = await db.query(
    `select revenue_cagr::text, revenue_cagr_unavailable_reason, revenue_cagr_supplemented, revenue_cagr_mixed_consolidation, revenue_cagr_period_sources,
            calculated_at from public.financial_metrics where code = $1`,
    [code],
  );
  return rows[0];
}

async function extractions() {
  const { rows } = await db.query(
    `select d.doc_id, b.status as business, a.shareholders_status as annual
       from public.edinet_documents d
       left join public.business_results_extractions b on b.doc_id = d.doc_id
       left join public.annual_report_extractions a on a.doc_id = d.doc_id
      where d.doc_id like 'S9DB%' order by d.doc_id`,
  );
  return rows;
}

// ---------------------------------------------------------------------------
// 一覧と書類
// ---------------------------------------------------------------------------

/** 新規公開の届出書（連結2期・提出会社3期。千円ではなく百万円の組み立て） */
const IPO_HTML = businessHtml([
  { id: "Prior5YearDuration", start: "1998-04-01", end: "1999-03-31", sales: 80, nonConsolidated: true },
  { id: "Prior4YearDuration", start: "1999-04-01", end: "2000-03-31", sales: 100, nonConsolidated: true },
  { id: "Prior3YearDuration", start: "2000-04-01", end: "2001-03-31", sales: 150, nonConsolidated: true },
  { id: "Prior2YearDuration", start: "2001-04-01", end: "2002-03-31", sales: 190, nonConsolidated: true },
  { id: "Prior2YearDuration", start: "2001-04-01", end: "2002-03-31", sales: 200 },
  { id: "Prior1YearDuration", start: "2002-04-01", end: "2003-03-31", sales: 300 },
]);

const LISTS: Record<string, ListRow[]> = {
  // 9V901: 上場前の届出書（証券コードなし）と、価格の決定の訂正届出書（経営指標の記載なし）
  "2004-02-10": [ipo("S9DB0001", { submitDateTime: "2004-02-10 15:00" })],
  "2004-02-25": [ipo("S9DB0002", { docTypeCode: "040", formCode: "020401", parentDocID: "S9DB0001", submitDateTime: "2004-02-25 15:00" })],
  // 9V901 の上場後の半期報告書（保存しない種類）: 提出者と証券コードの対応を作る
  "2004-06-20": [row("S9DB00H1", { edinetCode: "E9DB01", secCode: "9V901", docTypeCode: "160", formCode: "043A00", submitDateTime: "2004-06-20 15:00" })],
  // 9V902: 有報（主要な経営指標等と大株主・役員）と、訂正有報（大株主・役員だけ）
  "2004-06-25": [row("S9DB0003")],
  "2004-06-26": [row("S9DB0004", { docTypeCode: "130", formCode: "030001", periodStart: null, periodEnd: null, parentDocID: "S9DB0003", submitDateTime: "2004-06-26 15:00" })],
  // 9V903: 上場会社の参照方式の届出書（経営指標の記載なし）
  "2004-06-27": [row("S9DB0005", { edinetCode: "E9DB03", secCode: "9V903", docTypeCode: "030", formCode: "020000", periodStart: null, periodEnd: null, submitDateTime: "2004-06-27 15:00" })],
};

const DOCUMENTS: Record<string, Uint8Array> = {
  S9DB0001: documentZip(IPO_HTML),
  S9DB0002: documentZip(synthetic.ixbrlDocument({ contexts: [], body: "<p>【訂正事項】発行価格の決定</p>" })),
  // 9V902 の有報: 決算短信と同じ期（決算短信が優先）と、決算短信に無い古い期
  S9DB0003: documentZip(
    businessHtml([
      { id: "Prior4YearDuration", start: "1999-04-01", end: "2000-03-31", sales: 999 },
      { id: "CurrentYearDuration", start: "2003-04-01", end: "2004-03-31", sales: 888 },
    ]),
    annualHtml(),
  ),
  S9DB0004: documentZip(annualHtml("訂正")),
  S9DB0005: documentZip(synthetic.ixbrlDocument({ contexts: [], body: "<p>第三部【参照情報】</p>" })),
};

async function setupStocks() {
  for (const code of ["9V901", "9V902", "9V903"]) await insertStock(code);
  // 9V901: 上場後の決算短信は2期（2004/03・2005/03 ではなく 2003/03 を含まない）→ 期が足りない
  await insertStatements("9V901", [["2003-04-01", "2004-03-31", 400]]);
  // 9V902: 決算短信5期（算出済み）
  await insertStatements("9V902", [
    ["1999-04-01", "2000-03-31", 100],
    ["2000-04-01", "2001-03-31", 110],
    ["2001-04-01", "2002-03-31", 120],
    ["2002-04-01", "2003-03-31", 130],
    ["2003-04-01", "2004-03-31", 140],
  ]);
}

async function cleanup() {
  await db.query("delete from public.edinet_documents where doc_id like 'S9DB%'");
  await db.query("delete from public.edinet_filers where edinet_code like 'E9DB%'");
  await db.query("delete from public.edinet_list_fetched_dates where list_date between '2003-01-01' and '2004-12-31'");
  await db.query("delete from public.stocks where code like '9V9%'");
}

beforeAll(async () => {
  await db.connect();
  admin = createAdminClient();
  const { rows: running } = await db.query("select count(*)::int as n from public.ingestion_runs where status = 'running'");
  if (running[0].n > 0) throw new Error("実行中の実行が残っているため、結合テストを始められません");
  const { rows: others } = await db.query(
    `select (select count(*) from public.stocks where code not like '9V9%')::int
          + (select count(*) from public.edinet_documents where doc_id not like 'S9DB%')::int
          + (select count(*) from public.edinet_list_fetched_dates where list_date not between '2003-01-01' and '2004-12-31')::int as n`,
  );
  if (others[0].n > 0) {
    throw new Error("テスト以外の銘柄・EDINET の書類・一覧の取得済みの日があるため、結合テストを始められません（pnpm db:reset 直後の DB で実行してください）");
  }
  const { rows: seq } = await db.query("select coalesce(max(id), 0)::bigint + 1 as next from public.ingestion_runs");
  firstRunId = Number(seq[0].next);
});

beforeEach(async () => {
  await cleanup();
  await setupStocks();
});

afterEach(async () => {
  await db.query("delete from public.ingestion_runs where id >= $1 and status = 'running'", [firstRunId]);
  vi.restoreAllMocks();
});

afterAll(async () => {
  await cleanup();
  await db.query("delete from public.ingestion_runs where id >= $1", [firstRunId]);
  await db.end();
});

describe("主要な経営指標等の取り込み（DB 込み。契約の C6）", () => {
  it("1回目: 書類ごとに未処理の処理だけを行い、届出書は証券コードが無くても上場後の書類で銘柄に結び付く。処理件数は書類ごとに1", async () => {
    const before = await metrics("9V901");
    expect(before.revenue_cagr_unavailable_reason).toBe("insufficient_periods");

    const first = await ingest(LISTS, DOCUMENTS);
    expect(first.outcome.status).toBe("succeeded");
    expect(first.row.processed_count).toBe(5);
    // 取得の順: 条件①を算出できていない銘柄（9V901・9V903）の届出書（新しい順）→ そのほか（9V902 の有報。新しい順）
    expect(docCalls(first.calls)).toEqual(["S9DB0005", "S9DB0002", "S9DB0001", "S9DB0004", "S9DB0003"]);
    expect(first.row.details).toMatchObject({
      documentsTargeted: 5,
      documentsTargetedByKind: { annualReport: 2, businessResults: 5 },
      documentsProcessed: 5,
      businessResults: { ok: 2, section_not_found: 3 },
      businessResultsPeriods: 8,
      stoppedReason: null,
    });
    expect(first.row.details.filersUpdated).toBeGreaterThanOrEqual(2);

    // 有報は両方の処理、届出書は主要な経営指標等だけ
    expect(await extractions()).toEqual([
      { doc_id: "S9DB0001", business: "ok", annual: null },
      { doc_id: "S9DB0002", business: "section_not_found", annual: null },
      { doc_id: "S9DB0003", business: "ok", annual: "ok" },
      { doc_id: "S9DB0004", business: "section_not_found", annual: "ok" },
      { doc_id: "S9DB0005", business: "section_not_found", annual: null },
    ]);
    // 半期報告書は保存しない（対応だけを作る）
    const { rows: filers } = await db.query("select edinet_code, sec_code from public.edinet_filers where edinet_code like 'E9DB%' order by 1");
    expect(filers).toEqual([
      { edinet_code: "E9DB01", sec_code: "9V901" },
      { edinet_code: "E9DB02", sec_code: "9V902" },
      { edinet_code: "E9DB03", sec_code: "9V903" },
    ]);

    // 9V901: 届出書の期（単体 2000/03・2001/03、連結 2002/03・2003/03）＋決算短信 2004/03 で5期 → 算出（同じ実行の中で再計算）
    const m901 = await metrics("9V901");
    expect(m901.revenue_cagr_unavailable_reason).toBeNull();
    expect(m901.revenue_cagr).toBe("0.4142135624"); // (400/100)^(1/4) - 1
    expect(m901.revenue_cagr_supplemented).toBe(true);
    expect(m901.revenue_cagr_mixed_consolidation).toBe(true);
    expect(m901.revenue_cagr_period_sources.map((s: { source: string; document_id: string }) => `${s.source}:${s.document_id}`)).toEqual([
      "tdnet_summary:S9DBT9V9010",
      "edinet_registration_statement:S9DB0001",
      "edinet_registration_statement:S9DB0001",
      "edinet_registration_statement:S9DB0001",
      "edinet_registration_statement:S9DB0001",
    ]);
    // 2002/03期は連結の 200（単体の 190 ではない）。百万円の表示を円で保存
    const { rows: p2002 } = await db.query(
      "select net_sales::text, consolidated, source from public.financial_periods where code = '9V901' and fiscal_year_end = '2002-03-31'",
    );
    expect(p2002).toEqual([{ net_sales: "20000000000", consolidated: true, source: "edinet_registration_statement" }]);

    // 9V902: 決算短信の期は置き換えない（888 は使われない）。決算短信に無い期（なし）なので補完なし
    const m902 = await metrics("9V902");
    expect(m902.revenue_cagr_supplemented).toBe(false);
    const { rows: p902 } = await db.query("select fiscal_year_end::text, source from public.financial_periods where code = '9V902' order by 1");
    expect(p902.every((p: { source: string }) => p.source === "tdnet_summary")).toBe(true);

    // 2回目（新しい書類なし）: 書類取得 API への要求は0回、処理件数 0（AC15.11）
    const second = await ingest(LISTS, DOCUMENTS);
    expect(second.outcome.status).toBe("succeeded");
    expect(second.row.processed_count).toBe(0);
    expect(docCalls(second.calls)).toEqual([]);
    expect(listCalls(second.calls)).toBe(7);
  });

  it("導入時の1回だけの取り直し（C6-4）: 大株主・役員だけ処理済みの有報は1回だけ取得し、主要な経営指標等だけを保存する", async () => {
    await ingest(LISTS, DOCUMENTS);
    // Sprint 8 の状態を作る（主要な経営指標等の記録だけを消す）
    const { rows: annualBefore } = await db.query("select processed_at from public.annual_report_extractions where doc_id = 'S9DB0003'");
    await db.query("delete from public.business_results_extractions where doc_id = 'S9DB0003'");

    const again = await ingest(LISTS, DOCUMENTS);
    expect(docCalls(again.calls)).toEqual(["S9DB0003"]);
    expect(again.row.processed_count).toBe(1);
    expect(again.row.details).toMatchObject({ documentsTargetedByKind: { annualReport: 0, businessResults: 1 } });
    const { rows: annualAfter } = await db.query("select processed_at from public.annual_report_extractions where doc_id = 'S9DB0003'");
    expect(annualAfter[0].processed_at).toEqual(annualBefore[0].processed_at);
    expect((await extractions()).find((e: { doc_id: string }) => e.doc_id === "S9DB0003")).toMatchObject({ business: "ok" });

    const third = await ingest(LISTS, DOCUMENTS);
    expect(docCalls(third.calls)).toEqual([]);
    expect(third.row.processed_count).toBe(0);
  });

  it("導入時の edinet_filers（C6-4b。R1）: 既存の書類から作り、一覧の日の記録を消して取り直す。取り下げ・処理済みの記録は壊れない", async () => {
    await ingest(LISTS, DOCUMENTS);
    // Sprint 8 の状態: 提出者の対応が無い（9V901 の届出書は結び付かない）。S9DB0005 は取り下げ済み
    await db.query("delete from public.edinet_filers where edinet_code like 'E9DB%'");
    await db.query("update public.edinet_documents set withdrawn = true where doc_id = 'S9DB0005'");
    expect((await metrics("9V901")).revenue_cagr_unavailable_reason).toBe("insufficient_periods");

    const { rows: prepared } = await db.query("select public.prepare_edinet_filers_backfill() as r");
    // 証券コードのある書類（9V902・9V903）の提出者だけができる。一覧の取得済みの日は空になる
    expect(prepared[0].r.filers).toBe(2);
    expect(prepared[0].r.listDatesCleared).toBeGreaterThan(400);
    const { rows: dates } = await db.query("select count(*)::int as n from public.edinet_list_fetched_dates");
    expect(dates[0].n).toBe(0);
    expect((await metrics("9V901")).revenue_cagr_unavailable_reason).toBe("insufficient_periods");
    const extractionsBefore = await extractions();

    // 次の実行で 450 日分の一覧を取り直し、半期報告書の行から 9V901 の対応ができて再計算される
    const refetch = await ingest(LISTS, DOCUMENTS);
    expect(listCalls(refetch.calls)).toBe(451);
    expect(docCalls(refetch.calls)).toEqual([]);
    expect(refetch.row.processed_count).toBe(0);
    expect((await metrics("9V901")).revenue_cagr_unavailable_reason).toBeNull();
    const { rows: withdrawn } = await db.query("select withdrawn from public.edinet_documents where doc_id = 'S9DB0005'");
    expect(withdrawn[0].withdrawn).toBe(true);
    expect(await extractions()).toEqual(extractionsBefore);
  });

  it("取得の順番（C6-5）: 期限で止まると、条件①を算出できていない銘柄の書類が先に処理されている", async () => {
    // 一覧 451 日（1秒間隔）の後、書類は1通だけ要求できる期限
    const first = await ingest(LISTS, DOCUMENTS, { deadlineMs: 452_000 });
    expect(first.outcome.status).toBe("partial");
    expect(docCalls(first.calls)).toEqual(["S9DB0005"]);
    expect(first.row.processed_count).toBe(1);
    expect(first.row.details).toMatchObject({ stoppedReason: "time_budget", documentsRemaining: 4 });
  });

  it("キーが未設定なら外部 API を呼ばずに失敗し、決算短信から算出済みの指標は変わらない（AC15.10）", async () => {
    const before = await metrics("9V902");
    const start = await startIngestionRun(admin, "edinet_reports", "manual");
    if (!start.started) throw new Error("実行中の実行が残っています");
    const fetchImpl = vi.fn();
    const outcome = await executeIngestionRun(start.runId, "edinet_reports", { admin, fetchImpl, env: {}, clock: fakeClock().clock });
    expect(outcome.status).toBe("failed");
    expect(fetchImpl).not.toHaveBeenCalled();
    const { rows } = await db.query("select error_message from public.ingestion_runs where id = $1", [start.runId]);
    expect(rows[0].error_message).toBe("EDINET の API キーが設定されていません");
    expect(await metrics("9V902")).toEqual(before);
  });
});
