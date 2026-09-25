import type { Clock } from "./clock";

/**
 * 外部 API への要求の間隔と期限、呼び出し回数の制限（429・503）での待機と再試行（契約 sprint-12 の第2章の3）。
 *
 * - 要求の間隔は、前の要求の開始から intervalMs 以上（再試行を含むすべての要求）。
 * - 制限の応答を受けたら、Retry-After（秒の整数。1〜120 秒に収める）、無ければ 15 秒 → 30 秒 → 60 秒待って同じ要求を再試行する。
 *   1つの要求につき再試行は3回まで。回復した後は、その実行の残りで間隔を2倍にする。
 * - 待ちの終わりが期限を超えるときは待たずに打ち切る（rate_limit_exhausted / deadline）。
 * - 期限（deadline）を過ぎたら、新しい要求を始めない（{ kind: "deadline" }）。
 */

export const RATE_LIMIT_WAITS_MS = [15_000, 30_000, 60_000] as const;
export const RATE_LIMIT_MAX_RETRIES = RATE_LIMIT_WAITS_MS.length;
export const RETRY_AFTER_MIN_SECONDS = 1;
export const RETRY_AFTER_MAX_SECONDS = 120;

export type RateLimitStats = {
  /** 制限の応答の回数 */
  hits: number;
  /** 再試行の回数 */
  retries: number;
  /** 待った合計（ミリ秒） */
  waitedMs: number;
  /** 解消せずに打ち切ったか */
  exhausted: boolean;
};

export function emptyRateLimitStats(): RateLimitStats {
  return { hits: 0, retries: 0, waitedMs: 0, exhausted: false };
}

/** 要求の数と制限の記録（details の apiCalls・rateLimit に入れる）。 */
export type RequestCounters = { apiCalls: number; rateLimit: RateLimitStats };

export type RateLimitExhausted<T> = {
  kind: "rate_limit_exhausted";
  /** retries: 3回再試行しても解消しない。deadline: 待ちの終わりが期限を超える */
  cause: "retries" | "deadline";
  /** 最後の制限の応答 */
  last: T;
};

export type Paced<T> = T | { kind: "deadline" } | RateLimitExhausted<T>;

type RateLimitedLike = { kind: string; retryAfterSeconds?: number | null };

/** 制限の応答の待ち時間（ミリ秒）。retryIndex は 0 始まり（何回目の再試行か）。 */
export function rateLimitWaitMs(retryAfterSeconds: number | null | undefined, retryIndex: number): number {
  if (typeof retryAfterSeconds === "number" && Number.isFinite(retryAfterSeconds)) {
    const seconds = Math.min(Math.max(Math.trunc(retryAfterSeconds), RETRY_AFTER_MIN_SECONDS), RETRY_AFTER_MAX_SECONDS);
    return seconds * 1000;
  }
  return RATE_LIMIT_WAITS_MS[Math.min(retryIndex, RATE_LIMIT_WAITS_MS.length - 1)];
}

export type Pacer = {
  send<T extends RateLimitedLike>(request: () => Promise<T>): Promise<Paced<T>>;
  /** 今の要求の間隔（回復後は2倍） */
  intervalMs(): number;
};

export function createPacer({
  clock,
  deadline,
  intervalMs,
  counters,
  deadlineCheck = "after_wait",
}: {
  clock: Clock;
  deadline: number;
  intervalMs: number;
  counters: RequestCounters;
  /** 期限の確認を、間隔の待ちの前に行うか後に行うか（株価は前、財務・EDINET は後。Sprint 4・5・8 のまま） */
  deadlineCheck?: "before_wait" | "after_wait";
}): Pacer {
  let lastRequestAt = Number.NEGATIVE_INFINITY;
  let interval = intervalMs;
  let slowed = false;

  async function paceAndCheck(): Promise<boolean> {
    if (deadlineCheck === "before_wait" && clock.now() >= deadline) return false;
    const wait = lastRequestAt + interval - clock.now();
    if (wait > 0) await clock.sleep(wait);
    if (deadlineCheck === "after_wait" && clock.now() >= deadline) return false;
    return true;
  }

  return {
    intervalMs: () => interval,
    async send<T extends RateLimitedLike>(request: () => Promise<T>): Promise<Paced<T>> {
      if (!(await paceAndCheck())) return { kind: "deadline" };
      for (let retryIndex = 0; ; retryIndex += 1) {
        lastRequestAt = clock.now();
        counters.apiCalls += 1;
        const result = await request();
        if (result.kind !== "rate_limited") {
          if (retryIndex > 0 && !slowed) {
            // 回復した: この実行の残りで間隔を2倍にする
            interval = intervalMs * 2;
            slowed = true;
          }
          return result;
        }
        counters.rateLimit.hits += 1;
        if (retryIndex >= RATE_LIMIT_MAX_RETRIES) {
          counters.rateLimit.exhausted = true;
          return { kind: "rate_limit_exhausted", cause: "retries", last: result };
        }
        const waitMs = rateLimitWaitMs(result.retryAfterSeconds, retryIndex);
        if (clock.now() + waitMs >= deadline) {
          counters.rateLimit.exhausted = true;
          return { kind: "rate_limit_exhausted", cause: "deadline", last: result };
        }
        await clock.sleep(waitMs);
        counters.rateLimit.waitedMs += waitMs;
        counters.rateLimit.retries += 1;
        const wait = lastRequestAt + interval - clock.now();
        if (wait > 0) await clock.sleep(wait);
      }
    },
  };
}
