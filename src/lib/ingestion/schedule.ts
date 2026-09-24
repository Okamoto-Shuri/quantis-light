/**
 * 定期実行（Vercel Cron）の設定。vercel.json の crons と一致させる（schedule.test.ts が照合する）。
 * Vercel Cron の時刻は UTC。11:00 UTC = 20:00 JST（J-Quants の上場銘柄一覧は営業日の 17:30 以降に当日分を取得できる）。
 */
export const CRON_PATH = "/api/cron/daily";
export const CRON_SCHEDULE = "0 11 * * *";
export const CRON_SCHEDULE_LABEL = "毎日 20:00（日本時間）";
/** 定期実行で取り込む対象の表示名（この順に実行する。runner の SUPPORTED_TARGETS と一致させる）。 */
export const CRON_TARGETS_LABEL = "銘柄マスタ、株価（初出日）";
