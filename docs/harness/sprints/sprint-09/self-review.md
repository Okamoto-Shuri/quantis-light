# Sprint 09 自己評価（ラウンド 1）

## 実装内容

- **抽出**: `src/lib/ingestion/edinet/business-results.ts`（新規）。有報・届出書の「主要な経営指標等の推移」から、期ごとの売上高・営業利益を読む。
  - 読むコンテキスト: ID が `CurrentYearDuration`／`Prior{N}YearDuration` で始まる duration で、軸が無い（連結）か `NonConsolidatedMember`（単体）だけのもの。
  - 期の開始日・終了日は、コンテキストの startDate・endDate から取る（S1）。
  - 金額は十進の文字列のまま円にする。
  - 結果の区分は ok／no_xbrl／section_not_found／invalid_values。
- **取り込み**: `edinet-reports.ts` の骨組みを変えた。
  - 対象の書類に、未処理の処理（`needsAnnualReport`・`needsBusinessResults`）を付けた。1回の ZIP で両方を処理し、`save_edinet_extractions` で1トランザクションに保存する。処理件数は書類ごとに1。
  - `details` に次のキーを足した。Sprint 8 のキーの意味は変えていない。
    - `businessResults`・`businessResultsPeriods`・`businessResultsDiscardedFacts`
    - `documentsTargetedByKind`・`filersUpdated`
  - `documents-list.ts`: 一覧のすべての行から、提出者と証券コードの対応（`filers`）を作る。
- **DB**: `supabase/migrations/20261002000000_edinet_business_results.sql`
  - テーブル: `edinet_filers`・`business_results_extractions`・`business_results_periods`。
  - ビュー: `edinet_document_codes`（結び付け。2つの枝の union all）、`business_results_targets`（読む書類）、`financial_periods`（EDINET の期を加えて作り直した。列は末尾に追加）。
  - 関数:
    - `financial_metrics_from_periods`: 混在の旗を2つに分けた。
    - `recalculate_financial_metrics`: 補完の情報も保存する。
    - トリガーの関数5つ。
    - `prepare_edinet_filers_backfill`: 導入時に1回呼ぶ。
    - `save_edinet_document_list`: 引数 `p_filers` を追加。
    - `save_edinet_extractions`: `save_annual_report_extraction` を置き換えた。
    - `edinet_ingestion_state`、`business_results_summary`。
    - `screen_stocks`: 行の出力を追加。
  - `financial_metrics` の列を追加した（`revenue_cagr_mixed_consolidation`・`_standard`・`_supplemented`・`_period_sources`・`latest_period_source`）。
- **画面**
  - 詳細の5期の表:
    - 出典の列と書類の列を `components/financials/period-source.tsx` に置いた（取り込み状況の財務のカードと共有）。
    - EDINET の期の NULL は「記載なし」、売上高の名前が「売上高」以外ならその名前を出す。
    - グラフのツールチップに出典を出す。
    - 見出しを「通期実績（決算短信。無い期は EDINET の…）」に変えた。
  - CAGR のカード: 補った期と混在の注記（連結・単体／会計基準）。営業利益率のカード: EDINET の出典と「記載なし」の説明。
  - スクリーニングの「補完」の印: `components/screening/supplement-mark.tsx`。ホバー・クリック・Enter で開き、行のクリックには伝えない。
  - 注記を `CAGR_SUPPLEMENT_NOTE` に差し替えた（AC15.12）。
  - 取り込み状況:
    - 区画「上場前の期の補完（EDINET）」を加えた。
    - 書類一覧の取り直し中の注記を加えた。
    - 表示名を定数1か所（`runs.ts` の `RUN_TARGET_LABELS`・`RUN_TARGET_LONG_LABELS`）から出すようにした。
  - 情報の配色のトークン `info` を加えた（ライトとダーク）。
- **API**: `GET /api/stocks/[code]`・`GET /api/financials` の期に、追加の列と `edinet_url` を加えた。`GET /api/screening` の行に補完の項目を加えた。
- **Sprint 8 の m2・m3**: 区画がフォールバックの銘柄の出典の文言（m2）。区画の取り込み待ちに書類ID と提出日を出す（m3）。
- **共通化**: `src/lib/edinet.ts`（閲覧ページの URL・書類種別の名前）。`lib/stocks/annual-report.ts` から再 export している。
- **テスト**
  - 単体: `business-results.test.ts`（実データ5通と、組み立てた形）、`documents-list.test.ts`（filers）、`display.test.ts`。
  - 結合:
    - `financials/business-results.db.test.ts`（選び方・トリガー・要約・権限・性能）
    - `ingestion/edinet-business-results.db.test.ts`（取り込み・導入時・順番・キーなし）
  - E2E: `e2e/business-results.spec.ts`（19件）、`db-privileges.spec.ts` の更新。
  - 投入例: `e2e/fixtures/business-results-{example,add,cleanup}.sql`。
- **CLAUDE.md**: 「上場前の期の補完」の節、テストの接頭辞、現状を Sprint 9 にした。

## 起動方法

```bash
pnpm db:reset && pnpm seed:users
JQUANTS_API_KEY= EDINET_API_KEY= CRON_SECRET=local-cron-secret-0123456789 pnpm dev -p 3100
# 本番相当: pnpm build && JQUANTS_API_KEY= EDINET_API_KEY= CRON_SECRET=local-cron-secret-0123456789 pnpm start -p 3100
# 投入例: psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f e2e/fixtures/business-results-example.sql
# E2E: E2E_PORT=3100 E2E_CRON_SECRET=local-cron-secret-0123456789 pnpm test:e2e
```

- 詳細: http://localhost:3100/stocks/9V001
- スクリーニング: http://localhost:3100/screening?cagr=40&margin=10&years=5
- 取り込み状況: http://localhost:3100/imports

## 実 API・実データで確かめた点／未確認の点

### 取得できた実データ（キーなし。閲覧サイトの表示からインライン XBRL を取得）

Sprint 8 と同じ方法で取得した。閲覧ページ `WZEK0040.aspx?<書類ID>,,` を headless ブラウザで開き、目次の `mokujiclick(<ファイル名>)` で各章の iframe を表示して取り出した。

| 書類ID | 書類 | 確かめたこと |
|---|---|---|
| S100X683 | 有価証券届出書（新規公開時。テラテクノロジー、2025-11-21） | 連結2期と提出会社5期。**表の5期が Prior1〜Prior5**（進行中の期を CurrentYear とするため）。千円（scale 3）。DEI に証券コード 483A0 |
| S100UOKQ | 有価証券届出書（新規公開時。キオクシアホールディングス、2024-11-08） | 連結は IFRS の `RevenueIFRSSummaryOfBusinessResults`（売上収益）3期、提出会社は日本基準の `OperatingRevenue1SummaryOfBusinessResults`（営業収益）5期。百万円 |
| S100VTA5 | 有価証券届出書（新規公開時。エータイ、2025-05-23） | 連結財務諸表なし（DEI false）でも、提出会社の事実は `NonConsolidatedMember` のコンテキスト |
| S100W7OT | 有価証券報告書（ニップン、2025-06-27） | CurrentYear〜Prior4。**`endDate` は期間の末日**（2025-03-31。決算短信の CurPerEn と同じ表し方）。営業利益の行なし |
| S100DA8H | 有価証券報告書（フィデアホールディングス。銀行持株会社、2018-06-22） | 連結の `OrdinaryIncomeSummaryOfBusinessResults` の本文の見出しが「連結経常収益」、`OrdinaryIncomeLossSummaryOfBusinessResults` が「連結経常利益」（R4） |

- 抜粋は `src/lib/ingestion/edinet/__fixtures__/<書類ID>-business-results.htm` に置いた。
  - 残したのは、「主要な経営指標等の推移」のテキストブロック（`BusinessResultsOfGroupTextBlock`・`BusinessResultsOfReportingCompanyTextBlock`）と、参照するコンテキスト・DEI の一部だけ。
  - 元の書類の全文（取得した章のファイル）でも、抽出の結果が抜粋と同じになることを確かめた。確かめた書類は上の5通と S100W3D1（マクニカホールディングス。連結は売上高、提出会社は営業収益）。
- **要素名**: 金融庁「2025年版 EDINET タクソノミ」の勘定科目リスト（`1e_ElementList.xlsx`）で、`…SummaryOfBusinessResults` の要素と日本語の標準ラベルを確かめた。
  - 売上高の要素: 売上高・営業収益・営業収入・営業総収入・経常収益・売上収益（IFRS／JMIS）・売上高（US GAAP）。
  - **営業利益の要素は `OperatingIncomeLossUSGAAPSummaryOfBusinessResults`（US GAAP）だけ**。日本基準・IFRS の「主要な経営指標等の推移」には営業利益の行が無い。
- 組み立てたフィクスチャ（実データを取れなかった形。`synthetic.ts` の関数で作った）: 訂正届出書（記載あり・なし）、米国基準の営業利益、決算期の変更の9か月の期、中間期・セグメントのコンテキスト、失敗の各形（円以外・食い違い・数でない・期間が不正・独自の要素だけ）。
  - 訂正届出書の実物は、公開の検索で書類ID を見つけられなかった。

### 未確認のまま実装した点

- 書類取得 API の ZIP の実物（Sprint 8 と同じ）。届出書の ZIP の中のファイル名は、閲覧ページが参照していた `0201010_honbun_jpcrp020400-srs-…_ixbrl.htm` の形から推定した。
- 書類一覧の `secCode` に、新規公開の届出書の証券コードが入るか。DEI にはあったが、一覧の応答は見ていない。入らない場合は `edinet_filers`（上場後の書類）で結び付く。
- 訂正届出書（価格の決定など）が「主要な経営指標等の推移」を含むことがあるか。含まなければ `section_not_found` になり、元の届出書の値を使う。
- 1回の実行で処理できる書類の数。届出書の ZIP は大きいことがある。
- 実際の届出書の件数（見積もりは1年に数百通）。

## 契約から変えた点（評価者に確かめてほしい）

1. **読むコンテキストを `Prior{N}` 全般に広げた**。契約の第2章の4 (a) は「CurrentYear・Prior1〜4」としていた。実データ（S100X683・S100VTA5）の新規公開の届出書では、表の5期が Prior1〜Prior5 だったため。中間期（`InterimDuration`）・時点・セグメントは従来どおり読まない。
2. **営業利益の要素は米国基準の1つだけ**。タクソノミにほかの要素が無いため。投入例の `OperatingIncome` は仮の要素名で、表示には使っていない。
3. **売上高の要素の優先**: 同じ期に IFRS などの要素と日本基準の要素の両方があるときは、IFRS などを先にする（移行期の書類）。日本基準の中の順は契約どおり。
4. **保存の関数名**: `save_business_results_extraction` ではなく `save_edinet_extractions(p_run_id, p_doc_id, p_annual_report, p_business_results)` にした。1書類の2つの処理を1つのトランザクションで保存し、処理件数を1だけ足すため。契約は「足し方はジェネレーターが決める」としていた。Sprint 8 の `save_annual_report_extraction` は使わなくなったので削除した。
5. **ビューを2つ足した**: `business_results_targets`（読む書類。取り込みの対象と取り込み状況の「取り込み待ち」が同じものを使う）。`edinet_document_codes` は、性能のため2つの枝の union all にした。1つの式（coalesce）では、銘柄の絞り込みが索引に届かず、1銘柄の読み出しが 35ms だった。今は 0.5ms。
6. **`financial_metrics.latest_period_source` を足した**（営業利益率の「記載なし」の文言の出し分けに使う。算出には使わない）。

## 完了条件チェック

| 条件 | 状態 | 確認方法 |
|---|---|---|
| C1-1〜C1-9 出典の優先順位・5期の表・リンク・記載なし・指標・グラフ・API・銘柄コードで確認 | ✅ | E2E `business-results.spec.ts`（C1 の3件）、`business-results.db.test.ts` |
| C2-1〜C2-8 補完の印（ホバー・クリック・Enter・詳細へ移らない・Esc）、40／45、印の無い行、API、375px | ✅ | E2E（C2 の3件） |
| C3-1〜C3-4 算出不可の理由（5期未満・変則決算・連続しない）とデータなし | ✅ | E2E・db test |
| C4-1〜C4-3 9V005 に追加 → 25.7%、9V006 と numeric で一致、ダッシュボードの売上CAGR が +1 | ✅ | E2E・db test |
| C4-4・C4-5 9V008 の訂正届出書、取り下げると 35.1%、戻すと 31.6% | ✅ | E2E |
| C4-6・C4-7 有報 > 届出書（43.2%）、決算短信 > EDINET | ✅ | E2E |
| C4-8 選び方とトリガー（取り下げ・不開示・連結単体・filers・stocks の追加・書類の削除（連鎖）・抽出の行の削除・upsert で再計算しない・後片付け） | ✅ | `business-results.db.test.ts`。書類の削除では、同じ文の中で「期が無くなった後」の値になることを実際の値で確かめた（注意3） |
| C4-9 算出は出典を読まない、混在の旗2つ | ✅ | db test |
| C5-1〜C5-4 連結・単体、IFRS の売上収益、旧い文言が無い | ✅ | E2E・`stock-detail.spec.ts` の 9Y004（「連結・単体が混在」） |
| C6-1 キーなしで失敗し、指標は変わらない | ✅ | E2E・結合テスト |
| C6-2〜C6-8 取り込み（1回目・2回目 0件・導入時の取り直し・C6-4b・順番・失敗・Sprint 8 の結合テスト・details） | ✅ | `edinet-business-results.db.test.ts`、`edinet-reports.db.test.ts` |
| C7-1〜C7-5 抽出・filers・表示名・表示の関数の自動テスト | ✅ | `pnpm test` |
| C8-1〜C8-4 取り込み状況の区画（7/10・4・12（有報4・届出書8、読み取れた11・記載なし1）・取り込み待ち1・結び付かない1 → 追加後 8・5）、空の状態、表示名 | ✅ | E2E・db test（`business_results_summary()` と照合） |
| C9-1〜C9-5 注記の差し替え | ✅ | E2E（`screening.spec.ts`・`stock-detail.spec.ts`・`business-results.spec.ts`） |
| C10-1・C10-2 m2・m3 | ✅ | E2E |
| C11-1 コントラスト | ✅ | ライト・ダークで計測した。「補完」の印と注記の文字と背景の比は、ライト 7.25:1、ダーク 9.25:1（画面の色から計算） |
| C11-2 375px | ✅ | E2E（詳細・スクリーニング）、`/imports?code=9V001` も scrollWidth 375 を確かめた |
| C11-3 時計のずれ | ✅ | E2E（dev） |
| C11-4〜C11-8 外部 API を呼ばない、公開キー・intruder・db-privileges・401/403 | ✅ | E2E・db test |
| C12-1 性能 | ✅ | db test（4,000 銘柄）。1銘柄の期 < 20ms、スクリーニング < 100ms、全銘柄の再計算 < 10 秒、取り下げ 1通 < 100ms |
| C12-2 Sprint 1〜8 のリグレッション | ✅ | 全 E2E（dev 203 件）。変えたアサーションは下の一覧 |
| C12-3 lint・typecheck・test・test:db・build | ✅ | 下記 |
| C12-4 E2E | ✅ | dev 全件、prod 9 ファイル |
| C12-5 後片付け | ✅ | test:db の後、stocks・ingestion_runs・edinet_documents・edinet_filers・edinet_list_fetched_dates・financial_metrics がすべて0件 |
| C12-6〜C12-10 | ✅ | コンソールのエラーなし（E2E の `collectPageProblems`）、ダミーなし、コミット、CLAUDE.md、この文書 |

## 実行結果

- `pnpm lint`・`pnpm typecheck`: 成功。
- `pnpm test`: 41 ファイル・483 件成功。
- `pnpm test:db`: 11 ファイル・148 件成功。後片付けの後、上記のテーブルはすべて0件。
- `pnpm build`: 成功。
- `E2E_PORT=3100 pnpm test:e2e`（dev、キーなし）: **203 件すべて成功**（6.3 分）。
  - 途中の全件の実行で一度、`stock-detail.spec.ts` の「パンくず・条件を変える・戻る/進む」が失敗した。単独で2回続けて流すと成功した。今回の変更とは関係の無い、時間に依存する不安定さと考える。
- prod（`pnpm build && pnpm start -p 3100`、キーなし）: 次の 9 ファイルで **137 件すべて成功**。
  - `business-results`・`edinet`・`stock-detail`・`screening`
  - `screening-detail-race`・`ingestion`・`db-privileges`・`financials`・`dashboard`
- 終了後: 3100 番を PID を指定して止めた。`pnpm db:reset && pnpm seed:users` で戻した。3000 番には触れていない。

## C12-2: 既存のテストで変えたアサーション（前 → 後）

### Sprint 8 のテスト（契約の3種類に当たるもの）

| ファイル:行 | 前 | 後 | 種類 |
|---|---|---|---|
| e2e/edinet.spec.ts:67・129 | `radio { name: /^有報（EDINET）/ }` | `/^EDINET（有報・届出書）/` | 1 表示名 |
| e2e/edinet.spec.ts:86・169 | 実行履歴の行 `toContainText("有報")` | `"EDINET"` | 1 表示名 |
| e2e/edinet.spec.ts:127 | `"実行中: 有報"` | `"実行中: EDINET"` | 1 表示名 |
| e2e/edinet.spec.ts:144 | `"有報の取り込み実績がありません"` | `"EDINET の取り込み実績がありません"`（EDINET の実行の実績の意味） | 1 表示名 |
| e2e/dashboard.spec.ts:254 | 実行履歴の行 `"有報"` | `"EDINET"` | 1 表示名 |
| e2e/ingestion.spec.ts:94 | 定期実行 `"有報（EDINET）"` | `"EDINET（有報・届出書）"` | 1 表示名 |
| src/lib/ingestion/runner.test.ts:112 | `edinet_reports: "有報（EDINET）"` | `"EDINET（有報・届出書）"` | 1 表示名 |
| src/lib/ingestion/edinet-reports.db.test.ts:314 | 書類の要求の順 `["S8DB0003", "S8DB0001", "S8DB0002"]` | `["S8DB0003", "S8DB0002", "S8DB0001"]`（元の有報 0002 も主要な経営指標等のために最初の対象に入る） | 2 要求 |
| 同:320・322 | `documentsTargeted: 3`、`fallbackDocuments: 1` | `4`、`0`（同じ理由。`documentsProcessed: 4`・抽出の件数は同じ） | 2 details |
| 同:510 | `"銘柄マスタが未取り込みのため、有報を取り込めません。…"` | `"…、EDINET の書類を取り込めません。…"` | 3 文言 |
| src/lib/stocks/annual-reports.db.test.ts:220 | `edinet_ingestion_state` の targets が `[{ docId: "S8SEL031", code, xbrlAvailable }]` | 大株主・役員が未処理のもの（`needsAnnualReport`）に絞ると `[{ docId: "S8SEL031", …, needsAnnualReport: true, needsBusinessResults: true }]`（訂正 S8SEL032 も主要な経営指標等のために対象に入る） | 2 要求 |

- アサーションではない変更: `edinet-reports.db.test.ts` の後片付けに、`edinet_filers` の E999xx を消す1行を足した。一覧のすべての行から提出者の対応ができるようになったため。
- `e2e/db-privileges.spec.ts`: 追加・置き換えた DB オブジェクト（契約の C11-7）の一覧を更新した（`save_annual_report_extraction` → `save_edinet_extractions`、`save_edinet_document_list` の引数、Sprint 9 のテーブル・ビュー・関数）。

### Sprint 6・7 のテスト（契約の完了条件で文言が変わるもの）

| ファイル:行 | 前 | 後 | 根拠 |
|---|---|---|---|
| e2e/screening.spec.ts:16、e2e/stock-detail.spec.ts:17 | 旧い注記の文言 | AC15.12 の文言 | C9 |
| e2e/screening.spec.ts:64・79・197、e2e/stock-detail.spec.ts:314・317・761 | `cagr-provisional-note` | `cagr-supplement-note` | C9 |
| e2e/stock-detail.spec.ts:461・465 | `metric-mixed-basis`「連結と単体、または会計基準が異なる期を含みます」 | `metric-mixed-consolidation`「連結・単体が混在」（`metric-mixed-standard` は無い） | C5-4 |
| e2e/stock-detail.spec.ts:246 | ツールチップ `"FY0 2025/03期 売上高 40,000"` | `"FY0 2025/03期 売上高 40,000出典: 決算短信"` | C1-7（出典を加えた） |
| src/app/api/stocks/route.test.ts、src/app/api/stocks/[code]/route.test.ts | 指標・期の差し替えの行 | 追加の列（混在の旗・補完・出典）を足した | スキーマの追加 |

## 既知の問題・未実装

- EDINET のキーが無いため、実 API での取り込みは未確認（上記）。キーを設定したときの確認手順は、Sprint 8 の手順（CLAUDE.md）に、区画「上場前の期の補完」の件数を見ることを加えればよい。
- 書類一覧の期間（450 日）より前の届出書は読まない。そのため、最初の有報の表に足りない期がある銘柄は補えないことがある（CLAUDE.md の既知の制限）。
- 「売上高」と「営業収益」の両方を記載する会社では、決算短信（J-Quants の Sales）と定義がずれうる（既知の制限）。
- Sprint 8 の m1・m4・m5・m6 は行っていない（契約の第2章の11の理由）。
- 導入後の最初の約3回の実行は、書類一覧の取り直しの間、本文の処理を止める。取り込み状況に注記を出す。

## エバリュエーターに重点的に見てほしい点

- 契約から変えた6点（とくに1: Prior5 のコンテキストを読むこと、2: 営業利益の要素が米国基準だけであること）。
- 期の選び方の一貫性（画面・API・スクリーニングの印・取り込み状況の件数が同じ `financial_periods` から来ること）。
- 書類の削除（連鎖）・取り下げ・filers の変更での再計算（psql で `delete from edinet_documents where doc_id = 'S9TEST12'` など）。
- 「補完」の印の分かりやすさと、ホバーやクリックでの誤遷移が無いこと（dev・prod）。
