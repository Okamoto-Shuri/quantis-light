# Sprint 12 自己評価（ラウンド 1）

契約: `docs/harness/sprints/sprint-12/contract.md`（改訂1。再レビューで承認済み）。

## ユーザーの決定（第2章の ★）

- ★1（AC11.5）: 「銘柄単位の整合＋注記」で承認された。レビューの追加案の「未取得の残り」の注記を実装した（`ingestion-remaining-note`）。行ごとの「今回更新」の印は任意なので付けていない。
- ★2（AC11.3）: 取り込み対象ごとの判定で承認された（R3 の修正込み）。stale の行は `last_progress_at` で数える。
- 再レビューの注意1〜3 も反映した。
  1. `failed` で残りが NULL の実行は判定に使わない（`data_freshness`、E2E の C5 で確認）。
  2. 1280 幅の高さを、第2章の4でも「3行以内」にそろえた。
  3. 4 target すべてが古い状態の 375px で、`<details>` が閉じている（E2E で確認）。

## 実装内容

### DB（マイグレーション `supabase/migrations/20261005000000_ingestion_reliability.sql`）

- `ingestion_runs` に5つの列を追加した: `stopped_reason`・`remaining_count`・`remaining_unit`・`failed_count`・`last_progress_at`。鮮度の判定用の索引も追加した。
- 新しいテーブル `ingestion_run_failures` を作った。
  - RLS は許可ユーザーの select だけ。書き込みは `finish_ingestion_run(…, p_outcome)` 経由で、1実行 1,000 行まで。
- `stocks.delisted_on` を追加した。
- `last_progress_at` の更新: 保存の関数が書く5つの表（`stock_listing_dates`・`financial_fetched_dates`・`edinet_list_fetched_dates`・`annual_report_extractions`・`business_results_extractions`）に、文単位のトリガー `private.touch_ingestion_progress` を付けた。
- 関数の変更:
  - `start_ingestion_run`: stale の後片付けで、処理済みがあれば `partial`（`stale`）にする。0件なら旧い文言の `failed`。
  - `finish_ingestion_run`: `p_outcome` を加えた。
  - `complete_stock_master_run`: 上場廃止の確認・再上場・100 を超えるときの保留を加えた。
  - `listing_dates_pending`・`edinet_ingestion_state`: 上場廃止の銘柄を除く。
  - `screening_evaluate`: `is_delisted` を加えた。
  - `screen_stocks`: 上場廃止を除く。`stockCount` は上場中の数、`delistedCount` を追加。
  - `stock_detail`: `delisted_on` と `evaluation.delisted` を加えた。
  - `screening_filter_options`: 上場廃止を数えない。
  - `dashboard_summary`: `delistedCount` を追加。
  - `data_freshness(p_now)` を新規に作った。

### 取り込み（`src/lib/ingestion/`）

- `pacer.ts`（新規）: 要求の間隔・期限・制限の応答（429・503）での待機と再試行を行う。株価・財務・カレンダー・銘柄マスタ・EDINET のすべての要求がここを通る。
- `failures.ts`（新規）: 失敗の記録（`FailureLog`、1,000 件まで）と、文言の1か所（`failureMessage`）。
- `finish.ts`: 実行の終わり方（打ち切りの理由・残り・失敗）を渡すようにした。
- `listing-dates.ts`: 失敗の行・5回続けての失敗での打ち切り・残りの銘柄・再試行を加えた。
- `financials.ts`: 開示日の失敗の行・残りの開示日・再試行を加えた。
- `edinet-reports.ts`: 書類一覧の日・書類の失敗の行・残り（一覧の日 → 書類）・503/429 の再試行を加えた。`details.failedDocuments` は廃止した。
- `runner.ts`: 銘柄マスタの要求を `requestJQuants` と再試行に変えた。上場廃止を保留したときは `partial` を返す。
- `jquants/http.ts`・`edinet/http.ts`: `Retry-After`（秒の整数だけ）を読む。
- `runs.ts`: 一部完了・一部失敗の規則（`partialKindOf`）、残りの表示、中断の理由の文言、API の新しい項目。
- `freshness.ts`（新規）: `data_freshness` の読み出し。失敗したら null を返す。
- `run-detail.ts`（新規）: 実行の詳細の読み出しと API の形。

### 画面・API

- 鮮度の警告: `components/shell/stale-data-warning.tsx`・`stale-data-targets.tsx`。`ProtectedShell` に置いた。
- 実行履歴: 「開始」の日時を詳細へのリンクにした。バッジの一部完了・一部失敗、残りと失敗の件数を表示する（`run-history.tsx`・`run-status-badge.tsx`）。
- 実行の詳細 `/imports/runs/[id]`（page・not-found）と `GET /api/ingestion/runs/[id]`。
- スクリーニング: 実行中の注記、未取得の残りの注記、上場廃止の注記。
- 銘柄詳細: 上場廃止のラベル、「含まれない（上場廃止）」、実行中の注記。
- ダッシュボード: 「うち上場廃止 N 銘柄」と「データの鮮度を確認できませんでした」。API に `freshness` と `delistedCount` を加えた。

### 持ち越し

- m2: `results-table.tsx`
- m3: `owner-override.tsx`
- m6: `lib/ownership/override.ts` の `apiOverrideResponse`・`OverrideShapeError`
- m5: `vitest.db.config.mts` の `reporters: ["verbose"]`
- m1・E2E の手順: CLAUDE.md

### テスト

- 単体テスト（新規）: `pacer.test.ts`・`failures.test.ts`・`runs.test.ts`・`run-detail.test.ts`・`stale-warning.test.ts`・`ownership/override.test.ts`
- 単体テスト（追加）: `result-message.test.ts`・`dashboard/summary.test.ts`
- DB（新規）: `ingestion-reliability.db.test.ts`（取り込みの結合 9件）、`ingestion-consistency.db.test.ts`（整合・鮮度・上場廃止・性能 10件）
- DB（追加）: `edinet-reports.db.test.ts` に2件（書類の残り、503 からの回復）、`financials.db.test.ts` に列と失敗の行の検査
- E2E: `e2e/ingestion-reliability.spec.ts`（13件）。投入例は `e2e/fixtures/ingestion-reliability-example.sql`・`ingestion-reliability-cleanup.sql`

## 起動方法

```bash
pnpm install && pnpm db:start && pnpm db:reset && pnpm env:local && pnpm seed:users
JQUANTS_API_KEY= EDINET_API_KEY= CRON_SECRET=local-cron-secret-0123456789 pnpm dev -p 3100
# 本番相当（全件の E2E の標準）
pnpm build && JQUANTS_API_KEY= EDINET_API_KEY= CRON_SECRET=local-cron-secret-0123456789 pnpm start -p 3100
E2E_PORT=3100 E2E_CRON_SECRET=local-cron-secret-0123456789 pnpm test:e2e
```

投入例: `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f e2e/fixtures/ingestion-reliability-example.sql`

## 完了条件チェック

| 条件 | 状態 | 確認方法 |
|---|---|---|
| C1-1 株価の再開 | ✅ | test:db `ingestion-reliability.db.test.ts`。期限で4銘柄 → 一部完了・残り6。2回目は残りの6銘柄だけを要求した |
| C1-2 財務の再開 | ✅ | test:db `financials.db.test.ts` の C5-1（列 `time_budget`・`disclosure_dates`）と、既存の C5-2（取得済みを要求しない） |
| C1-3 EDINET の再開 | ✅ | test:db `edinet-reports.db.test.ts`。一覧の途中は `list_dates` 431。本文の途中は `documents`。2回目は処理済みを要求しない |
| C1-4 応答の無い実行 | ✅ | E2E（今すぐ取り込み → `partial`・`stale`・一部完了、`last_progress_at` は不変。0件は旧い文言で完全一致）と test:db |
| C1-5 実行履歴の表示 | ✅ | E2E。A〜E・列の無い行・375px のカード。見出しは7列のまま |
| C1-6 結果の文言 | ✅ | 単体テスト `result-message.test.ts` |
| C2-1・C2-5 銘柄の失敗・本文を残さない | ✅ | test:db。500 とタイムアウトの行。目印の文字列・キーは含まれない。2回目は2銘柄だけ |
| C2-2 続けての失敗 | ✅ | test:db。5件で打ち切り。成功を挟んだ場合は打ち切らない |
| C2-3 開示日の失敗の行 | ✅ | test:db `financials.db.test.ts` の C5-7 |
| C2-4 EDINET の失敗の行・`failedDocuments` の廃止 | ✅ | test:db `edinet-reports.db.test.ts`（書類4種の行・`code`）。一覧の日の行は `edinetFailure` で作り、E2E の投入例 D で表示を確認した |
| C2-6 1,000 件の上限 | ✅ | 単体テスト（`FailureLog`）と test:db（1,200 件を渡すと行は 1,000） |
| C2-7〜C2-10 詳細の画面・API・404 | ✅ | E2E（`aria-current`、コードのリンク、`invalid_id`・`not_found`・401・`no-store`、404 の画面、未ログインは `/login?next=`） |
| C3-1〜C3-4 株価の再試行 | ✅ | 単体テスト `pacer.test.ts` と test:db（15・30 秒、間隔 1,200ms、4回で打ち切り、Retry-After 7・600→120、期限を超えるなら待たない） |
| C3-5 ほかの API の再試行 | ✅ | test:db。財務（429×4 → 打ち切り）、銘柄マスタ（回復と打ち切り）、EDINET（429 → 打ち切り、503×2 → 回復） |
| C3-6 既存の間隔のテスト | ✅ | test:db（既存のまま成功） |
| C3-7 制限の表示 | ✅ | E2E（C: 「4 回（3 回再試行、待機 合計 1分45秒）。解消しなかったため中断しました」、A: 「当たっていません」・362 回） |
| C4-1〜C4-6 鮮度の警告 | ✅ | E2E。0件・47:59・48h・全画面（404・詳細を含む）・ログイン画面なし・partial と failed・複数の target・リンク・API |
| C4-7 境界 | ✅ | test:db（`p_now` で 47:59:59.999 と 48:00:00） |
| C4-8 幅と高さ | ✅ | E2E。1280 で 3行以内（≤84px）、375px で 4行以内（≤104px）で横スクロールなし。4 target でも `<details>` が閉じている |
| C4-9 既存の E2E（警告あり） | ⚠️ | 下の「R4 の記録」。警告による表示の崩れは無い。失敗した3件は、実験の方法（実行の行を1行足した）が既存の件数の検査に数えられたため |
| C4-10 R3 | ✅ | test:db（3日前に保存した stale の行は、後片付けの後も3日前として数え、警告は消えない。NULL の行は数えない） |
| C4-11 R5 | ✅ | 単体テスト `stale-warning.test.ts`（失敗・例外・形の違いで null）と `dashboard/summary.test.ts`（`freshness: null`）。画面の「確認できませんでした」は `freshness-panel.tsx` |
| C5-1 保存と再計算の整合 | ✅ | test:db `ingestion-consistency.db.test.ts`。5つの関数それぞれ、コミット前は保存前の値、コミット後はそろった値（取り下げで補完が外れる経路を含む） |
| C5-2〜C5-6 注記 | ✅ | E2E（実行中の注記、応答なし・終了済みでは出ない、残りの注記、failed の実行を飛ばす） |
| C6-1〜C6-3 銘柄マスタの上場廃止 | ✅ | test:db（消えた・対象外・再上場・101 で保留・100 で反映） |
| C6-4・C6-5 | ✅ | test:db（初出日・EDINET の対象から外れる。補正は残り、再上場で使われる） |
| C6-6〜C6-9 画面・API | ✅ | E2E |
| C7 性能 | ✅ | test:db（実測は下） |
| C8-1 m2・C8-2 m3 | ✅ | E2E |
| C8-3 m6 | ✅ | 単体テスト `ownership/override.test.ts` |
| C8-4 m5 | ✅ | test:db の出力に `[perf]`・`[性能]` の行が出る |
| C8-5 m1・C8-6 E2E の手順 | ✅ | CLAUDE.md |
| C9-1 コントラスト | ✅（目視） | 既存のトークン（`caution`・`info`・`destructive`）の組み合わせだけを使った。ライトで目視確認。ダークは計測していない |
| C9-2 時計のずれ | ✅ | E2E（dev と本番相当の両方で成功） |
| C9-3 表の幅 | ✅ | E2E（1280 で詳細の表の枠の scrollWidth ≤ clientWidth、375px でページの横スクロールなし） |
| C9-4・C9-5 | ✅ | 画面は読むだけ（書き込み無し）。E2E の `collectPageProblems` で0件 |
| C10-2〜C10-4 リグレッション・品質 | ✅ | lint・typecheck・test（526件）・test:db（218件、15 ファイル）・build が成功。E2E は本番相当で 250/250。dev で時計のずれを含む4ファイルは 69/69 |
| C10-5〜C10-8 | ✅ | 後片付けは自分の接頭辞だけ（E2E・test:db の後に DB は0件）。CLAUDE.md とコミット |

### 性能の実測値（`pnpm test:db`、開発機）

- `screen_stocks`（4,000 銘柄・上場廃止 200・既定の4条件・`sort=owner`）: 中央値 21.4ms（基準 100ms）
- `data_freshness()`（実行履歴 5,000 行）: 7.7ms（基準 20ms）
- 実行の詳細の読み出し（失敗 1,000 行）: 3.6ms（基準 100ms）
- 既存の性能テスト（同じ実行）:
  - Sprint 11: スクリーニング 既定 24.6ms・オーナー系合計の順 74.0ms、詳細 3.8ms
  - Sprint 6: 既定 20.6ms・最大 48.3ms

### R4 の記録（固定日時の投入例で、警告のある状態の全件の E2E）

- 方法: 固定日時の3つの投入例（`screening-example.sql`・`ownership-example.sql`・`business-results-example.sql`）の末尾に、72 時間前に終わった銘柄マスタの成功の実行を1行、一時的に足した（コミットしていない。実行後に `git checkout` で戻した）。
  - 投入例の株価の実行の日時（2026-09-24 20:03 JST）を直接古くすると、基準日（株価の成功の最新の日付）が変わる。すると、警告とは関係の無い上場年数の期待値が壊れる。そのため、基準日を保ったまま警告を出す方法にした。
- 結果（本番相当のサーバー）: 250 件中 242 件が成功、3 件が失敗した（`e2e-r4` の実行）。
- 失敗した3件は、どれも警告のある画面の検査を通った後の、最後の行の DB の検査で落ちた。
  - 対象: `business-results.spec.ts:453`・`screening.spec.ts:448`・`stock-detail.spec.ts:650`
  - 落ちた検査: 「`target <> 'daily_quotes'` の実行が0件」
  - 足した銘柄マスタの実行の行が数えられたためで、警告の表示とは関係が無い。
- 警告の影響が最も出やすい `screening.spec.ts` の 1280×800・375×812 の `toBeInViewport` の2件は成功した。
- 2026-09-26 20:03 JST 以降の実際の状態では、株価の実行そのものが古くなるので、この件数の検査は落ちない（行が増えないため）。

### C10-1: 変えた既存のテストのアサーション

| ファイル | 変更 | 種類 |
|---|---|---|
| `src/lib/ingestion/listing-dates.db.test.ts` C4-1 | `details` の完全一致に `rateLimit: {hits:0,…}` を追加 | 5 |
| 同 C4-7 | 要求: 99992 を1回 → 4回（再試行3回）。文言: 「…しばらくしてから再実行してください。残り 3 銘柄…」→「…3 回待って再試行しましたが解消しなかったため中断しました。残り 3 銘柄…」。`rateLimit` の検査を追加 | 1 |
| `src/lib/ingestion/financials.db.test.ts` C5-6 | 要求の列: 2026-09-18 を1回 → 4回。文言の正規表現: 「しばらくしてから再実行してください」→「3 回待って再試行しましたが解消しなかったため中断しました」 | 1 |
| `src/lib/ingestion/edinet-reports.db.test.ts`（本文の取得の失敗） | `details.failedDocuments` の配列の検査 → `failedDocuments` が無いことと、失敗の行（`ingestion_run_failures`）4行の検査 | 2 |
| 同（一覧で HTTP 429） | 文言: 「…しばらくしてから再実行してください」→「…3 回待って再試行しましたが解消しなかったため中断しました」。要求の数: 1 → 4（429 のときだけ） | 1 |
| `src/lib/ingestion/stock-master.db.test.ts`（成功） | `details` の完全一致に `apiCalls`・`rateLimit`・`delistedDetected`・`relisted`・`delistingHeld` を追加 | 5 |
| `src/lib/stocks/stock-detail.db.test.ts`（年数） | `stock` の完全一致に `delisted_on: null` を追加 | 5 |
| `src/lib/dashboard/summary.test.ts` | `SUMMARY` に `delistedCount: 0`。期待値 `summary: SUMMARY` → `{ ...SUMMARY, freshness: null }` | 5 |
| `src/app/api/dashboard/route.test.ts` | 同上（`{ data: SUMMARY }` → `{ data: { ...SUMMARY, freshness: null } }`） | 5 |
| `src/app/api/stocks/[code]/route.test.ts` | 詳細の `stock` に `delisted_on: null`、`evaluation` に `delisted: false` を追加（2か所） | 5 |
| `e2e/db-privileges.spec.ts` | authenticated が実行できる関数に `data_freshness`、参照できるテーブルに `ingestion_run_failures` を追加。`finish_ingestion_run` の引数を `(…,jsonb)` → `(…,jsonb,jsonb)` に変更 | 5 |

- 種類3（「一部失敗」→「一部完了」）と種類4（stale の `failed` → `partial`）に当たる既存の期待値は無かった。既存のテストの行には新しい列が無く、「一部失敗」のまま通った。
- 既存のテストへのアサーションの**追加**（期待値の変更ではない）: `financials.db.test.ts`（C5-1 の列、C5-7 の失敗の行）、`edinet-reports.db.test.ts`（一覧の期限の列）。新しいテストも2件加えた。

## 既知の問題・未実装

- 関数が強制終了された実行（stale）では、失敗の行が欠ける。行は実行の終了時に保存するため。画面に注記している。
- 取り込み状況の「取り込み待ちの書類」（`annual_reports_summary` の数）には、上場廃止の銘柄の書類も含む。本文の取得の対象からは外している。
- 上場廃止の日付は「銘柄マスタで確認した日」で、J-Quants の上場廃止日ではない（契約の第8章のとおり）。
- 鮮度の警告はレイアウトに置いているので、クライアント遷移では更新されない（CLAUDE.md に記載）。
- 実 API（キーあり）では確認していない。429・503 の振る舞いは、差し替えた応答でだけ確かめた。J-Quants・EDINET が実際に `Retry-After` を返すかは未確認。
- ダークテーマでのコントラストは、計測していない（既存のトークンの組み合わせだけを使った）。
- 銘柄詳細の 404 の説明文「上場廃止などで一覧から外れた可能性があります」は残した。上場廃止の銘柄は 404 にならないが、銘柄マスタに一度も入っていないコードには当たりうるため。

## エバリュエーターに重点的に見てほしい点

- 鮮度の警告のある状態での既存の画面の崩れ。2026-09-26 20:03 JST 以降は、固定日時の投入例で警告が出る。
- 実行履歴の「開始」のリンク化と、「一部完了」「一部失敗」の区別。
- 上場廃止の銘柄が、スクリーニングのどの経路（件数・絞り込みの選択肢の数・API）にも出ないこと。
- `data_freshness` の残りの規則（`failed` で残りの無い実行を飛ばす）。
