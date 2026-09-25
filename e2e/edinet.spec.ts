import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { BASE_URL, collectPageProblems, CRON_SECRET, loginAsOwner, OWNER, simulateServerClockBehind, sql } from "./support";

/**
 * 有報（EDINET）の取り込み・大株主と役員の表示（F8、Sprint 8）。契約の第5章の投入例（annual-report-example.sql）を使う。
 * 前提: 市場データ・EDINET の書類・実行履歴が0件の DB。EDINET のキーが未設定のサーバー（設定済みならキー未設定前提のテストはスキップ）。
 * 投入するコードは 9W001〜9W008、書類IDは S8TEST…。各テストの後に削除する。
 */
test.describe.configure({ mode: "serial" });

const EXAMPLE_SQL = readFileSync(join(__dirname, "fixtures/annual-report-example.sql"), "utf8");
const CLEANUP_SQL = readFileSync(join(__dirname, "fixtures/annual-report-cleanup.sql"), "utf8");
const EDINET_KEY_MISSING = "EDINET の API キーが設定されていません";
const JQUANTS_KEY_MISSING = "J-Quants の API キーが設定されていません";

const manualButton = (page: Page) => page.getByRole("button", { name: /今すぐ取り込み|実行中/ });
const section = (page: Page) => page.getByTestId("annual-report");

async function sourcesConfigured(page: Page) {
  const res = await page.request.get("/api/ingestion");
  const body = await res.json();
  const configured = (id: string) => body.data.sources.find((s: { id: string }) => s.id === id)?.configured === true;
  return { jquants: configured("jquants"), edinet: configured("edinet") };
}

test.beforeAll(async () => {
  const { rows } = await sql(
    `select (select count(*) from public.stocks)::int as stocks, (select count(*) from public.ingestion_runs)::int as runs,
            (select count(*) from public.edinet_documents)::int as docs`,
  );
  expect(rows[0], "E2E の前提: 市場データ・EDINET の書類・実行履歴が0件").toEqual({ stocks: 0, runs: 0, docs: 0 });
});

test.afterEach(async () => {
  await sql(CLEANUP_SQL);
  await sql("delete from public.stocks where code like '9W%'");
  await sql("delete from public.ingestion_runs");
  await sql("insert into private.allowed_emails (email) values ($1) on conflict do nothing", [OWNER.email]);
});

test.describe("キーが未設定のとき（C1、AC8.1）", () => {
  test("J-Quants の失敗を残したまま「有報（EDINET）」を実行すると、失敗が1行増え、J-Quants 側の行と市場データは変わらない", async ({ page }) => {
    const problems = collectPageProblems(page);
    await sql(EXAMPLE_SQL);
    await loginAsOwner(page);
    const configured = await sourcesConfigured(page);
    test.skip(configured.jquants || configured.edinet, "サーバーの J-Quants または EDINET のキーが設定済み");
    await page.goto("/imports");
    await expect(page.getByTestId("source-edinet")).toContainText("未設定");

    // J-Quants（銘柄マスタ）の失敗を先に作る
    await manualButton(page).click();
    await expect(page.getByTestId("ingestion-result")).toHaveText(`失敗: ${JQUANTS_KEY_MISSING}`);
    const before = (await sql("select id, target, status, processed_count, error_message, started_at::text, finished_at::text from public.ingestion_runs")).rows;
    const marketBefore = (
      await sql(
        `select (select count(*) from public.stocks)::int as stocks, (select count(*) from public.financial_statements)::int as statements,
                (select count(*) from public.financial_metrics)::int as metrics, (select count(*) from public.edinet_documents)::int as docs`,
      )
    ).rows[0];

    // 有報（EDINET）
    await page.getByRole("radio", { name: /^EDINET（有報・届出書）/ }).check();
    await manualButton(page).click();
    await expect(page.getByTestId("ingestion-result")).toHaveText(`失敗: ${EDINET_KEY_MISSING}`);
    const { rows } = await sql("select id, target, trigger, status, processed_count, error_message from public.ingestion_runs order by id");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ target: "edinet_reports", trigger: "manual", status: "failed", processed_count: 0, error_message: EDINET_KEY_MISSING });
    // J-Quants の行は変わらない
    expect((await sql("select id, target, status, processed_count, error_message, started_at::text, finished_at::text from public.ingestion_runs where id = $1", [before[0].id])).rows).toEqual(before);
    const marketAfter = (
      await sql(
        `select (select count(*) from public.stocks)::int as stocks, (select count(*) from public.financial_statements)::int as statements,
                (select count(*) from public.financial_metrics)::int as metrics, (select count(*) from public.edinet_documents)::int as docs`,
      )
    ).rows[0];
    expect(marketAfter).toEqual(marketBefore);

    // リロードしても残る。成功・0件成功の行は無い
    await page.reload();
    const first = page.getByTestId("run-table").locator("tbody tr").first();
    await expect(first).toContainText("EDINET");
    await expect(first).toContainText("失敗");
    await expect(first).toContainText(EDINET_KEY_MISSING);
    expect((await sql("select count(*)::int as n from public.ingestion_runs where status <> 'failed'")).rows[0].n).toBe(0);
    expect(problems).toEqual([]);
  });

  test("GET /api/cron/edinet: 正しいシークレットで失敗が1行（定期実行）。シークレットなし・違う値は 401 で増えない。HEAD は 405。実行中なら 409", async ({ page, request }) => {
    await loginAsOwner(page);
    const configured = await sourcesConfigured(page);
    const res = await request.get("/api/cron/edinet", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    test.skip(res.status() === 401, "サーバーの CRON_SECRET が E2E_CRON_SECRET と異なる");
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toContain("no-store");
    const body = await res.json();
    expect(body.data.runs).toEqual([expect.objectContaining({ target: "edinet_reports", status: "failed", processedCount: 0 })]);
    const { rows } = await sql("select target, trigger, status, error_message from public.ingestion_runs");
    expect(rows).toHaveLength(1);
    if (!configured.edinet) expect(rows[0]).toEqual({ target: "edinet_reports", trigger: "cron", status: "failed", error_message: EDINET_KEY_MISSING });

    for (const headers of [{}, { authorization: "Bearer wrong" }, { authorization: CRON_SECRET }] as Record<string, string>[]) {
      expect((await request.get("/api/cron/edinet", { headers })).status(), JSON.stringify(headers)).toBe(401);
    }
    expect((await request.post("/api/cron/edinet", { headers: { authorization: `Bearer ${CRON_SECRET}` } })).status()).toBe(405);
    const head = await request.head("/api/cron/edinet", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(head.status()).toBe(405);
    expect(head.headers()["allow"]).toBe("GET");
    expect((await sql("select count(*)::int as n from public.ingestion_runs")).rows[0].n).toBe(1);

    await sql("insert into public.ingestion_runs (target, trigger, status) values ('financials', 'manual', 'running')");
    expect((await request.get("/api/cron/edinet", { headers: { authorization: `Bearer ${CRON_SECRET}` } })).status()).toBe(409);
  });

  test("POST /api/ingestion/runs の target edinet_reports は 202（キーなしでも記録され、失敗で終わる）。実行中はボタンが「実行中…」", async ({ page }) => {
    await loginAsOwner(page);
    const res = await page.request.post("/api/ingestion/runs", { headers: { origin: BASE_URL }, data: { target: "edinet_reports" } });
    expect(res.status()).toBe(202);
    await expect.poll(async () => (await sql("select status from public.ingestion_runs")).rows[0]?.status).not.toBe("running");

    await sql("insert into public.ingestion_runs (target, trigger, status) values ('edinet_reports', 'cron', 'running')");
    await page.goto("/imports");
    await expect(page.getByTestId("active-run")).toContainText("実行中: EDINET");
    await expect(manualButton(page)).toHaveText(/実行中/);
    await expect(page.getByRole("radio", { name: /^EDINET（有報・届出書）/ })).toBeDisabled();
  });
});

test.describe("取り込み状況の画面（C2）", () => {
  test("投入例で「有報を取得できた銘柄 6 / 8」、抽出できた 5、抽出できなかった 1、取り込み待ち 1。値は DB の集計と一致", async ({ page }) => {
    await sql(EXAMPLE_SQL);
    await loginAsOwner(page);
    await page.goto("/imports");
    const panel = page.getByTestId("annual-reports-panel");
    await expect(panel.getByRole("heading", { name: "有価証券報告書（大株主・役員）" })).toBeVisible();
    await expect(panel.getByTestId("annual-report-stock-count")).toContainText("6 / 8");
    await expect(panel.getByTestId("annual-report-extracted-count")).toContainText("5");
    await expect(panel.getByTestId("annual-report-not-extracted-count")).toContainText("1");
    await expect(panel.getByTestId("annual-report-pending-count")).toContainText("1");
    await expect(panel.getByTestId("annual-report-pending-count")).toContainText("EDINET の取り込み実績がありません");
    const { rows } = await sql("select public.annual_reports_summary() as s");
    expect(rows[0].s).toMatchObject({ stockCount: 8, fetchedStockCount: 6, bothExtractedCount: 5, notExtractedCount: 1, pendingDocumentCount: 1 });
  });

  test("データが0件なら「まだ有報が取り込まれていません」とキーの注記", async ({ page }) => {
    await loginAsOwner(page);
    const configured = await sourcesConfigured(page);
    await page.goto("/imports");
    const panel = page.getByTestId("annual-reports-panel");
    await expect(panel.getByTestId("annual-reports-empty")).toContainText("まだ有報が取り込まれていません");
    if (!configured.edinet) await expect(panel.getByTestId("annual-reports-key-missing")).toContainText(EDINET_KEY_MISSING);
  });

  test("有報の実行の details があれば、結果の要約と直前の処理件数が出る", async ({ page }) => {
    await sql(
      `insert into public.ingestion_runs (target, trigger, status, started_at, finished_at, processed_count, details)
       values ('edinet_reports', 'manual', 'succeeded', now() - interval '2 minutes', now() - interval '1 minute', 12,
               '{"windowStart":"2025-06-22","windowEnd":"2026-09-15","listDatesInWindow":451,"listDatesRemaining":0,"listDatesFetched":7,"documentsProcessed":12,"documentsBothExtracted":11,"documentsNotExtracted":1}'::jsonb)`,
    );
    await loginAsOwner(page);
    await page.goto("/imports");
    const panel = page.getByTestId("annual-reports-panel");
    await expect(panel.getByTestId("annual-report-pending-count")).toContainText("直前の取り込みでは 12 件を処理");
    await expect(panel.getByTestId("annual-report-list-dates")).toContainText("451 / 451");
    await expect(page.getByTestId("run-table").locator("tbody tr").first()).toContainText("EDINET");
  });
});

test.describe("詳細画面の大株主・役員（C3〜C5）", () => {
  test.beforeEach(async () => {
    await sql(EXAMPLE_SQL);
  });

  test("9W001: 出典の書類、EDINET へのリンク、大株主5行、役員3行（兼務の改行）、総会後の表の注記。古い事業年度の書類は出ない（C3-1〜C3-4）", async ({ page }) => {
    const problems = collectPageProblems(page);
    await loginAsOwner(page);
    await page.goto("/stocks/9W001");
    const source = section(page).getByTestId("annual-report-source");
    await expect(source).toContainText("有価証券報告書");
    await expect(source).toContainText("S8TEST02");
    await expect(source).toContainText("提出日 2025-06-25");
    await expect(source).toContainText("2025/03期（2024-04-01〜2025-03-31）");
    const link = source.getByTestId("edinet-link").first();
    await expect(link).toHaveAttribute("href", "https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx?S8TEST02,,");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
    await expect(section(page).getByTestId("annual-report-siblings")).toHaveCount(0);

    const holders = section(page).getByTestId("shareholders-table").locator("tbody tr");
    await expect(holders).toHaveCount(5);
    const holder = (rank: number) => section(page).locator(`[data-testid=shareholders-table] tr[data-rank="${rank}"]`);
    await expect(holder(1).getByTestId("holder-name")).toContainText("山田　太郎");
    await expect(holder(1).getByTestId("holder-shares")).toHaveText("3,210,000");
    await expect(holder(1).getByTestId("holder-ratio")).toHaveText("32.10%");
    await expect(holder(2).getByTestId("holder-name")).toContainText("株式会社ヤマダホールディングス");
    await expect(holder(3).getByTestId("holder-name")).toContainText("日本マスタートラスト信託銀行株式会社（信託口）");
    await expect(holder(3).getByTestId("holder-ratio")).toHaveText("9.00%");
    await expect(holder(4).getByTestId("holder-name")).toContainText("THE BANK OF NEW YORK MELLON 140044");
    await expect(holder(5).getByTestId("holder-shares")).toHaveText("57,050");
    await expect(holder(5).getByTestId("holder-ratio")).toHaveText("0.57%");

    const officers = section(page).getByTestId("officers-table").locator("tbody tr");
    await expect(officers).toHaveCount(3);
    await expect(officers.nth(0).getByTestId("officer-name")).toHaveText("山田　太郎");
    // 役職名の改行が表示で保たれる（2行に見える）
    const title = officers.nth(0).getByTestId("officer-title");
    await expect(title).toHaveText("代表取締役社長\n社長執行役員");
    expect(await title.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe("pre-line");
    const box = await title.boundingBox();
    expect(box!.height).toBeGreaterThan(30);
    await expect(officers.nth(1).getByTestId("officer-title")).toHaveText("取締役\n（管理本部長兼経理部長）");
    await expect(officers.nth(2).getByTestId("officer-name")).toHaveText("鈴木　花子");
    await expect(section(page).getByTestId("post-agm-note")).toContainText("定時株主総会後の役員の予定も記載されています");

    await expect(section(page)).not.toContainText("旧年度 太郎");
    expect(problems).toEqual([]);
  });

  test("9W006（銀行業）も同じ規則。比率は記載の桁（3桁）のまま（C3-2・C3-5）", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/stocks/9W006");
    const ratios = section(page).getByTestId("holder-ratio");
    await expect(ratios).toHaveText(["12.345%", "5.100%"]);
    await expect(section(page).getByTestId("officer-title")).toHaveText("取締役頭取（代表取締役）");
  });

  test("API: annualReport は第4章の形で、数値は十進の文字列。9W004 は null（C3-6）", async ({ page, request }) => {
    await loginAsOwner(page);
    const res = await page.request.get("/api/stocks/9W001");
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toContain("no-store");
    const { data } = await res.json();
    expect(data.annualReport.document).toEqual({
      doc_id: "S8TEST02",
      doc_type_code: "120",
      doc_type_label: "有価証券報告書",
      submitted_at: "2025-06-25T15:00:00+09:00",
      period_start: "2024-04-01",
      period_end: "2025-03-31",
      edinet_url: "https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx?S8TEST02,,",
      status: "processed",
    });
    expect(data.annualReport.shareholders.rows[0]).toEqual({
      rank: 1,
      name: "山田　太郎",
      address: "東京都港区",
      shares_held: "3210000",
      ratio_pct: "32.10",
      ratio_decimals: 2,
      ratio_display: "32.10%",
    });
    expect(data.annualReport.shareholders.rows[4]).toMatchObject({ ratio_pct: "0.57", ratio_display: "0.57%" });
    expect(data.annualReport.officers).toMatchObject({ status: "ok", basis: "filing_date", has_post_agm_table: true, fallback: false });
    expect(data.annualReport.officers.rows[0]).toEqual({ seq: 1, name: "山田　太郎", title: "代表取締役社長\n社長執行役員" });
    expect((await (await page.request.get("/api/stocks/9W004")).json()).data.annualReport).toBeNull();

    // 未ログインは 401、許可の取り消し後は 403（有報のデータを含まない）
    const unauth = await request.get("/api/stocks/9W001");
    expect(unauth.status()).toBe(401);
    expect(await unauth.text()).not.toContain("S8TEST02");
    await sql("delete from private.allowed_emails where email = $1", [OWNER.email]);
    const revoked = await page.request.get("/api/stocks/9W001");
    expect(revoked.status()).toBe(403);
    expect(await revoked.text()).not.toContain("S8TEST02");
  });

  test("9W002: 訂正有報（最新の提出分）を使い、同じ事業年度の元の有報を示す。取り下げると元の有報に戻り、取り下げのラベル（C4-1〜C4-4）", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/stocks/9W002");
    const source = section(page).getByTestId("annual-report-source");
    await expect(source.getByTestId("doc-type")).toHaveText("訂正有価証券報告書");
    await expect(source).toContainText("S8TEST12");
    await expect(source).toContainText("提出日 2025-07-10");
    await expect(source).toContainText("2025/03期（2024-04-01〜2025-03-31）");
    const siblings = section(page).getByTestId("annual-report-siblings");
    await expect(siblings).toContainText("同じ事業年度の書類が2件あります（訂正を含む）。最新の提出分を使っています");
    const sibling = siblings.getByTestId("sibling");
    await expect(sibling).toHaveCount(1);
    await expect(sibling).toContainText("有価証券報告書");
    await expect(sibling).toContainText("S8TEST11");
    await expect(sibling).toContainText("2025-06-26");
    await expect(sibling.getByTestId("edinet-link")).toHaveAttribute("href", "https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx?S8TEST11,,");
    await expect(section(page).getByTestId("holder-name").first()).toContainText("髙橋　一郎");
    await expect(section(page).getByTestId("holder-ratio").first()).toHaveText("25.00%");
    await expect(section(page).getByTestId("officer-title")).toHaveText("代表取締役会長 兼 CEO");
    await expect(section(page).getByTestId("section-fallback")).toHaveCount(0);
    await expect(section(page)).not.toContainText("訂正前 太郎");
    await expect(section(page).getByTestId("section-source").first()).toHaveAttribute("data-doc-id", "S8TEST12");

    await sql("update public.edinet_documents set withdrawn = true where doc_id = 'S8TEST12'");
    await page.reload();
    await expect(section(page).getByTestId("annual-report-source")).toContainText("S8TEST11");
    await expect(section(page).getByTestId("holder-name").first()).toContainText("訂正前 太郎");
    await expect(section(page).getByTestId("sibling")).toContainText("S8TEST12");
    await expect(section(page).getByTestId("sibling-withdrawn")).toHaveText("取り下げ（使っていません）");
    await expect(section(page).getByTestId("annual-report-siblings")).not.toContainText("2件あります");
  });

  test("9W007: 訂正に大株主の記載が無い → 大株主は元の有報（注記つき）、役員は訂正。9W008: 事業年度を決められない訂正は使わない（C4-5・C4-6）", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/stocks/9W007");
    await expect(section(page).getByTestId("annual-report-source")).toContainText("S8TEST62");
    const holders = section(page).getByTestId("major-shareholders");
    await expect(holders.getByTestId("section-source")).toHaveAttribute("data-doc-id", "S8TEST61");
    await expect(holders.getByTestId("section-source")).toHaveAttribute("data-fallback", "true");
    await expect(holders.getByTestId("section-fallback")).toHaveText(
      "訂正有価証券報告書 S8TEST62（2025-08-05 提出）には『大株主の状況』の記載が無いため、有価証券報告書 S8TEST61（2025-06-26 提出）の記載を表示しています",
    );
    await expect(holders.getByTestId("holder-name")).toContainText(["部分訂正 花子"]);
    await expect(holders.getByTestId("holder-ratio")).toHaveText(["40.00%"]);
    const officers = section(page).getByTestId("officers");
    await expect(officers.getByTestId("section-source")).toHaveAttribute("data-fallback", "false");
    await expect(officers.getByTestId("officer-name")).toHaveText(["部分訂正 花子", "新任 五郎"]);
    await expect(section(page)).not.toContainText("訂正前 役員");
    const api = (await (await page.request.get("/api/stocks/9W007")).json()).data.annualReport;
    expect(api.shareholders).toMatchObject({ source_doc_id: "S8TEST61", fallback: true });
    expect(api.officers).toMatchObject({ source_doc_id: "S8TEST62", fallback: false });

    await page.goto("/stocks/9W008");
    await expect(section(page).getByTestId("annual-report-source")).toContainText("S8TEST72");
    await expect(section(page).getByTestId("annual-report-source")).toContainText("提出日 2025-06-20");
    await expect(section(page).getByTestId("holder-name")).toContainText(["当期 四郎"]);
    await expect(section(page)).not.toContainText("期不明 次郎");
    await expect(section(page)).not.toContainText("S8TEST71");
  });

  test("抽出できなかった・未取得・取り込み待ち（C5-1〜C5-5）", async ({ page }) => {
    await sql("insert into public.stocks (code, company_name, product_category) values ('99991', '検証用有報なし株式会社', '011')");
    try {
      await loginAsOwner(page);
      await page.goto("/stocks/9W003");
      await expect(section(page).getByTestId("annual-report-failed")).toHaveText("有報から大株主／役員情報を抽出できませんでした");
      const holders = section(page).getByTestId("major-shareholders");
      await expect(holders).toHaveAttribute("data-status", "invalid_values");
      await expect(holders.getByTestId("section-failure")).toContainText("有報から大株主情報を抽出できませんでした");
      await expect(holders.getByTestId("section-failure")).toContainText("『大株主の状況』の記載を読み取れませんでした（持株比率が数値でない行があります）");
      const officers = section(page).getByTestId("officers");
      await expect(officers).toHaveAttribute("data-status", "section_not_found");
      await expect(officers.getByTestId("section-failure")).toContainText("有報から役員情報を抽出できませんでした");
      await expect(officers.getByTestId("section-failure")).toContainText("書類から『役員の状況』の項目を見つけられませんでした");
      await expect(section(page).locator("table")).toHaveCount(0);

      await page.goto("/stocks/9W004");
      await expect(section(page)).toHaveAttribute("data-state", "not_fetched");
      await expect(section(page)).toContainText("有価証券報告書が未取得です");
      await expect(section(page).getByRole("link", { name: "取り込み状況を見る" })).toHaveAttribute("href", "/imports");
      await expect(section(page)).not.toContainText("抽出できませんでした");

      await page.goto("/stocks/9W005");
      await expect(section(page)).toHaveAttribute("data-state", "pending");
      await expect(section(page)).toContainText("有価証券報告書（S8TEST41、2025-09-24 提出）は取り込み待ちです");

      await sql("update public.annual_report_extractions set officers_status = 'no_xbrl' where doc_id = 'S8TEST51'");
      await page.goto("/stocks/9W006");
      await expect(section(page).getByTestId("shareholders-table")).toBeVisible();
      await expect(section(page).getByTestId("officers").getByTestId("section-failure")).toContainText("書類に XBRL（機械で読めるデータ）が含まれていません");
      await expect(section(page).getByTestId("annual-report-failed")).toHaveCount(0);

      // 有報の無い既存の銘柄も、区画に「未取得」が出て、ほかの区画は変わらない
      await page.goto("/stocks/99991");
      await expect(section(page)).toContainText("有価証券報告書が未取得です");
      await expect(page.getByTestId("stock-evaluation")).toBeVisible();
      await expect(page.getByTestId("stock-financials")).toBeVisible();
    } finally {
      await sql("delete from public.stocks where code = '99991'");
    }
  });

  test("375px でページ全体の横スクロールが無く、表は枠の中だけで横スクロールする（C8-2）", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 800 } });
    const page = await context.newPage();
    await loginAsOwner(page);
    await page.goto("/stocks/9W001");
    await expect(section(page).getByTestId("shareholders-table")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    const scroller = section(page).getByTestId("shareholders-table").locator("xpath=..");
    expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth && getComputedStyle(el).overflowX === "auto")).toBe(true);
    await context.close();
  });

  test("dev の時計のずれの状態でも、詳細（取得済み・抽出失敗・未取得・見つからない）でコンソールのエラーが出ない（C8-4）", async ({ page, context }) => {
    await simulateServerClockBehind(context);
    const problems = collectPageProblems(page);
    await loginAsOwner(page);
    for (const code of ["9W001", "9W003", "9W004", "9W007"]) {
      await page.goto(`/stocks/${code}`);
      await expect(section(page)).toBeVisible();
    }
    await page.goto("/stocks/99989");
    await expect(page.getByRole("heading", { level: 1, name: "銘柄が見つかりません" })).toBeVisible();
    expect(problems).toEqual([]);
  });

  test("詳細・取り込み状況の画面を開いても実行履歴は増えない（外部 API を呼ばない。C8-5）", async ({ page }) => {
    await loginAsOwner(page);
    for (const path of ["/stocks/9W001", "/stocks/9W002", "/imports", "/stocks/9W005"]) {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
    }
    expect((await sql("select count(*)::int as n from public.ingestion_runs")).rows[0].n).toBe(0);
  });
});
