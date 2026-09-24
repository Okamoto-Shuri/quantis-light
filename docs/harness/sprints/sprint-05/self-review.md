# Sprint 05 自己評価（ラウンド 1）

## 実装内容

### 契約
契約を改訂1にした。完了条件の削除や緩和は無い。
- 仕様の改訂2（出典に依存しない算出）を反映した。
- R1〜R9 を取り込んだ。
- 実装中に分かった点を追記した（`.env` のキー、訂正の空欄）。

### DB（`supabase/migrations/20260928000000_financial_metrics.sql`）
- `public.financial_statements`: 決算短信の通期の開示。
  - 主キーは (code, disclosure_no)。訂正の開示も別の行として残す。
  - `document_type` は通期の決算短信だけを受け付ける制約（REIT、四半期、予想は入らない）。
  - 連結かどうかと会計基準は生成列。
- `public.financial_periods`（ビュー。security_invoker）
  - 銘柄・事業年度ごとに1行を選ぶ。順は、出典の優先順位 → 開示日・時刻・開示番号の新しい順。
  - `source`・`source_priority`・`source_document_id` を持つ。
  - 売上高・営業利益は、項目ごとに値のある最新の開示を使う（R2。実データで、訂正の開示が空欄になる例を確認した）。
  - `is_irregular` は、期の日数が 358〜371 日の外のとき真。
- `public.financial_metrics_from_periods(jsonb)`: 算出の核。
  - 期の配列だけを受け取る純粋な関数で、出典の項目は無視する。
  - 理由の優先順位を持つ。値は小数点以下10桁に丸める。
- `public.recalculate_financial_metrics(text[])` と、`financial_statements` の insert・update・delete の文単位トリガー
  - 同じトランザクションの中で `financial_metrics` を計算し直す。
  - 通期実績がすべて無くなった銘柄は、指標の行を削除する。
- `financial_metrics` の拡張
  - 生成列 `*_display_pct`（百分率の小数点以下1桁に切り捨て）
  - FY-4 の終了日、連続する期の数、基準の混在、FY0 の終了日、期の数
  - 理由コードの制約と、部分索引（`revenue_cagr`、`operating_margin`）
- `public.financial_fetched_dates`（取得済みの開示日）
- `save_financial_statements`: 開示日ごとに、保存と取得済みの記録を1トランザクションで行う。値が変わったときだけ上書きする。
- `financials_ingestion_state`
- `financial_metrics_summary()`: authenticated が実行でき、security invoker。

### 取り込み（`src/lib/ingestion/`）
- `financials.ts`（target `financials`）
  - 最初に取引カレンダーを取り、営業日だけを要求する。取れなければ平日で代用する。
  - 処理の順は、直近7日の営業日（毎回取り直す）→ 未取得の日（新しい順）。
  - 要求の間隔は、前の要求の開始から 1,100ms。期限は 210 秒。
  - 開示日ごとの失敗が5回続いたら打ち切る。
  - `details` に件数と状態を記録する。
- `jquants/fins-summary.ts`: 通期の決算短信の選別と検証。非連結の短信は、項目ごとに `NC*` で代用する。
- `jquants/calendar.ts`
- `jquants/http.ts`: J-Quants の応答の分類を共通化した。`bars-daily.ts` もこれを使う。
- `financials-period.ts`: 日付の計算。
- `cron.ts`: Cron の共通の処理。
- `schedule.ts` の `CRON_JOBS` と `vercel.json`: 定期実行を2つにした。
- `runner.ts`: 対象に `financials` を加えた。
- `errors.ts` と `result-message.ts`: 財務の文言を加えた。

### ルート
- `GET /api/cron/financials`（新規）と、HEAD の 405
- `GET /api/financials?code=`（新規）
- `GET /api/stocks`: 指標の8項目を加えた（`revenue_cagr_mixed_basis` を含む）。
- `GET /api/ingestion`: `cron.schedules` を加えた。

### 画面（`/imports`）
- 手動取り込みの対象に「財務（決算短信）」を加えた（3列）。
- 定期実行の表示を2行にした。
- 独立した区画「銘柄コードで確認」を追加した（`code-lookup.tsx`、`code-lookup-form.tsx`）。
  - 正規化したコードの URL に移る（m2）。
  - 推定上場年数のカードは、項目名を値の上に置き、折り返さないようにした（m3）。
  - 財務のカード（`financial-card.tsx`）を並べた。
- 区画「財務指標」（`financial-metrics-panel.tsx`）を追加した。
- 要約の共通の部品（`summary-tile.tsx`）を作った。値を右端にそろえる（m1）。

### テスト
- Vitest（263件）
  - `fins-summary.test.ts`、`calendar.test.ts`、`financials-period.test.ts`、`financials/display.test.ts`
  - Cron のルート、結果の文言、定期実行の設定の照合
- test:db（82件）
  - `financials/financial-metrics.db.test.ts`: C3・C4・C12、R7、R2
  - `ingestion/financials.db.test.ts`: C5-1〜12
- E2E（114件）
  - `e2e/financials.spec.ts` を追加した。
  - `listing-dates.spec.ts` は、区画を移したことに合わせて、場所の指定だけを直した。
  - `ingestion.spec.ts` は、`cron.schedules` と、財務が未対応の対象でなくなったことに合わせて直した。
  - `dashboard.spec.ts` は、`financial_metrics` への直接の投入をやめ、同じ件数になる通期実績の投入に直した（指標は DB が導く値になったため）。
  - `db-privileges.spec.ts` に、新しいテーブル・ビュー・関数を加えた。

### その他
- CLAUDE.md を更新した。

## 起動方法
```bash
pnpm install && pnpm db:start && pnpm db:reset && pnpm env:local && pnpm seed:users
# キーなし（.env に有効なキーがあるため、空の値で上書きする）
JQUANTS_API_KEY= CRON_SECRET=local-cron-secret-0123456789 pnpm dev -p 3100
# 本番相当: pnpm build && JQUANTS_API_KEY= CRON_SECRET=local-cron-secret-0123456789 pnpm start -p 3100
# キーあり（.env の JQUANTS_API_KEY を使う）: CRON_SECRET=local-cron-secret-0123456789 pnpm start -p 3100
# E2E（キーなしのサーバーを先に起動しておく）: 上のサーバーを CRON_SECRET=e2e-local-cron-secret-0123456789 で起動して E2E_PORT=3100 pnpm test:e2e
```
- http://localhost:3100（`owner@quantis.local` / `Quantis-Owner-2026!`）
- **重要**: リポジトリ直下の `.env`（git 管理外。19:30 に作成されている。ジェネレーターは作っていない）に、有効な `JQUANTS_API_KEY` がある。
  - 何も付けずに起動すると「キーあり」になる。
  - E2E の自動起動（`pnpm dev`）も同じくキーありになり、キー未設定を前提にしたテストはスキップされる。
  - キーなしで確かめるときは、`JQUANTS_API_KEY=` を付けて起動する。

## コマンドの結果（2026-09-24）
| コマンド | 結果 |
|---|---|
| `pnpm lint` / `pnpm typecheck` | 成功 |
| `pnpm test` | 263 件成功 |
| `pnpm test:db`（`db:reset` 直後） | 82 件成功 |
| `pnpm build` | 成功 |
| `E2E_PORT=3100 pnpm test:e2e`（キーなしの dev を先に起動） | 114 件成功 |
| `E2E_PORT=3100 pnpm test:e2e`（キーなしの `pnpm start`） | 114 件成功 |

- 性能（C12、test:db の出力）
  - 24,000 行の投入（トリガー込み）: 547ms
  - 絞り込み: 0.52ms
  - 要約: 4ms
  - 1日分の保存（300 行）: 71ms
- E2E の後の DB は、市場データ・実行履歴・取得済みの開示日のすべてが0件だった。

## 完了条件チェック
| 条件 | 状態 | 確認方法 |
|---|---|---|
| C1-1〜5 表示（41.4%、期間、表、12.0%、切り捨て 19.9%・-1.1%、百万円） | ✅ | E2E（投入例）、test:db、スクリーンショット |
| C2-1〜6 算出不可の理由、未取り込み、時計のずれ、FY0 が 0・負、売上高の開示なし | ✅ | E2E（`simulateServerClockBehind` で pageerror 0件）、test:db |
| C3-1〜7 直近5期のみ、訂正の選び方（空欄の項目を含む）、制約、トリガー、出典に依存しない核 | ✅ | test:db、E2E（訂正あり） |
| C4-1〜7 算出ロジックの自動テスト | ✅ | test:db（境界 357/358/364/365/366/371/372、連続、優先順位、丸めの一致、混在、営業利益率） |
| C5-1〜12 取り込みの結合テスト | ✅ | test:db（fetch と時計だけを差し替え） |
| C6-1〜5 API | ✅ | E2E、Vitest、db-privileges（公開キーでの REST、authenticated は書き込み不可） |
| C7-1〜3 キーなしの手動取り込み | ✅ | E2E（キーボードで3つ目を選ぶ、履歴、実行中は変更不可） |
| C8-1・2 無効なキーで実 API | ✅ | `pnpm start` を `JQUANTS_API_KEY=qa-dummy-key-7f3a9c` で起動した。`/api/cron/financials` は 0.2 秒で失敗した（`apiCalls: 1`、HTTP 403 の文言）。`financial_statements` と `financial_fetched_dates` は0件。ログにキーは0件 |
| C9-1〜6 Cron（財務） | ✅ | E2E、Vitest、`schedule.test.ts` |
| C10-1〜3 ダッシュボード | ✅ | E2E（7 / 8 → 6 / 8、内訳は 3・6 → 2） |
| C11 キーあり | ✅（実データで確認） | 下記 |
| C12 性能 | ✅ | test:db（上の数値） |
| C13 デザイン | ✅（目視） | ライト 1280px、ダーク 375px、実データのスクリーンショット。`scrollWidth` は 1280 と 375。算出不可はアイコンと文字、変則決算はアイコン付きのバッジ。色は既存のトークン |
| C14-1〜4 m1〜m3 | ✅ | E2E（` 99991 ` → `?code=99991`、`8697` → `?code=86970`）、目視 |
| C15-1〜9 | ✅ | 上のコマンド。`.next/static` に `fins/summary`・`markets/calendar`・フィクスチャの値は含まれない。コミットは下記 |

### C11（キーあり）の実測（`.env` の有効なキーで、本番ビルドに Cron を送った）
- 銘柄マスタは 3,710 件だった。株価の初出日も1回走った（一部失敗、3,050 銘柄。Sprint 4 の C10 の一部も実データで動いた）。
- 財務の実行の結果
  - 1回目: 一部失敗。`apiCalls` 190、429 は0回、`calendar: "jquants"`
  - 2回目〜8回目: 各 189〜191 回
  - 8回目: `datesRemaining = 0` で成功
  - 9回目: 要求は3回（カレンダーと、直近の営業日2日。09-21〜23 は祝日の区分 3）で、成功。処理件数は 0
- 保存した通期実績は 3,683 銘柄だった。
  - 売上CAGR を算出できた銘柄: 3,251
  - 営業利益率を算出できた銘柄: 3,559
  - CAGR 20% 以上かつ営業利益率 10% 以上: 121 銘柄
  - 基準の混在: 247 銘柄
- 算出不可の内訳
  - 売上CAGR: 5期未満 323、変則決算 75、連続していない 19、売上高の開示なし 15
  - 営業利益率: 営業利益の開示なし 109、売上高の開示なし 13、売上高が0以下 2
- 日本取引所グループ（86970、IFRS）
  - 通期実績の表の値: 2022/03期〜2026/03期の売上高は 135,432 → 198,735 百万円、営業利益は 116,289 百万円
  - これを手計算すると、CAGR は (198,735/135,432)^(1/4) − 1 = 10.06%、営業利益率は 58.5%
  - 画面の表示: CAGR `10.0%`（切り捨て）、営業利益率 `58.5%`
  - 決算短信の値との照合は、J-Quants の応答（`code=86970`）とで行った。PDF の決算短信とは照合していない。
- 実データで確かめた、公式に記載の無い点
  - 非連結の短信の値は `Sales`・`OP` に入っていた（2025-05-14 の非連結の通期 46 件のすべてで `NCSales` が空）。
  - 金額の単位は円（JPX の営業収益が 162,230,000,000）。
  - 祝日の `date=` は、200 で `{"data": []}` だった。
  - 開示の多い日（2025-05-14、654 行）でも、ページ送りは無かった。
  - 取引カレンダーは、6年分（2,192 日）が1回で返った。
  - `DiscTime` は `12:00` の形（秒なし）もあった。
  - 訂正の開示で営業利益や売上高が空欄になる例が4件あった。この対応は R2 として実装した。
- 後片付け: 実データはすべて `pnpm db:reset` で消した（スクリーンショットはスクラッチパッドにだけ置いた）。

## 既知の問題・未実装
- `.env` の有効なキーのため、評価環境でも、何も付けずに起動するとキーありになる。
  - キーなしの完了条件は、`JQUANTS_API_KEY=` を付けて起動して確かめてほしい（契約の第3章に追記した）。
  - キーありで Cron や手動取り込みを押すと、実際の J-Quants に要求が飛ぶ（1回で約190回、約3.5分）。
- 上場から約4年未満の銘柄は、決算短信だけでは必ず「5期未満」になる。仕様の改訂2のとおり、F15（Sprint 9）で補う。
- 期の変更で FY0 が変則決算の銘柄も、営業利益率は算出する（仕様どおり）。表には「変則決算」の印が付く。
- `financial_periods` の訂正の空欄の埋め方について
  - 「訂正で本当に値を取り消した」場合も、以前の値が残る。
  - 実データでは、この区別ができない（公式に訂正のフラグは無い）。
- 取得範囲より古い開示の削除と、7日より前の開示日の定期的な取り直しはしていない（第9章）。
- dev と prod のサーバーのログに `Error: The destination stream closed early.` が1〜3回出た。Sprint 4 の m5 と同じく、E2E がストリーミング中にページを閉じたとき（`cross_origin` の文言のテストなど）に出るもので、ブラウザ側のエラーは0件だった。
- 1280px では「基準日: なし（株価の取り込み実績がありません）」の要約のタイルで、値が2行に折り返す（崩れではない）。

## エバリュエーターに重点的に見てほしい点
- 出典に依存しない3層の設計（仕様の改訂2、C3-7）が、Sprint 9 の追加に十分か。
- 理由の優先順位と、追加した2つの理由（売上高の開示なし、直近期の売上高がマイナス）の妥当性。
- 訂正の空欄を項目ごとに埋める扱い（R2 の実測を受けた追加）。
- キーなしの確認では、`.env` のキーを空の値で上書きして起動すること。
