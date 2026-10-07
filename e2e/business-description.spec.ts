import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { BASE_URL, collectPageProblems, expectNoPresets, expectNoSnapshotsOrWatchlist, loginAsOwner, OWNER, sql } from "./support";

/**
 * 事業の内容（F16、Sprint 16）。契約の第5章の投入例（business-description-example.sql）を使う。
 * 前提: 市場データ・EDINET の書類・実行履歴が0件の DB。EDINET のキーが未設定のサーバー。
 * 投入するコードは 9R001〜9R012、書類IDは S16TEST…、提出者は E99R…。各テストの後と、すべての後に削除する。
 */
test.describe.configure({ mode: "serial" });

const EXAMPLE_SQL = readFileSync(join(__dirname, "fixtures/business-description-example.sql"), "utf8");
const NEW_FY_SQL = readFileSync(join(__dirname, "fixtures/business-description-new-fy.sql"), "utf8");
const FILL_PENDING_SQL = readFileSync(join(__dirname, "fixtures/business-description-fill-pending.sql"), "utf8");
const CLEANUP_SQL = readFileSync(join(__dirname, "fixtures/business-description-cleanup.sql"), "utf8");

const LABEL = "有価証券報告書『事業の内容』の冒頭の段落（原文のまま）";
const AC_EXAMPLE = "当社グループは、当社及び連結子会社3社で構成されており、中小企業向けのクラウド会計ソフトの開発・販売を主な事業としております。";
const viewerUrl = (docId: string) => `https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx?${docId},,`;

const section = (page: Page) => page.getByTestId("business-description");
const text = (page: Page) => section(page).getByTestId("business-description-text");

async function paragraphOf(docId: string): Promise<string> {
  const { rows } = await sql("select paragraph from public.business_description_extractions where doc_id = $1", [docId]);
  return rows[0].paragraph;
}

/** 詳細を開き、本体（Suspense の中）が表示されるまで待つ */
async function openDetail(page: Page, code: string) {
  await page.goto(`/stocks/${code}`);
  await expect(section(page)).toBeVisible();
}

async function cleanup() {
  await sql(CLEANUP_SQL);
  await sql("delete from public.ingestion_runs");
  await sql("insert into private.allowed_emails (email) values ($1) on conflict do nothing", [OWNER.email]);
}

test.beforeAll(async () => {
  await expectNoPresets();
  await expectNoSnapshotsOrWatchlist();
  const { rows } = await sql(
    `select (select count(*) from public.stocks)::int as stocks, (select count(*) from public.ingestion_runs)::int as runs,
            (select count(*) from public.edinet_documents)::int as docs`,
  );
  expect(rows[0], "E2E の前提: 市場データ・EDINET の書類・実行履歴が0件").toEqual({ stocks: 0, runs: 0, docs: 0 });
});

test.beforeEach(async () => {
  await sql(EXAMPLE_SQL);
});

test.afterEach(cleanup);
test.afterAll(cleanup);

test.describe("位置と状態の表示（C1。AC16.1・AC16.5）", () => {
  test("どの状態でも「条件の判定」の直前に1つだけあり、間にほかのセクションが無い", async ({ page }) => {
    const problems = collectPageProblems(page);
    await loginAsOwner(page);
    for (const code of ["9R001", "9R005", "9R006", "9R007", "9R008", "9R009", "9R012"]) {
      await openDetail(page, code);
      await expect(section(page)).toHaveCount(1);
      await expect(section(page).getByRole("heading", { name: "事業の内容" })).toBeVisible();
      const layout = await page.evaluate(() => {
        const target = document.querySelector("[data-testid='business-description']")!;
        const next = target.nextElementSibling;
        const header = document.querySelector("[data-testid='stock-header']")!;
        const evaluation = document.querySelector("[data-testid='stock-evaluation']")!;
        // stock-header より後、stock-evaluation より前の section 要素
        const between = [...document.querySelectorAll("section")].filter(
          (s) =>
            header.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING &&
            s.compareDocumentPosition(evaluation) & Node.DOCUMENT_POSITION_FOLLOWING &&
            !s.contains(evaluation),
        );
        return {
          nextFirstChild: next?.firstElementChild?.getAttribute("data-testid") ?? null,
          between: between.map((s) => s.getAttribute("data-testid")),
        };
      });
      expect(layout, code).toEqual({ nextFirstChild: "stock-evaluation", between: ["business-description"] });
      // 1280×800 で、下端が「条件の判定」の上端より上
      const a = (await section(page).boundingBox())!;
      const b = (await page.getByTestId("stock-evaluation").boundingBox())!;
      expect(a.y + a.height, code).toBeLessThanOrEqual(b.y);
    }
    expect(problems).toEqual([]);
  });

  test("段落を表示できない状態の文言・書類ID・リンク。引用のラベル・段落の枠・社名・業種を出さない", async ({ page }) => {
    await loginAsOwner(page);
    const cases: [string, string, string, string | null, RegExp | null][] = [
      ["9R005", "no_annual_report", "有報が未取得のため、事業の内容を表示できません", null, null],
      ["9R006", "pending", "有価証券報告書（S16TEST51）の事業の内容は取り込み待ちです", "S16TEST51", null],
      ["9R007", "section_not_found", "有報に『事業の内容』の記載が見つかりませんでした", "S16TEST61", null],
      ["9R008", "invalid_values", "有報から事業の内容を読み取れませんでした", "S16TEST71", /本文の段落が見つかりません/],
      ["9R009", "no_xbrl", "有報から事業の内容を読み取れませんでした", "S16TEST81", /インライン XBRL/],
    ];
    for (const [code, status, message, docId, reason] of cases) {
      await openDetail(page, code);
      await expect(section(page)).toHaveAttribute("data-status", status);
      await expect(section(page).getByTestId("business-description-message")).toHaveText(message);
      if (reason) await expect(section(page).getByTestId("business-description-reason")).toHaveText(reason);
      const link = section(page).getByTestId("business-description-edinet-link");
      if (docId) {
        await expect(section(page)).toContainText(docId);
        await expect(link).toHaveAttribute("href", viewerUrl(docId));
        await expect(link).toHaveAttribute("target", "_blank");
        await expect(link).toHaveAttribute("rel", /noopener/);
      } else {
        await expect(link).toHaveCount(0);
      }
      await expect(section(page).getByTestId("business-description-label")).toHaveCount(0);
      await expect(section(page).getByTestId("business-description-text")).toHaveCount(0);
      // 引用の趣旨の文も出さない（評価 B1。AC16.5「どの場合も、引用のラベルは付けない」）
      await expect(section(page).getByTestId("business-description-quote-note")).toHaveCount(0);
      for (const phrase of ["引用", "原文のまま", "要約・言い換え"]) {
        await expect(section(page), `${code}: ${phrase}`).not.toContainText(phrase);
      }
      // 書類のある状態は、対象の事業年度も示す（評価 m4）
      if (docId) await expect(section(page).getByTestId("business-description-period")).toContainText("2025/03期");
      const content = await section(page).innerText();
      const { rows } = await sql("select company_name, sector33_name from public.stocks where code = $1", [code]);
      expect(content).not.toContain(rows[0].company_name);
      expect(content).not.toContain(rows[0].sector33_name);
    }
  });

  test("上場廃止の 9R012 でも同じ位置に段落が出る", async ({ page }) => {
    await loginAsOwner(page);
    await openDetail(page, "9R012");
    await expect(page.getByTestId("delisted-badge")).toBeVisible();
    await expect(section(page)).toHaveAttribute("data-status", "ok");
    await expect(text(page)).toHaveText("上場廃止の会社の段落です。");
  });
});

test.describe("内容・引用・出典（C2。AC16.2〜AC16.4・AC16.11）", () => {
  test("9R001: 段落が DB の値と完全に一致し、ラベルと出典（大株主の区画と同じ書類）が付く", async ({ page }) => {
    await loginAsOwner(page);
    await openDetail(page, "9R001");
    expect(await paragraphOf("S16TEST01")).toBe(AC_EXAMPLE);
    expect(await text(page).textContent()).toBe(AC_EXAMPLE);
    for (const absent of ["(1) 事業の概要", "旧年度の段落です。", "次のとおりであります"]) {
      await expect(section(page)).not.toContainText(absent);
    }
    await expect(section(page).getByTestId("business-description-label")).toHaveText(LABEL);
    await expect(section(page).getByTestId("business-description-quote-note")).toHaveText("有価証券報告書（EDINET）の記載から引用。要約・言い換えはしていません");
    const source = section(page).getByTestId("business-description-source");
    await expect(source).toHaveAttribute("data-doc-id", "S16TEST01");
    await expect(source).toContainText("S16TEST01");
    await expect(source).toContainText("提出日 2025-06-25");
    await expect(source).toContainText("2025/03期");
    const link = source.getByTestId("business-description-edinet-link");
    await expect(link).toHaveAttribute("href", viewerUrl("S16TEST01"));
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
    // 大株主の区画の出典と同じ書類ID
    await expect(page.getByTestId("major-shareholders").getByTestId("section-source")).toHaveAttribute("data-doc-id", "S16TEST01");
    await expect(section(page).getByTestId("business-description-fallback")).toHaveCount(0);
  });

  test("9R002: 長い段落も切らずに全文を折り返し、375px でも 1280px でも横スクロールが出ない", async ({ page }) => {
    await loginAsOwner(page);
    const expected = await paragraphOf("S16TEST11");
    expect([...expected].length).toBeGreaterThan(400);
    for (const size of [
      { width: 1280, height: 800 },
      { width: 375, height: 812 },
    ]) {
      await page.setViewportSize(size);
      await openDetail(page, "9R002");
      await expect(text(page)).toBeVisible();
      expect(await text(page).textContent()).toBe(expected);
      await expect(text(page)).toHaveText(/。$/);
      expect(await text(page).textContent()).not.toContain("…");
      const box = await text(page).evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
      expect(box.scroll).toBe(box.client);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${size.width}px`).toBeLessThanOrEqual(0);
    }
  });

  test("9R010: <b>・&amp;・<script> を文字のまま表示し、要素にもスクリプトの実行にもならない", async ({ page }) => {
    await loginAsOwner(page);
    const dialogs: string[] = [];
    page.on("dialog", async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.dismiss();
    });
    await openDetail(page, "9R010");
    const expected = await paragraphOf("S16TEST91");
    expect(expected).toContain("<script>alert(1)</script>");
    expect(await text(page).textContent()).toBe(expected);
    await expect(text(page).locator("b, script")).toHaveCount(0);
    await page.waitForTimeout(1000);
    expect(dialogs).toEqual([]);
  });
});

test.describe("訂正・取り下げ・新しい有報（C3。AC16.6・AC16.7）", () => {
  test("9R003: 訂正に区画が無ければ元の有報の段落と注記。9R004: 訂正に段落があれば訂正", async ({ page }) => {
    await loginAsOwner(page);
    await openDetail(page, "9R003");
    await expect(section(page)).toHaveAttribute("data-status", "ok");
    await expect(text(page)).toHaveText("元の有報の段落です。");
    await expect(section(page).getByTestId("business-description-source")).toHaveAttribute("data-doc-id", "S16TEST21");
    const note = section(page).getByTestId("business-description-fallback");
    await expect(note).toContainText("S16TEST22");
    await expect(note).toContainText("記載が無いため");
    await expect(note).toHaveText(
      "訂正有価証券報告書 S16TEST22（2025-08-05 提出）に『事業の内容』の記載が無いため、有価証券報告書 S16TEST21（2025-06-26 提出）の記載を表示しています",
    );

    await openDetail(page, "9R004");
    await expect(text(page)).toHaveText("訂正後の段落です。");
    await expect(section(page).getByTestId("business-description-source")).toHaveAttribute("data-doc-id", "S16TEST32");
    await expect(section(page).getByTestId("business-description-fallback")).toHaveCount(0);
  });

  test("9R011: 訂正を取り下げると元の有報、元の有報も取り下げると「有報が未取得」", async ({ page }) => {
    await loginAsOwner(page);
    await openDetail(page, "9R011");
    await expect(text(page)).toHaveText("取り下げられる訂正の段落です。");
    await sql("update public.edinet_documents set withdrawn = true where doc_id = 'S16TESTA2'");
    await page.reload();
    await expect(text(page)).toHaveText("取り下げ前の元の段落です。");
    await expect(section(page).getByTestId("business-description-source")).toHaveAttribute("data-doc-id", "S16TESTA1");
    await expect(section(page).getByTestId("business-description-fallback")).toHaveCount(0);
    await sql("update public.edinet_documents set withdrawn = true where doc_id = 'S16TESTA1'");
    await page.reload();
    await expect(section(page)).toHaveAttribute("data-status", "no_annual_report");
  });

  test("9R001: 新しい事業年度の有報が処理されると段落と書類IDが変わる。その事業の内容が未処理なら取り込み待ち", async ({ page }) => {
    await loginAsOwner(page);
    await openDetail(page, "9R001");
    await expect(text(page)).toHaveText(AC_EXAMPLE);
    await sql(NEW_FY_SQL);
    await page.reload();
    await expect(text(page)).toHaveText("新しい事業年度の段落です。");
    const source = section(page).getByTestId("business-description-source");
    await expect(source).toHaveAttribute("data-doc-id", "S16TEST02");
    await expect(source).toContainText("2026/03期");
    await sql("delete from public.business_description_extractions where doc_id = 'S16TEST02'");
    await page.reload();
    await expect(section(page)).toHaveAttribute("data-status", "pending");
    await expect(section(page)).toContainText("S16TEST02");
    await expect(section(page)).not.toContainText(AC_EXAMPLE);
  });
});

test.describe("API とアクセス制御（C4。AC16.10）", () => {
  test("段落・出典・状態が画面と同じで、未ログインでは返らない", async ({ page, request }) => {
    const unauth = await request.get("/api/stocks/9R001");
    expect(unauth.status()).toBe(401);
    expect(await unauth.text()).not.toContain("クラウド会計");

    await loginAsOwner(page);
    const get = async (code: string) => {
      const res = await page.request.get(`/api/stocks/${code}`);
      expect(res.status()).toBe(200);
      return (await res.json()).data.businessDescription;
    };
    expect(await get("9R001")).toEqual({
      status: "ok",
      detail: null,
      reason: null,
      paragraph: AC_EXAMPLE,
      document: {
        doc_id: "S16TEST01",
        doc_type_code: "120",
        doc_type_label: "有価証券報告書",
        submitted_at: "2025-06-25T15:00:00+09:00",
        period_start: "2024-04-01",
        period_end: "2025-03-31",
        edinet_url: viewerUrl("S16TEST01"),
      },
      fallback: null,
    });
    expect((await get("9R003")).fallback).toMatchObject({ skipped_doc_id: "S16TEST22", skipped_status: "section_not_found" });
    const expectations: [string, string, string | null][] = [
      ["9R005", "no_annual_report", null],
      ["9R006", "pending", null],
      ["9R007", "section_not_found", null],
      ["9R008", "invalid_values", "『事業の内容』の区画に本文の段落が見つかりません（見出し・表・図だけでした）"],
      ["9R009", "no_xbrl", "書類にインライン XBRL（機械で読めるデータ）が含まれていません"],
    ];
    for (const [code, status, reason] of expectations) {
      const body = await get(code);
      expect(body.status, code).toBe(status);
      expect(body.paragraph, code).toBeNull();
      expect(body.reason, code).toBe(reason);
      if (code === "9R005") expect(body.document).toBeNull();
      else expect(body.document.doc_id).toMatch(/^S16TEST/);
    }
    expect((await get("9R010")).paragraph).toBe(await paragraphOf("S16TEST91"));
  });

  test("キーなしの EDINET の取り込みは今までどおり失敗で記録され、詳細の表示は変わらない", async ({ page }) => {
    await loginAsOwner(page);
    const res = await page.request.post("/api/ingestion/runs", { headers: { origin: BASE_URL }, data: { target: "edinet_reports" } });
    expect(res.status()).toBe(202);
    await expect.poll(async () => (await sql("select status from public.ingestion_runs")).rows[0]?.status).toBe("failed");
    expect((await sql("select error_message from public.ingestion_runs")).rows[0].error_message).toBe("EDINET の API キーが設定されていません");
    await openDetail(page, "9R001");
    await expect(text(page)).toHaveText(AC_EXAMPLE);
    await openDetail(page, "9R006");
    await expect(section(page)).toHaveAttribute("data-status", "pending");
  });
});

test.describe("取り込み状況（C5。AC16.9）", () => {
  const count = (page: Page) => page.getByTestId("annual-reports-panel").getByTestId("business-description-count");
  const pending = (page: Page) => page.getByTestId("annual-reports-panel").getByTestId("business-description-pending-count");

  test("「上場中の 11 銘柄のうち 6 銘柄」・取り込み待ち 1 件。1銘柄分を投入すると 7 銘柄・0 件。上場廃止は数えない", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/imports");
    await expect(count(page)).toContainText("上場中の 11 銘柄のうち 6 銘柄");
    await expect(pending(page)).toHaveText("事業の内容の取り込み待ちの有報 1 件");
    await expect(count(page)).toContainText("記載なし 1 銘柄・読み取れなかった 2 銘柄");

    await sql(FILL_PENDING_SQL);
    await page.reload();
    await expect(count(page)).toContainText("上場中の 11 銘柄のうち 7 銘柄");
    await expect(pending(page)).toHaveText("事業の内容の取り込み待ちの有報 0 件");

    // C5-4: 上場廃止の銘柄の書類は待ちに数えない
    await sql("delete from public.business_description_extractions where doc_id = 'S16TESTB1'");
    await page.reload();
    await expect(count(page)).toContainText("上場中の 11 銘柄のうち 7 銘柄");
    await expect(pending(page)).toHaveText("事業の内容の取り込み待ちの有報 0 件");
    await sql("update public.stocks set delisted_on = null where code = '9R012'");
    await page.reload();
    await expect(count(page)).toContainText("上場中の 12 銘柄のうち 7 銘柄");
    await expect(pending(page)).toHaveText("事業の内容の取り込み待ちの有報 1 件");
  });

  test("C5-3: 上場廃止を外すと、ok の 9R012 も数える（12 銘柄のうち 8 銘柄）", async ({ page }) => {
    await sql(FILL_PENDING_SQL);
    await sql("update public.stocks set delisted_on = null where code = '9R012'");
    await loginAsOwner(page);
    await page.goto("/imports");
    await expect(count(page)).toContainText("上場中の 12 銘柄のうち 8 銘柄");
  });

  test("既存のタイルの値は annual_reports_summary の既存のキーと一致する（数え方は変えない）", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/imports");
    const { rows } = await sql("select public.annual_reports_summary() as s");
    const s = rows[0].s;
    const panel = page.getByTestId("annual-reports-panel");
    await expect(panel.getByTestId("annual-report-stock-count")).toContainText(`${s.fetchedStockCount} / ${s.stockCount}`);
    await expect(panel.getByTestId("annual-report-pending-count")).toContainText(`${s.pendingDocumentCount}`);
    // 大株主・役員の取り込み待ちは、上場中の銘柄の大株主・役員が未処理の有報（事業の内容の待ちとは別に数える）
    const { rows: annualPending } = await sql(
      `select count(*)::int as n from (
         select shareholders_doc_id from public.annual_report_sections a join public.stocks st on st.code = a.code
          where st.delisted_on is null and shareholders_status = 'pending'
         union
         select officers_doc_id from public.annual_report_sections a join public.stocks st on st.code = a.code
          where st.delisted_on is null and officers_status = 'pending') x`,
    );
    expect(s.pendingDocumentCount).toBe(annualPending[0].n);
  });
});
