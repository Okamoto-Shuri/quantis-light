import { describe, expect, it } from "vitest";

import { createPacer, emptyRateLimitStats, rateLimitWaitMs } from "./pacer";

function fakeClock(start = 0) {
  let now = start;
  const sleeps: number[] = [];
  return {
    sleeps,
    clock: {
      now: () => now,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        now += ms;
      },
    },
  };
}

type Reply = { kind: "ok" } | { kind: "rate_limited"; retryAfterSeconds?: number };

function sequence(replies: Reply[]) {
  let i = 0;
  const at: number[] = [];
  return {
    at,
    request: (clock: { now(): number }) => async () => {
      at.push(clock.now());
      return replies[Math.min(i++, replies.length - 1)];
    },
  };
}

describe("rateLimitWaitMs（契約 sprint-12 の第2章の3）", () => {
  it("Retry-After が無ければ 15・30・60 秒", () => {
    expect([0, 1, 2].map((i) => rateLimitWaitMs(undefined, i))).toEqual([15_000, 30_000, 60_000]);
  });
  it("Retry-After（秒）は 1〜120 秒に収める", () => {
    expect(rateLimitWaitMs(7, 0)).toBe(7_000);
    expect(rateLimitWaitMs(600, 0)).toBe(120_000);
    expect(rateLimitWaitMs(0, 2)).toBe(1_000);
  });
});

describe("createPacer", () => {
  it("429 を2回受けたら 15 秒・30 秒待って同じ要求を再試行し、回復後は間隔を2倍にする（C3-1）", async () => {
    const { clock, sleeps } = fakeClock();
    const counters = { apiCalls: 0, rateLimit: emptyRateLimitStats() };
    const pacer = createPacer({ clock, deadline: 1_000_000, intervalMs: 600, counters });
    const seq = sequence([{ kind: "rate_limited" }, { kind: "rate_limited" }, { kind: "ok" }, { kind: "ok" }]);
    expect(await pacer.send(seq.request(clock))).toEqual({ kind: "ok" });
    expect(sleeps.slice(0, 2)).toEqual([15_000, 30_000]);
    expect(counters).toEqual({ apiCalls: 3, rateLimit: { hits: 2, retries: 2, waitedMs: 45_000, exhausted: false } });
    expect(pacer.intervalMs()).toBe(1_200);
    await pacer.send(seq.request(clock));
    expect(seq.at[3] - seq.at[2]).toBeGreaterThanOrEqual(1_200);
  });

  it("429 が4回続けば3回再試行した後に打ち切る（C3-2）", async () => {
    const { clock } = fakeClock();
    const counters = { apiCalls: 0, rateLimit: emptyRateLimitStats() };
    const pacer = createPacer({ clock, deadline: 1_000_000, intervalMs: 600, counters });
    const seq = sequence([{ kind: "rate_limited" }]);
    const result = await pacer.send(seq.request(clock));
    expect(result).toMatchObject({ kind: "rate_limit_exhausted", cause: "retries" });
    expect(seq.at).toHaveLength(4);
    expect(counters.rateLimit).toEqual({ hits: 4, retries: 3, waitedMs: 105_000, exhausted: true });
  });

  it("Retry-After: 7 なら 7 秒待つ（C3-3）", async () => {
    const { clock, sleeps } = fakeClock();
    const counters = { apiCalls: 0, rateLimit: emptyRateLimitStats() };
    const pacer = createPacer({ clock, deadline: 1_000_000, intervalMs: 600, counters });
    await pacer.send(sequence([{ kind: "rate_limited", retryAfterSeconds: 7 }, { kind: "ok" }]).request(clock));
    expect(sleeps[0]).toBe(7_000);
  });

  it("待ちの終わりが期限を超えるときは待たずに打ち切る（C3-4）", async () => {
    const { clock, sleeps } = fakeClock();
    const counters = { apiCalls: 0, rateLimit: emptyRateLimitStats() };
    const pacer = createPacer({ clock, deadline: 10_000, intervalMs: 600, counters });
    const result = await pacer.send(sequence([{ kind: "rate_limited" }]).request(clock));
    expect(result).toMatchObject({ kind: "rate_limit_exhausted", cause: "deadline" });
    expect(sleeps).toEqual([]);
    expect(counters.rateLimit).toEqual({ hits: 1, retries: 0, waitedMs: 0, exhausted: true });
  });

  it("期限を過ぎたら新しい要求を始めない。間隔は前の要求の開始から数える", async () => {
    const { clock } = fakeClock();
    const counters = { apiCalls: 0, rateLimit: emptyRateLimitStats() };
    const pacer = createPacer({ clock, deadline: 1_000, intervalMs: 600, counters });
    const seq = sequence([{ kind: "ok" }]);
    await pacer.send(seq.request(clock));
    await pacer.send(seq.request(clock));
    expect(seq.at).toEqual([0, 600]);
    expect(await pacer.send(seq.request(clock))).toEqual({ kind: "deadline" });
    expect(counters.apiCalls).toBe(2);
  });

  it("同時に呼んでも、開始は呼んだ順で、開始どうしの間隔を保つ。応答を待たずに次の要求を始める", async () => {
    const { clock } = fakeClock();
    const counters = { apiCalls: 0, rateLimit: emptyRateLimitStats() };
    const pacer = createPacer({ clock, deadline: 1_000_000, intervalMs: 1_000, counters });
    const started: { id: number; at: number }[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const request = (id: number) => async () => {
      started.push({ id, at: clock.now() });
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { kind: "ok" as const };
    };
    await Promise.all([0, 1, 2, 3].map((id) => pacer.send(request(id))));
    expect(started.map((s) => s.id)).toEqual([0, 1, 2, 3]);
    expect(started.map((s) => s.at)).toEqual([0, 1_000, 2_000, 3_000]);
    expect(maxInFlight).toBe(4);
  });

  it("制限の応答の待ちの間は、ほかの要求も始めない。cancelled なら要求を始めない", async () => {
    const { clock } = fakeClock();
    const counters = { apiCalls: 0, rateLimit: emptyRateLimitStats() };
    const pacer = createPacer({ clock, deadline: 1_000_000, intervalMs: 1_000, counters });
    const at: Record<"a" | "b", number[]> = { a: [], b: [] };
    let limited = true;
    const a = async () => {
      at.a.push(clock.now());
      if (limited) {
        limited = false;
        // 応答が届く前に b が順番を取る
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { kind: "rate_limited" as const, retryAfterSeconds: 10 };
      }
      return { kind: "ok" as const };
    };
    const b = async () => {
      at.b.push(clock.now());
      return { kind: "ok" as const };
    };
    await Promise.all([pacer.send(a), pacer.send(b)]);
    // a の制限は b の開始（1 秒）の後に届き、そこから 10 秒待って再試行する
    expect(at.a).toEqual([0, 11_000]);
    // b は間隔どおり 1 秒後に始まる（a の制限はまだ分からない）。その後の要求は a の待ちの終わりより後
    expect(at.b).toEqual([1_000]);
    await pacer.send(b);
    expect(at.b[1]).toBeGreaterThanOrEqual(10_000);
    expect(await pacer.send(b, { cancelled: () => true })).toEqual({ kind: "deadline" });
    expect(at.b).toHaveLength(2);
  });
});
