/**
 * 有報の「使う書類」の選び方（DB のビュー annual_report_sections）と、詳細・要約の関数の結合テスト（契約の C4-7・C2-1・C11-2）。
 * 実行: pnpm test:db（銘柄マスタ・EDINET の書類が0件の DB）。
 * 投入は契約の第5章の e2e/fixtures/annual-report-example.sql（9W001〜9W008、S8TEST…）と、この中で作る 9W8xx・S8SEL…。後片付けする。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { annualReportRowSchema } from "./annual-report";

const DB_URL = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const FIXTURES = join(__dirname, "../../../e2e/fixtures");
const EXAMPLE_SQL = readFileSync(join(FIXTURES, "annual-report-example.sql"), "utf8");
const CLEANUP_SQL = readFileSync(join(FIXTURES, "annual-report-cleanup.sql"), "utf8");

const db = new Client({ connectionString: DB_URL });
let ownerId = "";
let intruderId = "";

async function cleanup() {
  await db.query(CLEANUP_SQL);
  await db.query("delete from public.edinet_documents where doc_id like 'S8SEL%'");
  await db.query("delete from public.stocks where code like '9W8%'");
}

async function sections(code: string) {
  const { rows } = await db.query(
    `select latest_doc_id, fiscal_period_end::text, latest_processed, shareholders_doc_id, shareholders_status,
            officers_doc_id, officers_status
       from public.annual_report_sections where code = $1`,
    [code],
  );
  return rows[0] ?? null;
}

type Doc = {
  id: string;
  code?: string;
  type?: "120" | "130";
  periodEnd?: string | null;
  submitted: string;
  parent?: string;
  withdrawn?: boolean;
  withheld?: boolean;
};

async function insertDocs(docs: Doc[]) {
  for (const d of docs) {
    await db.query(
      `insert into public.edinet_documents (doc_id, sec_code, edinet_code, doc_type_code, ordinance_code, form_code, period_start,
         period_end, submitted_at, parent_doc_id, withdrawn, withheld, xbrl_available, list_date)
       values ($1, $2, 'E98801', $3, '010', '030000', null, $4, $5, $6, $7, $8, true, '2025-06-01')`,
      [d.id, d.code ?? "9W801", d.type ?? "120", d.periodEnd === undefined ? "2025-03-31" : d.periodEnd, d.submitted, d.parent ?? null, d.withdrawn ?? false, d.withheld ?? false],
    );
  }
}

async function extraction(id: string, shareholders: string, officers: string) {
  await db.query(
    `insert into public.annual_report_extractions (doc_id, shareholders_status, officers_status) values ($1, $2, $3)`,
    [id, shareholders, officers],
  );
}

beforeAll(async () => {
  await db.connect();
  const { rows: others } = await db.query(
    `select (select count(*) from public.stocks where code not like '9W%')::int
          + (select count(*) from public.edinet_documents where doc_id not like 'S8TEST%' and doc_id not like 'S8SEL%')::int as n`,
  );
  if (others[0].n > 0) throw new Error("テスト以外の銘柄または EDINET の書類があるため、始められません（pnpm db:reset 直後の DB で実行してください）");
  const { rows: users } = await db.query("select id::text, email from auth.users where email in ('owner@quantis.local', 'intruder@quantis.local')");
  ownerId = users.find((u) => u.email === "owner@quantis.local")?.id ?? "";
  intruderId = users.find((u) => u.email === "intruder@quantis.local")?.id ?? "";
  if (!ownerId || !intruderId) throw new Error("評価用ユーザーがいません（pnpm seed:users を実行してください）");
});

beforeEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await db.end();
});

describe("第5章の投入例（annual-report-example.sql）", () => {
  beforeEach(async () => {
    await db.query(EXAMPLE_SQL);
  });

  it("取り込み状況の要約: 有報を取得できた 6 / 8、両方抽出 5、抽出できず 1、取り込み待ち 1", async () => {
    const { rows } = await db.query("select public.annual_reports_summary() as s");
    expect(rows[0].s).toMatchObject({
      stockCount: 8,
      fetchedStockCount: 6,
      bothExtractedCount: 5,
      notExtractedCount: 1,
      pendingDocumentCount: 1,
      lastRun: null,
    });
  });

  it("区画ごとの書類（第5章の期待される表示）", async () => {
    expect(await sections("9W001")).toMatchObject({ latest_doc_id: "S8TEST02", shareholders_doc_id: "S8TEST02", officers_doc_id: "S8TEST02" });
    expect(await sections("9W002")).toMatchObject({ latest_doc_id: "S8TEST12", fiscal_period_end: "2025-03-31", shareholders_doc_id: "S8TEST12" });
    expect(await sections("9W003")).toMatchObject({ shareholders_status: "invalid_values", officers_status: "section_not_found" });
    expect(await sections("9W004")).toBeNull();
    expect(await sections("9W005")).toMatchObject({ latest_processed: false, shareholders_status: "pending", officers_status: "pending" });
    expect(await sections("9W007")).toMatchObject({ latest_doc_id: "S8TEST62", shareholders_doc_id: "S8TEST61", officers_doc_id: "S8TEST62" });
    expect(await sections("9W008")).toMatchObject({ latest_doc_id: "S8TEST72" });
  });

  it("詳細の関数は数値を十進の文字列で返し、画面の形（zod）に合う", async () => {
    const { rows } = await db.query("select public.annual_report_detail('9W006') as d");
    const detail = annualReportRowSchema.parse(rows[0].d);
    expect(detail.shareholders.rows.map((r) => [r.ratio_pct, r.ratio_decimals, r.shares_held])).toEqual([
      ["12.345", 3, "12000000"],
      ["5.100", 3, "5000000"],
    ]);
    const { rows: w1 } = await db.query("select public.annual_report_detail('9W001') as d");
    expect(w1[0].d.shareholders.rows[0].ratio_pct).toBe("32.10");
    expect(w1[0].d.shareholders.rows[4]).toMatchObject({ ratio_pct: "0.57", shares_held: "57050" });
  });

  it("許可リストのユーザー（authenticated）は読め、許可リスト外は行が見えない（NULL・0件）", async () => {
    const asUser = async (userId: string) => {
      await db.query("begin");
      try {
        await db.query("set local role authenticated");
        await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
        const detail = (await db.query("select public.annual_report_detail('9W001') as d")).rows[0].d;
        const summary = (await db.query("select public.annual_reports_summary() as s")).rows[0].s;
        const counts = (
          await db.query(
            `select (select count(*) from public.edinet_documents)::int as docs,
                    (select count(*) from public.annual_report_shareholders)::int as holders,
                    (select count(*) from public.annual_report_officers)::int as officers,
                    (select count(*) from public.annual_report_sections)::int as sections`,
          )
        ).rows[0];
        return { detail, summary, counts };
      } finally {
        await db.query("rollback");
      }
    };
    const owner = await asUser(ownerId);
    expect(owner.detail.document.doc_id).toBe("S8TEST02");
    expect(owner.summary.fetchedStockCount).toBe(6);
    const intruder = await asUser(intruderId);
    expect(intruder.detail).toBeNull();
    expect(intruder.summary).toMatchObject({ stockCount: 0, documentCount: 0, fetchedStockCount: 0 });
    expect(intruder.counts).toEqual({ docs: 0, holders: 0, officers: 0, sections: 0 });
  });

  it("取り下げた訂正は選ばず、siblings に取り下げとして出る（C4-4）", async () => {
    await db.query("update public.edinet_documents set withdrawn = true where doc_id = 'S8TEST12'");
    const { rows } = await db.query("select public.annual_report_detail('9W002') as d");
    expect(rows[0].d.document.doc_id).toBe("S8TEST11");
    expect(rows[0].d.candidate_count).toBe(1);
    expect(rows[0].d.shareholders.rows[0].name).toBe("訂正前 太郎");
    expect(rows[0].d.siblings).toEqual([expect.objectContaining({ doc_id: "S8TEST12", withdrawn: true })]);
  });
});

describe("使う書類の選び方（annual_report_sections）", () => {
  beforeEach(async () => {
    await db.query(
      `insert into public.stocks (code, company_name, product_category) values ('9W801', '選び方テスト株式会社', '011')`,
    );
  });

  it("事業年度の新しい順 → 提出日時の新しい順", async () => {
    await insertDocs([
      { id: "S8SEL001", periodEnd: "2024-03-31", submitted: "2025-12-01 10:00+09" }, // 古い事業年度（提出は新しい）
      { id: "S8SEL002", submitted: "2025-06-25 10:00+09" },
      { id: "S8SEL003", type: "130", periodEnd: null, parent: "S8SEL002", submitted: "2025-07-01 10:00+09" },
    ]);
    expect(await sections("9W801")).toMatchObject({ latest_doc_id: "S8SEL003", fiscal_period_end: "2025-03-31", latest_processed: false });
  });

  it("取り下げ・不開示の書類は選ばない", async () => {
    await insertDocs([
      { id: "S8SEL011", submitted: "2025-06-25 10:00+09" },
      { id: "S8SEL012", type: "130", periodEnd: null, parent: "S8SEL011", submitted: "2025-07-01 10:00+09", withdrawn: true },
      { id: "S8SEL013", type: "130", periodEnd: null, parent: "S8SEL011", submitted: "2025-07-02 10:00+09", withheld: true },
    ]);
    expect(await sections("9W801")).toMatchObject({ latest_doc_id: "S8SEL011" });
  });

  it("元の書類が保存されていない訂正（事業年度を決められない）は、提出が新しくても選ばない（NULL を先頭にしない）", async () => {
    await insertDocs([
      { id: "S8SEL021", submitted: "2025-06-25 10:00+09" },
      { id: "S8SEL022", type: "130", periodEnd: null, parent: "S8OUTSID", submitted: "2025-08-01 10:00+09" },
    ]);
    expect(await sections("9W801")).toMatchObject({ latest_doc_id: "S8SEL021" });
    await db.query("delete from public.edinet_documents where doc_id = 'S8SEL021'");
    expect(await sections("9W801")).toBeNull(); // 事業年度を決められる書類が無い → 未取得と同じ
  });

  it("区画ごとのフォールバック: 訂正に区画が無い・XBRL が無い → 元の有報。invalid_values → 戻さない。元が未処理 → pending", async () => {
    await insertDocs([
      { id: "S8SEL031", submitted: "2025-06-25 10:00+09" },
      { id: "S8SEL032", type: "130", periodEnd: null, parent: "S8SEL031", submitted: "2025-07-01 10:00+09" },
    ]);
    await extraction("S8SEL032", "section_not_found", "no_xbrl");
    // 元の有報が未処理 → どちらの区画も取り込み待ち（新しい書類で区画が無いと分かった後に、古い書類を確かめる）
    expect(await sections("9W801")).toMatchObject({
      latest_doc_id: "S8SEL032",
      latest_processed: true,
      shareholders_status: "pending",
      shareholders_doc_id: "S8SEL031",
      officers_status: "pending",
    });
    // 取り込みの対象（edinet_ingestion_state）にも元の有報が入る（大株主・役員が未処理の書類。Sprint 9 で、主要な経営指標等が
    // 未処理の書類（訂正 S8SEL032）も対象に入るので、大株主・役員が未処理のものに絞って確かめる）
    const state = (await db.query("select public.edinet_ingestion_state('2025-01-01', '2025-12-31') as s")).rows[0].s;
    expect(state.targets.filter((t: { needsAnnualReport: boolean }) => t.needsAnnualReport)).toEqual([
      { docId: "S8SEL031", code: "9W801", xbrlAvailable: true, needsAnnualReport: true, needsBusinessResults: true },
    ]);

    await extraction("S8SEL031", "ok", "invalid_values");
    expect(await sections("9W801")).toMatchObject({
      shareholders_status: "ok",
      shareholders_doc_id: "S8SEL031",
      officers_status: "invalid_values",
      officers_doc_id: "S8SEL031",
    });

    // 訂正の区画が invalid_values なら、古い書類に戻さない
    await db.query("update public.annual_report_extractions set shareholders_status = 'invalid_values' where doc_id = 'S8SEL032'");
    expect(await sections("9W801")).toMatchObject({ shareholders_status: "invalid_values", shareholders_doc_id: "S8SEL032" });
  });

  it("候補をすべて見ても区画が無ければ、最新の提出分の理由を使う", async () => {
    await insertDocs([
      { id: "S8SEL041", submitted: "2025-06-25 10:00+09" },
      { id: "S8SEL042", type: "130", periodEnd: null, parent: "S8SEL041", submitted: "2025-07-01 10:00+09" },
    ]);
    await extraction("S8SEL041", "section_not_found", "ok");
    await extraction("S8SEL042", "no_xbrl", "no_xbrl");
    expect(await sections("9W801")).toMatchObject({
      shareholders_status: "no_xbrl",
      shareholders_doc_id: "S8SEL042",
      officers_status: "ok",
      officers_doc_id: "S8SEL041",
    });
  });
});
