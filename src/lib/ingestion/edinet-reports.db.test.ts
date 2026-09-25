/**
 * 有報（EDINET）の取り込みの結合テスト（ローカルの DB に実際に書き込む）。外部 API（fetch）と時計だけを差し替える（契約の C6）。
 * 実行: pnpm test:db（pnpm db:start と pnpm env:local が済み、銘柄マスタ・EDINET の書類が0件の DB であること）
 * テストの銘柄コードは 9W9xx、書類IDは S8DB…。一覧の期間は 2000〜2001 年（時計を差し替える）。後片付けでは、それらと
 * list_date < 2002-01-01 の取得済みの日、作った ingestion_runs の行だけを消す。
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
const KEY = "edinet-db-test-KEY-3f9a1c";
const ENV = { EDINET_API_KEY: KEY };
/** 実行日: 2001-07-01 0:00 JST（定期実行と同じ時刻）。一覧の期間は 2000-04-07〜2001-07-01。 */
const RUN_AT = Date.parse("2001-06-30T15:00:00Z");

const db = new Client({ connectionString: DB_URL });
let admin: SupabaseClient;
let firstRunId = 0;

// ---------------------------------------------------------------------------
// 差し替えの EDINET
// ---------------------------------------------------------------------------

type ListRow = Record<string, unknown>;

function row(docID: string, overrides: ListRow = {}): ListRow {
  return {
    seqNumber: 1,
    docID,
    edinetCode: "E99901",
    secCode: "9W901",
    JCN: null,
    filerName: "有報テスト株式会社",
    fundCode: null,
    ordinanceCode: "010",
    formCode: "030000",
    docTypeCode: "120",
    periodStart: "2000-04-01",
    periodEnd: "2001-03-31",
    submitDateTime: "2001-06-28 15:00",
    docDescription: "有価証券報告書",
    issuerEdinetCode: null,
    subjectEdinetCode: null,
    subsidiaryEdinetCode: null,
    currentReportReason: null,
    parentDocID: null,
    opeDateTime: null,
    withdrawalStatus: "0",
    docInfoEditStatus: "0",
    disclosureStatus: "0",
    xbrlFlag: "1",
    pdfFlag: "1",
    attachDocFlag: "0",
    englishDocFlag: "0",
    csvFlag: "1",
    legalStatus: "1",
    ...overrides,
  };
}

function listBody(date: string, results: ListRow[]) {
  return {
    metadata: {
      title: "提出された書類を把握するための API",
      parameter: { date, type: "2" },
      resultset: { count: results.length },
      processDateTime: `${date} 23:59`,
      status: "200",
      message: "OK",
    },
    results: results.map((r, i) => ({ ...r, seqNumber: i + 1 })),
  };
}

/** 書類取得 API の ZIP（XBRL/PublicDoc のインライン XBRL と、監査報告書）。 */
function documentZip(html: string) {
  return zipSync({
    "XBRL/PublicDoc/0000000_header_jpcrp030000-asr-001_E99999-000_2001-03-31_01_2001-06-28_ixbrl.htm": strToU8(
      synthetic.ixbrlDocument({ contexts: [], body: "<p>表紙</p>" }),
    ),
    "XBRL/PublicDoc/0104010_honbun_jpcrp030000-asr-001_E99999-000_2001-03-31_01_2001-06-28_ixbrl.htm": strToU8(html),
    "XBRL/AuditDoc/jpaud-aar-cc-001_E99999-000_2001-03-31_01_2001-06-28_ixbrl.htm": strToU8("<html>監査報告書</html>"),
  });
}

/** 大株主2名・役員2名の有報（section で区画を省ける）。 */
function reportHtml({ holders = true, officers = true, prefix = "" }: { holders?: boolean; officers?: boolean; prefix?: string } = {}) {
  const members = ["YamadaTaroMember", "SatoIchiroMember"];
  return synthetic.ixbrlDocument({
    contexts: [synthetic.shareholderContext(1), synthetic.shareholderContext(2), ...members.map(synthetic.officerContext)],
    body: [
      holders
        ? `<table>${synthetic.shareholderRow(1, `${prefix}山田　太郎`, "東京都", "3,210", "32.10")}${synthetic.shareholderRow(2, "日本マスタートラスト信託銀行株式会社（信託口）", "東京都", "900", "9.00")}</table>`
        : "",
      officers
        ? `<table>${synthetic.officerRow("YamadaTaroMember", "<p>代表取締役社長</p>", `${prefix}山田　太郎`)}${synthetic.officerRow("SatoIchiroMember", "<p>取締役</p>", "佐藤　一郎")}</table>`
        : "",
    ].join(""),
  });
}

/** 持株比率が比率そのもの（scale 0）で書かれた書類（十進の変換の確認）。 */
function ratioHtml() {
  const ratios: [number, string, string][] = [
    [1, "0.0057", "4"],
    [2, "0.0129", "4"],
    [3, "0.12345", "5"],
  ];
  return synthetic.ixbrlDocument({
    contexts: [1, 2, 3].map(synthetic.shareholderContext).concat(synthetic.officerContext("AMember")),
    body: `<table>${ratios
      .map(
        ([rank, value, decimals]) =>
          `<tr><td>${synthetic.nonNumeric("jpcrp_cor:NameMajorShareholders", `CurrentYearInstant_No${rank}MajorShareholdersMember`, `株主${rank}`)}</td><td>${synthetic.nonFraction("jpcrp_cor:ShareholdingRatio", `CurrentYearInstant_No${rank}MajorShareholdersMember`, value, { decimals })}</td></tr>`,
      )
      .join("")}</table><table>${synthetic.officerRow("AMember", "取締役", "A")}</table>`,
  });
}

type Reply = { status?: number; body?: unknown; bytes?: Uint8Array; error?: Error; headers?: Record<string, string> };

function fakeEdinet({
  lists,
  documents,
  clock,
  override,
}: {
  lists: Record<string, ListRow[]>;
  documents: Record<string, Uint8Array | Reply>;
  clock: ReturnType<typeof fakeClock>;
  override?: (url: URL) => Reply | undefined;
}) {
  const calls: { path: string; date: string | null; key: string | null; at: number; redirect: RequestRedirect | undefined }[] = [];
  const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    calls.push({ path: url.pathname, date: url.searchParams.get("date"), key: url.searchParams.get("Subscription-Key"), at: clock.clock.now(), redirect: init?.redirect });
    const reply =
      override?.(url) ??
      (url.pathname === "/api/v2/documents.json"
        ? { body: listBody(url.searchParams.get("date")!, lists[url.searchParams.get("date")!] ?? []) }
        : (() => {
            const id = url.pathname.split("/").at(-1)!;
            const doc = documents[id];
            if (!doc) return { body: { metadata: { title: "提出された書類を把握するための API", status: "404", message: "Not Found" } } };
            return doc instanceof Uint8Array ? { bytes: doc, headers: { "content-type": "application/octet-stream" } } : doc;
          })());
    if (reply.error) throw reply.error;
    const body: BodyInit = reply.bytes ? new Blob([reply.bytes as Uint8Array<ArrayBuffer>]) : typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body ?? {});
    return new Response(body, { status: reply.status ?? 200, headers: reply.headers ?? { "content-type": "application/json; charset=utf-8" } });
  });
  return { fetchImpl, calls };
}

function fakeClock(start = RUN_AT) {
  let now = start;
  return {
    clock: {
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
      },
    },
  };
}

async function insertStocks(codes: string[]) {
  for (const code of codes) {
    await db.query(
      `insert into public.stocks (code, company_name, market_code, market_name, sector33_code, sector33_name, product_category)
       values ($1, $2, '0113', 'グロース', '5250', '情報・通信業', '011') on conflict do nothing`,
      [code, `有報テスト${code}株式会社`],
    );
  }
}

async function run(id: number) {
  const { rows } = await db.query(
    "select status, processed_count, error_message, details from public.ingestion_runs where id = $1",
    [id],
  );
  return rows[0];
}

async function columns(runId: number) {
  const { rows } = await db.query(
    "select stopped_reason, remaining_count, remaining_unit, failed_count from public.ingestion_runs where id = $1",
    [runId],
  );
  return rows[0];
}

async function failuresOf(runId: number) {
  const { rows } = await db.query(
    "select item_type, item_key, code, reason, http_status, network_error from public.ingestion_run_failures where run_id = $1 order by id",
    [runId],
  );
  return rows;
}

async function ingest(
  fake: Omit<Parameters<typeof fakeEdinet>[0], "clock">,
  options: { deadlineMs?: number; env?: Record<string, string>; clock?: ReturnType<typeof fakeClock> } = {},
) {
  const clock = options.clock ?? fakeClock();
  const edinet = fakeEdinet({ ...fake, clock });
  const start = await startIngestionRun(admin, "edinet_reports", "manual");
  if (!start.started) throw new Error("実行中の実行が残っています");
  const outcome = await executeIngestionRun(start.runId, "edinet_reports", {
    admin,
    fetchImpl: edinet.fetchImpl,
    env: options.env ?? ENV,
    clock: clock.clock,
    requestDeadline: clock.clock.now() + (options.deadlineMs ?? 1_000_000),
  });
  return { runId: start.runId, outcome, calls: edinet.calls, row: await run(start.runId) };
}

async function documentsInDb() {
  const { rows } = await db.query(
    `select doc_id, doc_type_code, sec_code, edinet_code, withdrawn, withheld, period_end::text
       from public.edinet_documents where doc_id like 'S8DB%' order by doc_id`,
  );
  return rows;
}

async function detail(code: string) {
  const { rows } = await db.query("select public.annual_report_detail($1) as d", [code]);
  return rows[0].d;
}

const docCalls = (calls: { path: string }[]) => calls.filter((c) => c.path.startsWith("/api/v2/documents/")).map((c) => c.path.split("/").at(-1));
const listCalls = (calls: { path: string; date: string | null }[]) => calls.filter((c) => c.path === "/api/v2/documents.json").map((c) => c.date);

async function cleanup() {
  await db.query("delete from public.edinet_documents where doc_id like 'S8DB%'");
  await db.query("delete from public.edinet_list_fetched_dates where list_date < '2002-01-01'");
  await db.query("delete from public.stocks where code like '9W9%'");
  // Sprint 9: 一覧のすべての行から作られる提出者と証券コードの対応（テストの提出者 E999xx）も消す
  await db.query("delete from public.edinet_filers where edinet_code like 'E999%'");
}

beforeAll(async () => {
  await db.connect();
  admin = createAdminClient();
  const { rows: running } = await db.query("select count(*)::int as n from public.ingestion_runs where status = 'running'");
  if (running[0].n > 0) throw new Error("実行中の実行が残っているため、結合テストを始められません");
  const { rows: others } = await db.query(
    `select (select count(*) from public.stocks where code not like '9W9%')::int
          + (select count(*) from public.edinet_documents where doc_id not like 'S8DB%')::int as n`,
  );
  if (others[0].n > 0) {
    throw new Error("テスト以外の銘柄または EDINET の書類があるため、有報の結合テストを始められません（pnpm db:reset 直後の DB で実行してください）");
  }
  const { rows: seq } = await db.query("select coalesce(max(id), 0)::bigint + 1 as next from public.ingestion_runs");
  firstRunId = Number(seq[0].next);
});

beforeEach(async () => {
  await cleanup();
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

// ---------------------------------------------------------------------------
// 1回目の一覧と書類
// ---------------------------------------------------------------------------

const FIRST_LISTS: Record<string, ListRow[]> = {
  "2001-06-26": [row("S8DB0008", { secCode: "9W905", edinetCode: "E99905" })],
  "2001-06-27": [row("S8DB0007", { secCode: "9W904", edinetCode: "E99904" })],
  "2001-06-28": [
    row("S8DB0001"),
    row("S8DB0002", { secCode: "9W902", edinetCode: "E99902" }),
    row("S8DB0003", {
      secCode: "9W902",
      edinetCode: "E99902",
      docTypeCode: "130",
      formCode: "030001",
      periodStart: null,
      periodEnd: null,
      parentDocID: "S8DB0002",
      submitDateTime: "2001-06-28 17:00",
    }),
    row("S8DB0004", { secCode: null, edinetCode: "E99909", docTypeCode: "030", formCode: "020000", periodStart: null, periodEnd: null }),
    row("S8DB0005", { secCode: "9W903", edinetCode: "E99903", xbrlFlag: "0" }),
    row("S8DB0006", { secCode: "9W999", edinetCode: "E99999" }), // 銘柄マスタに無い
    row("S8DB00Q1", { docTypeCode: "140" }), // 四半期報告書
    row("S8DB00N1", { secCode: null }), // 証券コードの無い有報
    row("S8DB00F1", { ordinanceCode: "030" }), // ファンド
  ],
  // 取下書（親書類 S8DB0007 を取り下げ）と、不開示の開始の情報（S8DB0008）。項目が null の形
  "2001-06-30": [
    { ...Object.fromEntries(Object.keys(row("x")).map((k) => [k, null])), docID: "S8DB00W1", parentDocID: "S8DB0007", submitDateTime: "2001-06-30 09:30", withdrawalStatus: "1", docInfoEditStatus: "0", disclosureStatus: "0", xbrlFlag: "0", legalStatus: "0" },
    row("S8DB0008", { secCode: "9W905", edinetCode: "E99905", disclosureStatus: "1", opeDateTime: "2001-06-30 19:30" }),
  ],
};

const FIRST_DOCUMENTS: Record<string, Uint8Array> = {
  S8DB0001: documentZip(synthetic.readRealFixture("S100W7OT")),
  S8DB0002: documentZip(reportHtml({ prefix: "元" })),
  S8DB0003: documentZip(reportHtml({ holders: false, prefix: "訂正" })),
  S8DB0007: documentZip(reportHtml()),
  S8DB0008: documentZip(reportHtml()),
};

describe("有報の取り込み（DB 込み）", () => {
  it("1回目: 対象の書類だけを保存し、使う書類の本文を処理する。訂正に区画が無ければ元の書類も取得する。取り下げ・不開示は取得しない", async () => {
    await insertStocks(["9W901", "9W902", "9W903", "9W904", "9W905"]);
    const first = await ingest({ lists: FIRST_LISTS, documents: FIRST_DOCUMENTS });

    expect(first.outcome.status).toBe("succeeded");
    // 本文を処理した書類: 0001（実データ）、0003（訂正）→ 0002（大株主が訂正に無いので元の書類）、0005（XBRL なし。要求しない）
    expect(first.row.processed_count).toBe(4);
    // 提出日時の新しい順（同じ時刻は書類IDの降順）。Sprint 9: 主要な経営指標等は候補の列のすべてを読むので、
    // 元の有報（0002）も最初の対象に入る（大株主の区画の不足で後から加わるのではなく）
    expect(docCalls(first.calls)).toEqual(["S8DB0003", "S8DB0002", "S8DB0001"]);
    expect(first.row.details).toMatchObject({
      listDatesInWindow: 451,
      listDatesFetched: 451,
      listDatesRemaining: 0,
      // Sprint 9: 最初の対象は 0003・0002・0001・0005（元の有報 0002 も主要な経営指標等のために最初から入る）
      documentsTargeted: 4,
      documentsProcessed: 4,
      fallbackDocuments: 0,
      documentsBothExtracted: 2,
      documentsNotExtracted: 2,
      withdrawnUpdated: 1,
      withheldUpdated: 1,
      stoppedReason: null,
    });
    expect(first.row.error_message).toBeNull();
    // 直近7日は古い順（取下書より前に元の書類を保存する）
    expect(listCalls(first.calls).slice(0, 7)).toEqual(["2001-06-25", "2001-06-26", "2001-06-27", "2001-06-28", "2001-06-29", "2001-06-30", "2001-07-01"]);
    // キーはクエリで送り、リダイレクトは追わない
    expect(first.calls.every((c) => c.key === KEY && c.redirect === "manual")).toBe(true);

    expect(await documentsInDb()).toEqual([
      { doc_id: "S8DB0001", doc_type_code: "120", sec_code: "9W901", edinet_code: "E99901", withdrawn: false, withheld: false, period_end: "2001-03-31" },
      { doc_id: "S8DB0002", doc_type_code: "120", sec_code: "9W902", edinet_code: "E99902", withdrawn: false, withheld: false, period_end: "2001-03-31" },
      { doc_id: "S8DB0003", doc_type_code: "130", sec_code: "9W902", edinet_code: "E99902", withdrawn: false, withheld: false, period_end: null },
      { doc_id: "S8DB0004", doc_type_code: "030", sec_code: null, edinet_code: "E99909", withdrawn: false, withheld: false, period_end: null },
      { doc_id: "S8DB0005", doc_type_code: "120", sec_code: "9W903", edinet_code: "E99903", withdrawn: false, withheld: false, period_end: "2001-03-31" },
      { doc_id: "S8DB0006", doc_type_code: "120", sec_code: "9W999", edinet_code: "E99999", withdrawn: false, withheld: false, period_end: "2001-03-31" },
      { doc_id: "S8DB0007", doc_type_code: "120", sec_code: "9W904", edinet_code: "E99904", withdrawn: true, withheld: false, period_end: "2001-03-31" },
      { doc_id: "S8DB0008", doc_type_code: "120", sec_code: "9W905", edinet_code: "E99905", withdrawn: false, withheld: true, period_end: "2001-03-31" },
    ]);

    // 実データの抜粋（S100W7OT）: 比率は記載どおり（9.6、桁数 1）
    const d1 = await detail("9W901");
    expect(d1.shareholders.status).toBe("ok");
    expect(d1.shareholders.rows).toHaveLength(10);
    expect(d1.shareholders.rows[0]).toMatchObject({ rank: 1, ratio_pct: "9.6", ratio_decimals: 1, shares_held: "7554000" });
    expect(d1.officers.rows).toHaveLength(12);

    // 訂正に大株主の区画が無い → 大株主は元の有報、役員は訂正
    const d2 = await detail("9W902");
    expect(d2.document.doc_id).toBe("S8DB0003");
    expect(d2.document.period_end).toBe("2001-03-31");
    expect(d2.shareholders).toMatchObject({ status: "ok", source_doc_id: "S8DB0002", fallback: true });
    expect(d2.shareholders.rows[0].name).toBe("元山田　太郎");
    expect(d2.officers).toMatchObject({ status: "ok", source_doc_id: "S8DB0003", fallback: false });
    expect(d2.officers.rows[0].name).toBe("訂正山田　太郎");

    // XBRL の無い書類は要求せずに no_xbrl で処理済み
    expect((await detail("9W903")).shareholders).toMatchObject({ status: "no_xbrl", detail: "xbrl_flag_off" });
    // 取り下げ・不開示は使わない
    expect(await detail("9W904")).toBeNull();
    expect(await detail("9W905")).toBeNull();

    // 2回目（新しい書類なし）: 本文の要求は0回。一覧は直近7日だけ。取り下げは false に戻らない
    const second = await ingest({ lists: FIRST_LISTS, documents: FIRST_DOCUMENTS });
    expect(second.outcome.status).toBe("succeeded");
    expect(second.row.processed_count).toBe(0);
    expect(docCalls(second.calls)).toEqual([]);
    expect(listCalls(second.calls)).toHaveLength(7);
    const withdrawn = await db.query("select withdrawn from public.edinet_documents where doc_id = 'S8DB0007'");
    expect(withdrawn.rows[0].withdrawn).toBe(true);

    // 3回目（直近の日に訂正が1通増える）: その1通だけを取得し、表示が切り替わる
    const lists = {
      ...FIRST_LISTS,
      "2001-07-01": [
        row("S8DB0009", { docTypeCode: "130", formCode: "030001", periodStart: null, periodEnd: null, parentDocID: "S8DB0001", submitDateTime: "2001-07-01 10:00" }),
      ],
    };
    const third = await ingest({ lists, documents: { ...FIRST_DOCUMENTS, S8DB0009: documentZip(reportHtml({ prefix: "再訂正" })) } });
    expect(third.outcome.status).toBe("succeeded");
    expect(docCalls(third.calls)).toEqual(["S8DB0009"]);
    expect(third.row.processed_count).toBe(1);
    const d1b = await detail("9W901");
    expect(d1b.document.doc_id).toBe("S8DB0009");
    expect(d1b.shareholders.rows[0].name).toBe("再訂正山田　太郎");
    expect(d1b.siblings.map((s: { doc_id: string }) => s.doc_id)).toEqual(["S8DB0001"]);
  });

  it("期限で一覧の途中で止まると partial（残りの日数を記録）。本文は取得しない。次の実行で続きの日から再開する", async () => {
    await insertStocks(["9W901"]);
    const clock = fakeClock();
    // 要求の間隔は 1,000ms。期限 20 秒 → 20 日分で止まる
    const first = await ingest({ lists: FIRST_LISTS, documents: FIRST_DOCUMENTS }, { clock, deadlineMs: 20_000 });
    expect(first.outcome.status).toBe("partial");
    expect(first.row.details).toMatchObject({ stoppedReason: "time_budget", listDatesFetched: 20, listDatesRemaining: 431 });
    expect(first.row.error_message).toBe("時間内に書類一覧を取得しきれなかったため、残り 431 日分は次回の取り込みで取得します");
    expect(docCalls(first.calls)).toEqual([]);
    // Sprint 12（C1-3）: 残りは書類一覧の日
    expect(await columns(first.runId)).toEqual({ stopped_reason: "time_budget", remaining_count: 431, remaining_unit: "list_dates", failed_count: 0 });
    // 要求の間隔（前の要求の開始から 1,000ms 以上）
    for (let i = 1; i < first.calls.length; i++) expect(first.calls[i].at - first.calls[i - 1].at).toBeGreaterThanOrEqual(1_000);

    const second = await ingest({ lists: FIRST_LISTS, documents: FIRST_DOCUMENTS });
    // 直近7日と、未取得の 431 − 0 日（取得済みの 13 日を飛ばす）
    expect(listCalls(second.calls)).toHaveLength(7 + 431);
    expect(listCalls(second.calls)).not.toContain(listCalls(first.calls)[10]);
    expect(second.outcome.status).toBe("succeeded");
    expect(docCalls(second.calls)).toEqual(["S8DB0001"]);
  });

  it("Sprint 12（C1-3）: 一覧を取り終えた後、本文の途中で期限なら残りは書類。次の実行は処理済みの書類を要求しない", async () => {
    await insertStocks(["9W901", "9W902", "9W903", "9W904", "9W905"]);
    await ingest({ lists: {}, documents: {} }); // 一覧（空）を取り終える
    // 直近7日の一覧（7 回）と本文1通で期限（要求の間隔 1,000ms）
    const first = await ingest({ lists: FIRST_LISTS, documents: FIRST_DOCUMENTS }, { deadlineMs: 8_000 });
    expect(first.outcome.status).toBe("partial");
    expect(docCalls(first.calls)).toHaveLength(1);
    expect(await columns(first.runId)).toMatchObject({ stopped_reason: "time_budget", remaining_unit: "documents", failed_count: 0 });
    expect((await columns(first.runId)).remaining_count).toBe(first.row.details.documentsRemaining);
    expect(first.row.details.documentsRemaining).toBeGreaterThan(0);
    const second = await ingest({ lists: FIRST_LISTS, documents: FIRST_DOCUMENTS });
    expect(docCalls(second.calls)).not.toContain(docCalls(first.calls)[0]);
    expect(await columns(second.runId)).toMatchObject({ remaining_count: 0, remaining_unit: "documents", stopped_reason: null });
  });

  it("Sprint 12（C3-5）: 一覧の 503 を2回受けても、待って再試行して回復する", async () => {
    await insertStocks(["9W901"]);
    let n = 0;
    const result = await ingest({
      lists: FIRST_LISTS,
      documents: FIRST_DOCUMENTS,
      override: (url) => (url.pathname === "/api/v2/documents.json" && n++ < 2 ? { status: 503, body: { StatusCode: 503, message: "Service Unavailable" } } : undefined),
    });
    expect(result.outcome.status).toBe("succeeded");
    expect(result.row.details.rateLimit).toEqual({ hits: 2, retries: 2, waitedMs: 45_000, exhausted: false });
  });

  it("本文の取得の失敗（500・200 の本文 404・ZIP でない本文・接続できない）は処理済みにせず partial。次の実行で再試行する。抽出の失敗は処理済み", async () => {
    await insertStocks(["9W901", "9W902", "9W903", "9W904", "9W906"]);
    const lists: Record<string, ListRow[]> = {
      "2001-06-28": [
        row("S8DB0101"),
        row("S8DB0102", { secCode: "9W902" }),
        row("S8DB0103", { secCode: "9W903" }),
        row("S8DB0104", { secCode: "9W904" }),
        row("S8DB0106", { secCode: "9W906", submitDateTime: "2001-06-28 18:00" }),
      ],
    };
    const invalid = synthetic.ixbrlDocument({
      contexts: [synthetic.shareholderContext(1), synthetic.officerContext("AMember")],
      body: `<table>${synthetic.shareholderRow(1, "A", "東京都", "1", "一〇")}</table><table>${synthetic.officerRow("AMember", "取締役", "A")}</table>`,
    });
    const failing: Record<string, Uint8Array | Reply> = {
      S8DB0101: { status: 500, body: "" },
      S8DB0102: { body: { metadata: { title: "x", status: "404", message: "Not Found" } } },
      S8DB0103: { body: "<html>Sorry</html>", headers: { "content-type": "text/html" } },
      S8DB0104: { error: new TypeError("fetch failed", { cause: Object.assign(new Error(`connect ECONNRESET ?Subscription-Key=${KEY}`), { code: "ECONNRESET" }) }) },
      S8DB0106: documentZip(invalid),
    };
    const consoleSpies = [vi.spyOn(console, "error").mockImplementation(() => {}), vi.spyOn(console, "warn").mockImplementation(() => {})];

    const first = await ingest({ lists, documents: failing });
    expect(first.outcome.status).toBe("partial");
    expect(first.row.processed_count).toBe(1);
    expect(first.row.details.documentsFailed).toBe(4);
    // Sprint 12: 失敗した書類は details.failedDocuments ではなく、失敗の行（ingestion_run_failures）に残す（契約 C10-1 の種類2）
    expect(first.row.details.failedDocuments).toBeUndefined();
    expect(await failuresOf(first.runId)).toEqual([
      { item_type: "document", item_key: "S8DB0104", code: "9W904", reason: "unreachable", http_status: null, network_error: "network" },
      { item_type: "document", item_key: "S8DB0103", code: "9W903", reason: "invalid_format", http_status: null, network_error: null },
      { item_type: "document", item_key: "S8DB0102", code: "9W902", reason: "not_found", http_status: 404, network_error: null },
      { item_type: "document", item_key: "S8DB0101", code: "9W901", reason: "http_error", http_status: 500, network_error: null },
    ]);
    expect((await db.query("select failed_count from public.ingestion_runs where id = $1", [first.runId])).rows[0].failed_count).toBe(4);
    expect(first.row.error_message).toBe("4 件の書類を取得できませんでした。次回の取り込みで再試行します");
    expect((await detail("9W906")).shareholders).toMatchObject({ status: "invalid_values", detail: "ratio_not_numeric", rows: [] });
    const everything = JSON.stringify(first.row) + JSON.stringify(consoleSpies.flatMap((spy) => spy.mock.calls));
    expect(everything).not.toContain(KEY);

    // 次の実行: 失敗した4通だけを再試行する（抽出に失敗した書類は取り直さない）
    const ok = Object.fromEntries(["S8DB0101", "S8DB0102", "S8DB0103", "S8DB0104"].map((id) => [id, documentZip(reportHtml())]));
    const second = await ingest({ lists, documents: { ...failing, ...ok } });
    expect(second.outcome.status).toBe("succeeded");
    expect(docCalls(second.calls).sort()).toEqual(["S8DB0101", "S8DB0102", "S8DB0103", "S8DB0104"]);
    expect(second.row.processed_count).toBe(4);
  });

  it.each([
    ["200＋本文 StatusCode 401", { body: { StatusCode: 401, message: "Access denied due to invalid subscription key." } }, "EDINET の API キーが無効です（HTTP 401）", "unauthorized"],
    // Sprint 12: 制限の応答は待って3回再試行してから打ち切る（契約 C10-1 の種類1）
    ["HTTP 429", { status: 429, body: { StatusCode: 429, message: "Too Many Requests" } }, "EDINET の呼び出しが制限されました（HTTP 429）。3 回待って再試行しましたが解消しなかったため中断しました", "rate_limited"],
    ["302", { status: 302, body: "", headers: { location: "https://old-host.example/" } }, "EDINET から予期しない応答がありました（リダイレクト）", "redirect"],
  ])("一覧で %s なら打ち切って failed。キーを記録しない", async (_label, reply, message, reason) => {
    await insertStocks(["9W901"]);
    const consoleSpies = [vi.spyOn(console, "error").mockImplementation(() => {}), vi.spyOn(console, "warn").mockImplementation(() => {})];
    const result = await ingest({ lists: FIRST_LISTS, documents: FIRST_DOCUMENTS, override: () => reply as Reply });
    expect(result.outcome.status).toBe("failed");
    expect(result.row.error_message).toBe(message);
    expect(result.row.details.stoppedReason).toBe(reason);
    expect(result.calls).toHaveLength(reason === "rate_limited" ? 4 : 1);
    expect(JSON.stringify(result.row) + JSON.stringify(consoleSpies.flatMap((spy) => spy.mock.calls))).not.toContain(KEY);
  });

  it("書類取得で 200＋本文 401 なら、書類ごとの失敗にせず打ち切る（一覧は取れているので partial）", async () => {
    await insertStocks(["9W901", "9W902"]);
    const unauthorized = { body: { StatusCode: 401, message: "Access denied due to invalid subscription key." } };
    const result = await ingest({
      lists: FIRST_LISTS,
      documents: { S8DB0001: unauthorized, S8DB0003: unauthorized, S8DB0002: unauthorized },
    });
    expect(result.outcome.status).toBe("partial");
    expect(result.row.details).toMatchObject({ stoppedReason: "unauthorized", documentsFailed: 0 });
    expect(docCalls(result.calls)).toHaveLength(1);
    expect(result.row.error_message).toContain("EDINET の API キーが無効です（HTTP 401）");
  });

  it("接続の失敗が5回続くと打ち切る（例外の cause の URL・キーは記録しない）", async () => {
    await insertStocks(["9W901"]);
    const consoleSpies = [vi.spyOn(console, "error").mockImplementation(() => {}), vi.spyOn(console, "warn").mockImplementation(() => {})];
    const error = new TypeError("fetch failed", {
      cause: Object.assign(new Error(`getaddrinfo ENOTFOUND https://api.edinet-fsa.go.jp/api/v2/documents.json?Subscription-Key=${KEY}`), { code: "ENOTFOUND" }),
    });
    const result = await ingest({ lists: FIRST_LISTS, documents: FIRST_DOCUMENTS, override: () => ({ error }) });
    expect(result.outcome.status).toBe("failed");
    expect(result.row.error_message).toBe("EDINET からの取得に5回続けて失敗したため中断しました（最後の応答は 接続または形式の失敗）");
    expect(result.calls).toHaveLength(5);
    expect(JSON.stringify(result.row) + JSON.stringify(consoleSpies.flatMap((spy) => spy.mock.calls))).not.toContain(KEY);
  });

  it("キーが未設定なら外部 API を呼ばずに失敗。銘柄マスタが0件でも外部 API を呼ばずに失敗", async () => {
    const noKey = await ingest({ lists: FIRST_LISTS, documents: FIRST_DOCUMENTS }, { env: {} });
    expect(noKey.row).toMatchObject({ status: "failed", processed_count: 0, error_message: "EDINET の API キーが設定されていません" });
    expect(noKey.calls).toEqual([]);

    const noStocks = await ingest({ lists: FIRST_LISTS, documents: FIRST_DOCUMENTS });
    expect(noStocks.row).toMatchObject({
      status: "failed",
      error_message: "銘柄マスタが未取り込みのため、EDINET の書類を取り込めません。先に銘柄マスタを取り込んでください",
    });
    expect(noStocks.calls).toEqual([]);
  });

  it("持株比率は十進のまま保存する（0.0057 → 0.57、0.0129 → 1.29、0.12345 → 12.345）", async () => {
    await insertStocks(["9W901"]);
    const result = await ingest({ lists: { "2001-06-28": [row("S8DB0201")] }, documents: { S8DB0201: documentZip(ratioHtml()) } });
    expect(result.outcome.status).toBe("succeeded");
    const { rows } = await db.query(
      `select rank, ratio_pct = 0.57 as a, ratio_pct = 1.29 as b, ratio_pct = 12.345 as c, ratio_pct::text as text, ratio_decimals
         from public.annual_report_shareholders where doc_id = 'S8DB0201' order by rank`,
    );
    expect(rows).toEqual([
      { rank: 1, a: true, b: false, c: false, text: "0.57", ratio_decimals: 2 },
      { rank: 2, a: false, b: true, c: false, text: "1.29", ratio_decimals: 2 },
      { rank: 3, a: false, b: false, c: true, text: "12.345", ratio_decimals: 3 },
    ]);
  });
});
