import { RUN_TARGET_LONG_LABELS } from "./runs";

/**
 * 定期実行（Vercel Cron）の設定。vercel.json の crons と一致させる（schedule.test.ts が照合する）。
 * Vercel Cron の時刻は UTC。
 * - 11:00 UTC = 20:00 JST: 銘柄マスタ → 株価（初出日）。J-Quants の上場銘柄一覧は営業日の 17:30 以降に当日分を取得できる。
 * - 13:00 UTC = 22:00 JST: 財務（決算短信）。財務情報の速報は 18:00 頃。確報（24:30 頃）は翌日の実行で直近7日を取り直すときに入る。
 *   別の関数にするのは、株価の初回の取り込み（210 秒を使い切る）と時間を取り合わないため。Vercel Hobby の Cron は起動時刻が
 *   1時間の中でずれるので、20:00 の実行と重ならないよう2時間あける。
 * - 15:00 UTC = 0:00 JST: EDINET（有報・届出書）。書類はおおむね当日の 17:15 までに提出される。0:00 を過ぎてから動くので、実行日（JST）は
 *   前日の書類の提出日の翌日になる（書類一覧の直近7日の取り直しに前日が含まれる）。22:00 の財務の実行（最大 23:05 ごろまで）とは、
 *   Hobby の1時間のずれを見込んでも重ならない。
 */
export type CronJob = {
  path: string;
  schedule: string;
  scheduleLabel: string;
  /** この順に実行する（runner の SupportedTarget）。 */
  targets: readonly ("stock_master" | "daily_quotes" | "financials" | "edinet_reports")[];
  targetsLabel: string;
};

export const DAILY_CRON_JOB = {
  path: "/api/cron/daily",
  schedule: "0 11 * * *",
  scheduleLabel: "毎日 20:00（日本時間）",
  targets: ["stock_master", "daily_quotes"],
  targetsLabel: "銘柄マスタ、株価（初出日）",
} as const satisfies CronJob;

export const FINANCIALS_CRON_JOB = {
  path: "/api/cron/financials",
  schedule: "0 13 * * *",
  scheduleLabel: "毎日 22:00（日本時間）",
  targets: ["financials"],
  targetsLabel: "財務（決算短信）",
} as const satisfies CronJob;

export const EDINET_CRON_JOB = {
  path: "/api/cron/edinet",
  schedule: "0 15 * * *",
  scheduleLabel: "毎日 0:00（日本時間）",
  targets: ["edinet_reports"],
  targetsLabel: RUN_TARGET_LONG_LABELS.edinet_reports,
} as const satisfies CronJob;

export const CRON_JOBS: readonly CronJob[] = [DAILY_CRON_JOB, FINANCIALS_CRON_JOB, EDINET_CRON_JOB];

/** Sprint 3・4 からの名前（/api/cron/daily の設定）。 */
export const CRON_PATH = DAILY_CRON_JOB.path;
export const CRON_SCHEDULE = DAILY_CRON_JOB.schedule;
export const CRON_SCHEDULE_LABEL = DAILY_CRON_JOB.scheduleLabel;
export const CRON_TARGETS_LABEL = DAILY_CRON_JOB.targetsLabel;
