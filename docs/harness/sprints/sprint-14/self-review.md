# Sprint 14 自己評価（ラウンド 1）

対象: 契約 `docs/harness/sprints/sprint-14/contract.md`（改訂2・承認済み）。F13 ウォッチリストと新規該当。スプリント計画の最後のスプリント（Sprint 15 はユーザーの決定により実施しない）。

## 実装内容

### DB（`supabase/migrations/20261007000000_watchlist_and_changes.sql`）
- **ウォッチリスト** `watchlist_items`（主キー (user_id, code)、`auth.users`・`stocks` への参照は削除で連鎖）。
  - 利用者のデータとして、RLS は4つの操作すべてで「本人かつ許可ユーザー」。authenticated に付ける権限は select・insert・update・delete だけ。
  - BEFORE トリガー `watchlist_items_before_write`（VOLATILE）:
    - `user_id` は NULL のときだけ `auth.uid()` を補う。`user_id`・`code` の変更は 42501。
    - `created_at` は固定、`updated_at` はメモが変わったときだけ新しくする。
    - メモは前後の空白を除き、空なら NULL。check は 1〜1,000 コードポイント。
    - 上限は 500 件（QW500）。ユーザーごとの advisory lock の後、**同じ (user_id, code) の行があれば上限の確認を飛ばす**（R1）。
- **比較の基準の記録** `screening_snapshots`・`screening_snapshot_stocks`。市場データと同じ RLS で、authenticated は select だけ。
  - 記録は `capture_screening_snapshot(run_id)`（service_role のみ）で行う。判定の入力を記録し、最新 7 回だけを残す。
- **`start_ingestion_run`**: `stock_master`・`cron` の実行の行を作れたときだけ、セーブポイントの中で記録する。
  - 失敗しても実行は始め、`details.snapshot` に `captured`（と `snapshotId`）か `failed` を、内側のブロックの外で書く（R2）。
  - `when others` は `query_canceled` を捕まえない。記録の日時は `now()` で、実行の開始と同じ。
- **終了の関数**（`finish_ingestion_run`・`complete_stock_master_run`）: `details` を置き換えるときに、`snapshot`・`snapshotId` だけを残す（`ingestion_run_kept_details`。開始時の値が勝つ。R5）。
- **判定の1か所**（R3）: `screening_evaluate(params, codes, snapshot_id)` が、条件ごとの状態に加えて `included`・`exclusion`・`blocking` を返す。
  - `exclusion` の優先順位: 上場廃止 → 絞り込み → 満たさない → 算出不可 → 判定不能。
  - 入力の行は `screening_evaluate_input(codes, snapshot_id)` から取り出す。分岐した方の表だけを読むので、記録を読めないときも今の判定は影響を受けない。
  - 状態の CASE 式・④の結果・分類は1つずつしか無い。
  - `screen_stocks` の結果と除外の件数、`stock_detail`、比較、ウォッチリストは、この分類を使う（式を持たない）。
- **`screening_rows(params, codes)`**: スクリーニングの行の表示の値。`screen_stocks` のページの行とウォッチリストで共有する。
- **`screening_changes(params)`**: 最新の記録と今のデータを、同じ条件と今の手動補正で比べる。
  - `status` は `ok`／`no_snapshot`／`empty_snapshot`。
  - 理由は `new_stock`・`relisted`・`delisted`・`missing`（どれもそれだけ）、`filters`、条件の変化（片方の `blocking` にだけある条件）。
- **`watchlist_entries(params)`**: 自分のウォッチリストの行・表示の値・判定。
- **件数の分母を上場中に**: `dashboard_summary`・`financial_metrics_summary`・`annual_reports_summary`・`business_results_summary`。
- **性能**: `owner_override_summary` を、本文を変えずに language sql から plpgsql にした。
  - `ownership_summary` の中から行ごとに呼ぶと、sql の本文が毎回計画し直され、ウォッチリスト 500 件で約 150ms かかっていた。変更後は約 80ms。

### アプリ
- ライブラリ:
  - `lib/watchlist/`: `memo.ts`、`entries.ts`、`queries.ts`、`api.ts`
  - `lib/screening/changes.ts`（形と文言）、`change-queries.ts`
  - `lib/screening/default-conditions.ts`（既定の条件の解決の1か所。m3 の注記）
  - `lib/stocks/detail.ts`（`describeInclusion` を DB の分類から作る。`detailInclusionKind` で判定不能を `unavailable` に。m7）
  - `lib/ingestion/runs.ts`（`runSnapshotStatus`）
- API:
  - `GET /api/watchlist`
  - `PUT`・`PATCH`・`DELETE /api/watchlist/[code]`
  - `GET /api/screening/changes`
  - `GET /api/screening`（`watchlisted`・`isNew`・`comparison`・`newCount` を追加）
  - `GET /api/stocks/[code]`（`watchlist` を追加）
- 画面:
  - `/watchlist`（ナビゲーションに追加）。`components/watchlist/`: `watchlist-view.tsx`・`watchlist-toggle.tsx`・`watchlist-detail-control.tsx`
  - ダッシュボードの区画「前回の取り込みからの変化」（`components/dashboard/screening-changes.tsx`）
  - スクリーニングの星・NEW（`components/screening/new-badge.tsx`）と `new-count-note`
  - 銘柄詳細の星と追加日
  - 実行の詳細の `run-snapshot-failed`
  - 既定のプリセットの注記 `default-preset-invalid-note`（`components/screening/default-preset-note.tsx`）
  - ダッシュボード・取り込み状況の分母の文言
- 持ち越し:
  - `preset-bar.tsx`（898 行）を5つのファイルに分けた。最大は `preset-bar.tsx` の 274 行。
  - m2: 確認のダイアログが閉じる途中の Esc で、管理のダイアログを閉じる（`closingEscape`）。
  - m1: Sprint 13 の契約の C2-6 と CLAUDE.md の文言を直した。
- CLAUDE.md を更新した。「現状」はスプリント計画の完了で、Sprint 15 は実施しない。

### テスト
- 単体テストを追加:
  - `lib/screening/changes.test.ts`
  - `lib/screening/default-conditions.test.ts`
  - `lib/watchlist/watchlist.test.ts`
- DB 込みのテストを追加:
  - `lib/watchlist/watchlist.db.test.ts`（7件）
  - `lib/screening/screening-changes.db.test.ts`（10件）
- E2E を追加:
  - `e2e/watchlist.spec.ts`（19件）
  - `e2e/screening-changes.spec.ts`（20件）
  - `e2e/db-privileges.spec.ts` に Sprint 14 の3件
- 投入例:
  - `e2e/fixtures/watchlist-example.sql`・`watchlist-cleanup.sql`
  - `e2e/fixtures/screening-changes-after.sql`・`screening-snapshots-cleanup.sql`

## 起動方法
```bash
pnpm install && pnpm db:start && pnpm db:reset && pnpm env:local && pnpm seed:users
JQUANTS_API_KEY= EDINET_API_KEY= CRON_SECRET=local-cron-secret-0123456789 pnpm dev -p 3100            # dev
pnpm build && JQUANTS_API_KEY= EDINET_API_KEY= CRON_SECRET=local-cron-secret-0123456789 pnpm start -p 3100   # 本番相当
```
- 画面: http://localhost:3100/ （変化）、`/watchlist`、`/screening`、`/stocks/9U011`
- 比較の基準の記録は、次のどちらかで作る。
  - `curl -H "Authorization: Bearer local-cron-secret-0123456789" http://localhost:3100/api/cron/daily`（キーなしでも記録される）
  - psql の `select public.capture_screening_snapshot();`

## 完了条件チェック

| 条件 | 状態 | 確認方法 |
|---|---|---|
| C1-1〜C1-9 追加・削除 | ✅ | E2E `watchlist.spec.ts` の C1 の7件。次のすべてを確かめた。<br>・キーボード（Enter・Space で切り替わり、フォーカスが残る）<br>・メモのある銘柄の確認のダイアログ（スクリーニングと詳細）<br>・上場廃止の銘柄の追加・削除<br>・API（201／200 の冪等、正規化、400・404、同時の PUT）<br>・上限（501 件目は 409、500 件で登録済みの PUT は 200 で行は変わらない。R1）<br>・`ingestion_runs` が増えない |
| C2-1〜C2-10 ウォッチリスト画面 | ✅ | E2E の C2 の8件。次のすべてを確かめた。<br>・ナビゲーションの5項目と `aria-current`<br>・4行の値・判定・追加日・2行のメモ<br>・手動補正<br>・メモの編集（Ctrl+Enter・Esc・フォーカスの戻り・全角空白で消す・「𠮷」1,000／1,001・XSS）<br>・確認して外す<br>・既定のプリセット<br>・API（既定を当てない、`owner=40`、400・404）<br>・空状態<br>・375px |
| C3-1〜C3-7 記録 | ✅ | E2E の C3 の5件と test:db（C3-4 の保持 7 回）。<br>記録されない経路: 手動・財務・EDINET・409・401。<br>C3-5 は、`check (false) not valid` で記録を実際に失敗させて確かめた（`details.snapshot = failed`、記録の数は変わらない、`run-snapshot-failed` が出る、`changes-cycle` は前回のまま）。制約は `finally` で外す |
| C4-1〜C4-9・C4-11・C4-12 | ✅ | E2E の C4 の7件。<br>・一覧と理由の表示・詳細へのリンク<br>・NEW と件数（条件ごと）<br>・既定のプリセット（厳しめ・グロースのみ）とスクリーニングの NEW の一致<br>・手動補正を両側に当てる（9U003・9U009）と owner2 の結果<br>・ウォッチリストの印<br>・51 件（「ほか 1 銘柄」、API は全件）<br>・今回の取り込みの未完了・実行中の注記<br>・時計のずれ（dev） |
| C4-10 理由の網羅 | ✅ | test:db の `screening-changes.db.test.ts`。次を確かめた。<br>・`new_stock`・`relisted`・`filters`・`cagr:unavailable>met`（含める設定では変化にならない）・`owner:unavailable>met`<br>・理由が2つ、`delisted` だけ、`relisted` だけ<br>・基準日の変化だけで `years:met>unmet`<br>・空の理由が無い<br>・`screen_stocks` の結果との一致 |
| C5-1〜C5-3・C5-6・C5-9〜C5-11 | ✅ | E2E。再ログイン、owner2 からは見えない・影響しない、anon の REST（テーブル・関数・記録）、未ログインの API は 401 で no-store、別のオリジンは 403、許可の取り消しで 403 |
| C5-4・C5-5・C5-7・C5-8 | ✅ | test:db の `watchlist.db.test.ts`（authenticated・JWT の claims で直接 SQL）。次のすべてを確かめた。<br>・他人の行は0行、他人の user_id の insert は拒否、省けば本人<br>・`user_id`・`code` の変更は拒否、日時は偽れない<br>・メモ（1,001 は拒否、前後の空白、空白だけは NULL）<br>・外部キー、501 件目、intruder |
| C6-1・C6-2 読めないとき | ✅ | E2E。revoke は `finally` で戻す。<br>・ウォッチリストはエラー、スクリーニングと詳細は描画を続ける（星は無効）、API は 500<br>・ウォッチリストを読めないとき、ダッシュボードは一覧を出し、星の印だけを出さない（m3）<br>・記録を読めないとき、ダッシュボードは `changes-error`、スクリーニングは `new-load-error`、ウォッチリストは `watchlist-change-error`、API は 500 |
| C7-1 DB と設計 | ✅ | test:db（17件）。次のすべてを確かめた。<br>・R1: 並行の insert（別の銘柄は1つだけ成功、同じ銘柄は両方成功して1行。ロックの待ちは `pg_stat_activity` で確かめた）<br>・R2・R5: 巻き戻すトランザクションで、記録の失敗と、2つの終了の関数でのキーの保持を確かめた<br>・R3: 128 通りの条件で3つの集合が一致し、除外の件数が変更前の定義と一致する。優先順位と `blocking` も確かめた<br>・記録を今と同じ値で作った直後は変化が無い<br>・連鎖<br>・R4: 記録0件の前提を冒頭で確かめる |
| C7-2 判定の1か所 | ✅（コードで確認） | 式が `screening_evaluate` の1か所だけにあることを確かめた。<br>・`screen_stocks` に `ok_a`・`ok_b` は無い<br>・記録の側は `screening_evaluate_input` の取り出し元と基準日だけを切り替える<br>・TypeScript は文言の対応だけ（`describeInclusion`・`watchlistInclusionText`・`changeReasonText`） |
| C7-3 | ✅ | ウォッチリスト・比較のコードは `admin.ts` を import しない。記録は `start_ingestion_run` の中だけ（アプリから記録の関数を呼ばない） |
| C7-4 権限 | ✅ | E2E `db-privileges.spec.ts`（27件すべて成功） |
| C8 性能 | ✅ | 実測（test:db、authenticated、中央値）は下の表 |
| C9-1〜C9-3 分母 | ✅ | E2E。上場廃止1件の投入例で「3」「ほかに上場廃止 1 銘柄」「上場中の 3 銘柄のうち」。上場廃止の無い投入例は 14 のまま。全銘柄が上場廃止でも空状態にしない |
| C9-4 m1 | ✅ | Sprint 13 の契約の C2-6 と改訂履歴、CLAUDE.md を直した |
| C9-5 m2 | ✅ | E2E。状態の表示が出た直後（0ms・100ms）の Esc 1回で、管理のダイアログが閉じる |
| C9-6 m3 | ✅ | E2E。範囲外（cagr）のプリセットで、ダッシュボード（「比較しています」）・詳細・ウォッチリストに注記。正規形でない形では「標準の形に直して判定しています」 |
| C9-7 preset-bar の分割 | ✅ | 5ファイルに分け、最大 274 行。`screening-presets.spec.ts` はそのまま成功 |
| C10-1 コントラスト | ✅ | ブラウザで実測した（ライト／ダーク）。<br>・NEW: 6.2／8.53<br>・変化の理由のチップ: 15.66／14.61<br>・該当の文言: 7.12〜17.3／11.1〜14.23<br>・外れたのバッジ: 5.18／5.99<br>・星の印: 5.97〜7.04／6.55〜11.78<br>・直近の取り込みの行: 5.97／6.55<br>色に加えて、形（塗りつぶし）と文字でも区別できる |
| C10-2・C10-3 レイアウト | ✅ | E2E。<br>・1280: 市場区分・注記がスクロールなしで見え、`results-scroll`・`watchlist-scroll` は横スクロールしない<br>・375: 4画面が横スクロールせず、確認のダイアログが収まる。スクリーニングの注記はスクロールなしで見える<br>ライト・ダーク、1280・375 のスクリーンショットも目視した |
| C10-4・C10-5 | ✅ | E2E の `collectPageProblems` は0件。星・メモ・比較の操作で `ingestion_runs` は増えない |
| C11-1 既存テストの変更 | ⚠️ | 下の一覧。5種類に当たらない変更が2件（単体テスト。R3 と API の項目の追加に伴うもの）。報告する |
| C11-2 リグレッション | ✅ | 全件の E2E が成功した |
| C11-3 | ✅ | lint（0件）、typecheck、`pnpm test` 559 件、`pnpm test:db` 251 件（18 ファイル）、build が成功 |
| C11-4 E2E | ✅ | 本番相当（キーなし、3100 番）で **326/326**（7.0 分）。<br>dev でも、時計のずれを含む spec を流した。9 ファイル・167 件で、途中で dev サーバーがメモリの閾値で再起動した（既知）1件を除き成功。その `stock-detail.spec.ts` は単独で 23/23 成功<br>E2E の後の DB は、市場データ・実行履歴・記録・ウォッチリスト・プリセットが0件。制約 `e2e_fail_snapshot` は無く、権限は元どおり |
| C11-5 | ✅ | 後片付けは自分の行だけ（接頭辞・fixture・テストが作った記録） |
| C11-6 コミット | ✅ | `sprint-14: ウォッチリストと新規該当`（sprint-13 の evaluation-1.md と sprint-14 の契約・レビューを含む） |
| C11-7 CLAUDE.md | ✅ | 現状（計画の完了、Sprint 15 は実施しない）、ウォッチリスト、比較の基準の記録（いつ記録するか・入力を残す理由・両側の条件と補正・最新 7 回）、分類、既定の条件の解決、API、分母、前提（E2E・test:db）、R2・R5、m1〜m3 を追記した |

### C8 性能の実測（`screening-changes.db.test.ts`。4,000 銘柄、authenticated、中央値）

| 項目 | 実測 | 上限 |
|---|---|---|
| 記録（4,000 銘柄） | 19.2ms | 1,000ms |
| `screening_changes`（変化 229 件） | 34.3ms | 150ms |
| スクリーニングの1回の表示（`screen_stocks`＋比較＋星） | 65.1ms | 250ms |
| ウォッチリスト 500 件 | 78.7ms | 150ms |
| `dashboard_summary` | 3.6ms | 50ms |
| 既存の `screen_stocks`（`screening.db.test.ts`） | 既定 28.6ms、3条件オフ 33〜36ms | 100ms |
| 既存の `screen_stocks`（`ownership*.db.test.ts`） | 既定 29〜32ms、オーナー系合計の順 46〜54ms | 100ms |

### C11-1 既存テストの変更の一覧

| 種類 | ファイル・行 | 前 → 後 |
|---|---|---|
| 1 | `e2e/db-privileges.spec.ts` | 次の許可リストに、Sprint 14 のテーブル・関数を足した。<br>・書き込めるテーブル: `watchlist_items` の DELETE・INSERT・UPDATE<br>・authenticated が実行できる関数: `screening_changes`・`screening_evaluate_input`・`screening_rows`・`watchlist_entries`<br>・service_role だけの関数: `capture_screening_snapshot`・`ingestion_run_kept_details`<br>・参照できるテーブル: `screening_snapshot_stocks`・`screening_snapshots`・`watchlist_items`<br>・security invoker の関数に上の4つ<br>既存の項目の値は変えていない。Sprint 14 の3件の test を追加した |
| 2 | `e2e/shell.spec.ts:16` | `NAV` に「ウォッチリスト」を追加 |
| 2 | `e2e/shell.spec.ts:29` | `/ウォッチリスト\|準備中\|近日公開/` が0件 → `/準備中\|近日公開/` が0件 |
| 2 | `e2e/shell.spec.ts:59` | 404 の確かめ先 `/watchlist` → `/watchlist/zzz`（`/watchlist` は実装済み）。テスト名の「4画面」を「5画面」に |
| 2（単体） | `src/lib/navigation.test.ts:7` | 4項目 → 「ウォッチリスト」を含む5項目 |
| 3 | `e2e/financials.spec.ts:152` | 「銘柄マスタ 8 銘柄のうち」→「上場中の 8 銘柄のうち」（値は同じ） |
| 3 | `e2e/ingestion-reliability.spec.ts:398` | 「うち上場廃止 1 銘柄」→「ほかに上場廃止 1 銘柄」 |
| 4 | `e2e/ingestion.spec.ts:70`・`e2e/listing-dates.spec.ts:58` | `afterEach` に `cleanupSnapshots()` を追加 |
| 5 | `e2e/{business-results,screening-detail-race,ownership-override,ownership,stock-detail,screening}.spec.ts` | `beforeAll` の `expectNoPresets()` の次に、`expectNoSnapshotsOrWatchlist()` を1行追加（`e2e/support.ts` に追加） |
| **5種類の外（報告）** | `src/lib/stocks/detail.test.ts:7〜40` | `describeInclusion` の引数を、状態（status・matchesFilters・included）から DB の分類（`exclusion`・`blocking`）に変えた（R3。TypeScript に式を持たない）。<br>期待する文言は同じ（「条件③を満たさないため…」「条件①・条件③を…」「条件①・条件②が算出不可のため…」）。判定不能の種類が `unavailable` のままであること（m7）の確認を足した |
| **5種類の外（報告）** | `src/app/api/stocks/[code]/route.test.ts:38・185〜188` | モックの DB の値に `exclusion: null, blocking: []` を足し、応答の `evaluation` の期待値に同じ2項目を足した（項目の追加。既存の値は変えていない） |

- m6（星のボタンによる Tab の順）: 既存の E2E の変更は要らなかった。星はコードのリンクの前にあり、Tab の順は「星 → コードのリンク」。

## 既知の問題・未実装
- **ウォッチリストの表の固定の列はコードだけ**（契約の第2章の4は「コード・社名の列は左に固定」）。
  - 375px では、コード（6.5rem）と社名（9rem）を両方固定すると、残りが約 110px になる。そのため、横スクロールしてもメモの「編集」ボタンが固定の列の下に隠れ、押せなかった（E2E で検出した）。
  - コードの列（星・コード）だけを固定した。社名はリンクとして次の列にある。
- 取り込み状況の株価の初出日の区画の「うち、データ期間開始以前から上場」の数は、上場廃止の銘柄も含めたまま。ビュー `stock_listing_ages` を PostgREST で上場中に絞れないため。
  - 分母の「上場中の銘柄」・「初出日が確定した銘柄」・「未確定」は、上場中だけにした。
- 星のボタンの読み上げの名前は `aria-label`（「ウォッチリストから外す: 9U001 …」）で、詳細のボタンの見える文字（「ウォッチリスト登録済み」）とは違う。状態は `aria-pressed` でも伝わる。
- dev サーバーは、E2E を長く流すとメモリの閾値で再起動することがある（既知。CLAUDE.md）。今回も1回起きた。本番相当では起きない。
- EDINET・J-Quants のキーが無い環境なので、実際の定期実行（キーあり）での記録と比較は確かめていない。
  - キーなしの定期実行で記録が作られることは確かめた。
  - キーありの終了の経路（`complete_stock_master_run`）でキーが残ることは、test:db で確かめた。

## エバリュエーターに重点的に見てほしい点
- C3-5（R2・R5）: 記録を実際に失敗させる経路。dev と本番相当の両方で、E2E `screening-changes.spec.ts` の C3-5 が成功する。
- R3: `screen_stocks` の除外の件数が、変更前の定義と一致すること。
  - test:db では、128 通りの条件で「変更前の式（ok_a・ok_b）で求めた値」と一致した。
  - 既存の `screening.spec.ts`・`ownership.spec.ts` の件数の期待値も、変えずに通っている。
- `start_ingestion_run` の 409（二重実行）と、応答の無い実行の後片付け（stale）のリグレッション。
  - 記録の呼び出しは、実行の行の insert の後に行う。
  - 後片付けの update は、今までどおり外側で先に行う。
  - `ingestion.spec.ts`・`ingestion-reliability.spec.ts`・`stock-master.db.test.ts` は成功している。
- `owner_override_summary` を plpgsql にしたこと（本文と結果は同じ。Sprint 11 の E2E・test:db は成功）。
- ウォッチリストの固定の列の変更（既知の問題の1つ目）。
