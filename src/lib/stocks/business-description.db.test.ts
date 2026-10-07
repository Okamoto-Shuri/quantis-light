/**
 * 事業の内容の書類の選び方（DB の business_description_sections_for）と、詳細・要約の関数・権限・性能の結合テスト（契約の C7）。
 * 実行: pnpm test:db（銘柄マスタ・EDINET の書類が0件の DB）。
 * 投入は 9R8xx・S16SEL…（選び方）と、性能の D0000〜D3999・S16PERF…。後片付けする。
 */
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { businessDescriptionRowSchema } from "./business-description";

const DB_URL = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const db = new Client({ connectionString: DB_URL });
let ownerId = "";
let intruderId = "";

async function cleanup() {
  await db.query("delete from public.edinet_documents where doc_id like 'S16SEL%' or doc_id like 'S16PERF%'");
  await db.query("delete from public.stocks where code like '9R8%' or code ~ '^D[0-9]{4}$'");
}

type Doc = {
  id: string;
  code?: string;
  type?: "120" | "130" | "030";
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
       values ($1, $2, 'E9R801', $3, '010', '030000', null, $4, $5, $6, $7, $8, true, '2025-06-01')`,
      [d.id, d.code ?? "9R801", d.type ?? "120", d.periodEnd === undefined ? "2025-03-31" : d.periodEnd, d.submitted, d.parent ?? null, d.withdrawn ?? false, d.withheld ?? false],
    );
  }
}

async function description(id: string, status: string, paragraph: string | null = null, detail: string | null = null) {
  await db.query("insert into public.business_description_extractions (doc_id, status, detail, paragraph) values ($1, $2, $3, $4)", [id, status, detail, paragraph]);
}

async function section(code = "9R801") {
  const { rows } = await db.query(
    `select doc_id, status, detail, fallback, latest_doc_id, latest_status
       from public.business_description_sections_for(array[$1]::text[])`,
    [code],
  );
  return rows[0] ?? null;
}

async function asUser<T>(userId: string | null, fn: () => Promise<T>): Promise<T> {
  await db.query("begin");
  try {
    if (userId === null) {
      await db.query("set local role anon");
    } else {
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
    }
    return await fn();
  } finally {
    await db.query("rollback");
  }
}

beforeAll(async () => {
  await db.connect();
  const { rows: others } = await db.query(
    `select (select count(*) from public.stocks where code not like '9R8%' and code !~ '^D[0-9]{4}$')::int
          + (select count(*) from public.edinet_documents where doc_id not like 'S16SEL%' and doc_id not like 'S16PERF%')::int as n`,
  );
  if (others[0].n > 0) throw new Error("テスト以外の銘柄または EDINET の書類があるため、始められません（pnpm db:reset 直後の DB で実行してください）");
  const { rows: users } = await db.query("select id::text, email from auth.users where email in ('owner@quantis.local', 'intruder@quantis.local')");
  ownerId = users.find((u) => u.email === "owner@quantis.local")?.id ?? "";
  intruderId = users.find((u) => u.email === "intruder@quantis.local")?.id ?? "";
  if (!ownerId || !intruderId) throw new Error("評価用ユーザーがいません（pnpm seed:users を実行してください）");
  await cleanup();
});

beforeEach(async () => {
  await cleanup();
  await db.query(
    `insert into public.stocks (code, company_name, market_code, market_name, sector33_code, sector33_name, product_category)
     values ('9R801', '選び方テスト株式会社', '0113', 'グロース', '5250', '情報・通信業', '011')`,
  );
});

afterAll(async () => {
  await cleanup();
  await db.end();
});

describe("事業の内容の書類の選び方（C7-1〜C7-9）", () => {
  it("C7-1: 元の有報（ok）＋訂正（section_not_found）→ 元の有報、fallback", async () => {
    await insertDocs([
      { id: "S16SEL01", submitted: "2025-06-25 15:00+09" },
      { id: "S16SEL02", type: "130", periodEnd: null, parent: "S16SEL01", submitted: "2025-08-01 15:00+09" },
    ]);
    await description("S16SEL01", "ok", "元の段落です。");
    await description("S16SEL02", "section_not_found");
    expect(await section()).toEqual({ doc_id: "S16SEL01", status: "ok", detail: null, fallback: true, latest_doc_id: "S16SEL02", latest_status: "section_not_found" });
  });

  it("C7-2: 元の有報（ok）＋訂正（no_xbrl）→ 元の有報、fallback、latest_status は no_xbrl", async () => {
    await insertDocs([
      { id: "S16SEL01", submitted: "2025-06-25 15:00+09" },
      { id: "S16SEL02", type: "130", periodEnd: null, parent: "S16SEL01", submitted: "2025-08-01 15:00+09" },
    ]);
    await description("S16SEL01", "ok", "元の段落です。");
    await description("S16SEL02", "no_xbrl", null, "no_inline_xbrl");
    expect(await section()).toMatchObject({ doc_id: "S16SEL01", fallback: true, latest_status: "no_xbrl" });
  });

  it("C7-3: 元の有報（ok）＋訂正（invalid_values）→ 訂正の失敗で止まる", async () => {
    await insertDocs([
      { id: "S16SEL01", submitted: "2025-06-25 15:00+09" },
      { id: "S16SEL02", type: "130", periodEnd: null, parent: "S16SEL01", submitted: "2025-08-01 15:00+09" },
    ]);
    await description("S16SEL01", "ok", "元の段落です。");
    await description("S16SEL02", "invalid_values", null, "no_paragraph");
    expect(await section()).toMatchObject({ doc_id: "S16SEL02", status: "invalid_values", detail: "no_paragraph", fallback: false });
  });

  it("C7-4: 元の有報（ok）＋訂正（未処理）→ 訂正の取り込み待ち", async () => {
    await insertDocs([
      { id: "S16SEL01", submitted: "2025-06-25 15:00+09" },
      { id: "S16SEL02", type: "130", periodEnd: null, parent: "S16SEL01", submitted: "2025-08-01 15:00+09" },
    ]);
    await description("S16SEL01", "ok", "元の段落です。");
    expect(await section()).toMatchObject({ doc_id: "S16SEL02", status: "pending", fallback: false });
  });

  it("C7-5: 訂正が2通（どちらも ok）→ 提出が新しい方", async () => {
    await insertDocs([
      { id: "S16SEL01", submitted: "2025-06-25 15:00+09" },
      { id: "S16SEL02", type: "130", periodEnd: null, parent: "S16SEL01", submitted: "2025-08-01 15:00+09" },
      { id: "S16SEL03", type: "130", periodEnd: null, parent: "S16SEL01", submitted: "2025-09-01 15:00+09" },
    ]);
    await description("S16SEL01", "ok", "元の段落です。");
    await description("S16SEL02", "ok", "訂正1の段落です。");
    await description("S16SEL03", "ok", "訂正2の段落です。");
    expect(await section()).toMatchObject({ doc_id: "S16SEL03", status: "ok", fallback: false });
  });

  it("C7-6: 候補がすべて section_not_found → 最新の書類の section_not_found", async () => {
    await insertDocs([
      { id: "S16SEL01", submitted: "2025-06-25 15:00+09" },
      { id: "S16SEL02", type: "130", periodEnd: null, parent: "S16SEL01", submitted: "2025-08-01 15:00+09" },
    ]);
    await description("S16SEL01", "section_not_found");
    await description("S16SEL02", "section_not_found");
    expect(await section()).toMatchObject({ doc_id: "S16SEL02", status: "section_not_found", fallback: false });
  });

  it("C7-7: 取り下げ・不開示・事業年度を決められない訂正は使わない", async () => {
    await insertDocs([
      { id: "S16SEL01", submitted: "2025-06-25 15:00+09" },
      { id: "S16SEL02", type: "130", periodEnd: null, parent: "S16SEL01", submitted: "2025-08-01 15:00+09", withdrawn: true },
      { id: "S16SEL03", type: "130", periodEnd: null, parent: "S16SEL01", submitted: "2025-09-01 15:00+09", withheld: true },
      // 元の書類が期間外（保存されていない）の訂正（事業年度を決められない）
      { id: "S16SEL04", type: "130", periodEnd: null, parent: "S16SELOUT", submitted: "2025-10-01 15:00+09" },
    ]);
    await description("S16SEL01", "ok", "元の段落です。");
    await description("S16SEL02", "ok", "取り下げの段落です。");
    await description("S16SEL03", "ok", "不開示の段落です。");
    await description("S16SEL04", "ok", "期不明の段落です。");
    expect(await section()).toMatchObject({ doc_id: "S16SEL01", status: "ok", fallback: false, latest_doc_id: "S16SEL01" });
    // 元の有報も不開示にすると候補が無い（行を返さない）
    await db.query("update public.edinet_documents set withheld = true where doc_id = 'S16SEL01'");
    expect(await section()).toBeNull();
    expect((await db.query("select public.business_description_detail('9R801') as d")).rows[0].d).toBeNull();
  });

  it("C7-8: 古い事業年度の有報に段落があっても、新しい事業年度の有報の状態（取り込み待ち・失敗）を使う", async () => {
    await insertDocs([
      { id: "S16SEL01", periodEnd: "2024-03-31", submitted: "2024-06-25 15:00+09" },
      { id: "S16SEL02", periodEnd: "2025-03-31", submitted: "2025-06-25 15:00+09" },
    ]);
    await description("S16SEL01", "ok", "古い事業年度の段落です。");
    expect(await section()).toMatchObject({ doc_id: "S16SEL02", status: "pending" });
    await description("S16SEL02", "section_not_found");
    expect(await section()).toMatchObject({ doc_id: "S16SEL02", status: "section_not_found", fallback: false });
  });

  it("C7-9: 大株主・役員の区画と同じ書類を選ぶ構成では doc_id が一致する。詳細の関数の形はアプリのスキーマに合う", async () => {
    await insertDocs([
      { id: "S16SEL01", submitted: "2025-06-25 15:00+09" },
      { id: "S16SEL02", type: "130", periodEnd: null, parent: "S16SEL01", submitted: "2025-08-01 15:00+09" },
    ]);
    await db.query(
      `insert into public.annual_report_extractions (doc_id, shareholders_status, officers_status) values ('S16SEL01', 'ok', 'ok'), ('S16SEL02', 'section_not_found', 'section_not_found')`,
    );
    await description("S16SEL01", "ok", "元の段落です。");
    await description("S16SEL02", "section_not_found");
    const { rows } = await db.query("select shareholders_doc_id from public.annual_report_sections where code = '9R801'");
    expect(rows[0].shareholders_doc_id).toBe((await section()).doc_id);
    const detail = (await db.query("select public.business_description_detail('9R801') as d")).rows[0].d;
    const parsed = businessDescriptionRowSchema.parse(detail);
    expect(parsed).toMatchObject({
      status: "ok",
      paragraph: "元の段落です。",
      fallback: true,
      document: { doc_id: "S16SEL01", period_end: "2025-03-31" },
      latest: { doc_id: "S16SEL02", status: "section_not_found" },
    });
  });

  it("段落の check 制約: ok だけ段落あり、前後の空白・空・20,000 超は拒否", async () => {
    await insertDocs([{ id: "S16SEL01", submitted: "2025-06-25 15:00+09" }]);
    for (const [status, paragraph] of [
      ["ok", null],
      ["section_not_found", "段落"],
      ["ok", ""],
      ["ok", " 前に空白"],
      ["ok", "後ろに全角空白　"],
      ["ok", "\n改行"],
      ["ok", "あ".repeat(20001)],
    ] as const) {
      await expect(description("S16SEL01", status, paragraph), `${status} ${String(paragraph).slice(0, 10)}`).rejects.toThrow(/check constraint/);
    }
    await description("S16SEL01", "ok", "𠮷".repeat(20000));
  });
});

describe("権限（C7-10）", () => {
  beforeEach(async () => {
    await insertDocs([{ id: "S16SEL01", submitted: "2025-06-25 15:00+09" }]);
    await description("S16SEL01", "ok", "権限の段落です。");
  });

  it("許可ユーザーは詳細の関数を実行でき、テーブルを読める。許可リスト外・anon は読めない", async () => {
    const owner = await asUser(ownerId, async () => ({
      detail: (await db.query("select public.business_description_detail('9R801') as d")).rows[0].d,
      rows: (await db.query("select count(*)::int as n from public.business_description_extractions where doc_id = 'S16SEL01'")).rows[0].n,
      summary: (await db.query("select public.annual_reports_summary() -> 'businessDescription' as s")).rows[0].s,
    }));
    expect(owner.detail).toMatchObject({ status: "ok", paragraph: "権限の段落です。" });
    expect(owner.rows).toBe(1);
    expect(owner.summary).toMatchObject({ stockCount: 1, extractedStockCount: 1, pendingDocumentCount: 0 });

    const intruder = await asUser(intruderId, async () => ({
      detail: (await db.query("select public.business_description_detail('9R801') as d")).rows[0].d,
      rows: (await db.query("select count(*)::int as n from public.business_description_extractions")).rows[0].n,
    }));
    expect(intruder).toEqual({ detail: null, rows: 0 });

    await expect(asUser(null, () => db.query("select count(*) from public.business_description_extractions"))).rejects.toThrow(/permission denied/);
    await expect(asUser(null, () => db.query("select public.business_description_detail('9R801')"))).rejects.toThrow(/permission denied/);
  });

  it("authenticated は書き込めず、保存の関数も実行できない", async () => {
    for (const statement of [
      "insert into public.business_description_extractions (doc_id, status) values ('S16SEL01', 'section_not_found')",
      "update public.business_description_extractions set paragraph = '書き換え' where doc_id = 'S16SEL01'",
      "delete from public.business_description_extractions where doc_id = 'S16SEL01'",
      "select public.save_edinet_extractions(1, 'S16SEL01', null, null, '{\"status\":\"ok\",\"paragraph\":\"x\"}'::jsonb)",
    ]) {
      await expect(asUser(ownerId, () => db.query(statement)), statement).rejects.toThrow(/permission denied/);
    }
  });
});

describe("性能（C7-11。4,000 銘柄・有報 6,000 通）", () => {
  it("business_description_detail は 20ms 以内、annual_reports_summary・edinet_ingestion_state は変更前の 2 倍以内", async () => {
    await db.query(`
      insert into public.stocks (code, company_name, market_code, market_name, sector33_code, sector33_name, product_category)
      select 'D' || lpad(i::text, 4, '0'), 'DB16性能' || i, '0111', 'プライム', '5250', '情報・通信業', '011' from generate_series(0, 3999) i;
      insert into public.edinet_documents (doc_id, sec_code, edinet_code, doc_type_code, ordinance_code, form_code, period_start, period_end,
        submitted_at, parent_doc_id, withdrawn, withheld, xbrl_available, list_date)
      select 'S16PERF' || lpad(i::text, 4, '0') || 'A', 'D' || lpad(i::text, 4, '0'), 'E9RP' || lpad(i::text, 4, '0'), '120', '010', '030000',
             '2024-04-01', '2025-03-31', '2025-06-25 15:00+09', null, false, false, true, '2025-06-25'
        from generate_series(0, 3999) i;
      insert into public.edinet_documents (doc_id, sec_code, edinet_code, doc_type_code, ordinance_code, form_code, period_start, period_end,
        submitted_at, parent_doc_id, withdrawn, withheld, xbrl_available, list_date)
      select 'S16PERF' || lpad(i::text, 4, '0') || 'B', 'D' || lpad(i::text, 4, '0'), 'E9RP' || lpad(i::text, 4, '0'), '130', '010', '030001',
             null, null, '2025-08-01 15:00+09', 'S16PERF' || lpad(i::text, 4, '0') || 'A', false, false, true, '2025-08-01'
        from generate_series(0, 1999) i;
      insert into public.annual_report_extractions (doc_id, shareholders_status, officers_status)
      select doc_id, 'ok', 'ok' from public.edinet_documents where doc_id like 'S16PERF%';
      -- 訂正の半分は区画なし（元の有報へ）、残りは段落あり。訂正の無い銘柄の半分は取り込み待ち
      insert into public.business_description_extractions (doc_id, status, paragraph)
      select doc_id,
             case when doc_id like '%B' and right(left(doc_id, 11), 1)::int % 2 = 0 then 'section_not_found' else 'ok' end,
             case when doc_id like '%B' and right(left(doc_id, 11), 1)::int % 2 = 0 then null else '当社は性能の検証用の会社であります。' end
        from public.edinet_documents where doc_id like 'S16PERF%' and (doc_id like '%B' or doc_id < 'S16PERF3000');
      analyze public.stocks; analyze public.edinet_documents; analyze public.annual_report_extractions;
      analyze public.business_description_extractions; analyze public.ownership_judgments;
    `);
    const measure = async (fn: () => Promise<unknown>, times = 5) => {
      await fn();
      const samples: number[] = [];
      for (let i = 0; i < times; i++) {
        const start = performance.now();
        await fn();
        samples.push(performance.now() - start);
      }
      return Math.min(...samples);
    };
    const detailMs = await asUser(ownerId, () => measure(() => db.query("select public.business_description_detail('D0123')")));
    const summaryMs = await asUser(ownerId, () => measure(() => db.query("select public.annual_reports_summary()"), 3));
    const stateMs = await measure(() => db.query("select public.edinet_ingestion_state('2024-04-01', '2025-09-01')"), 3);
    console.log(`[性能] business_description_detail ${detailMs.toFixed(1)}ms / annual_reports_summary ${summaryMs.toFixed(1)}ms / edinet_ingestion_state ${stateMs.toFixed(1)}ms`);
    // 変更前の実測値（同じ規模。self-review に記録）: annual_reports_summary 約 40ms、edinet_ingestion_state 約 150ms
    expect(detailMs).toBeLessThan(20);
    expect(summaryMs).toBeLessThan(80);
    expect(stateMs).toBeLessThan(300);
    const summary = await asUser(ownerId, async () => (await db.query("select public.annual_reports_summary() -> 'businessDescription' as s")).rows[0].s);
    expect(summary.stockCount).toBe(4001);
    expect(summary.pendingDocumentCount).toBe(1000);
  });
});
