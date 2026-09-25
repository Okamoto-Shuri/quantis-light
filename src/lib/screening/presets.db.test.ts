/**
 * 条件プリセット（Sprint 13）の結合テスト（契約の C5-4〜C5-7・C6-1・C7）。
 * 実行: pnpm test:db（pnpm seed:users 済み。owner・owner2・intruder）。
 * 作る行: 名前の接頭辞「〔DB13〕」のプリセットと、性能のテストのユーザー（@quantis-db13.local。プリセットはユーザーの削除で連鎖して消える）。
 * 後片付けで自分の行だけを消す。
 */
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { WHITESPACE_CLASS } from "@/lib/text/whitespace";

import { CONDITION_KEYS, DEFAULT_CONDITIONS, SORT_KEYS, type ConditionKey, type ScreeningConditions } from "./params";
import { presetQueryOf, STANDARD_QUERY } from "./presets";
import { MARKETS, SECTOR33 } from "./sectors";

const DB_URL = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const P = "〔DB13〕";
const STRICT = "cagr=20&margin=10&years=5&owner=40&ownermode=any&sort=owner&order=desc";

const db = new Client({ connectionString: DB_URL });
let ownerId = "";
let owner2Id = "";
let intruderId = "";

async function cleanup() {
  await db.query("delete from public.screening_presets where name like $1", [`${P}%`]);
  await db.query("delete from auth.users where email like '%@quantis-db13.local'");
}

/** authenticated（JWT の sub が userId）として実行する。commit が false なら最後に rollback する */
async function asUser<T>(userId: string, fn: (client: Client) => Promise<T>, commit = true, client: Client = db): Promise<T> {
  await client.query("begin");
  try {
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
    const result = await fn(client);
    await client.query(commit ? "commit" : "rollback");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

/** authenticated として実行し、エラーのコード（成功なら null）を返す */
async function tryAsUser(userId: string, text: string, values: unknown[] = [], commit = false): Promise<string | null> {
  try {
    await asUser(userId, (c) => c.query(text, values), commit);
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "error";
  }
}

async function create(userId: string, name: string, query = STANDARD_QUERY, isDefault = false) {
  return asUser(userId, async (c) => (await c.query("select public.create_screening_preset($1, $2, $3) as r", [name, query, isDefault])).rows[0].r);
}

async function rows(userId: string) {
  const { rows: result } = await db.query(
    "select id::text, name, query, is_default, created_at, updated_at from public.screening_presets where user_id = $1 order by created_at, id",
    [userId],
  );
  return result;
}

async function defaults(userId: string): Promise<string[]> {
  return (await rows(userId)).filter((row) => row.is_default).map((row) => row.name);
}

beforeAll(async () => {
  await db.connect();
  const { rows: users } = await db.query(
    "select email, id::text from auth.users where email in ('owner@quantis.local', 'owner2@quantis.local', 'intruder@quantis.local')",
  );
  const byEmail = new Map(users.map((u) => [u.email, u.id]));
  ownerId = byEmail.get("owner@quantis.local") ?? "";
  owner2Id = byEmail.get("owner2@quantis.local") ?? "";
  intruderId = byEmail.get("intruder@quantis.local") ?? "";
  expect(ownerId && owner2Id && intruderId, "pnpm seed:users が必要").toBeTruthy();
  await cleanup();
});

beforeEach(cleanup);

afterAll(async () => {
  await cleanup();
  await db.end();
});

describe("RLS とユーザーごとの分離（C5-4・C5-7）", () => {
  it("select は本人の行だけ。他人の行の update・delete は0行", async () => {
    await create(ownerId, `${P}owner`);
    await create(owner2Id, `${P}owner2`);
    const seen = await asUser(owner2Id, async (c) => (await c.query("select name from public.screening_presets where name like $1", [`${P}%`])).rows);
    expect(seen.map((r) => r.name)).toEqual([`${P}owner2`]);
    const [target] = await rows(ownerId);
    const updated = await asUser(owner2Id, async (c) => (await c.query("update public.screening_presets set name = 'x' where id = $1", [target.id])).rowCount);
    const deleted = await asUser(owner2Id, async (c) => (await c.query("delete from public.screening_presets where id = $1", [target.id])).rowCount);
    expect([updated, deleted]).toEqual([0, 0]);
    expect((await rows(ownerId))[0].name).toBe(`${P}owner`);
  });

  it("user_id に他人の id を指定した insert は RLS で拒否。user_id を省けば本人の id", async () => {
    expect(
      await tryAsUser(owner2Id, "insert into public.screening_presets (user_id, name, query) values ($1, $2, $3)", [ownerId, `${P}x`, STANDARD_QUERY]),
    ).toBe("42501");
    await asUser(ownerId, (c) => c.query("insert into public.screening_presets (name, query) values ($1, $2)", [`${P}省略`, STANDARD_QUERY]));
    expect((await rows(ownerId)).map((r) => r.name)).toEqual([`${P}省略`]);
  });

  it("set_default_screening_preset に他人の行・存在しない id を渡すと NULL で、誰の既定も変わらない（R1）", async () => {
    await create(ownerId, `${P}グロースのみ`, STANDARD_QUERY, true);
    const strict = await create(ownerId, `${P}厳しめ`, STRICT);
    await create(owner2Id, `${P}owner2の既定`, STANDARD_QUERY, true);
    const other = await asUser(owner2Id, async (c) => (await c.query("select public.set_default_screening_preset($1, true) as r", [strict.id])).rows[0].r);
    expect(other).toBeNull();
    const missing = await asUser(owner2Id, async (c) =>
      (await c.query("select public.set_default_screening_preset($1, true) as r", ["00000000-0000-4000-8000-000000000000"])).rows[0].r,
    );
    expect(missing).toBeNull();
    const patch = await asUser(owner2Id, async (c) =>
      (await c.query("select public.update_screening_preset($1, 'x', null, true) as r", [strict.id])).rows[0].r,
    );
    expect(patch).toBeNull();
    expect(await defaults(ownerId)).toEqual([`${P}グロースのみ`]);
    expect(await defaults(owner2Id)).toEqual([`${P}owner2の既定`]);
    expect((await rows(ownerId)).map((r) => r.name)).toEqual([`${P}グロースのみ`, `${P}厳しめ`]);
  });

  it("許可リスト外（intruder）は読み書きできない。anon は権限なし", async () => {
    expect(await tryAsUser(intruderId, "insert into public.screening_presets (name, query) values ($1, $2)", [`${P}x`, STANDARD_QUERY])).toBe("42501");
    expect(await tryAsUser(intruderId, "select public.create_screening_preset($1, $2, false)", [`${P}x`, STANDARD_QUERY])).toBe("42501");
    await create(ownerId, `${P}owner`);
    const seen = await asUser(intruderId, async (c) => (await c.query("select count(*)::int as n from public.screening_presets")).rows[0].n);
    expect(seen).toBe(0);
    await db.query("begin");
    try {
      await db.query("set local role anon");
      await expect(db.query("select * from public.screening_presets")).rejects.toMatchObject({ code: "42501" });
    } finally {
      await db.query("rollback");
    }
  });
});

describe("トリガーと check 制約（C5-5）", () => {
  it("id・user_id の変更は拒否。created_at は変わらない。updated_at は名前・クエリが変わったときだけ", async () => {
    const created = await create(ownerId, `${P}a`);
    const [before] = await rows(ownerId);
    expect(await tryAsUser(ownerId, "update public.screening_presets set user_id = $1 where id = $2", [owner2Id, created.id], true)).toBe("42501");
    expect(
      await tryAsUser(ownerId, "update public.screening_presets set id = gen_random_uuid() where id = $1", [created.id], true),
    ).toBe("42501");
    await asUser(ownerId, (c) =>
      c.query("update public.screening_presets set created_at = '2000-01-01', updated_at = '2000-01-01' where id = $1", [created.id]),
    );
    let [after] = await rows(ownerId);
    expect(after.created_at).toEqual(before.created_at);
    expect(after.updated_at).toEqual(before.updated_at);
    // 既定の切り替えでは updated_at は変わらない
    await asUser(ownerId, (c) => c.query("select public.set_default_screening_preset($1, true)", [created.id]));
    [after] = await rows(ownerId);
    expect(after.is_default).toBe(true);
    expect(after.updated_at).toEqual(before.updated_at);
    // 名前の変更で新しくなる
    await asUser(ownerId, (c) => c.query("select public.update_screening_preset($1, $2, null, null)", [created.id, `${P}b`]));
    [after] = await rows(ownerId);
    expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
    expect(after.created_at).toEqual(before.created_at);
  });

  it("既定は1個まで（PostgREST で直接2つ目を既定にすると一意の索引で拒否）", async () => {
    await create(ownerId, `${P}a`, STANDARD_QUERY, true);
    const b = await create(ownerId, `${P}b`);
    expect(await tryAsUser(ownerId, "update public.screening_presets set is_default = true where id = $1", [b.id], true)).toBe("23505");
    expect(await defaults(ownerId)).toEqual([`${P}a`]);
  });

  it("名前: 空・空白だけ・41 コードポイント・途中のタブ・改行は拒否。前後の空白は除く", async () => {
    const insert = (name: string) =>
      tryAsUser(ownerId, "insert into public.screening_presets (name, query) values ($1, $2)", [name, STANDARD_QUERY], true);
    for (const name of ["", " ", "　　", "\n", `${P}${"あ".repeat(35)}`, `${P}a\tb`, `${P}a\nb`]) {
      expect(await insert(name), JSON.stringify(name)).toBe("23514");
    }
    expect(await insert(`　${P}${"𠮷".repeat(34)}\n`)).toBeNull();
    expect((await rows(ownerId)).map((r) => r.name)).toEqual([`${P}${"𠮷".repeat(34)}`]);
  });

  it("名前の前後の空白の文字集合は JavaScript の \\s と同じ（DB のトリガーが除く）", async () => {
    const ours = new RegExp(`^${WHITESPACE_CLASS}$`, "u");
    const spaces: string[] = [];
    for (let cp = 1; cp <= 0xffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const ch = String.fromCharCode(cp);
      if (/^\s$/.test(ch)) {
        expect(ours.test(ch)).toBe(true);
        spaces.push(ch);
      }
    }
    // すべての空白を前後に付けた名前が、除いた値で保存される（1文字でも集合から漏れていれば、そこで除くのが止まる）
    const { rows: result } = await asUser(
      ownerId,
      (c) => c.query("insert into public.screening_presets (name, query) values ($1, $2) returning name", [`${spaces.join("")}名前${spaces.join("")}`, STANDARD_QUERY]),
      false,
    );
    expect(result[0].name).toBe("名前");
  });

  it("クエリ: 形の違反・危険な文字・重複・順番の違い・page・改行・1,001 文字は拒否。範囲外の値（cagr=99999）は通る（R2）", async () => {
    const insert = (query: string) =>
      tryAsUser(ownerId, "insert into public.screening_presets (name, query) values ($1, $2)", [`${P}q`, query], false);
    const tail = "&margin=10&years=5&owner=20&ownermode=any&sort=cagr&order=desc";
    const rejected = [
      "",
      "foo=bar",
      `page=2&cagr=20${tail}`,
      `${STANDARD_QUERY}&page=2`,
      `margin=10&cagr=20&years=5&owner=20&ownermode=any&sort=cagr&order=desc`,
      `cagr=20&cagr=30${tail}`,
      "cagr=20&margin=10&years=5&owner=20&ownermode=any&market=0111%2C0113&sort=cagr&order=desc",
      `cagr=20#${tail}`,
      `cagr=20/${tail}`,
      `cagr=20\\${tail}`,
      `cagr=20?${tail}`,
      `cagr=20 ${tail}`,
      `cagr=２０${tail}`,
      `cagr=2\n0${tail}`,
      `${STANDARD_QUERY}\n`,
      `${STANDARD_QUERY}\r\n`,
      `cagr=20&margin=10&years=5&owner=20&ownermode=any&sector=${"0".repeat(200)}&sector=1&sort=cagr&order=desc`,
      `${STANDARD_QUERY}${"x".repeat(1001)}`,
    ];
    for (const query of rejected) expect(await insert(query), JSON.stringify(query)).toBe("23514");
    expect(await insert(`cagr=99999${tail}`)).toBeNull();
    expect(await insert("cagr=20&margin=10&years=5&owner=20&ownermode=xyz&sort=cagr&order=desc")).toBeNull();
    expect(await insert(`cagr=20&margin=10&years=5&owner=20&ownermode=any&sector=${SECTOR33.map(([code]) => code).join(",")}&sort=cagr&order=desc`)).toBeNull();
  });

  it("serializeScreeningParams の出力（page を除く）は、どれも DB の形の検査を通る", async () => {
    const offSets: ConditionKey[][] = [];
    for (let mask = 0; mask < 16; mask++) offSets.push(CONDITION_KEYS.filter((_, i) => mask & (1 << i)));
    const marketSets = [[], ...MARKETS.map((m) => [m.code]), MARKETS.map((m) => m.code)];
    const sectorSets = [[], [SECTOR33[0][0]], SECTOR33.map(([code]) => code)];
    const queries = new Set<string>();
    for (const off of offSets) {
      for (const [includeUnavailable, includeUndeterminable] of [
        [false, false],
        [true, false],
        [false, true],
        [true, true],
      ]) {
        for (const market of marketSets) {
          for (const sector of sectorSets) {
            const conditions: ScreeningConditions = {
              ...DEFAULT_CONDITIONS,
              cagr: "-100",
              margin: "12.5",
              years: "0.1",
              owner: "100",
              ownerMode: off.length % 2 === 0 ? "any" : "president",
              off,
              includeUnavailable,
              includeUndeterminable,
              market: market as ScreeningConditions["market"],
              sector,
              sort: SORT_KEYS[queries.size % SORT_KEYS.length],
              order: queries.size % 2 === 0 ? "asc" : "desc",
              page: 7,
            };
            queries.add(presetQueryOf(conditions));
          }
        }
      }
    }
    for (const sort of SORT_KEYS) for (const order of ["asc", "desc"] as const) queries.add(presetQueryOf({ ...DEFAULT_CONDITIONS, sort, order }));
    // check 制約の正規表現（定義から取り出す。取り出せなければ失敗にする）で、すべてのクエリを確かめる
    const { rows: result } = await db.query(
      `with c as (select substring(pg_get_constraintdef(oid) from $$query ~ '(.*)'::text$$) as pattern
                   from pg_constraint where conname = 'screening_presets_query_check')
       select c.pattern, count(*)::int as total,
              count(*) filter (where char_length(q) <= 1000 and q ~ c.pattern)::int as passed,
              array_agg(q) filter (where not (char_length(q) <= 1000 and q ~ c.pattern)) as failed
         from c cross join unnest($1::text[]) as q group by c.pattern`,
      [[...queries]],
    );
    expect(result[0].pattern).toMatch(/^\^cagr=/);
    expect(result[0].failed).toBeNull();
    expect(result[0].passed).toBe(queries.size);
    expect(queries.size).toBeGreaterThan(900);
    // 念のため実際の insert でも抜き取って確かめる
    for (const query of [...queries].slice(0, 40)) {
      expect(await tryAsUser(ownerId, "insert into public.screening_presets (name, query) values ($1, $2)", [`${P}s`, query])).toBeNull();
    }
  });
});

describe("既定の切り替えと作成（R1。C6-1）", () => {
  it("既定つきの作成で既存の既定が外れる。名前の重複で失敗したら行も既定も残らない", async () => {
    await create(ownerId, `${P}厳しめ`, STRICT, true);
    await create(ownerId, `${P}新既定`, STANDARD_QUERY, true);
    expect(await defaults(ownerId)).toEqual([`${P}新既定`]);
    expect(await tryAsUser(ownerId, "select public.create_screening_preset($1, $2, true)", [`${P}厳しめ`, STANDARD_QUERY], true)).toBe("23505");
    expect(await defaults(ownerId)).toEqual([`${P}新既定`]);
    expect((await rows(ownerId)).length).toBe(2);
  });

  it("PATCH の名前と既定の同時の変更。名前が重複なら名前も既定も変わらない", async () => {
    await create(ownerId, `${P}厳しめ`, STRICT, true);
    const growth = await create(ownerId, `${P}グロースのみ`);
    expect(
      await tryAsUser(ownerId, "select public.update_screening_preset($1, $2, null, true)", [growth.id, `${P}厳しめ`], true),
    ).toBe("23505");
    expect(await defaults(ownerId)).toEqual([`${P}厳しめ`]);
    await asUser(ownerId, (c) => c.query("select public.update_screening_preset($1, $2, null, true)", [growth.id, `${P}厳しめ（改）`]));
    expect(await defaults(ownerId)).toEqual([`${P}厳しめ（改）`]);
  });

  it("同じユーザーの既定の切り替えを2つの接続で並行に行うと、ロックで待ち、どちらも成功し、後にコミットした方が既定", async () => {
    const a = await create(ownerId, `${P}A`);
    const b = await create(ownerId, `${P}B`);
    const other = new Client({ connectionString: DB_URL });
    await other.connect();
    try {
      // 接続1: A を既定にして、トランザクションを開いたまま
      await db.query("begin");
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ownerId, role: "authenticated" })]);
      await db.query("select public.set_default_screening_preset($1, true)", [a.id]);
      const pidOther = (await other.query("select pg_backend_pid() as pid")).rows[0].pid;
      // 接続2: B を既定にする（接続1のロックを待つ）
      const second = asUser(ownerId, (c) => c.query("select public.set_default_screening_preset($1, true) as r", [b.id]), true, other);
      // 接続2がロックを待っていることを確かめる（逐次の実行で成功していないこと）
      const observer = new Client({ connectionString: DB_URL });
      await observer.connect();
      let waiting = false;
      for (let i = 0; i < 50 && !waiting; i++) {
        const { rows: act } = await observer.query("select wait_event_type, wait_event from pg_stat_activity where pid = $1", [pidOther]);
        waiting = act[0]?.wait_event_type === "Lock" && act[0]?.wait_event === "advisory";
        if (!waiting) await new Promise((r) => setTimeout(r, 20));
      }
      await observer.end();
      expect(waiting, "接続2が advisory lock を待つ").toBe(true);
      await db.query("commit");
      await second;
    } finally {
      await other.end();
    }
    expect(await defaults(ownerId)).toEqual([`${P}B`]);
  });

  it("上限: 50 件まで。49 件のユーザーで2つの insert を並行に行うと1つだけが成功する（ロックの待ちを確かめる）", async () => {
    const values = Array.from({ length: 49 }, (_, i) => `${P}${String(i).padStart(2, "0")}`);
    await asUser(ownerId, (c) =>
      c.query("insert into public.screening_presets (name, query) select n, $2 from unnest($1::text[]) as n", [values, STANDARD_QUERY]),
    );
    const other = new Client({ connectionString: DB_URL });
    await other.connect();
    let secondError: string | null = null;
    try {
      await db.query("begin");
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ownerId, role: "authenticated" })]);
      await db.query("insert into public.screening_presets (name, query) values ($1, $2)", [`${P}49a`, STANDARD_QUERY]);
      const pidOther = (await other.query("select pg_backend_pid() as pid")).rows[0].pid;
      const second = asUser(
        ownerId,
        (c) => c.query("insert into public.screening_presets (name, query) values ($1, $2)", [`${P}49b`, STANDARD_QUERY]),
        true,
        other,
      ).catch((error: { code?: string }) => {
        secondError = error.code ?? "error";
      });
      const observer = new Client({ connectionString: DB_URL });
      await observer.connect();
      let waiting = false;
      for (let i = 0; i < 50 && !waiting; i++) {
        const { rows: act } = await observer.query("select wait_event_type from pg_stat_activity where pid = $1", [pidOther]);
        waiting = act[0]?.wait_event_type === "Lock";
        if (!waiting) await new Promise((r) => setTimeout(r, 20));
      }
      await observer.end();
      expect(waiting, "2つ目の insert がロックを待つ").toBe(true);
      await db.query("commit");
      await second;
    } finally {
      await other.end();
    }
    expect(secondError).toBe("QP050");
    expect((await rows(ownerId)).length).toBe(50);
    expect(await tryAsUser(ownerId, "select public.create_screening_preset($1, $2, false)", [`${P}51`, STANDARD_QUERY])).toBe("QP050");
  });

  it("ユーザーの削除でプリセットは連鎖して消える。市場データとは独立", async () => {
    const { rows: users } = await db.query(
      "insert into auth.users (id, instance_id, aud, role, email) values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cascade@quantis-db13.local') returning id::text",
    );
    await db.query("insert into public.screening_presets (user_id, name, query) values ($1, $2, $3)", [users[0].id, `${P}c`, STANDARD_QUERY]);
    await db.query("delete from auth.users where id = $1", [users[0].id]);
    expect((await rows(users[0].id)).length).toBe(0);
  });
});

describe("性能（C7）", () => {
  it("1人 50 件・ほか 20 人 × 50 件で、一覧は 20ms 以内、既定は 10ms 以内（authenticated、中央値）", async () => {
    await db.query(
      `with u as (
         insert into auth.users (id, instance_id, aud, role, email)
         select gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'perf' || i || '@quantis-db13.local'
           from generate_series(1, 20) i
         returning id)
       insert into public.screening_presets (user_id, name, query)
       select u.id, $1 || n, $2 from u cross join generate_series(1, 50) n`,
      [P, STANDARD_QUERY],
    );
    await db.query(
      "insert into public.screening_presets (user_id, name, query, is_default) select $1, $2 || n, $3, n = 25 from generate_series(1, 50) n",
      [ownerId, P, STANDARD_QUERY],
    );
    await db.query("analyze public.screening_presets");
    const timeOf = async (text: string) =>
      asUser(
        ownerId,
        async (c) => {
          const samples: number[] = [];
          for (let i = 0; i < 15; i++) {
            const started = performance.now();
            await c.query(text);
            samples.push(performance.now() - started);
          }
          samples.sort((x, y) => x - y);
          return samples[Math.floor(samples.length / 2)];
        },
        false,
      );
    const list = await timeOf(
      "select id, name, query, is_default, created_at, updated_at from public.screening_presets order by created_at, id",
    );
    const def = await timeOf("select id, name, query, is_default, created_at, updated_at from public.screening_presets where is_default limit 1");
    console.info(`[性能] プリセットの一覧 ${list.toFixed(2)}ms、既定 ${def.toFixed(2)}ms（中央値）`);
    expect(list).toBeLessThan(20);
    expect(def).toBeLessThan(10);
  });
});
