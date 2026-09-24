# Sprint 04 自己評価（ラウンド 1）

## 実装内容
- **DB**（`supabase/migrations/20260927000000_stock_listing_dates.sql`）
  - `public.stock_listing_dates`（初出日、データ期間の開始日、確定日時、実行 ID。`first_price_date >= data_start_date`。RLS・権限は `stocks` と同じ）
  - `public.listing_years_between(from, to)`：暦の年の整数部分・正確な値（numeric）・小数1桁の切り上げ。切り上げは整数演算 `ceil(10d / L)` で求める（契約レビューの N1）
  - ビュー `public.listing_reference_date`（基準日）と `public.stock_listing_ages`（推定上場年数）。どちらも `security_invoker`
  - service_role 専用の `listing_dates_pending()` と `save_stock_listing_dates()`。`finish_ingestion_run` を置き換え、`p_processed_count` が NULL なら件数を変えないようにした（予期しない例外で終わっても、保存済みの件数を 0 に戻さない。C4-13）
- **取り込み**
  - `src/lib/ingestion/listing-dates.ts`（target `daily_quotes`）
    - 未確定の銘柄だけを対象にする
    - データ期間の開始日 W を探す（14 日）
    - W の日の一覧に出た銘柄は「データ期間開始以前」として保存する
    - 残りはコード別に全ページを取得する
    - 要求の間隔は 600ms。210 秒で打ち切る
    - 50 銘柄ごとに保存する
    - 結果の文言と `details` を記録する
  - `jquants/bars-daily.ts`：株価四本値の1ページを取得して分類する。210／401／キーの本文の 403／キー以外の 403／429／そのほかの状態コード／接続できない／形式の違い、に分ける
  - `listing-period.ts`：日付の計算。`clock.ts`：時計と要求の期限。`finish.ts`：`finishRun` を runner から分離した
  - `runner.ts`：`SUPPORTED_TARGETS` に `daily_quotes` を追加した。`RunDeps` に `clock`・`requestDeadline`・`saveBatchSize`（テスト用）を追加した
- **ルート**
  - `GET /api/cron/daily`：銘柄マスタ → 株価 の順に実行する。途中でほかの実行が走っていたら `skipped`。期限はルートの開始から数える。`HEAD` は 405（M2）
  - `POST /api/ingestion/runs`：`daily_quotes` を受け付ける。同一オリジンの確認を `lib/http/same-origin.ts` にした（M1）。拒否は `cross_origin`
  - `POST /auth/signout`：同じ確認にした。`GET /auth/signout`：リダイレクト先を相対パスにした（R1）
  - `GET /api/stocks`：年数の6項目、`meta.referenceDate`、`?code=`（形式の違うコードは 400 `invalid_code`）を追加した
- **画面**（`/imports`）
  - 手動取り込みに対象の選択（ネイティブのラジオ）と、`cross_origin` 用の文言、一部失敗の注意色を加えた
  - 新しい区画「株価の初出日と推定上場年数」（`components/imports/listing-dates-panel.tsx`）を加えた。要約、銘柄コードで確認（`?code=`）、初出日の新しい銘柄の表
  - 定期実行の対象の表示を「銘柄マスタ、株価（初出日）」にした
- **その他**
  - `next.config.ts` に `allowedDevOrigins: ["127.0.0.1"]` を加えた。dev を `127.0.0.1` で開くと HMR などが拒否され、画面が動かなかったため
  - CLAUDE.md を更新した
- **テスト**
  - Vitest（214 件）
    - `bars-daily.test.ts`、`listing-period.test.ts`、`same-origin.test.ts`、`listing/ages.test.ts`
    - ルートのテスト（Cron の順序、`skipped`、期限、HEAD、`cross_origin`、`127.0.0.1`、`daily_quotes`、`/api/stocks` の年数と `?code=`）
    - 結果の文言
  - `test:db`（51 件）
    - `listing-dates.db.test.ts`：C4-1〜13 のすべて
    - `listing/listing-ages.db.test.ts`：年数の境界、「表示 ≤ X ⇔ 正確 ≤ X」、7 年分の毎日の日付での切り上げの照合、基準日の選び方、投入例
  - E2E（102 件）
    - `e2e/listing-dates.spec.ts`（15 件）を追加した
    - `ingestion.spec.ts` の Cron のテストを2要素に直した。手動と Cron の同時要求は、「勝った側の行だけ」を確かめる形にした（緩めていない）
    - `db-privileges.spec.ts` に新しいテーブル・ビュー・関数を加えた

## 起動方法
```bash
pnpm install && pnpm db:start && pnpm db:reset && pnpm env:local && pnpm seed:users
CRON_SECRET=local-cron-secret-0123456789 pnpm dev -p 3100
# 本番相当: pnpm build && CRON_SECRET=local-cron-secret-0123456789 pnpm start -p 3100
# E2E: E2E_PORT=3100 pnpm test:e2e（3100 番が空いていれば dev を自動で起動する）
```
- http://localhost:3100 （`owner@quantis.local` / `Quantis-Owner-2026!`）

## コマンドの結果（2026-09-24 に実行）
| コマンド | 結果 |
|---|---|
| `pnpm lint` | 成功 |
| `pnpm typecheck` | 成功 |
| `pnpm test` | 214 件成功 |
| `pnpm test:db` | 51 件成功 |
| `pnpm build` | 成功 |
| `E2E_PORT=3100 pnpm test:e2e`（dev を自動で起動） | 102 件成功 |
| `E2E_PORT=3100 pnpm test:e2e`（`pnpm start -p 3100`、`CRON_SECRET` は E2E の既定値） | 102 件成功 |

## 完了条件チェック
| 条件 | 状態 | 確認方法 |
|---|---|---|
| C1-1〜3 要約、コードでの確認（3.0年）、新しい銘柄の表 | ✅ | E2E（投入例） |
| C1-4 切り上げの表示（3.0／3.1／5.0／5.0／5.1／0.0） | ✅ | E2E（DB を書き換えて再表示）、test:db |
| C1-5 基準日なし | ✅ | E2E |
| C1-6・C1-7 基準日の選び方（failed・stock_master は使わない、partial は使う、JST の日付） | ✅ | test:db |
| C2-1 データ期間開始以前（9年超）と補足、数値の年数は出ない | ✅ | E2E |
| C2-2 両方 2016-09-24 なら 10年超 | ✅ | test:db（N=10）。画面は同じ関数の値を表示する |
| C2-3 開始日＋1日で 10.0年 | ✅ | test:db（9.99… → 10.0）。画面も同じ値を表示する |
| C2-4 `first < start` は制約で入れられない | ✅ | test:db |
| C2-5 未確定、無いコード、形式の違い、4桁、200、時計のずれの pageerror 0件 | ✅ | E2E（dev と prod） |
| C2-6 `<script>`・`%00` | ✅ | E2E（200、そのまま出ない） |
| C3-1・C3-2 年数の算出のテスト | ✅ | test:db。境界、うるう日、N、閾値の一致、毎日の照合を含む。N1 に従い、アプリ側では年数を計算しない（DB の値を表示するだけ）。そのため、アプリと DB の結果の一致は構造上保証される。表示の書式は Vitest で確かめた |
| C4-1〜13 取り込みの結合テスト | ✅ | test:db（fetch と時計だけを差し替えた） |
| C5-1〜3 `/api/stocks` | ✅ | E2E、Vitest |
| C5-4 公開キーで REST | ✅ | E2E（db-privileges）。0行か権限エラーで、行は漏れない |
| C5-5 `daily_quotes` は 202、ほかは 400 | ✅ | Vitest、E2E |
| C6-1〜4 キー未設定の株価の取り込み（画面）、キーボード、実行中は変更不可、キーの確認が先 | ✅ | E2E |
| C7-1・C7-2 無効なキーで実 API | ✅ | `JQUANTS_API_KEY=qa-dummy-key-7f3a9c` で prod を起動し、Cron を実行した。株価は `apiCalls: 1`、`dataStartProbe: [{date: 2016-09-25, status: 403}]` で、「…無効か…（HTTP 403）」の失敗になった。サーバーのログにキーは0件だった |
| C8-1 Cron で2つの実行 | ✅ | E2E、Vitest |
| C8-2・C8-4 409、Sprint 3 の Cron の認証 | ✅ | E2E（Sprint 3 の分） |
| C8-3 HEAD は 405 | ✅ | E2E、Vitest |
| C8-5 定期実行の対象の表示 | ✅ | E2E。表示と `SUPPORTED_TARGETS` の一致は Vitest で確かめた |
| C8-6 `skipped` と期限 | ✅ | Vitest |
| C9-1〜5 同一オリジン（M1）とリダイレクト先（R1） | ✅ | E2E（`127.0.0.1:3100` での手動取り込み、許可の取り消し、ログアウト。`cross_origin` の各ケース。画面の文言）、Vitest |
| C10 キーあり | 対象外（キーなし） | 有効なキーが無いため |
| C11-1〜5 デザイン | ✅（目視） | ライト・ダーク × 1280・375 のスクリーンショットで確かめた。`scrollWidth` は 375 以下。数値は `tabular font-mono` で右揃えにした。「データ期間開始以前」「未確定」「基準日なし」はアイコンと文字で区別した。ラベルと `aria-describedby` を付けた。対象のグループには名前「対象」を付けた |
| C12-1〜5 | ✅ | 上の表のコマンドがすべて成功した。E2E の後、DB は0件に戻る |
| C12-6 ダミーデータ | ✅ | `.next/static` に、フィクスチャの社名、`equities/bars`、キーの本文は含まれない |
| C12-7 CLAUDE.md | ✅ | |
| C12-8 コミット | ✅ | `sprint-04: 株価の初出日と上場からの年数`（呼び出し元の指定に合わせた。契約の文言「上場年数」とは少し異なる） |

## 既知の問題・未実装
- **有効なキーでの確認（C10）はしていない。** 次の点は、キーのある環境で初めて確かめられる。
  - 休場日・期間外の日付の応答
  - W の日の一覧の件数とページ送り
  - 1回あたりに処理できる銘柄数。約 300 銘柄を見込んでいる
- **手動取り込みの対象の選択をネイティブのラジオにした。** radix の RadioGroup をラベルで包むと、矢印キーでフォーカスは移るが、選択が変わらなかった（Sprint 2 から持ち越している「最初の矢印キー」の件と同じ系統）。そのため、ここでは `<input type="radio">` にした。
  - 見た目は、既存の設定画面のラジオ（radix）とそろえてある。
  - ダークテーマでは、未選択の丸がブラウザの描画になる。
- **ダークテーマの未選択のラジオのコントラスト。** 枠（非テキスト要素）がブラウザの既定の描画で、3:1 を測ってはいない。
- **375px の確認カード。** 項目名の列（7.5rem）のため、「データ期間開始以前から上場（9年超）」が2行に折り返す。崩れではない。
- **`finish_ingestion_run` の変更。** `p_details` が NULL のとき、既存の `details` を残すようにした。Sprint 3 の銘柄マスタの失敗は、もともと `details` が NULL なので影響しない。
- `test:db` の株価の結合テストは、銘柄マスタにテスト以外の行が無い DB を前提にしている（実データの入った DB では、冒頭で明示的に止まる）。

## エバリュエーターに重点的に見てほしい点
- C4 の結合テストの網羅（特に C4-6 の 403 の分け方、C4-9 の時間切れからの再開、C4-12・C4-13）
- `stock_listing_ages` の切り上げと、`listing_years_exact` を返していること（Sprint 6 に渡すもの）
- `127.0.0.1:3100` での手動取り込み、許可の取り消し、ログアウト（M1・R1）。dev を `127.0.0.1` で開くために `allowedDevOrigins` を足したことの妥当性
- 取り込み状況の画面の新しい区画のデザイン（ライト・ダーク、375px）
