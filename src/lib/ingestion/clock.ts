/** 時計（テストで差し替える）。 */
export type Clock = { now(): number; sleep(ms: number): Promise<void> };

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * 外部 API への新しい要求を始めてよい時間。ルート（Route Handler）の処理の開始から数える。
 * Vercel の関数の上限（maxDuration = 300 秒）から、1回の要求のタイムアウト（30 秒）と保存の時間を引いた値。
 */
export const REQUEST_BUDGET_MS = 210_000;
