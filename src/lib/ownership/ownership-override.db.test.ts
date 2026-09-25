/**
 * 条件④の手動補正（Sprint 11）の結合テスト（契約の C4-3〜C4-5・C5・C6・C7・C8-3）。
 * 実行: pnpm test:db（銘柄マスタ・EDINET の書類が0件の DB。pnpm seed:users 済み）。
 * 投入は Sprint 10 の e2e/fixtures/ownership-example.sql（9U001〜9U014、SXTEST…）と、Sprint 11 の ownership-override-add*.sql（SYTEST…）、
 * この中で作る 9T…・SYDB…、性能の T0000〜T3999・SYPERF…。後片付けで自分の行だけを消す（補正は銘柄の削除で連鎖して消える）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MEMO_WHITESPACE_CLASS } from "./memo";

const DB_URL = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const FIXTURES = join(__dirname, "../../../e2e/fixtures");
const EXAMPLE_SQL = readFileSync(join(FIXTURES, "ownership-example.sql"), "utf8");
const CLEANUP_SQL = readFileSync(join(FIXTURES, "ownership-cleanup.sql"), "utf8");
const ADD_SQL = readFileSync(join(FIXTURES, "ownership-override-add.sql"), "utf8");
const ADD_9U004_SQL = readFileSync(join(FIXTURES, "ownership-override-add-9u004.sql"), "utf8");
const OVERRIDE_CLEANUP_SQL = readFileSync(join(FIXTURES, "ownership-override-cleanup.sql"), "utf8");

const db = new Client({ connectionString: DB_URL });
let ownerId = "";
let owner2Id = "";
let intruderId = "";

const DEFAULT_PARAMS = { cagr: "20", margin: "10", years: "5" };

async function cleanup() {
  await db.query(OVERRIDE_CLEANUP_SQL);
  await db.query("delete from public.edinet_documents where doc_id like 'SYDB%' or doc_id like 'SYPERF%'");
  await db.query("delete from public.stocks where code like '9T%' or code ~ '^T[0-9]{4}$'");
  await db.query(CLEANUP_SQL);
}

/** authenticated（JWT の sub が userId）として実行する。commit が false なら最後に rollback する */
async function asUser<T>(userId: string, fn: () => Promise<T>, commit = true): Promise<T> {
  await db.query("begin");
  try {
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
    const result = await fn();
    await db.query(commit ? "commit" : "rollback");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

/** authenticated として実行し、エラーのコード（成功なら null）を返す（常に rollback） */
async function tryAsUser(userId: string, text: string, values: unknown[] = []): Promise<string | null> {
  try {
    await asUser(userId, () => db.query(text, values), false);
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "error";
  }
}

async function save(userId: string, code: string, verdict: string, memo = "理由") {
  return asUser(userId, async () => (await db.query("select public.owner_override_save($1, $2, $3) as r", [code, verdict, memo])).rows[0].r);
}

async function summary(userId: string, code: string, params: object = {}) {
  return asUser(userId, async () => (await db.query("select public.owner_override_summary($1, $2::jsonb) as r", [code, JSON.stringify(params)])).rows[0].r);
}

async function evaluate(userId: string, codes: string[], params: object = {}) {
  return asUser(userId, async () => {
    const { rows } = await db.query(
      "select code, s_owner, owner_result, owner_auto_result, owner_override from public.screening_evaluate($1::jsonb, $2) order by code",
      [JSON.stringify({ ...DEFAULT_PARAMS, ...params }), codes],
    );
    return rows;
  });
}

async function screen(userId: string, params: object = {}) {
  return asUser(userId, async () => {
    const { rows } = await db.query("select public.screen_stocks($1::jsonb) as r", [JSON.stringify({ ...DEFAULT_PARAMS, ...params })]);
    const r = rows[0].r;
    return { codes: r.rows.map((row: { code: string }) => row.code) as string[], total: r.total as number, excludedUndeterminable: r.excludedUndeterminable as number, rows: r.rows };
  });
}

async function overrideRow(userId: string, code: string) {
  const { rows } = await db.query(
    `select verdict, memo, created_at, updated_at, auto_status, auto_undeterminable_reason, auto_president_is_top_holder,
            auto_owner_total_pct::text as auto_total, auto_shareholders_doc_id, auto_officers_doc_id
       from public.ownership_overrides where user_id = $1 and code = $2`,
    [userId, code],
  );
  return rows[0] ?? null;
}

beforeAll(async () => {
  await db.connect();
  const { rows: others } = await db.query(
    `select (select count(*) from public.stocks)::int + (select count(*) from public.edinet_documents)::int as n`,
  );
  if (others[0].n > 0) throw new Error("銘柄または EDINET の書類があるため、始められません（pnpm db:reset 直後の DB で実行してください）");
  const { rows: users } = await db.query(
    "select id::text, email from auth.users where email in ('owner@quantis.local', 'owner2@quantis.local', 'intruder@quantis.local')",
  );
  ownerId = users.find((u) => u.email === "owner@quantis.local")?.id ?? "";
  owner2Id = users.find((u) => u.email === "owner2@quantis.local")?.id ?? "";
  intruderId = users.find((u) => u.email === "intruder@quantis.local")?.id ?? "";
  if (!ownerId || !owner2Id || !intruderId) throw new Error("評価用ユーザーがいません（pnpm seed:users を実行してください）");
});

beforeEach(async () => {
  await cleanup();
  await db.query(EXAMPLE_SQL);
});

afterAll(async () => {
  await cleanup();
  const { rows } = await db.query(
    `select (select count(*) from public.ownership_overrides o join public.stocks s using (code))::int as o,
            (select count(*) from public.ownership_overrides where code like '9U%' or code like '9T%' or code ~ '^T[0-9]{4}$')::int as leftover`,
  );
  expect(rows[0].leftover).toBe(0);
  await db.end();
});

describe("補正後の判定の式（C6-1。補正3種 × モード2種 × 自動判定4種）", () => {
  // 自動判定（既定の閾値 20%）: 9U001 社長が筆頭株主、9U006 オーナー企業（35%）、9U003 非該当、9U004 判定不能（有報なし）
  const AUTO = {
    any: { "9U001": "president_top", "9U006": "owner_company", "9U003": "not_matched", "9U004": "undeterminable" },
    president: { "9U001": "president_top", "9U006": "not_matched", "9U003": "not_matched", "9U004": "undeterminable" },
  } as const;
  const codes = ["9U001", "9U003", "9U004", "9U006"] as const;
  const expectedStatus = (verdict: string, mode: "any" | "president") =>
    verdict === "president_top" || (verdict === "owner_company" && mode === "any") ? "met" : "unmet";

  for (const verdict of ["president_top", "owner_company", "not_matched"] as const) {
    it(`補正「${verdict}」: モードは当て、閾値は当てない。オフは off。自動判定はそのまま返す`, async () => {
      for (const code of codes) await save(ownerId, code, verdict);
      for (const mode of ["any", "president"] as const) {
        for (const owner of ["20", "90", "0"]) {
          const rows = await evaluate(ownerId, [...codes], { ownerMode: mode, owner });
          for (const row of rows) {
            const code = row.code as (typeof codes)[number];
            expect(row.owner_override, `${code} ${mode} ${owner}`).toBe(verdict);
            expect(row.owner_result, `${code} ${mode} ${owner}`).toBe(verdict);
            expect(row.s_owner, `${code} ${mode} ${owner}`).toBe(expectedStatus(verdict, mode));
            if (owner === "20") expect(row.owner_auto_result, `${code} ${mode}`).toBe(AUTO[mode][code]);
          }
        }
        const off = await evaluate(ownerId, [...codes], { ownerMode: mode, ownerOn: false });
        expect(off.map((r) => r.s_owner)).toEqual(["off", "off", "off", "off"]);
        expect(off.map((r) => r.owner_result)).toEqual([verdict, verdict, verdict, verdict]);
      }
      // 別のユーザー（owner2）には影響しない
      const other = await evaluate(owner2Id, [...codes]);
      expect(other.map((r) => [r.code, r.owner_override, r.owner_result])).toEqual(codes.map((c) => [c, null, AUTO.any[c]]));
      // 未ログイン相当（service_role・postgres で auth.uid() が NULL）にも影響しない
      const { rows: system } = await db.query("select owner_override from public.screening_evaluate($1::jsonb, $2)", [JSON.stringify(DEFAULT_PARAMS), [...codes]]);
      expect(system.every((r) => r.owner_override === null)).toBe(true);
    });
  }
});

describe("スクリーニングの件数（契約の第5章。C2・C4）", () => {
  it("owner の補正に従い、owner2 は自動判定のまま", async () => {
    await save(ownerId, "9U003", "owner_company");
    expect(await screen(ownerId)).toMatchObject({ total: 8, excludedUndeterminable: 3 });
    expect((await screen(ownerId, { ownerMode: "president" })).codes).toEqual(["9U001", "9U008", "9U009", "9U010", "9U014"]);
    expect((await screen(ownerId, { owner: "40" })).codes).toEqual(["9U001", "9U003", "9U008", "9U009", "9U010", "9U014"]);

    await save(ownerId, "9U006", "not_matched");
    await save(ownerId, "9U004", "president_top");
    const all = await screen(ownerId);
    expect(all.codes).toEqual(["9U001", "9U002", "9U003", "9U004", "9U008", "9U009", "9U010", "9U014"]);
    expect(all.excludedUndeterminable).toBe(2);
    expect((await screen(ownerId, { includeUndeterminable: true })).total).toBe(10);

    // sort=owner: 補正で結果に入った判定不能の 9U004（合計なし）は昇順・降順とも最後（C5-10）
    for (const order of ["asc", "desc"]) {
      const sorted = await screen(ownerId, { sort: "owner", order });
      expect(sorted.codes.at(-1), order).toBe("9U004");
    }

    const row = all.rows.find((r: { code: string }) => r.code === "9U003");
    expect(row.ownership).toMatchObject({ result: "owner_company", auto_result: "not_matched", override: { verdict: "owner_company", auto_changed: false } });
    expect(row.status.owner).toBe("met");
    const plain = all.rows.find((r: { code: string }) => r.code === "9U001");
    expect(plain.ownership).toMatchObject({ result: "president_top", auto_result: "president_top", override: null });

    const other = await screen(owner2Id);
    expect(other).toMatchObject({ total: 7, excludedUndeterminable: 3 });
    expect(other.codes).toEqual(["9U001", "9U002", "9U006", "9U008", "9U009", "9U010", "9U014"]);
  });

  it("stock_detail: 補正後の状態で included を求め、自動判定と補正を並べて返す", async () => {
    await save(ownerId, "9U003", "owner_company", "メモ");
    const detail = await asUser(ownerId, async () => (await db.query("select public.stock_detail('9U003', $1::jsonb) as r", [JSON.stringify(DEFAULT_PARAMS)])).rows[0].r);
    expect(detail.evaluation).toMatchObject({ ownerResult: "owner_company", ownerAutoResult: "not_matched", ownerOverride: "owner_company", included: true });
    expect(detail.evaluation.status.owner).toBe("met");
    expect(detail.ownership).toMatchObject({ result: "owner_company", auto_result: "not_matched", override: { memo: "メモ" } });
    const president = await asUser(ownerId, async () =>
      (await db.query("select public.stock_detail('9U003', $1::jsonb) as r", [JSON.stringify({ ...DEFAULT_PARAMS, ownerMode: "president" })])).rows[0].r,
    );
    expect(president.evaluation).toMatchObject({ included: false, status: { owner: "unmet" } });
  });
});

describe("補正後に自動判定が更新されたか（C5。auto_changed）", () => {
  it("訂正有報で自動判定が変われば知らせ、元に戻れば消える。確認済みで記録を置き換える", async () => {
    await save(ownerId, "9U006", "not_matched");
    expect((await summary(ownerId, "9U006")).auto_changed).toBe(false);

    await db.query(ADD_SQL);
    const changed = await summary(ownerId, "9U006");
    expect(changed.auto_changed).toBe(true);
    expect(changed.auto_at_override).toMatchObject({ result: "owner_company", owner_total_pct: "35.00", shareholders_doc_id: "SXTEST06" });
    expect(changed.auto_current).toMatchObject({ result: "not_matched", owner_total_pct: "17.00", shareholders_doc_id: "SYTEST16", officers_doc_id: "SYTEST16" });
    expect(changed.verdict).toBe("not_matched");

    await db.query(OVERRIDE_CLEANUP_SQL);
    expect((await summary(ownerId, "9U006")).auto_changed).toBe(false);
    await db.query(ADD_SQL);
    expect((await summary(ownerId, "9U006")).auto_changed).toBe(true);

    const before = await overrideRow(ownerId, "9U006");
    const acknowledged = await asUser(ownerId, async () => (await db.query("select public.owner_override_acknowledge('9U006') as r")).rows[0].r);
    expect(acknowledged.auto_changed).toBe(false);
    const after = await overrideRow(ownerId, "9U006");
    expect(after).toMatchObject({ verdict: "not_matched", memo: before.memo, auto_total: "17.00", auto_shareholders_doc_id: "SYTEST16" });
    expect(after.created_at).toEqual(before.created_at);

    await db.query(OVERRIDE_CLEANUP_SQL);
    expect((await summary(ownerId, "9U006")).auto_changed).toBe(true);
    // 編集して保存すると記録が置き換わる（C5-8）
    await save(ownerId, "9U006", "not_matched", "見直した");
    expect((await summary(ownerId, "9U006")).auto_changed).toBe(false);
  });

  it("同じ内容の再計算・取り込み待ちの書類が載っただけでは知らせない（C5-5）", async () => {
    await save(ownerId, "9U006", "not_matched");
    await db.query("update public.annual_report_shareholders set address = '東京都千代田区' where doc_id = 'SXTEST06'");
    expect((await summary(ownerId, "9U006")).auto_changed).toBe(false);
    await db.query(
      `insert into public.edinet_documents (doc_id, sec_code, edinet_code, doc_type_code, ordinance_code, form_code, period_start, period_end,
         submitted_at, xbrl_available, list_date)
       values ('SYDB0601', '9U006', 'E99U06', '120', '010', '030000', '2026-04-01', '2027-03-31', '2027-06-25 15:00+09', true, '2027-06-25')`,
    );
    const { rows } = await db.query("select shareholders_pending_doc_id from public.ownership_judgments where code = '9U006'");
    expect(rows[0].shareholders_pending_doc_id).toBe("SYDB0601");
    expect((await summary(ownerId, "9U006")).auto_changed).toBe(false);
  });

  it("有報未取得 → 取り込み → 知らせ（C5-9）。取り下げで判定不能に変わっても知らせる（C5-6）", async () => {
    await save(ownerId, "9U004", "president_top");
    const first = await summary(ownerId, "9U004");
    expect(first.auto_changed).toBe(false);
    expect(first.auto_at_override).toMatchObject({ status: "undeterminable", undeterminable_reason: "no_annual_report", owner_total_pct: null, result: "undeterminable" });
    await db.query(ADD_9U004_SQL);
    const changed = await summary(ownerId, "9U004");
    expect(changed.auto_changed).toBe(true);
    expect(changed.auto_current).toMatchObject({ result: "president_top", owner_total_pct: "40.00", shareholders_doc_id: "SYTEST04" });
    await db.query(OVERRIDE_CLEANUP_SQL);
    expect((await summary(ownerId, "9U004")).auto_changed).toBe(false);

    await save(ownerId, "9U003", "owner_company");
    await db.query("update public.edinet_documents set withdrawn = true where doc_id = 'SXTEST03'");
    const withdrawn = await summary(ownerId, "9U003");
    expect(withdrawn.auto_changed).toBe(true);
    expect(withdrawn.auto_at_override.result).toBe("not_matched");
    expect(withdrawn.auto_current).toMatchObject({ result: "undeterminable", undeterminable_reason: "no_annual_report" });
    const rows = await evaluate(ownerId, ["9U003"]);
    expect(rows[0]).toMatchObject({ owner_result: "owner_company", s_owner: "met", owner_auto_result: "undeterminable" });
  });

  it("補正時の結果の名前は、同じ値の現在の判定と同じ式（owner_result_of）で求まる", async () => {
    await save(ownerId, "9U006", "not_matched");
    for (const [params, expected] of [
      [{}, "owner_company"],
      [{ owner: "40" }, "not_matched"],
      [{ ownerMode: "president" }, "not_matched"],
    ] as const) {
      const s = await summary(ownerId, "9U006", params);
      expect(s.auto_at_override.result).toBe(expected);
      expect(s.auto_current.result).toBe(expected);
      const [row] = await evaluate(ownerId, ["9U006"], params);
      expect(row.owner_auto_result).toBe(expected);
    }
  });
});

describe("権限と直接の書き込みへの防御（C4-3〜C4-5・C6-4）", () => {
  it("本人の行だけが見え、ほかのユーザーの行は更新・削除できない（C4-3）", async () => {
    await save(ownerId, "9U003", "owner_company", "owner のメモ");
    await save(owner2Id, "9U003", "not_matched", "owner2 のメモ");
    const visible = await asUser(owner2Id, async () => (await db.query("select user_id::text, memo from public.ownership_overrides")).rows);
    expect(visible).toEqual([{ user_id: owner2Id, memo: "owner2 のメモ" }]);

    const updated = await asUser(owner2Id, async () => (await db.query("update public.ownership_overrides set memo = 'x' where user_id = $1", [ownerId])).rowCount);
    const deleted = await asUser(owner2Id, async () => (await db.query("delete from public.ownership_overrides where user_id = $1", [ownerId])).rowCount);
    expect([updated, deleted]).toEqual([0, 0]);
    expect((await overrideRow(ownerId, "9U003")).memo).toBe("owner のメモ");

    expect(await tryAsUser(owner2Id, "insert into public.ownership_overrides (user_id, code, verdict, memo) values ($1, '9U006', 'not_matched', 'x')", [ownerId])).toBe("42501");
  });

  it("許可リスト外（intruder）は読めず書けない（C4-5）", async () => {
    await save(ownerId, "9U003", "owner_company");
    const seen = await asUser(intruderId, async () => (await db.query("select count(*)::int as n from public.ownership_overrides")).rows[0].n);
    expect(seen).toBe(0);
    expect(await tryAsUser(intruderId, "insert into public.ownership_overrides (code, verdict, memo) values ('9U003', 'not_matched', 'x')")).toBe("42501");
    // 関数は実行できても、銘柄マスタが見えないので何も保存しない（NULL）
    expect(await asUser(intruderId, async () => (await db.query("select public.owner_override_save('9U003', 'not_matched', 'x') as r")).rows[0].r)).toBeNull();
    const { rows: intruderRows } = await db.query("select count(*)::int as n from public.ownership_overrides where user_id = $1", [intruderId]);
    expect(intruderRows[0].n).toBe(0);
    const evaluated = await evaluate(intruderId, ["9U003"]);
    expect(evaluated).toEqual([]); // 銘柄マスタも読めない
  });

  it("anon はテーブルにも関数にも権限が無い（C4-4）", async () => {
    const { rows } = await db.query(
      `select has_table_privilege('anon', 'public.ownership_overrides', 'select') as t,
              has_function_privilege('anon', 'public.owner_override_save(text, text, text)', 'execute') as f,
              has_function_privilege('authenticated', 'public.ownership_overrides_before_write()', 'execute') as trigger_fn`,
    );
    expect(rows[0]).toEqual({ t: false, f: false, trigger_fn: false });
  });

  it("記録・日時・user_id・code・verdict・メモを直接の書き込みで偽れない（C6-4 の 1〜6）", async () => {
    // 1. 記録を偽った insert・update: 現在の自動判定の値になる
    await asUser(ownerId, () =>
      db.query(
        `insert into public.ownership_overrides (code, verdict, memo, auto_status, auto_owner_total_pct, auto_shareholders_doc_id, auto_president_is_top_holder)
         values ('9U006', 'not_matched', 'x', 'undeterminable', 99, 'FAKE', true)`,
      ),
    );
    expect(await overrideRow(ownerId, "9U006")).toMatchObject({ auto_status: "determined", auto_total: "35.00", auto_shareholders_doc_id: "SXTEST06", auto_president_is_top_holder: false });
    await asUser(ownerId, () => db.query("update public.ownership_overrides set auto_owner_total_pct = 1, auto_shareholders_doc_id = 'FAKE', auto_status = 'undeterminable' where code = '9U006'"));
    expect(await overrideRow(ownerId, "9U006")).toMatchObject({ auto_status: "determined", auto_total: "35.00", auto_shareholders_doc_id: "SXTEST06" });

    // 2. created_at は変わらず、updated_at は now()
    const before = await overrideRow(ownerId, "9U006");
    await asUser(ownerId, () => db.query("update public.ownership_overrides set created_at = '2000-01-01', updated_at = '2000-01-01' where code = '9U006'"));
    const after = await overrideRow(ownerId, "9U006");
    expect(after.created_at).toEqual(before.created_at);
    expect(after.updated_at.getTime()).toBeGreaterThan(new Date("2020-01-01").getTime());

    // 3. user_id・code の変更は拒否
    expect(await tryAsUser(ownerId, "update public.ownership_overrides set user_id = $1 where code = '9U006'", [owner2Id])).toBe("42501");
    expect(await tryAsUser(ownerId, "update public.ownership_overrides set code = '9U003' where code = '9U006'")).toBe("42501");

    // 4. verdict の check 制約
    expect(await tryAsUser(ownerId, "insert into public.ownership_overrides (code, verdict, memo) values ('9U003', 'met', 'x')")).toBe("23514");
    expect(await tryAsUser(ownerId, "update public.ownership_overrides set verdict = 'met' where code = '9U006'")).toBe("23514");

    // 5. メモ（空白だけ・改行だけ・1,001・「𠮷」1,001 は拒否。前後の空白は除く。「𠮷」1,000 は保存）
    for (const memo of [" ", "　　", "\n\n", "\t　\n", "a".repeat(1001), "𠮷".repeat(1001)]) {
      expect(await tryAsUser(ownerId, "insert into public.ownership_overrides (code, verdict, memo) values ('9U003', 'not_matched', $1)", [memo]), JSON.stringify(memo.slice(0, 4))).toBe("23514");
    }
    await asUser(ownerId, () => db.query("insert into public.ownership_overrides (code, verdict, memo) values ('9U003', 'not_matched', $1)", ["　\n 理由\n2行目 \t　"]));
    expect((await overrideRow(ownerId, "9U003")).memo).toBe("理由\n2行目");
    await asUser(ownerId, () => db.query("update public.ownership_overrides set memo = $1 where code = '9U003'", ["𠮷".repeat(1000)]));
    const { rows } = await db.query("select char_length(memo) as n from public.ownership_overrides where user_id = $1 and code = '9U003'", [ownerId]);
    expect(rows[0].n).toBe(1000);
    await asUser(ownerId, () => db.query("update public.ownership_overrides set memo = $1 where code = '9U003'", [`${"a".repeat(1000)}\n`]));
    expect((await overrideRow(ownerId, "9U003")).memo).toBe("a".repeat(1000));

    // 6. user_id を省いた insert は自分の id
    await asUser(ownerId, () => db.query("insert into public.ownership_overrides (code, verdict, memo) values ('9U001', 'not_matched', 'x')"));
    expect(await overrideRow(ownerId, "9U001")).not.toBeNull();
  });

  it("DB の空白の文字集合は JavaScript の \\s と同じ（U+0000〜U+FFFF。サロゲートを除く）", async () => {
    const { rows } = await db.query(
      `select array_agg(cp order by cp) as cps from generate_series(1, 65535) cp
        where (cp < 55296 or cp > 57343)
          and chr(cp) ~ '^[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]$'`,
    );
    const js: number[] = [];
    const ours = new RegExp(`^${MEMO_WHITESPACE_CLASS}$`, "u");
    for (let cp = 1; cp <= 0xffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      if (/^\s$/.test(String.fromCharCode(cp))) {
        js.push(cp);
        expect(ours.test(String.fromCharCode(cp))).toBe(true);
      }
    }
    expect(rows[0].cps).toEqual(js);
  });

  it("銘柄の削除で補正は連鎖して消える", async () => {
    await save(ownerId, "9U003", "owner_company");
    await db.query("delete from public.stocks where code = '9U003'");
    const { rows } = await db.query("select count(*)::int as n from public.ownership_overrides where code = '9U003'");
    expect(rows[0].n).toBe(0);
  });

  it("保存・確認済み・取り消しの関数: 無い銘柄は NULL、補正が無ければ確認済みは NULL・取り消しは false", async () => {
    expect(await save(ownerId, "9U999", "not_matched")).toBeNull();
    expect(await asUser(ownerId, async () => (await db.query("select public.owner_override_acknowledge('9U003') as r")).rows[0].r)).toBeNull();
    expect(await asUser(ownerId, async () => (await db.query("select public.owner_override_delete('9U003') as r")).rows[0].r)).toBe(false);
    await save(ownerId, "9U003", "not_matched");
    expect(await asUser(ownerId, async () => (await db.query("select public.owner_override_delete('9U003') as r")).rows[0].r)).toBe(true);
  });
});

describe("姓の読みの辞書の追加（C8-3。Sprint 10 評価の m3）", () => {
  it("別の読みが加わり、読みで資産管理会社と推定できる", async () => {
    const { rows } = await db.query("select surname, reading from public.surname_readings where surname in ('岩崎', '宮崎', '中沢', '小島', '塩谷', '清野') order by surname, reading");
    const pairs = rows.map((r) => `${r.surname}:${r.reading}`);
    for (const pair of ["岩崎:イワザキ", "岩崎:イワサキ", "宮崎:ミヤサキ", "宮崎:ミヤザキ", "中沢:ナカサワ", "中沢:ナカザワ", "小島:オジマ", "小島:コシマ", "小島:コジマ", "塩谷:シオタニ", "塩谷:エンヤ", "清野:キヨノ"]) {
      expect(pairs).toContain(pair);
    }
    const { rows: judged } = await db.query("select public.ownership_judgment_from_sections($1::jsonb, $2::jsonb) as r", [
      JSON.stringify([
        { rank: 1, name: "株式会社イワザキ興産", ratio_pct: "20.00", ratio_decimals: 2 },
        { rank: 2, name: "岩崎　健", ratio_pct: "10.00", ratio_decimals: 2 },
      ]),
      JSON.stringify([{ seq: 1, name: "岩崎　健", title: "代表取締役社長" }]),
    ]);
    expect(judged[0].r.holders.map((h: { category: string }) => h.category)).toEqual(["asset_company", "president"]);
  });
});

describe("性能（C7）", () => {
  it("4,000 銘柄・2人がそれぞれ 1,000 銘柄に補正: スクリーニング 100ms 以内、詳細 20ms 以内", async () => {
    await db.query(`
      insert into public.stocks (code, company_name, market_code, market_name, sector33_code, sector33_name, product_category)
      select 'T' || lpad(i::text, 4, '0'), '補正性能' || i || '株式会社', '0113', 'グロース', '5250', '情報・通信業', '011'
        from generate_series(0, 3999) i`);
    await db.query(`
      insert into public.edinet_documents (doc_id, sec_code, edinet_code, doc_type_code, ordinance_code, form_code, period_start, period_end,
        submitted_at, xbrl_available, list_date)
      select 'SYPERF' || lpad(i::text, 4, '0'), 'T' || lpad(i::text, 4, '0'), 'E9TP' || i, '120', '010', '030000',
             '2025-04-01', '2026-03-31', '2026-06-25 15:00+09', true, '2026-06-25'
        from generate_series(0, 3999) i`);
    await db.query(`
      insert into public.annual_report_extractions (doc_id, shareholders_status, officers_status, officers_basis, officers_order_source)
      select doc_id, 'ok', 'ok', 'filing_date', 'inline_document' from public.edinet_documents where doc_id like 'SYPERF%'`);
    await db.query(`
      insert into public.annual_report_shareholders (doc_id, rank, name, ratio_pct, ratio_decimals)
      select d.doc_id, r, case when r = 1 then '田中　太郎' when r = 2 then '株式会社タナカ' else '株主' || r || '　花子' end, (20 - r)::numeric, 2
        from public.edinet_documents d, generate_series(1, 10) r where d.doc_id like 'SYPERF%'`);
    await db.query(`
      insert into public.annual_report_officers (doc_id, seq, name, title)
      select d.doc_id, s, case when s = 1 then '田中　太郎' else '役員' || s || '　次郎' end, case when s = 1 then '代表取締役社長' else '取締役' end
        from public.edinet_documents d, generate_series(1, 10) s where d.doc_id like 'SYPERF%'`);
    for (const [userId, offset] of [[ownerId, 0], [owner2Id, 500]] as const) {
      await asUser(userId, () =>
        db.query(
          `insert into public.ownership_overrides (code, verdict, memo)
           select 'T' || lpad(i::text, 4, '0'), case i % 3 when 0 then 'president_top' when 1 then 'owner_company' else 'not_matched' end, '性能の補正'
             from generate_series($1::int, $1::int + 999) i`,
          [offset],
        ),
      );
    }
    await db.query("analyze public.ownership_overrides, public.ownership_judgments, public.stocks");

    const median = async (fn: () => Promise<number>) => {
      const samples: number[] = [];
      for (let i = 0; i < 6; i += 1) samples.push(await fn());
      return samples.slice(1).sort((a, b) => a - b)[2]!;
    };
    const timed = (text: string, values: unknown[]) =>
      median(async () => {
        const started = performance.now();
        await asUser(ownerId, () => db.query(text, values));
        return performance.now() - started;
      });
    const byDefault = await timed("select public.screen_stocks($1::jsonb)", [JSON.stringify({ ...DEFAULT_PARAMS, pageSize: 100 })]);
    const byOwner = await timed("select public.screen_stocks($1::jsonb)", [
      JSON.stringify({ ...DEFAULT_PARAMS, cagrOn: false, marginOn: false, yearsOn: false, includeUnavailable: true, sort: "owner", order: "desc", pageSize: 100 }),
    ]);
    const detail = await timed("select public.stock_detail('T0003', $1::jsonb)", [JSON.stringify(DEFAULT_PARAMS)]);
    const { rows } = await asUser(ownerId, () => db.query("select public.screen_stocks($1::jsonb) as r", [JSON.stringify({ ...DEFAULT_PARAMS, cagrOn: false, marginOn: false, yearsOn: false, includeUnavailable: true, pageSize: 100 })]));
    // owner の補正: T0000〜T0999 のうち not_matched（333 件）だけが外れる。それ以外は自動判定（社長が筆頭株主）。投入例の 9U（④を満たす9件）も数える
    expect(rows[0].r.total).toBe(4000 - 333 + 9);
    expect(byDefault, `既定 ${byDefault}ms`).toBeLessThan(100);
    expect(byOwner, `オーナー系合計の順 ${byOwner}ms`).toBeLessThan(100);
    expect(detail, `詳細 ${detail}ms`).toBeLessThan(20);
    console.log(`[性能] スクリーニング 既定 ${byDefault.toFixed(1)}ms・オーナー系合計の順 ${byOwner.toFixed(1)}ms、詳細 ${detail.toFixed(1)}ms`);
  }, 180_000);
});
