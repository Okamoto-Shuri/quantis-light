import { expect, type BrowserContext, type Page } from "@playwright/test";
import { Client } from "pg";

/** E2E の対象（playwright.config.ts と同じ規則）。 */
export const BASE_URL = `http://localhost:${process.env.E2E_PORT ?? 3000}`;
/** 定期実行のエンドポイントの E2E に使うシークレット（playwright.config.ts と同じ既定値）。 */
export const CRON_SECRET = process.env.E2E_CRON_SECRET ?? "e2e-local-cron-secret-0123456789";

export const OWNER = { email: "owner@quantis.local", password: "Quantis-Owner-2026!" };
export const INTRUDER = { email: "intruder@quantis.local", password: "Quantis-Intruder-2026!" };
export const TEST_STOCK = {
  code: "99991",
  company_name: "E2E検証用銘柄株式会社",
  market_name: "グロース",
  sector33_name: "情報・通信業",
};

export const DB_URL = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/** ローカル DB に対して SQL を実行する（テストの前準備と後片付けのみ）。 */
export async function sql(text: string, values: unknown[] = []) {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    return await client.query(text, values);
  } finally {
    await client.end();
  }
}

export async function login(page: Page, email: string, password: string, path = "/login") {
  await page.goto(path);
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill(password);
  await page.getByRole("button", { name: "ログイン" }).click();
}

export async function expectFooter(page: Page) {
  const footer = page.locator("footer");
  await expect(footer).toContainText("データ出典: J-Quants API（日本取引所グループ）／EDINET（金融庁）");
  await expect(footer).toContainText("本アプリは情報提供を目的とした個人用ツールであり、投資助言ではありません。");
}

/**
 * 一定時間、画面にテキストが一度も現れないことを確かめる（キャッシュからの復元や再読み込みが
 * 落ち着くまで観測する）。観測中に表示された URL の一覧を返す。
 */
export async function expectNeverShown(page: Page, text: string, durationMs = 2000, intervalMs = 100) {
  const seen: string[] = [];
  const deadline = Date.now() + durationMs;
  while (Date.now() < deadline) {
    try {
      const visible = await page.evaluate((t) => document.body?.innerText.includes(t) ?? false, text);
      if (visible) seen.push(page.url());
    } catch {
      // ナビゲーション中は評価できないことがある
    }
    await page.waitForTimeout(intervalMs);
  }
  expect(seen, `"${text}" が表示された URL`).toEqual([]);
}

/** ログインしてダッシュボードの表示を待つ。 */
export async function loginAsOwner(page: Page) {
  await login(page, OWNER.email, OWNER.password);
  await expect(page.getByRole("heading", { name: "ダッシュボード", level: 1 })).toBeVisible();
}

export async function logout(page: Page) {
  await page.getByRole("button", { name: "アカウントメニュー" }).click();
  await page.getByRole("menuitem", { name: "ログアウト" }).click();
  await expect(page).toHaveURL("/login");
}

/**
 * 未処理の例外（pageerror）とコンソールのエラーを集める。
 * 404 画面そのものの読み込み（ドキュメントの 404）は想定どおりなので除外する。
 */
export function collectPageProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (message.text().includes("the server responded with a status of 404")) return;
    problems.push(`console: ${message.text()}`);
  });
  return problems;
}

/** E2E で投入する検証用の銘柄コード（アプリ本体には含めない）。 */
export const E2E_STOCK_CODES = ["99901", "99902", "99903", "99904"] as const;

/** E2E で投入した市場データと実行履歴を削除する。 */
export async function cleanupDashboardData(runIds: number[] = []) {
  await sql("delete from public.stocks where code = any($1)", [E2E_STOCK_CODES]);
  await sql("delete from public.edinet_documents where doc_id like 'SDASH%'"); // 条件④の判定の投入（Sprint 10）
  if (runIds.length) await sql("delete from public.ingestion_runs where id = any($1)", [runIds]);
}

/** 実行履歴を1行投入して id を返す。日時は now() からの相対（例: '5 hours'）で指定する。 */
export async function insertRun(run: {
  target: string;
  trigger: string;
  status: string;
  startedAgo: string;
  finishedAgo: string | null;
  processedCount?: number;
  errorMessage?: string | null;
}): Promise<number> {
  const { rows } = await sql(
    `insert into public.ingestion_runs (target, trigger, status, started_at, finished_at, processed_count, error_message)
     values ($1, $2, $3, now() - $4::interval, case when $5::text is null then null else now() - $5::interval end, $6, $7)
     returning id`,
    [run.target, run.trigger, run.status, run.startedAgo, run.finishedAgo, run.processedCount ?? 0, run.errorMessage ?? null],
  );
  return Number(rows[0].id);
}

/** DB に保存された日時を、画面と同じ日本時間の YYYY-MM-DD HH:mm で求める。 */
export async function jstOfRun(id: number, column: "started_at" | "finished_at"): Promise<string> {
  const { rows } = await sql(
    `select to_char(${column} at time zone 'Asia/Tokyo', 'YYYY-MM-DD HH24:MI') as v from public.ingestion_runs where id = $1`,
    [id],
  );
  return rows[0].v;
}

/**
 * サーバーの時計がブラウザより遅れている状態を再現する（ブラウザの performance.timeOrigin を進める）。
 * dev で長く動かしたサーバーでは、Node の単調時計と壁時計がずれて同じ状態になる。React の開発用の
 * パフォーマンス計測は、サーバーのコンポーネントの時刻を「サーバーの timeOrigin − ブラウザの timeOrigin」で
 * 換算するため、この状態でエラーになったコンポーネントがあると Performance.measure が負の時刻で例外を出す
 * （Sprint 2 評価ラウンド1の B1）。起動直後のサーバーでも、この不具合を確実に検出できるようにする。
 */
export async function simulateServerClockBehind(context: BrowserContext, ms = 60_000) {
  await context.addInitScript((skew) => {
    const descriptor = Object.getOwnPropertyDescriptor(Performance.prototype, "timeOrigin");
    if (!descriptor?.get) return;
    const original = descriptor.get;
    Object.defineProperty(Performance.prototype, "timeOrigin", {
      configurable: true,
      get() {
        return original.call(this) + skew;
      },
    });
  }, ms);
}

/**
 * E2E の前提（Sprint 13）: 評価用ユーザー（pnpm seed:users）のプリセットが0件。
 * 既定のプリセットが残っていると、条件のパラメータの無い /screening はそのプリセットへリダイレクトされ、/stocks/<code> の判定も変わる。
 * 残っていれば、リダイレクトによる連鎖の失敗ではなく、前提の失敗として落とす。
 */
export async function expectNoPresets() {
  const { rows } = await sql(
    "select count(*)::int as n from public.screening_presets where user_id in (select id from auth.users where email like '%@quantis.local')",
  );
  expect(rows[0].n, "E2E の前提: 評価用ユーザーのプリセットが0件（e2e/fixtures/screening-presets-cleanup.sql で消せる）").toBe(0);
}
