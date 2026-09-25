/**
 * ウォッチリスト（Sprint 14）の結合テスト（契約の C5-4〜C5-8・C7-1 のウォッチリストの部分）。
 * 実行: pnpm test:db（pnpm seed:users 済み。owner・owner2・intruder）。
 * 作る行: 銘柄コード 9S8xx・上限のテストの 9S5xx（銘柄の削除でウォッチリストも連鎖して消える）と、@quantis-db14.local のユーザー。
 * 後片付けで自分の行だけを消す。
 */
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const DB_URL = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const db = new Client({ connectionString: DB_URL });
let ownerId = "";
let owner2Id = "";
let intruderId = "";

async function cleanup() {
  await db.query("delete from public.stocks where code like '9S8%' or code like '9S5%'");
  await db.query("delete from auth.users where email like '%@quantis-db14.local'");
}

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

async function tryAsUser(userId: string, text: string, values: unknown[] = [], commit = false): Promise<string | null> {
  try {
    await asUser(userId, (c) => c.query(text, values), commit);
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "error";
  }
}

async function insertStocks(codes: string[]) {
  await db.query(
    `insert into public.stocks (code, company_name, market_code, market_name, sector33_code, sector33_name, product_category)
     select c, 'DB14検証' || c, '0113', 'グロース', '5250', '情報・通信業', '011' from unnest($1::text[]) c`,
    [codes],
  );
}

async function rows(userId: string) {
  const { rows: result } = await db.query(
    "select code, memo, created_at, updated_at from public.watchlist_items where user_id = $1 and (code like '9S8%' or code like '9S5%') order by code",
    [userId],
  );
  return result as { code: string; memo: string | null; created_at: Date; updated_at: Date }[];
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

beforeEach(async () => {
  await cleanup();
  await insertStocks(["9S801", "9S802", "9S803"]);
});

afterAll(async () => {
  await cleanup();
  await db.end();
});

describe("RLS とユーザーごとの分離（C5-4・C5-8）", () => {
  it("select は本人の行だけ。他人の行の update・delete は0行。他人の user_id の insert は拒否、省けば本人", async () => {
    await asUser(ownerId, (c) => c.query("insert into public.watchlist_items (code, memo) values ('9S801', 'owner')"));
    await asUser(owner2Id, (c) => c.query("insert into public.watchlist_items (code, memo) values ('9S801', 'owner2')"));
    const seen = await asUser(owner2Id, async (c) => (await c.query("select memo from public.watchlist_items where code like '9S8%'")).rows);
    expect(seen.map((r) => r.memo)).toEqual(["owner2"]);
    const updated = await asUser(owner2Id, async (c) => (await c.query("update public.watchlist_items set memo = 'x' where user_id = $1 and code = '9S801'", [ownerId])).rowCount);
    const deleted = await asUser(owner2Id, async (c) => (await c.query("delete from public.watchlist_items where user_id = $1", [ownerId])).rowCount);
    expect([updated, deleted]).toEqual([0, 0]);
    expect((await rows(ownerId)).map((r) => r.memo)).toEqual(["owner"]);
    expect(await tryAsUser(owner2Id, "insert into public.watchlist_items (user_id, code) values ($1, '9S802')", [ownerId])).toBe("42501");
  });

  it("許可リスト外（intruder）は読めず書けない", async () => {
    await asUser(ownerId, (c) => c.query("insert into public.watchlist_items (code) values ('9S801')"));
    const seen = await asUser(intruderId, async (c) => (await c.query("select count(*)::int as n from public.watchlist_items")).rows[0].n);
    expect(seen).toBe(0);
    expect(await tryAsUser(intruderId, "insert into public.watchlist_items (code) values ('9S802')")).toBe("42501");
  });
});

describe("直接の書き込みへの防御（C5-5）", () => {
  it("user_id・code の変更は拒否、日時は偽れない、メモの規則、存在しない銘柄", async () => {
    await asUser(ownerId, (c) => c.query("insert into public.watchlist_items (code, memo, created_at, updated_at) values ('9S801', 'x', '2000-01-01', '2000-01-01')"));
    const [first] = await rows(ownerId);
    expect(first.created_at.getFullYear()).toBeGreaterThan(2020);
    expect(first.updated_at.getTime()).toBe(first.created_at.getTime());

    expect(await tryAsUser(ownerId, "update public.watchlist_items set user_id = $1 where code = '9S801'", [owner2Id])).toBe("42501");
    expect(await tryAsUser(ownerId, "update public.watchlist_items set code = '9S802' where code = '9S801'")).toBe("42501");
    await asUser(ownerId, (c) => c.query("update public.watchlist_items set created_at = '2000-01-01', updated_at = '2000-01-01' where code = '9S801'"));
    const [same] = await rows(ownerId);
    expect([same.created_at.getTime(), same.updated_at.getTime()]).toEqual([first.created_at.getTime(), first.updated_at.getTime()]);

    // メモ: 1,001 コードポイントは拒否。前後の空白は除く。空白だけは NULL
    expect(await tryAsUser(ownerId, "update public.watchlist_items set memo = $1 where code = '9S801'", ["𠮷".repeat(1001)])).toBe("23514");
    await asUser(ownerId, (c) => c.query("update public.watchlist_items set memo = $1 where code = '9S801'", ["　" + "𠮷".repeat(1000) + "\n "]));
    expect([...((await rows(ownerId))[0].memo ?? "")].length).toBe(1000);
    const edited = (await rows(ownerId))[0];
    expect(edited.updated_at.getTime()).toBeGreaterThan(first.updated_at.getTime());
    expect(edited.created_at.getTime()).toBe(first.created_at.getTime());
    await asUser(ownerId, (c) => c.query("update public.watchlist_items set memo = $1 where code = '9S801'", ["　\n\t "]));
    expect((await rows(ownerId))[0].memo).toBeNull();
    await asUser(ownerId, (c) => c.query("insert into public.watchlist_items (code, memo) values ('9S802', $1)", ["\n　途中の\n改行　 "]));
    expect((await rows(ownerId))[1].memo).toBe("途中の\n改行");

    expect(await tryAsUser(ownerId, "insert into public.watchlist_items (code) values ('9S899')")).toBe("23503");
  });
});

describe("上限と冪等な追加（C7-1。R1）", () => {
  async function fill(userId: string, count: number) {
    // 9S5 ＋ 36進の2文字（最大 1,296 銘柄）
    const unique = Array.from({ length: count }, (_, i) => `9S5${i.toString(36).toUpperCase().padStart(2, "0")}`);
    await insertStocks(unique);
    await db.query("insert into public.watchlist_items (user_id, code) select $1, c from unnest($2::text[]) c", [userId, unique]);
    return unique;
  }

  async function waitForLock(pid: number) {
    const observer = new Client({ connectionString: DB_URL });
    await observer.connect();
    let waiting = false;
    for (let i = 0; i < 50 && !waiting; i++) {
      const { rows: act } = await observer.query("select wait_event_type from pg_stat_activity where pid = $1", [pid]);
      waiting = act[0]?.wait_event_type === "Lock";
      if (!waiting) await new Promise((r) => setTimeout(r, 20));
    }
    await observer.end();
    return waiting;
  }

  it("500 件のユーザー: 登録済みの銘柄の insert（on conflict do nothing）は成功し、行は変わらない。新しい銘柄は QW500", async () => {
    const codes = await fill(ownerId, 497);
    await asUser(ownerId, (c) => c.query("insert into public.watchlist_items (code) values ('9S801'), ('9S802'), ('9S803')"));
    expect((await db.query("select count(*)::int as n from public.watchlist_items where user_id = $1", [ownerId])).rows[0].n).toBe(500);
    const before = (await db.query("select created_at from public.watchlist_items where user_id = $1 and code = $2", [ownerId, codes[5]])).rows[0].created_at;
    await asUser(ownerId, (c) => c.query("insert into public.watchlist_items (code) values ($1) on conflict (user_id, code) do nothing", [codes[5]]));
    const after = (await db.query("select created_at from public.watchlist_items where user_id = $1 and code = $2", [ownerId, codes[5]])).rows[0].created_at;
    expect(after.getTime()).toBe(before.getTime());
    await insertStocks(["9S804"]);
    expect(await tryAsUser(ownerId, "insert into public.watchlist_items (code) values ('9S804') on conflict (user_id, code) do nothing")).toBe("QW500");
    expect(await tryAsUser(ownerId, "insert into public.watchlist_items (code) values ('9S804')")).toBe("QW500");
    expect((await db.query("select count(*)::int as n from public.watchlist_items where user_id = $1", [ownerId])).rows[0].n).toBe(500);
  });

  it("499 件のユーザー: 別の銘柄の2つの並行の insert は1つだけ成功（ロックの待ちを確かめる）", async () => {
    await fill(ownerId, 499);
    const other = new Client({ connectionString: DB_URL });
    await other.connect();
    let secondError: string | null = null;
    try {
      await db.query("begin");
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ownerId, role: "authenticated" })]);
      await db.query("insert into public.watchlist_items (code) values ('9S801')");
      const pidOther = (await other.query("select pg_backend_pid() as pid")).rows[0].pid;
      const second = asUser(ownerId, (c) => c.query("insert into public.watchlist_items (code) values ('9S802')"), true, other).catch(
        (error: { code?: string }) => {
          secondError = error.code ?? "error";
        },
      );
      expect(await waitForLock(pidOther), "2つ目の insert がロックを待つ").toBe(true);
      await db.query("commit");
      await second;
    } finally {
      await other.end();
    }
    expect(secondError).toBe("QW500");
    expect((await db.query("select count(*)::int as n from public.watchlist_items where user_id = $1", [ownerId])).rows[0].n).toBe(500);
  });

  it("499 件のユーザー: 同じ銘柄の2つの並行の insert（on conflict do nothing）は両方成功し、1行（500 件）になる", async () => {
    await fill(ownerId, 499);
    const other = new Client({ connectionString: DB_URL });
    await other.connect();
    try {
      await db.query("begin");
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ownerId, role: "authenticated" })]);
      await db.query("insert into public.watchlist_items (code) values ('9S801') on conflict (user_id, code) do nothing");
      const pidOther = (await other.query("select pg_backend_pid() as pid")).rows[0].pid;
      const second = asUser(ownerId, (c) => c.query("insert into public.watchlist_items (code) values ('9S801') on conflict (user_id, code) do nothing"), true, other);
      expect(await waitForLock(pidOther), "2つ目の insert がロックを待つ").toBe(true);
      await db.query("commit");
      await second;
    } finally {
      await other.end();
    }
    const { rows: result } = await db.query(
      "select count(*)::int as n, count(*) filter (where code = '9S801')::int as target from public.watchlist_items where user_id = $1",
      [ownerId],
    );
    expect(result[0]).toEqual({ n: 500, target: 1 });
  });
});

describe("連鎖（C7-1）", () => {
  it("ユーザーの削除・銘柄の削除で消える。上場廃止では消えない", async () => {
    const { rows: users } = await db.query(
      "insert into auth.users (id, instance_id, aud, role, email) values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cascade@quantis-db14.local') returning id::text",
    );
    const temp = users[0].id as string;
    await db.query("insert into public.watchlist_items (user_id, code) values ($1, '9S801'), ($2, '9S801'), ($2, '9S802')", [temp, ownerId]);
    await db.query("delete from auth.users where id = $1", [temp]);
    expect((await db.query("select count(*)::int as n from public.watchlist_items where user_id = $1", [temp])).rows[0].n).toBe(0);
    await db.query("update public.stocks set delisted_on = '2026-09-25' where code = '9S801'");
    expect((await rows(ownerId)).map((r) => r.code)).toEqual(["9S801", "9S802"]);
    await db.query("delete from public.stocks where code = '9S802'");
    expect((await rows(ownerId)).map((r) => r.code)).toEqual(["9S801"]);
  });
});
