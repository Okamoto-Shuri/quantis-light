# Sprint 07 自己評価（ラウンド 1）

## 実装内容

### DB（`supabase/migrations/20260930000000_stock_detail.sql`）
- `public.screening_evaluate(p_params jsonb, p_codes text[])`（security invoker）: 条件①〜③の状態（met／unmet／unavailable／off）と、市場区分・業種の絞り込みに当てはまるか（`matches_filters`）。判定の式はここ1か所だけ（契約の第2章の2）。
- `public.screen_stocks(jsonb)`: `create or replace` で、判定を `screening_evaluate` に任せる形にした（応答の形と振る舞いは Sprint 6 のまま。Sprint 6 の結合テストと性能テスト（100ms）はそのまま通る）。
- `public.stock_detail(p_code text, p_params jsonb)`（security invoker）: 基本情報、初出日と表示用の年数（`listing_years_between`）、判定（状態・`matchesFilters`・`included`）を1回で返す。銘柄マスタに無ければ NULL。`included` は screen_stocks の「絞り込みに当てはまり、オンの条件に unmet が無く、算出不可を含めないときは unavailable も無い」と同じ。
- `listing_first_date_cutoff`: `p_max_years` を関数の側で 200 年に丸める（Sprint 6 評価の改善提案。アプリの上限 10.0 年より十分大きいので結果は変わらない）。
- 権限: anon は実行不可、authenticated と service_role だけ。`e2e/db-privileges.spec.ts` の許可リストと REST の検査に追加した。

### 画面・API
- `/stocks/[code]`（`src/app/(app)/stocks/[code]/page.tsx`・`not-found.tsx`、部品は `src/components/stocks/`）
  - パンくず、見出し（コード・社名・市場・業種・基準日）。
  - 条件の判定（`stock-evaluation.tsx`）: 判定の出どころ（スクリーニングの条件／既定の条件）、不正な項目の注記、結果に含まれるかの1行（第2章の2の表と優先順位）、条件ごとの閾値・値・印、市場・業種の絞り込み、「条件を変える」。
  - 指標（`stock-metrics.tsx`）: 売上CAGR（算出に使った期・取得済みの期数・連結と単体の混在・AC6.12 の注記）、営業利益率（FY0 の営業利益 ÷ 売上高）、推定上場年数（初出日 → 基準日、データ期間開始以前、未確定、基準日なし）。
  - 業績推移: グラフ（`financial-chart.tsx`。HTML と CSS だけの棒グラフ。負の値は 0 の線の下、データなし・開示なしを描き分ける、ホバーで期・系列・値）、5期の表（`period-tables.tsx`。想定の決算期つきの「データなし」、算出に使った期の線、変則決算・「開示2件（訂正あり）」の印、`title`／`data-yen` に円の保存値）、「保存済みの通期実績をすべて表示」。
  - コードの正規化とリダイレクト（クエリを保つ）、`notFound()`（保護画面の中、HTTP 404）、`generateMetadata` のタイトル。
- `GET /api/stocks/[code]`（`requireApiUser()`・`jsonNoStore`）: `stock`・`referenceDate`・`listing`・`metrics`・`periods`・`slots`・`evaluation`。400（invalid_code／invalid_params）・404・401・403・405。
- 5期の枠: `src/lib/stocks/slots.ts`（第2章の3・R2 の規則）。判定の条件と戻り先: `src/lib/stocks/detail.ts`。読み出し: `src/lib/stocks/queries.ts`。
- スクリーニング: 行を詳細へのリンクにした（コード・社名は `<a>`、行のほかの場所のクリック、⌘／Ctrl・中クリックで新しいタブ、リンクの上では二重に遷移しない）。リンクのクエリと条件の印は表示中の結果の条件から作る。
- ナビゲーション: 詳細（と「銘柄が見つかりません」）を開いている間だけ、「スクリーニング」の `href` をパンくずと同じ戻り先にする（`src/lib/navigation-href.ts`、`main-nav.tsx`。R3 の案 (a)）。
- 取り込み状況の「銘柄コードで確認」に「銘柄詳細を開く」。

### Sprint 6 評価の軽微な指摘
- m1: 「既定の条件に戻す」で条件パネルを作り直し、入力欄の不正な値とエラーを消す。
- m2: 算出不可の文言に `text-balance`、「データ期間開始以前」は折り返さない、売上CAGR・営業利益率・推定上場年数の列を少し広げた（7.25rem・7.25rem・7.5rem）。
- m3: 並べ替えの矢印を見出しの文字の最後にインラインで置く（右揃えの列でも文字の隣）。「推定上場年数（初出日）」は「（初出日）」の前で折り返す。
- m4: 条件パネルの市場区分・業種を上に移した。1280×800 で「市場区分」は y=183、AC6.12 の注記は y=517〜613（どちらもスクロールなしで見える）。
- m5: 条件の印の `title` とスクリーンリーダー用の文字は、結果の条件（サーバーが判定に使った閾値）から作る。
- 条件の印と AC6.12 の注記を `components/screening/status-mark.tsx`（フックを使わない部品）に移し、スクリーニングと詳細で共有した（Sprint 9 の差し替えは1か所）。
- CLAUDE.md の後片付けの接頭辞の説明を更新した。

### テスト
- `pnpm test`: `slots.test.ts`（5期ちょうど・6期・3期・欠け・変則決算・決算期変更の直後の欠け・2月決算とうるう年・20日締め）、`detail.test.ts`（結果に含まれるかの文言と優先順位、判定の条件と戻り先）、`navigation-href.test.ts`、`api/stocks/[code]/route.test.ts`（401・403・400・404・正規化・500）。
- `pnpm test:db`: `stock-detail.db.test.ts`
  - 判定の一致: 閾値・8通りのオン／オフ・算出不可を含める・5通りの市場と業種の組み合わせ、計 1,000 通り弱 × 14 銘柄。状態は投入値から求めた独立の参照実装と一致し、結果にある行では `screen_stocks` の `status` と一致する。`included` は `screen_stocks`（全件）の結果にあるかと一致する。
  - 年数が `stock_listing_ages` と一致すること、無いコードは NULL、許可リスト外は NULL、`listing_first_date_cutoff` の上限。
  - 5期の枠の連続の数が `revenue_cagr_period_count` と一致すること。
- E2E: `e2e/stock-detail.spec.ts`（23件。契約の C13-3 の対象をすべて含む）。

## 起動方法
```bash
pnpm db:reset && pnpm env:local && pnpm seed:users
JQUANTS_API_KEY= EDINET_API_KEY= CRON_SECRET=local-cron-secret-0123456789 pnpm dev -p 3100
# 本番相当: pnpm build && JQUANTS_API_KEY= EDINET_API_KEY= CRON_SECRET=local-cron-secret-0123456789 pnpm start -p 3100
```
- 投入例: `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f e2e/fixtures/screening-example.sql -f e2e/fixtures/stock-detail-example.sql`
- http://localhost:3100/screening → 行をクリック、または http://localhost:3100/stocks/99991

## 完了条件チェック
| 条件 | 状態 | 確認方法 |
|---|---|---|
| C1-1〜C1-5 スクリーニングから詳細へ | ✅ | E2E（社名・ほかのセル・Enter・⌘クリック・中クリック・戻る1回、ポインター、未ログイン → ログイン後に同じ URL、ナビゲーションの aria-current なし） |
| C2-1〜C2-7 基本情報・5期の表・グラフ | ✅ | E2E（7銘柄の5期の表と棒の値、データなし・開示なし・負の棒、変則決算・訂正、`title`／`data-yen` と `financial_periods` の照合、凡例・単位・ホバー・aria-label、すべての期の一覧、財務データなし）とスクリーンショット |
| C3-1〜C3-6 指標と算出に使った期 | ✅ | E2E（9銘柄の値・期間・理由・注記・「算出に使用」、基準日なし）、API と DB の一致は test:db |
| C4-1〜C4-10 判定 | ✅（C4-6 は下記の訂正あり） | E2E（14銘柄の状態と結果に含まれるか、スクリーニングの行から開いた判定、境界、オフ、絞り込み、不正な条件、`/api/screening` との一致、連結・単体の混在）、網羅は test:db |
| C5-1〜C5-6 見つからない銘柄 | ✅ | E2E（404 の状態コード・タイトル・コード、形の不正、リダイレクト、戻るリンクのクエリ、アプリ全体の 404、未ログイン） |
| C6-1 時計のずれ | ✅ | E2E（`simulateServerClockBehind` の下で notFound・redirect・クライアント遷移。pageerror とコンソールのエラーが0件）。C4-6 の E2E も同じ状態で実行 |
| C7-1〜C7-5 スクリーニングに戻る | ✅ | E2E（パンくず・条件を変える・戻る／進む・ヘッダーのナビゲーション・375px のドロワー・2ページ目、ほかの画面の href） |
| C8-1〜C8-8 API | ✅ | E2E と Route Handler の単体テスト。公開キーでの RPC は db-privileges.spec.ts。キーなしのサーバーで `ingestion_runs` が増えないことを E2E で確認。`src/app/(app)/stocks/`・`src/app/api/stocks/[code]/`・`src/lib/stocks/` は `lib/ingestion` を import しない |
| C9-1 取り込み状況からの導線 | ✅ | E2E |
| C10-1〜C10-5 自動テスト | ✅ | `pnpm test`（359件）・`pnpm test:db`（107件。Sprint 6 の性能テストを含む） |
| C11-1〜C11-5 デザイン | ✅ | スクリーンショット（1280×800 のライト、375×812 のダーク）。375px で `scrollWidth` 375、5期の表は枠の中でスクロール、グラフの5枠が収まる（E2E） |
| C12-1〜C12-6 Sprint 6 の軽微な指摘 | ✅ | E2E（m1、m3・m4・m5）、m2 はスクリーンショット（1280px・14銘柄・3条件オフ・算出不可を含める）で、最後の1〜2文字だけが落ちる行が無いことを目視 |
| C13-1 リグレッション | ✅ | E2E 157件すべて成功（dev）。詳細を開いた状態での許可の取り消しは、スクリプトで `/login?reason=revoked` に送られ、API が 401 になることを確認 |
| C13-2 lint・typecheck・test・test:db・build | ✅ | すべて成功 |
| C13-3 E2E | ✅ | `E2E_PORT=3100 pnpm test:e2e` 157件成功。stock-detail と screening の2ファイルは `pnpm start`（本番）に対しても 41件成功。実行後の DB は stocks 0・ingestion_runs 0 |
| C13-4 db-privileges | ✅ | E2E |
| C13-5 コンソールのエラー | ✅ | E2E の `collectPageProblems`（dev と本番） |
| C13-6 ダミーデータなし | ✅ | 投入例は `e2e/fixtures/` だけ |
| C13-7 CLAUDE.md | ✅ | 「現状」とアーキテクチャ（銘柄詳細、判定の共有、5期の枠、行のリンク、notFound）を追記 |
| C13-8 コミット | ✅ | `sprint-07: 銘柄詳細画面`（`docs/harness/sprints/sprint-06/evaluation-1.md` を含む） |

## 契約との違い・判断したこと（エバリュエーターに確かめてほしい）
1. **C4-6 の `years=99` は無効（契約の誤りを訂正）**: `THRESHOLDS` は値 × 10 の整数で範囲を持つので、`years` の範囲は 0.1〜10.0 年です。契約（と契約レビューの R1）の「`years=99` は有効」は、この単位を読み違えていました。Sprint 6 の E2E（C6-4）も `years=99` を無効として確かめています。範囲は変えず、`/stocks/99991?years=99` は「URL の条件の一部（years）が無効なため…」を出します（E2E で確認）。契約の第9章に「改訂2（実装時の訂正）」として書きました。`years=0`・`years=4.95` が無効であることは契約どおりです。
2. **既存の E2E の更新（表記の統一と新しいルート）**
   - `e2e/financials.spec.ts`: 「訂正あり（2件）」を「開示2件（訂正あり）」に替えました。訂正の開示（146.41 億円）が最新として選ばれることは、同じテストの `14,641` の確認がそのまま確かめています。加えて、`title`（「元の開示と訂正を合わせて2件。最新の開示の値を表示しています」）も確かめるようにしました（検査は弱めていません）。
   - `e2e/auth.spec.ts`・`e2e/shell.spec.ts`: Sprint 1 からアプリ全体の 404 の例に使っていた `/stocks/72030` が、Sprint 7 で銘柄詳細（銘柄マスタに無いので「銘柄が見つかりません」、404）になりました。auth の2件は見出しを「銘柄が見つかりません」に替え（アプリのレイアウトの中の 404 であることは同じ）、shell の時計のずれの検査はアプリ全体の 404 の例を `/stocks/72030/zzz` に替えました（「銘柄が見つかりません」の時計のずれの検査は stock-detail.spec.ts の C6 にあります）。
3. **`listing_first_date_cutoff` の上限**: 契約の第2章の9は「`THRESHOLDS.years.max` で丸める」でしたが、DB の関数がアプリの定数を知らないので、200 年を上限にしました（結果は変わらず、1,000,000,000 年でもエラーにならないことを test:db で確認）。
4. **グラフはライブラリを使わない**: HTML と CSS だけで描きました（依存を増やさない、サーバーで描画できる、文字が拡大縮小しない）。ホバーの表示も CSS だけです。フォーカスでの表示はありません（棒は `role="img"` の中の装飾で、数値の読み取りは表が代替）。
5. **条件パネルの並び**: m4 のため、市場区分・業種を条件①〜③の上に移しました（Sprint 6 の契約の並びから変わります）。

## 既知の問題・未実装
- 全体の E2E を3回流したうち1回だけ、`screening.spec.ts` の C6-1（未ログインの別のコンテキストからのログイン）が 30 秒の時間切れになりました。直後の単独の実行と、その後の全体の実行では成功し、再現しませんでした。今回の変更とは関係の無い箇所（ログイン画面の遷移）で、dev のコンパイルの待ちの可能性があります。
- 狭い画面のグラフの横軸は「21/03期」のように年を2桁にしています（1280px では「2021/03期」）。
- 5期の表の負の営業利益は赤系の文字（`text-destructive-strong`）にしています。グラフの負の棒は色を変えず、0 の線の下に描いています。
- 詳細画面での閾値の変更はしません（スクリーニング画面に集める。契約の第8章）。

## エバリュエーターに重点的に見てほしい点
- 判定の一致（`screening_evaluate` を共有）: 独自の条件で、詳細の印と `GET /api/screening` の `status`・結果にあるかどうかが一致するか。
- 5期の枠の決め方（欠けた期の想定の決算期、変則決算・決算期変更の銘柄）と、`GET /api/stocks/[code]` の `slots`。
- AC7.6: パンくず・「条件を変える」・ブラウザの戻る・ヘッダーのナビゲーション（デスクトップとドロワー）のどれでも、条件・並べ替え・ページが保たれるか。
- `notFound()`／`redirect()` を投げる画面の、dev の時計のずれの下での挙動。
- m4 の変更後の条件パネルの使い勝手（市場区分・業種を上にした並び）。
