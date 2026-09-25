/**
 * 条件④（Sprint 10）の判定ロジック・再計算のトリガー・権限・性能の結合テスト（契約の C1・C5・C6・C8-2・C11）。
 * 実行: pnpm test:db（銘柄マスタ・EDINET の書類が0件の DB）。
 * 投入は契約の第5章の e2e/fixtures/ownership-example.sql（9U001〜9U014、SXTEST…、E99U…）と、この中で作る
 * 9U8xx・SXSEL…・E9SX…、性能の Q0000〜Q3999・SXPERF…。後片付けで自分の行だけを消す。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { readRealFixture } from "@/lib/ingestion/edinet/__fixtures__/synthetic";
import { extractAnnualReport } from "@/lib/ingestion/edinet/annual-report";
import { readInlineXbrl } from "@/lib/ingestion/edinet/xbrl";

const DB_URL = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const FIXTURES = join(__dirname, "../../../e2e/fixtures");
const EXAMPLE_SQL = readFileSync(join(FIXTURES, "ownership-example.sql"), "utf8");
const CLEANUP_SQL = readFileSync(join(FIXTURES, "ownership-cleanup.sql"), "utf8");

const db = new Client({ connectionString: DB_URL });
let ownerId = "";
let intruderId = "";

async function cleanup() {
  await db.query("delete from public.edinet_documents where doc_id like 'SXSEL%' or doc_id like 'SXPERF%'");
  await db.query("delete from public.stocks where code like '9U8%' or code ~ '^Q[0-9]{4}$'");
  await db.query(CLEANUP_SQL);
}

type Holder = [name: string, ratio: string];
type Officer = [name: string, title: string];

/** 純粋な関数を呼ぶ（書類・銘柄の情報を渡さない） */
async function judge(holders: Holder[], officers: Officer[]) {
  const { rows } = await db.query("select public.ownership_judgment_from_sections($1::jsonb, $2::jsonb) as r", [
    JSON.stringify(holders.map(([name, ratio], i) => ({ rank: i + 1, name, ratio_pct: ratio, ratio_decimals: 2 }))),
    JSON.stringify(officers.map(([name, title], i) => ({ seq: i + 1, name, title }))),
  ]);
  return rows[0].r;
}

const categories = (r: { holders: { category: string }[] }) => r.holders.map((h) => h.category);
const presidentNames = (r: { presidents: { name: string }[] }) => r.presidents.map((p) => p.name);

async function key(name: string): Promise<string> {
  const { rows } = await db.query("select public.ownership_name_key($1) as k", [name]);
  return rows[0].k;
}

async function judgment(code: string) {
  const { rows } = await db.query(
    `select status, undeterminable_reason, president_is_top_holder, owner_total_pct::text as total,
            shareholders_doc_id, officers_doc_id, shareholders_pending_doc_id, officers_pending_doc_id
       from public.ownership_judgments where code = $1`,
    [code],
  );
  return rows[0] ?? null;
}

/** 許可リストのユーザー（authenticated）として、1つのトランザクションの中で実行する。 */
async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  await db.query("begin");
  try {
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
    return await fn();
  } finally {
    await db.query("rollback");
  }
}

async function insertStock(code: string) {
  await db.query(
    `insert into public.stocks (code, company_name, market_code, market_name, sector33_code, sector33_name, product_category)
     values ($1, $2, '0113', 'グロース', '5250', '情報・通信業', '011') on conflict do nothing`,
    [code, `判定テスト${code}株式会社`],
  );
}

type Doc = { id: string; code: string; type?: "120" | "130"; end?: string | null; submitted: string; parent?: string };
async function insertDoc(d: Doc) {
  await db.query(
    `insert into public.edinet_documents (doc_id, sec_code, edinet_code, doc_type_code, ordinance_code, form_code, period_start, period_end,
       submitted_at, parent_doc_id, xbrl_available, list_date)
     values ($1, $2, 'E9SX01', $3, '010', '030000', null, $4, $5, $6, true, '2026-06-25')`,
    [d.id, d.code, d.type ?? "120", d.end === undefined ? "2026-03-31" : d.end, d.submitted, d.parent ?? null],
  );
}

async function insertExtraction(docId: string, sh = "ok", off = "ok", holders: Holder[] = [], officers: Officer[] = []) {
  await db.query(
    `insert into public.annual_report_extractions (doc_id, shareholders_status, officers_status, officers_basis, officers_order_source)
     values ($1, $2, $3, 'filing_date', 'inline_document')`,
    [docId, sh, off],
  );
  for (const [i, [name, ratio]] of holders.entries()) {
    await db.query("insert into public.annual_report_shareholders (doc_id, rank, name, ratio_pct, ratio_decimals) values ($1, $2, $3, $4, 2)", [
      docId,
      i + 1,
      name,
      ratio,
    ]);
  }
  for (const [i, [name, title]] of officers.entries()) {
    await db.query("insert into public.annual_report_officers (doc_id, seq, name, title) values ($1, $2, $3, $4)", [docId, i + 1, name, title]);
  }
}

beforeAll(async () => {
  await db.connect();
  const { rows: others } = await db.query(
    `select (select count(*) from public.stocks)::int + (select count(*) from public.edinet_documents)::int as n`,
  );
  if (others[0].n > 0) throw new Error("銘柄または EDINET の書類があるため、始められません（pnpm db:reset 直後の DB で実行してください）");
  const { rows: users } = await db.query("select id::text, email from auth.users where email in ('owner@quantis.local', 'intruder@quantis.local')");
  ownerId = users.find((u) => u.email === "owner@quantis.local")?.id ?? "";
  intruderId = users.find((u) => u.email === "intruder@quantis.local")?.id ?? "";
  if (!ownerId || !intruderId) throw new Error("評価用ユーザーがいません（pnpm seed:users を実行してください）");
});

beforeEach(async () => {
  await cleanup();
  await db.query(EXAMPLE_SQL);
});

afterAll(async () => {
  await cleanup();
  const { rows } = await db.query(
    `select (select count(*) from public.ownership_judgments where code like '9U%' or code ~ '^Q[0-9]{4}$')::int as judgments,
            (select count(*) from public.ownership_holder_classifications where code like '9U%' or code ~ '^Q[0-9]{4}$')::int as holders,
            (select count(*) from public.stocks)::int as stocks`,
  );
  await db.end();
  expect(rows[0]).toEqual({ judgments: 0, holders: 0, stocks: 0 });
});

describe("第5章の投入例の期待値（C1・AC9.1〜AC9.4・AC9.10・AC9.14）", () => {
  it("判定の状態・合計・筆頭株主・取り込み待ちの書類", async () => {
    const { rows } = await db.query(
      `select code, status, undeterminable_reason as reason, president_is_top_holder as top, owner_total_pct::text as total,
              president_pct::text as p, officer_pct::text as o, family_pct::text as f, asset_company_pct::text as a, other_pct::text as x,
              top_holders -> 0 ->> 'name' as top_name, shareholders_pending_doc_id as pending
         from public.ownership_judgments where code like '9U%' order by code`,
    );
    const d = (code: string, top: boolean, total: string, p: string, o: string, f: string, a: string, x: string, topName: string, pending: string | null = null) => ({
      code, status: "determined", reason: null, top, total, p, o, f, a, x, top_name: topName, pending,
    });
    const u = (code: string, reason: string, pending: string | null = null) => ({
      code, status: "undeterminable", reason, top: null, total: null, p: null, o: null, f: null, a: null, x: null, top_name: null, pending,
    });
    expect(rows).toEqual([
      d("9U001", true, "30.00", "30.00", "0", "0", "0", "13.00", "山田 太郎"),
      d("9U002", false, "23.00", "8.00", "0", "0", "15.00", "34.50", "日本マスタートラスト信託銀行株式会社（信託口）"),
      d("9U003", false, "0", "0", "0", "0", "0", "25.50", "株式会社日本カストディ銀行（信託口）"),
      u("9U005", "shareholders_not_extracted"),
      d("9U006", false, "35.00", "12.00", "0", "5.00", "18.00", "9.00", "有限会社山田興産"),
      d("9U007", false, "4.00", "0", "4.00", "0", "0", "17.00", "日本マスタートラスト信託銀行株式会社（信託口）"),
      d("9U008", true, "30.00", "30.00", "0", "0", "0", "5.00", "高橋　二郎"),
      d("9U009", true, "28.00", "15.00", "0", "3.00", "10.00", "0", "山崎　健"),
      d("9U010", true, "40.00", "40.00", "0", "0", "0", "8.00", "小川　大輔"),
      d("9U011", true, "35.00", "35.00", "0", "0", "0", "0", "木村　修"),
      d("9U012", true, "50.00", "50.00", "0", "0", "0", "0", "清水　隆"),
      u("9U013", "annual_report_pending", "SXTEST13"),
      d("9U014", true, "25.00", "25.00", "0", "0", "0", "7.00", "松本　浩", "SXTEST15"),
    ]);
    // 9U004 は有報が無いので行を作らない（有報が未取得）
    expect(await judgment("9U004")).toBeNull();
  });

  it("株主ごとの区分と理由（AC9.2・AC9.13・AC9.14）", async () => {
    const { rows } = await db.query(
      "select code, rank, category, reason_code, reason from public.ownership_holder_classifications where code in ('9U002', '9U006', '9U007') order by code, rank",
    );
    expect(rows.map((r) => [r.code, r.rank, r.category, r.reason_code])).toEqual([
      ["9U002", 1, "other", "financial_or_association"],
      ["9U002", 2, "asset_company", "surname_reading"],
      ["9U002", 3, "president", "president_name"],
      ["9U002", 4, "other", "financial_or_association"],
      ["9U002", 5, "other", "unrelated_individual"],
      ["9U002", 6, "other", "financial_or_association"],
      ["9U006", 1, "asset_company", "president_surname"],
      ["9U006", 2, "president", "president_name"],
      ["9U006", 3, "other", "financial_or_association"],
      ["9U006", 4, "family", "president_surname"],
      ["9U007", 1, "other", "financial_or_association"],
      ["9U007", 2, "other", "unrelated_corporation"],
      ["9U007", 3, "officer", "officer_name"],
    ]);
    expect(rows[1].reason).toEqual({ president_name: "山田　一郎", surname: "山田", reading: "ヤマダ" });
    expect(rows[12].reason).toEqual({ officer_name: "佐藤　一郎", officer_title: "取締役CFO" });
  });

  it("スクリーニングの件数と並び（第5章の表）", async () => {
    const base = { cagr: "20", margin: "10", years: "5" };
    const screen = async (params: object) => {
      const { rows } = await db.query("select public.screen_stocks($1::jsonb) as r", [JSON.stringify({ ...base, pageSize: 100, ...params })]);
      return { total: rows[0].r.total as number, excluded: rows[0].r.excludedUndeterminable as number, codes: rows[0].r.rows.map((x: { code: string }) => x.code) };
    };
    expect(await screen({})).toEqual({ total: 7, excluded: 3, codes: ["9U001", "9U002", "9U006", "9U008", "9U009", "9U010", "9U014"] });
    expect((await screen({ ownerMode: "president" })).codes).toEqual(["9U001", "9U008", "9U009", "9U010", "9U014"]);
    expect((await screen({ owner: "24" })).total).toBe(6);
    expect((await screen({ owner: "40" })).codes).toEqual(["9U001", "9U008", "9U009", "9U010", "9U014"]);
    expect((await screen({ owner: "30" })).total).toBe(6);
    expect(await screen({ includeUndeterminable: true })).toMatchObject({ total: 10, excluded: 0 });
    expect((await screen({ includeUnavailable: true })).total).toBe(7);
    expect((await screen({ ownerOn: false })).total).toBe(12);
    expect((await screen({ sort: "owner", order: "desc" })).codes).toEqual(["9U010", "9U006", "9U001", "9U008", "9U009", "9U014", "9U002"]);
    expect((await screen({ sort: "owner", order: "asc", includeUndeterminable: true })).codes).toEqual([
      "9U002", "9U014", "9U009", "9U001", "9U008", "9U006", "9U010", "9U004", "9U005", "9U013",
    ]);
    expect((await screen({ sort: "owner", order: "desc", includeUndeterminable: true })).codes.slice(-3)).toEqual(["9U004", "9U005", "9U013"]);
  });

  it("ダッシュボードと取り込み状況の数（C7）", async () => {
    const { rows } = await db.query("select public.dashboard_summary() ->> 'ownershipDeterminedCount' as n, public.annual_reports_summary() -> 'ownership' as o");
    expect(rows[0].n).toBe("11");
    expect(rows[0].o).toEqual({
      determinedCount: 11,
      noAnnualReportCount: 1,
      annualReportPendingCount: 1,
      shareholdersNotExtractedCount: 1,
      officersNotExtractedCount: 0,
      presidentNotFoundCount: 0,
      previousReportCount: 1,
    });
  });
});

describe("判定ロジック（純粋な関数。C6・AC9.9）", () => {
  it("空白・全角半角の違いがあっても氏名が一致する", async () => {
    const same = ["山田 太郎", "山田　太郎", "山田太郎", " 山田　　太郎 ", "山田\n太郎"];
    const keys = await Promise.all(same.map(key));
    expect(new Set(keys)).toEqual(new Set(["山田太郎"]));
    expect(await key("ＪＯＨＮ　ＳＭＩＴＨ")).toBe(await key("JOHN SMITH"));
    expect(await key("ﾔﾏﾀﾞﾎｰﾙﾃﾞｨﾝｸﾞｽ")).toBe(await key("ヤマダホールディングス"));
    expect(await key("やまだ")).toBe(await key("ヤマダ"));
    const r = await judge([["山田 太郎", "30.00"]], [["山田太郎", "代表取締役社長"]]);
    expect(r).toMatchObject({ status: "determined", president_is_top_holder: true });
    const half = await judge([["ﾔﾏﾀﾞﾎｰﾙﾃﾞｨﾝｸﾞｽ株式会社", "20.00"]], [["山田　一郎", "代表取締役社長"]]);
    expect(half.holders[0]).toMatchObject({ category: "asset_company", reason_code: "surname_reading" });
  });

  it("旧字体・異体字（契約の第2章の2の表のすべての組）", async () => {
    const pairs = [
      ["髙", "高"], ["﨑", "崎"], ["嵜", "崎"], ["邊", "辺"], ["邉", "辺"], ["濵", "浜"], ["濱", "浜"], ["齋", "斎"], ["齊", "斉"], ["澤", "沢"],
      ["櫻", "桜"], ["廣", "広"], ["國", "国"], ["德", "徳"], ["惠", "恵"], ["榮", "栄"], ["眞", "真"], ["冨", "富"], ["嶋", "島"], ["嶌", "島"],
      ["槗", "橋"], ["瀨", "瀬"], ["證", "証"],
    ];
    for (const [oldForm, newForm] of pairs) expect(await key(`${oldForm}田 太郎`), oldForm).toBe(await key(`${newForm}田太郎`));
    // 氏名の一致（髙／高・﨑／崎）と姓の一致
    const taka = await judge(
      [["高橋　二郎", "20.00"], ["高橋　花子", "3.00"]],
      [["髙橋　二郎", "代表取締役社長"]],
    );
    expect(categories(taka)).toEqual(["president", "family"]);
    const saki = await judge(
      [["山崎　健", "15.00"], ["山﨑　美香", "3.00"], ["株式会社ヤマサキ興産", "2.00"]],
      [["山﨑　健", "代表取締役 CEO"]],
    );
    expect(categories(saki)).toEqual(["president", "family", "asset_company"]);
    expect(saki.presidents[0]).toMatchObject({ surname: "山﨑", surname_key: "山崎" });
  });

  it("社長が複数: どちらが筆頭株主でも該当。どちらの姓でも同姓・資産管理会社と推定する", async () => {
    const officers: Officer[] = [["鈴木　一郎", "代表取締役社長"], ["高橋　二郎", "代表取締役 社長執行役員"], ["佐藤　三郎", "取締役"]];
    const first = await judge([["鈴木　一郎", "20.00"], ["高橋　二郎", "10.00"]], officers);
    const second = await judge([["高橋　二郎", "20.00"], ["鈴木　一郎", "10.00"]], officers);
    expect(first.president_is_top_holder).toBe(true);
    expect(second.president_is_top_holder).toBe(true);
    expect(presidentNames(first)).toEqual(["鈴木　一郎", "高橋　二郎"]);
    const estimated = await judge(
      [["信託銀行株式会社（信託口）", "20.00"], ["鈴木　花子", "5.00"], ["高橋　花子", "4.00"], ["株式会社スズキ", "3.00"], ["有限会社高橋", "2.00"]],
      officers,
    );
    expect(categories(estimated)).toEqual(["other", "family", "family", "asset_company", "asset_company"]);
    expect(estimated.president_is_top_holder).toBe(false);
  });

  it("社長の特定（第2章の3。R1・S3）", async () => {
    const isPresident = async (title: string) => {
      const r = await judge([["株主　太郎", "10.00"]], [["役員　一郎", title], ["役員　二郎", "取締役"], ["役員　三郎", "代表取締役会長"]]);
      return r.presidents?.some((p: { name: string; basis: string }) => p.name === "役員　一郎" && p.basis === "title") ?? false;
    };
    for (const title of ["代表取締役社長", "代表取締役 社長執行役員", "代表執行役社長", "代表取締役CEO", "代表取締役会長 兼 CEO", "代表取締役会長兼社長", "取締役頭取（代表取締役）"]) {
      expect(await isPresident(title), title).toBe(true);
    }
    for (const title of ["代表取締役副社長", "代表取締役副頭取", "\n\n代表取締役\n\n\n専務執行役員\n\n\n社長補佐\n\n", "取締役社長執行役員", "代表取締役会長", "取締役CFO"]) {
      expect(await isPresident(title), title).toBe(false);
    }
    // 銀行: 頭取と副頭取がともに代表取締役 → 社長候補は頭取だけ
    const bank = await judge([["株主　太郎", "10.00"]], [["銀行　頭取", "取締役頭取（代表取締役）"], ["銀行　副頭", "代表取締役副頭取"]]);
    expect(presidentNames(bank)).toEqual(["銀行　頭取"]);
    // 代表者による補い（会長・副社長も候補になる）
    const rep = await judge([["株主　太郎", "10.00"]], [["会長　一郎", "代表取締役会長"], ["副社　二郎", "代表取締役副社長"], ["平　三郎", "取締役"]]);
    expect(rep.basis).toBe("representative");
    expect(presidentNames(rep)).toEqual(["会長　一郎", "副社　二郎"]);
    // 「取締役社長」等による補い（S3）
    const noRep = await judge([["株主　太郎", "10.00"]], [["社長　一郎", "取締役社長"], ["平　三郎", "取締役"]]);
    expect(noRep.basis).toBe("title_without_representative");
    expect(presidentNames(noRep)).toEqual(["社長　一郎"]);
    // 社長がいない
    expect(await judge([["株主　太郎", "10.00"]], [["平　三郎", "取締役"], ["監査　四郎", "監査役"]])).toEqual({
      status: "undeterminable",
      reason: "president_not_found",
    });
  });

  it("姓（R3・S2・S5）", async () => {
    // 空白の無い役員の氏名 → 一致した大株主の記載から
    const fromHolder = await judge([["山田 太郎", "30.00"], ["山田　花子", "5.00"]], [["山田太郎", "代表取締役社長"]]);
    expect(fromHolder.presidents[0]).toMatchObject({ surname: "山田", surname_source: "shareholder" });
    expect(categories(fromHolder)).toEqual(["president", "family"]);
    // 決まらない → 同姓と姓・読みによる資産管理会社の推定をしない。氏名を名称に含む法人は資産管理会社
    const unknown = await judge(
      [["山田　花子", "5.00"], ["株式会社ヤマダ", "4.00"], ["株式会社山田太郎事務所", "3.00"], ["山田興産株式会社", "2.00"]],
      [["山田太郎", "代表取締役社長"]],
    );
    expect(unknown.presidents[0]).toMatchObject({ surname: null, surname_key: null });
    expect(categories(unknown)).toEqual(["other", "other", "asset_company", "other"]);
    expect(unknown.holders[2]).toMatchObject({ reason_code: "president_full_name" });
    // 1文字ずつの区切りからは決めない（S2）
    const spaced = await judge([["株主　太郎", "10.00"]], [["山 田 太 郎", "代表取締役社長"]]);
    expect(spaced.presidents[0].surname).toBeNull();
    // 連続した空白（S5。S100W4KN の「宗政　　寛」）
    const mune = await judge([["宗政　寛", "10.00"]], [["宗政　　寛", "代表取締役社長"]]);
    expect(mune.presidents[0]).toMatchObject({ surname: "宗政" });
    expect(mune.president_is_top_holder).toBe(true);
    // 常任代理人の括弧は氏名の比較でも除く
    expect(await key("山田 太郎（常任代理人 株式会社三菱UFJ銀行）")).toBe("山田太郎");
  });

  it("区分の優先（社長本人 > 役員本人 > 同姓の親族）", async () => {
    const r = await judge(
      [["山田　太郎", "10.00"], ["山田　次郎", "5.00"], ["山田　三郎", "3.00"]],
      [["山田　太郎", "代表取締役社長"], ["山田　次郎", "取締役"]],
    );
    expect(categories(r)).toEqual(["president", "officer", "family"]);
  });

  it("法人・個人と除く語（第2章の4・5。R2・S1・既知の制限）", async () => {
    const officers: Officer[] = [["山田　一郎", "代表取締役社長"]];
    const r = await judge(
      [
        ["山田信託銀行株式会社（信託口）", "9.00"],
        ["山田証券株式会社", "8.00"],
        ["山田工業従業員持株会", "7.00"],
        ["THE BANK OF NEW YORK MELLON 140044", "6.00"],
        ["STATE STREET BANK AND TRUST COMPANY 505223", "5.00"],
        ["YAMADA KOSAN CO., LTD.", "4.00"],
        ["YAMADAYA INC.", "3.00"],
        ["株式会社ヤマダ", "2.00"],
      ],
      officers,
    );
    expect(r.holders.map((h: { category: string; reason_code: string }) => `${h.category}:${h.reason_code}`)).toEqual([
      "other:financial_or_association",
      "other:financial_or_association",
      "other:financial_or_association",
      "other:financial_or_association",
      "other:financial_or_association",
      "asset_company:surname_romaji",
      "other:unrelated_corporation",
      "asset_company:surname_reading",
    ]);
    // 1文字の姓（森）: 法人格の語を除いた先頭だけ。読み「モリ」（2文字）は使わない
    const mori = await judge(
      [["株式会社森ビル", "5.00"], ["株式会社青森物産", "4.00"], ["株式会社モリ産業", "3.00"]],
      [["森　太郎", "代表取締役社長"]],
    );
    expect(categories(mori)).toEqual(["asset_company", "other", "other"]);
    // 證券（S1）
    const nomura = await judge([["野村證券株式会社", "5.00"]], [["野村　太郎", "代表取締役社長"]]);
    expect(nomura.holders[0]).toMatchObject({ category: "other", reason_code: "financial_or_association" });
    // 常任代理人（R2）
    const agent = await judge(
      [["山田 太郎（常任代理人 株式会社三菱UFJ銀行）", "30.00"], ["MSIP CLIENT SECURITIES（常任代理人 モルガン・スタンレーMUFG証券株式会社）", "5.00"]],
      [["山田　太郎", "代表取締役社長"]],
    );
    expect(categories(agent)).toEqual(["president", "other"]);
    expect(agent.president_is_top_holder).toBe(true);
    // 既知の制限: 読み「アライ」（新井）が外来語に含まれて一致する
    const arai = await judge([["株式会社テストアライアンス", "5.00"]], [["新井　太郎", "代表取締役社長"]]);
    expect(arai.holders[0]).toMatchObject({ category: "asset_company", reason_code: "surname_reading" });
  });

  it("筆頭株主の同率と比率の合計", async () => {
    const tie = await judge([["株式会社検証", "20.00"], ["社長　太郎", "20.00"], ["他人　次郎", "1.00"]], [["社長　太郎", "代表取締役社長"]]);
    expect(tie.top_holders.map((t: { rank: number }) => t.rank)).toEqual([1, 2]);
    expect(tie.president_is_top_holder).toBe(true);
    const sum = await judge([["社長　太郎", "0.57"], ["社長　花子", "19.43"], ["他人　次郎", "25.00"]], [["社長　太郎", "代表取締役社長"]]);
    expect(sum.totals.owner_total).toBe(20.0);
    const { rows } = await db.query("select trunc(19.98::numeric, 1)::text as t");
    expect(rows[0].t).toBe("19.9");
  });

  it("大株主の行が無い", async () => {
    expect(await judge([], [["社長　太郎", "代表取締役社長"]])).toMatchObject({ status: "undeterminable", reason: "shareholders_not_extracted" });
  });

  it("姓の読みの辞書（1,000 姓以上、主な姓の読み）", async () => {
    const { rows } = await db.query("select count(distinct surname)::int as n from public.surname_readings");
    expect(rows[0].n).toBeGreaterThanOrEqual(1000);
    const expected: Record<string, string[]> = {
      佐藤: ["サトウ"], 鈴木: ["スズキ"], 高橋: ["タカハシ"], 田中: ["タナカ"], 伊藤: ["イトウ"], 渡辺: ["ワタナベ"], 山本: ["ヤマモト"],
      中村: ["ナカムラ"], 小林: ["コバヤシ"], 加藤: ["カトウ"], 山田: ["ヤマダ"], 山崎: ["ヤマサキ", "ヤマザキ"], 中島: ["ナカシマ", "ナカジマ"], 斎藤: ["サイトウ"],
    };
    for (const [surname, readings] of Object.entries(expected)) {
      const { rows: r } = await db.query("select array_agg(reading order by reading) as a from public.surname_readings where surname = $1", [surname]);
      expect(r[0].a, surname).toEqual(readings);
    }
    const { rows: romaji } = await db.query("select romaji from public.surname_readings where surname = '大野'");
    expect(romaji[0].romaji).toEqual(["OONO", "ONO", "OHNO"]);
  });
});

describe("実データの形（Sprint 8 のフィクスチャ S100W7OT・S100W4KN・S100W5PD。C12-10）", () => {
  async function judgeReal(id: "S100W7OT" | "S100W4KN" | "S100W5PD") {
    const r = extractAnnualReport(readInlineXbrl([{ name: "doc", html: readRealFixture(id) }]));
    const { rows } = await db.query("select public.ownership_judgment_from_sections($1::jsonb, $2::jsonb) as r", [
      JSON.stringify(r.shareholders),
      JSON.stringify(r.officers),
    ]);
    return { extracted: r, judged: rows[0].r };
  }

  it("S100W7OT: 社長候補は前鶴 俊哉の1名だけ（「代表取締役 専務執行役員 社長補佐」は社長にならない。R1）。大株主に関係者はいない", async () => {
    const { extracted, judged } = await judgeReal("S100W7OT");
    // 役員の氏名は姓と名の間に全角空白がある（実データ）
    expect(extracted.officers.every((o) => /\u3000/.test(o.name))).toBe(true);
    expect(presidentNames(judged)).toEqual(["前鶴　俊哉"]);
    expect(judged.presidents[0]).toMatchObject({ basis: "title", surname: "前鶴", surname_source: "officer" });
    expect(judged.president_is_top_holder).toBe(false);
    expect(judged.totals.owner_total).toBe(0);
    // 持株会・信託口・銀行・保険は区分5
    expect(new Set(categories(judged))).toEqual(new Set(["other"]));
  });

  it("S100W4KN: 役員「宗政　　寛」（全角空白2つ）と大株主「宗政　寛」が一致し、姓は「宗政」（S5）", async () => {
    const { judged } = await judgeReal("S100W4KN");
    expect(presidentNames(judged)).toEqual(["宗政　　寛"]);
    expect(judged.presidents[0]).toMatchObject({ surname: "宗政" });
    expect(judged.holders[1]).toMatchObject({ name: "宗政　寛", category: "president", reason_code: "president_name" });
    expect(judged.totals.owner_total).toBe(13.5);
    expect(judged.president_is_top_holder).toBe(false);
    // 「取締役 副社長執行役員」は社長にならない
    expect(judged.presidents).toHaveLength(1);
  });

  it("S100W5PD: 常任代理人の付いた外国の名義は法人のまま区分5。社長は平尾 泰文", async () => {
    const { judged } = await judgeReal("S100W5PD");
    expect(presidentNames(judged)).toEqual(["平尾　泰文"]);
    expect(judged.holders[2]).toMatchObject({ category: "other", reason_code: "financial_or_association" });
    expect(judged.holders[7]).toMatchObject({ category: "other", reason_code: "financial_or_association" });
    expect(judged.totals.owner_total).toBe(0);
  });

  it("実データの役員の氏名に、1文字ずつ空白で区切った記載は無い（S2 の確認）", async () => {
    for (const id of ["S100W7OT", "S100W4KN", "S100W5PD"] as const) {
      const r = extractAnnualReport(readInlineXbrl([{ name: "doc", html: readRealFixture(id) }]));
      for (const o of r.officers) {
        const parts = o.name.normalize("NFKC").trim().split(/\s+/);
        expect(parts.length >= 3 && parts.every((x) => x.length === 1), `${id} ${o.name}`).toBe(false);
      }
    }
  });
});

describe("判定不能の理由の順番（第2章の7）", () => {
  it("有報なし → 取り込み待ち → 大株主 → 役員 → 社長", async () => {
    for (const code of ["9U801", "9U802", "9U803", "9U804", "9U805"]) await insertStock(code);
    await insertDoc({ id: "SXSEL02", code: "9U802", submitted: "2026-06-25 15:00+09" });
    await insertDoc({ id: "SXSEL03", code: "9U803", submitted: "2026-06-25 15:00+09" });
    await insertExtraction("SXSEL03", "section_not_found", "invalid_values");
    await insertDoc({ id: "SXSEL04", code: "9U804", submitted: "2026-06-25 15:00+09" });
    await insertExtraction("SXSEL04", "ok", "invalid_values", [["株主　太郎", "10.00"]]);
    await insertDoc({ id: "SXSEL05", code: "9U805", submitted: "2026-06-25 15:00+09" });
    await insertExtraction("SXSEL05", "ok", "ok", [["株主　太郎", "10.00"]], [["役員　一郎", "取締役"]]);
    expect(await judgment("9U801")).toBeNull();
    expect((await judgment("9U802")).undeterminable_reason).toBe("annual_report_pending");
    expect((await judgment("9U803")).undeterminable_reason).toBe("shareholders_not_extracted");
    expect((await judgment("9U804")).undeterminable_reason).toBe("officers_not_extracted");
    expect((await judgment("9U805")).undeterminable_reason).toBe("president_not_found");
    const { rows } = await db.query("select undeterminable_detail as d from public.ownership_judgments where code = '9U803'");
    expect(rows[0].d).toEqual({ status: "section_not_found", detail: null, doc_id: "SXSEL03" });
  });
});

describe("再計算のトリガー（C5）", () => {
  it("大株主の比率の変更で、同じトランザクションの中で再計算される（C5-1）", async () => {
    await db.query("begin");
    try {
      await db.query("update public.annual_report_shareholders set ratio_pct = 5.00 where doc_id = 'SXTEST06' and rank = 1");
      expect(await judgment("9U006")).toMatchObject({ total: "22.00", president_is_top_holder: true });
    } finally {
      await db.query("rollback");
    }
    expect(await judgment("9U006")).toMatchObject({ total: "35.00", president_is_top_holder: false });
  });

  it("取り下げ・不開示で有報が未取得になり、戻すと元に戻る（C5-2）", async () => {
    for (const column of ["withdrawn", "withheld"]) {
      await db.query(`update public.edinet_documents set ${column} = true where doc_id = 'SXTEST02'`);
      expect(await judgment("9U002"), column).toBeNull();
      await db.query(`update public.edinet_documents set ${column} = false where doc_id = 'SXTEST02'`);
      expect(await judgment("9U002"), column).toMatchObject({ status: "determined", total: "23.00" });
    }
  });

  it("取り込み待ちの書類に抽出を足すと判定される（C5-3）", async () => {
    await insertExtraction("SXTEST13", "ok", "ok", [["検証　六郎", "30.00"]], [["検証　六郎", "代表取締役社長"]]);
    expect(await judgment("9U013")).toMatchObject({ status: "determined", president_is_top_holder: true, shareholders_pending_doc_id: null });
  });

  it("訂正有報に大株主の区画が無いとき、大株主は元の有報、役員は訂正で判定する（C5-4）", async () => {
    await insertDoc({ id: "SXSEL61", code: "9U006", type: "130", end: null, parent: "SXTEST06", submitted: "2026-07-10 15:00+09" });
    await insertExtraction("SXSEL61", "section_not_found", "ok", [], [["山田　太郎", "代表取締役社長"], ["新任　五郎", "取締役"]]);
    expect(await judgment("9U006")).toMatchObject({ status: "determined", shareholders_doc_id: "SXTEST06", officers_doc_id: "SXSEL61", total: "35.00" });
  });

  it("取り込み待ちの書類が訂正有報のときは、処理済みの元の有報で判定する（評価の抜き取りの形）", async () => {
    await insertDoc({ id: "SXSEL62", code: "9U006", type: "130", end: null, parent: "SXTEST06", submitted: "2026-07-10 15:00+09" });
    expect(await judgment("9U006")).toMatchObject({
      status: "determined",
      shareholders_doc_id: "SXTEST06",
      officers_doc_id: "SXTEST06",
      shareholders_pending_doc_id: "SXSEL62",
      officers_pending_doc_id: "SXSEL62",
    });
  });

  it("社長の役職名を変えると社長が見つからない（C5-5）", async () => {
    await db.query("update public.annual_report_officers set title = '取締役' where doc_id = 'SXTEST06' and seq = 1");
    expect((await judgment("9U006")).undeterminable_reason).toBe("president_not_found");
    await db.query("update public.annual_report_officers set title = '代表取締役社長' where doc_id = 'SXTEST06' and seq = 1");
    expect((await judgment("9U006")).status).toBe("determined");
  });

  it("銘柄マスタに後から入った銘柄は、保存済みの有報で判定される（C5-6）", async () => {
    await insertDoc({ id: "SXSEL71", code: "9U871", submitted: "2026-06-25 15:00+09" });
    await insertExtraction("SXSEL71", "ok", "ok", [["後入　太郎", "40.00"]], [["後入　太郎", "代表取締役社長"]]);
    expect(await judgment("9U871")).toBeNull();
    await insertStock("9U871");
    expect(await judgment("9U871")).toMatchObject({ status: "determined", president_is_top_holder: true });
  });

  it("書類の削除（連鎖）と抽出の行の削除で再計算される", async () => {
    await db.query("delete from public.annual_report_extractions where doc_id = 'SXTEST07'");
    expect((await judgment("9U007")).undeterminable_reason).toBe("annual_report_pending");
    await db.query("delete from public.edinet_documents where doc_id = 'SXTEST07'");
    expect(await judgment("9U007")).toBeNull();
    const { rows } = await db.query("select count(*)::int as n from public.ownership_holder_classifications where code = '9U007'");
    expect(rows[0].n).toBe(0);
  });

  it("取り込み待ちが解消すると新しい有報で判定し、直前の有報を取り下げると判定不能（C5-9・C5-10）", async () => {
    await insertExtraction("SXTEST15", "ok", "ok", [["日本マスタートラスト信託銀行株式会社（信託口）", "30.00"], ["松本　浩", "20.00"]], [["松本　浩", "代表取締役社長"]]);
    expect(await judgment("9U014")).toMatchObject({ status: "determined", total: "20.00", president_is_top_holder: false, shareholders_pending_doc_id: null });
    await db.query("delete from public.annual_report_extractions where doc_id = 'SXTEST15'");
    expect(await judgment("9U014")).toMatchObject({ shareholders_doc_id: "SXTEST14", shareholders_pending_doc_id: "SXTEST15" });
    await db.query("update public.edinet_documents set withdrawn = true where doc_id = 'SXTEST14'");
    expect((await judgment("9U014")).undeterminable_reason).toBe("annual_report_pending");
  });

  it("区画ごとの置き換え: 役員の区画だけが取り込み待ち（C5-11・S4）", async () => {
    await insertStock("9U881");
    // 2025/03期（処理済み）、2026/03期の有報（未処理）と訂正（大株主あり・役員の区画なし）
    await insertDoc({ id: "SXSEL81", code: "9U881", end: "2025-03-31", submitted: "2025-06-25 15:00+09" });
    await insertExtraction("SXSEL81", "ok", "ok", [["旧年　太郎", "30.00"]], [["区画　太郎", "代表取締役社長"]]);
    await insertDoc({ id: "SXSEL82", code: "9U881", submitted: "2026-06-25 15:00+09" });
    await insertDoc({ id: "SXSEL83", code: "9U881", type: "130", end: null, parent: "SXSEL82", submitted: "2026-07-10 15:00+09" });
    await insertExtraction("SXSEL83", "ok", "section_not_found", [["区画　太郎", "25.00"]]);
    expect(await judgment("9U881")).toMatchObject({
      status: "determined",
      shareholders_doc_id: "SXSEL83",
      officers_doc_id: "SXSEL81",
      shareholders_pending_doc_id: null,
      officers_pending_doc_id: "SXSEL82",
      president_is_top_holder: true,
    });
  });
});

describe("権限（C8-2）", () => {
  it("許可リスト外のユーザーには、判定・明細・辞書が見えない。許可ユーザーには見える", async () => {
    const count = (userId: string) =>
      asUser(userId, () =>
        db.query(
          `select (select count(*) from public.ownership_judgments)::int as j, (select count(*) from public.ownership_holder_classifications)::int as h,
                  (select count(*) from public.surname_readings)::int as s`,
        ),
      );
    expect((await count(intruderId)).rows[0]).toEqual({ j: 0, h: 0, s: 0 });
    const owner = (await count(ownerId)).rows[0];
    expect(owner.j).toBeGreaterThanOrEqual(13);
    expect(owner.h).toBeGreaterThan(0);
  });
});

describe("性能（C11）", () => {
  it("4,000 銘柄: 全件の再計算 10 秒以内、1銘柄 50ms 以内、取り下げ 50ms 以内、区画 10ms 以内、スクリーニング 100ms 以内", async () => {
    await db.query(`
      insert into public.stocks (code, company_name, market_code, market_name, sector33_code, sector33_name, product_category)
      select 'Q' || lpad(i::text, 4, '0'), '判定性能' || i || '株式会社', '0113', 'グロース', '5250', '情報・通信業', '011'
        from generate_series(0, 3999) i`);
    await db.query(`
      insert into public.edinet_documents (doc_id, sec_code, edinet_code, doc_type_code, ordinance_code, form_code, period_start, period_end,
        submitted_at, xbrl_available, list_date)
      select 'SXPERF' || lpad(i::text, 4, '0') || y, 'Q' || lpad(i::text, 4, '0'), 'E9PF' || i, '120', '010', '030000',
             make_date(y - 1, 4, 1), make_date(y, 3, 31), make_timestamptz(y, 6, 25, 15, 0, 0, 'Asia/Tokyo'), true, make_date(y, 6, 25)
        from generate_series(0, 3999) i, generate_series(2025, 2026) y where y = 2026 or i % 2 = 0`);
    await db.query(`
      insert into public.annual_report_extractions (doc_id, shareholders_status, officers_status, officers_basis, officers_order_source)
      select doc_id, 'ok', 'ok', 'filing_date', 'inline_document' from public.edinet_documents where doc_id like 'SXPERF%'`);
    await db.query(`
      insert into public.annual_report_shareholders (doc_id, rank, name, ratio_pct, ratio_decimals)
      select d.doc_id, r, case when r = 1 then '田中　太郎' when r = 2 then '株式会社タナカ' when r = 3 then '日本マスタートラスト信託銀行株式会社（信託口）'
                               else '株主' || r || '　花子' end, (20 - r)::numeric, 2
        from public.edinet_documents d, generate_series(1, 10) r where d.doc_id like 'SXPERF%'`);
    await db.query(`
      insert into public.annual_report_officers (doc_id, seq, name, title)
      select d.doc_id, s, case when s = 1 then '田中　太郎' else '役員' || s || '　次郎' end, case when s = 1 then '代表取締役社長' else '取締役' end
        from public.edinet_documents d, generate_series(1, 10) s where d.doc_id like 'SXPERF%'`);
    await db.query("analyze public.ownership_judgments, public.ownership_holder_classifications, public.edinet_documents, public.annual_report_extractions");

    const time = async (text: string, values: unknown[] = []) => {
      const started = performance.now();
      await db.query(text, values);
      return performance.now() - started;
    };
    const full = await time("select public.recalculate_ownership_judgments(array(select code from public.stocks where code ~ '^Q[0-9]{4}$'))");
    expect(full, `全件 ${full}ms`).toBeLessThan(10_000);
    const { rows } = await db.query("select count(*) filter (where status = 'determined')::int as n from public.ownership_judgments where code ~ '^Q'");
    expect(rows[0].n).toBe(4000);

    const median = async (fn: () => Promise<number>) => {
      const samples: number[] = [];
      for (let i = 0; i < 6; i += 1) samples.push(await fn());
      return samples.slice(1).sort((a, b) => a - b)[2]!;
    };
    let n = 0;
    const single = await median(() => time("select public.recalculate_ownership_judgments(array[$1])", [`Q${String(100 + n++).padStart(4, "0")}`]));
    expect(single, `1銘柄 ${single}ms`).toBeLessThan(50);
    let w = 0;
    const withdraw = await median(() => time("update public.edinet_documents set withdrawn = true where doc_id = $1", [`SXPERF${String(200 + w++).padStart(4, "0")}2026`]));
    expect(withdraw, `取り下げ ${withdraw}ms`).toBeLessThan(50);
    const detail = await median(() => time("select public.annual_report_detail('Q0300')"));
    expect(detail, `区画 ${detail}ms`).toBeLessThan(10);
    const screen = async (params: object) =>
      median(async () => {
        const started = performance.now();
        await asUser(ownerId, () => db.query("select public.screen_stocks($1::jsonb)", [JSON.stringify({ cagr: "20", margin: "10", years: "5", pageSize: 100, ...params })]));
        return performance.now() - started;
      });
    const byDefault = await screen({});
    const byOwner = await screen({ cagrOn: false, marginOn: false, yearsOn: false, includeUnavailable: true, sort: "owner", order: "desc" });
    expect(byDefault, `既定 ${byDefault}ms`).toBeLessThan(100);
    expect(byOwner, `オーナー系合計の順 ${byOwner}ms`).toBeLessThan(100);
    console.log(
      `[性能] 全件 ${full.toFixed(0)}ms、1銘柄 ${single.toFixed(1)}ms、取り下げ ${withdraw.toFixed(1)}ms、区画 ${detail.toFixed(1)}ms、` +
        `スクリーニング 既定 ${byDefault.toFixed(1)}ms・オーナー系合計の順 ${byOwner.toFixed(1)}ms`,
    );
  }, 180_000);
});
