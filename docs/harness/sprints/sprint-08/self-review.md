# Sprint 08 自己評価（ラウンド 1）

## 実装内容

- **EDINET の取り込みの土台**（`src/lib/ingestion/edinet/`、Sprint 9 で使い回す）
  - `http.ts`: EDINET API v2 への要求と応答の分類。
    - キーはクエリの `Subscription-Key` で送る。要求の URL と fetch の例外（`cause`）は記録しない。
    - `redirect: "manual"` で 3xx は打ち切る。
    - HTTP 200 のまま本文で返るエラー（`StatusCode`・`metadata.status`）も分類する。
    - 書類取得の成功は、本文の先頭の ZIP のシグネチャで判定する。
  - `documents-list.ts`: 書類一覧の検証と行の分類。
    - 有報・訂正有報は証券コードがあるものだけ保存する。届出書・訂正届出書は証券コードが無くても `edinet_code` 付きで保存する。
    - 取下書・取り下げられた書類・不開示の開始と解除の情報を、それぞれ分けて返す。
  - `document-archive.ts`: ZIP から `XBRL/PublicDoc/*_ixbrl.htm` を文書の順に取り出す（fflate）。
  - `xbrl.ts`: インライン XBRL の汎用の読み取り（parse5）。
    - 事実を文書の順に返し、直前の本文も付ける。
    - コンテキストは、どのファイルにあっても集める。接頭辞は xmlns で名前空間に直す。
    - ixt の書式・scale・sign・nil を扱う。
  - `annual-report.ts`: 大株主と役員の抽出（第2章の5）。
  - `decimal.ts`: 十進の文字列のまま桁をずらす。
- **取り込み** `src/lib/ingestion/edinet-reports.ts`
  - 骨組み `runEdinetPipeline` に、対象の選び方（`loadState`）と書類ごとの処理（`process`・`save`・`count`）を渡す形にした。Sprint 9 は別の pipeline を渡す。
  - 流れは、書類一覧（直近7日は古い順、そのほかは未取得の日を新しい順）→ 本文（区画の不足で元の書類が対象になれば続けて処理）。
  - 要求の間隔は 1,000ms、期限は 210 秒。キーの無効・429・3xx・5回連続の失敗で打ち切る。
  - `details` に一覧・書類・抽出の結果・失敗した書類（上限 50 件）を残す。
  - 周辺の変更:
    - `runner.ts`: `edinet_reports` を追加。
    - `schedule.ts`・`vercel.json`・`/api/cron/edinet`: 毎日 0:00 JST の定期実行。
    - `errors.ts`・`result-message.ts`: 失敗の文言と結果の要約。
    - 手動取り込みの対象に「有報（EDINET）」を追加。
- **DB**（`supabase/migrations/20261001000000_edinet_annual_reports.sql`）
  - テーブル: `edinet_documents`、`edinet_list_fetched_dates`、`annual_report_extractions`、`annual_report_shareholders`、`annual_report_officers`。`parent_doc_id` に外部キーは付けていない。
  - ビュー（security_invoker）:
    - `annual_report_candidates`: 候補の列。事業年度を決められない書類は除く。
    - `annual_report_sections`: 区画ごとの書類。書類の選び方はこの1か所で決まる。
  - authenticated が実行できる関数: `annual_report_detail(code)`（数値は `::text`）、`annual_reports_summary()`。
  - service_role だけが実行できる関数: `edinet_ingestion_state`、`save_edinet_document_list`、`save_annual_report_extraction`。
  - RLS・権限は `stocks` と同じ方針。`e2e/db-privileges.spec.ts` を更新した。
- **画面と API**
  - 銘柄詳細: 区画「大株主・役員（有価証券報告書）」（`components/stocks/annual-report-section.tsx`）を追加した。
    - 出典の書類と EDINET のリンク、同じ事業年度のほかの書類（取り下げのラベル付き）を示す。
    - 区画ごとの出典と、元の有報へのフォールバックの注記を出す。
    - 大株主の表（株・比率は記載の桁）と役員の表（改行を保つ）。総会後の表の注記。
    - 抽出できなかった・未取得・取り込み待ちは、それぞれ別の表示にした。
  - `GET /api/stocks/[code]` に `annualReport` を追加した（数値は十進の文字列、`ratio_display` 付き）。
  - 取り込み状況: 区画「有価証券報告書（大株主・役員）」（`components/imports/annual-reports-panel.tsx`）を追加した。
- **Sprint 7 評価の B1**
  - `screening-view.tsx` の `openDetail`: 待っている書き換えを先に発行し、完了を待ってから詳細へ push する。
  - `results-table.tsx`: 行・リンクのクリックを `openDetail` に通す。
- **任意の改善**
  - m1: グラフの端の枠のツールチップを内側に寄せた。
  - m2: 「すべて表示（6期）」の括弧の見かけの空白（等幅のフォント）をなくした。
  - m3: 営業利益の開示なしのとき、割り算の形を出さない。
  - m4: 社名のリンクの `title`（Sprint 7 で既にある）。
- **テスト**
  - 単体テスト: `edinet/*.test.ts`（http・一覧・ZIP・XBRL・抽出・十進）、`edinet-period.test.ts`、`lib/stocks/annual-report.test.ts`、runner・schedule・cron route・ingestion route。
  - 結合テスト: `edinet-reports.db.test.ts`（取り込みの流れ）、`lib/stocks/annual-reports.db.test.ts`（選び方・要約・権限）。
  - E2E: `e2e/edinet.spec.ts`、`e2e/screening-detail-race.spec.ts`、`db-privileges.spec.ts`・`ingestion.spec.ts` の更新。
- **CLAUDE.md**: Sprint 8 のアーキテクチャを追記した。キーを設定したときの確認手順、初回の所要と6月末の遅れ、0:00 JST と実行日、既知の制限、テストの接頭辞も書いた。

## 起動方法

```bash
pnpm db:reset && pnpm seed:users
JQUANTS_API_KEY= EDINET_API_KEY= CRON_SECRET=local-cron-secret-0123456789 pnpm dev -p 3100
# 本番相当: pnpm build && JQUANTS_API_KEY= EDINET_API_KEY= CRON_SECRET=local-cron-secret-0123456789 pnpm start -p 3100
# 投入例: psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f e2e/fixtures/annual-report-example.sql
# E2E: E2E_PORT=3100 E2E_CRON_SECRET=local-cron-secret-0123456789 pnpm test:e2e
```
http://localhost:3100/stocks/9W001 ・ http://localhost:3100/imports

## 閲覧サイトからの XBRL の取得（第2章の1の3）と、実 API で未確認の点

### 取得できたもの

- **ZIP（書類取得 API の形）は取得できなかった。**
  - 閲覧サイトの XBRL のダウンロードは、画面の操作（GeneXus のポストバック）を経由する。`searchdocument/xbrl/…zip` のような直接の URL は 404 だった。
- 代わりに、閲覧ページ `https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx?<書類ID>,,` を headless ブラウザで開いた。表示の iframe（srcdoc）に入る**インライン XBRL の本文（表紙の ix:header のコンテキストと、各章の htm）**を、キー無しで取得した。
  - 取得した書類: **S100W7OT**（ニップン。2025-06-27 提出）、**S100W4KN**（2025-06-25 提出。株主総会の前の提出で、総会後の役員の表あり）、**S100W5PD**（2025-06-26 提出。株の単位の所有株式数、外国名義）。
  - フィクスチャ（`src/lib/ingestion/edinet/__fixtures__/S100W7OT.htm` など）は、その抜粋から作った。残したのは、大株主と役員のテキストブロック（記載のまま）と、参照するコンテキストだけ。略歴の中身と style・class は省いた。
- **閲覧ページの URL の形**: `https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx?S100W7OT,,`（末尾は `,,`）で書類が表示されることを確かめた（HTTP 200）。
- **API のエラーの形**: キー無しで `https://api.edinet-fsa.go.jp/api/v2/documents.json?date=2025-06-25&type=2` を呼ぶと、**HTTP 200 で `{"StatusCode": 401, "message": "Access denied due to invalid subscription key...."}`** が返ることを実際に確かめた。
- **仕様書**: 金融庁「EDINET API 仕様書（Version 2）」2026年6月版（ESE140206.pdf）の本文を取り出して確かめた。
  - キーはクエリ、エラーは HTTP 200＋本文、書類取得の Content-Type。
  - 取下げ: 取下書は "1" で `parentDocID` が対象。取り下げられた書類は "2" で、日次更新の後は項目が null。親が取り下げられると子も取り下げられる。
  - 不開示: 1 開始・2 不開示中・3 解除。不開示の書類の取得は PDF。
  - 訂正有報・届出書は期間（periodStart・periodEnd）が出力されない。
  - ZIP の構成は XBRL/PublicDoc・AuditDoc。

### 実データで分かり、契約と違う実装にした点（評価者に確かめてほしい）

1. **役員の記載順の根拠**: 契約の第2章の5は「表示リンク（`*_pre.xml`）の順 → だめならインライン XBRL の文書の順」としていた。実装は**インライン XBRL の文書の順だけ**（`officers_order_source = inline_document`）。
   - 表示リンクの実物（ZIP）は取得できなかった。
   - 実データでは、総会後の表も同じコンテキスト（役員ごとのメンバー）を使う。そのため、メンバーの順は表の区別に使えない。
   - 文書の順は、画面の表の順そのものである。
   - テストでは、コンテキストの定義の順とメンバー名の順を文書の順と逆にしたフィクスチャで、文書の順になることを確かめた（レビューの「表示リンクで順が決まらない場合の文書の順のテスト」に当たる）。
2. **総会後の役員の表の見分け方**: 契約は「異なるコンテキストで区別される（実装時に確かめる）」としていた。実データ（S100W4KN）では、**コンテキストは同じで、要素名の末尾が `Proposal`** だった（`NameInformationAboutDirectorsAndCorporateAuditorsProposal` など）。
   - 読むのは末尾に `Proposal` の無い要素だけ。`Proposal` の要素があれば `officers_has_post_agm_table = true` にする。
   - 提出日現在の表の中で同じ役員が異なる記載で2回現れたら `invalid_values`（duplicate_officer）にする。
3. **読むファイル**: 契約の第2章の5は「本文のインスタンス（`*.xbrl`）を読む」としていた。実装は**インライン XBRL（`*_ixbrl.htm`）**を読む。
   - 理由1: 実データで確かめられたのはインライン XBRL だけである。
   - 理由2: 2つの役員の表の区別と記載順には、文書の構造が要る。
   - インスタンスは、インライン XBRL から作られる同じ事実の集まり（仕様書 3-2-2）。
   - インラインでない XBRL だけの書類は `no_xbrl`（`no_inline_xbrl`）にする。一覧の期間（450 日）の有報はすべてインライン XBRL の時期。
4. **直近7日の一覧の順**: 契約は「直近7日 → 未取得の日（新しい順）」としていた。直近7日は**古い順**にした。
   - 取下書・不開示の情報は操作日の一覧に出る。同じ実行の中で、元の書類を保存してから取り下げを反映できるようにするため。
5. **不開示の解除**: 契約は「true を false に戻さない（仕様書で違えば仕様書どおり）」としていた。仕様書に解除（"3"）があるので、**操作日時の新しい情報だけで withheld を更新**する（解除で false）。取り下げは戻さない。
6. **比率の表示**: 実データの比率は、小数点以下1桁（S100W7OT。`decimals="3"`）と2桁（S100W4KN・S100W5PD）の両方があった。規則（最低2桁）どおり、`9.6` は `9.60%` と表示する。保存値は `9.6`、`ratio_decimals = 1`。

### 実 API で未確認のまま実装した点

- 書類取得 API（type=1）の ZIP の実物は見ていない。ファイル名の規則（`XBRL/PublicDoc/0000000_header_…_ixbrl.htm`、`0101010_honbun_…_ixbrl.htm`）は、閲覧ページが参照していたファイル名と仕様書の構成図から推定した。文書の順は、ファイル名の昇順とした。
- 書類一覧の実際の応答（`results` の件数・順番、`formCode` の値）。様式コードでは絞り込まず、府令 010＋書類種別＋証券コードで絞っている。外国会社の有報は銘柄マスタ（内国株券）に無いので使わない。
- 呼び出しの上限（429）の実際の閾値。1,000ms 間隔が十分かは未確認。
- 1回の実行で処理できる書類の数（見積もりは 100〜150 通）。

## 完了条件チェック

| 条件 | 状態 | 確認方法 |
|---|---|---|
| C1-1〜C1-2 キー未設定の手動取り込み、J-Quants 側に影響なし | ✅ | E2E `edinet.spec.ts`（J-Quants の失敗の行と市場データの件数が変わらない） |
| C1-3〜C1-5 `/api/cron/edinet`（200・401・405・409）、二重実行の防止 | ✅ | E2E、route の単体テスト |
| C2-1〜C2-3 取り込み状況の区画（6/8・5・1・1、空、details の要約） | ✅ | E2E、`annual-reports.db.test.ts` で `annual_reports_summary()` と照合 |
| C3-1〜C3-6 詳細の大株主・役員、API の形（`"32.10"` の文字列） | ✅ | E2E（href・target・rel、5行・3行、改行の表示の高さ、`12.345%`・`5.100%`、API の完全一致） |
| C4-1〜C4-6 最新の提出分、siblings、取り下げ、9W007 のフォールバック、9W008 | ✅ | E2E |
| C4-7 選び方の網羅 | ✅ | `annual-reports.db.test.ts`（事業年度 → 提出日時、取り下げ・不開示、期間外の親、フォールバック・invalid・pending、取り込みの対象） |
| C5-1〜C5-5 抽出できなかった・未取得・取り込み待ち・片方だけ・既存の銘柄 | ✅ | E2E |
| C6-1〜C6-9 増分の取り込み | ✅ | `edinet-reports.db.test.ts`。1回目は4件を処理し、要求は3回（XBRL の無い書類は要求しない）。取り下げ・不開示・届出書（証券コードなし）も確認。2回目は0件で、一覧は7日だけ。3回目は1件。期限・失敗・打ち切り（本文 401・429・302・接続）でキーを記録しないことと `redirect: manual`、間隔、十進の変換も確かめた |
| C7-1〜C7-6 抽出ロジックの自動テスト | ✅ | 実データの抜粋3通＋組み立てたフィクスチャ。個人・法人・信託口・外国名義、兼務、議決権の表、総会後の表、順、失敗の各種 |
| C8-1〜C8-5 リンク・375px・コントラスト・時計のずれ・外部 API を呼ばない | ✅／⚠️ | E2E（C8-3 のコントラストは既存のトークンだけを使い、目視でライト・ダークを確認） |
| C9-1〜C9-7 B1 の修正 | ✅ | E2E `screening-detail-race.spec.ts`（dev・時計のずれの両方）。修正前のコードでは C9-1 が失敗することを確かめた |
| C10-1〜C10-4 任意の改善 | ✅（m4 は既存） | m1・m3 は目視と E2E の既存のテスト |
| C11-1〜C11-5 権限・API | ✅ | `db-privileges.spec.ts`（REST・関数の ACL・テーブルとビュー）、`annual-reports.db.test.ts`（intruder は0件）、E2E（401・403） |
| C12-2 lint・typecheck・test・test:db・build | ✅ | 下記の「実行結果」 |
| C12-3 E2E | ✅ | 下記 |
| C12-8 コミット（sprint-07 の evaluation-1.md を含む） | ✅ | |

## 実行結果

- `pnpm lint`・`pnpm typecheck`: 成功
- `pnpm test`: 40 ファイル・459 件成功
- `pnpm test:db`: 9 ファイル・127 件成功（Sprint 6 の性能テストを含む）
- `pnpm build`: 成功
- `E2E_PORT=3100 E2E_CRON_SECRET=… pnpm test:e2e`（dev、キーなし）: **182 件すべて成功**（5.0 分）
- prod（`pnpm build && pnpm start -p 3100`、キーなし）: `edinet`・`screening-detail-race`・`stock-detail`・`screening`・`ingestion`・`db-privileges` の 97 件すべて成功
- 目視: 1280px のライト・ダーク（9W001・9W003・9W007）、375px（ページの横スクロールなし）、取り込み状況の区画、m1（375px の FY0・FY-4 のツールチップが 0〜375px の内側）、m3（99997）

## 既知の問題・未実装

- EDINET のキーが無いため、実 API での取り込みは未確認（上記）。キーを設定したときの確認手順は CLAUDE.md に書いた。
- 取り下げの反映は、取下書が出た日を直近7日の取り直しで読むか、日次更新の後の元の日付の一覧を読むときに限られる（CLAUDE.md の既知の制限）。
- 一覧の期間（450 日）より前に元の有報がある訂正は、事業年度を決められないため使わない。
- 取得に失敗し続ける書類（恒常的な 404 など）は毎日再試行され、実行が `partial` になり続ける。`details.failedDocuments` で追える（Sprint 12 で扱う）。

## エバリュエーターに重点的に見てほしい点

- 契約と違う実装にした6点（上記「実データで分かり、契約と違う実装にした点」）が妥当か。特に、役員の順の根拠と、総会後の表を `Proposal` の要素名で見分ける点。
- 区画ごとのフォールバック（9W007）の表示が分かりやすいか。
- 持株比率の表示の規則（最低2桁。記載が1桁の実データでも `9.60%`）。
