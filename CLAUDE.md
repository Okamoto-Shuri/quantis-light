# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## 現状

Quantis Light（個人用の日本株スクリーナー。仕様は `docs/harness/spec.md`）を、ハーネスでスプリントごとに構築中。Sprint 5（財務指標）まで実装済み。

## 技術スタック

- TypeScript（strict）、Next.js 16（App Router、Turbopack）、React 19
- shadcn/ui（radix ベース）＋ Tailwind CSS v4、lucide-react
- Supabase（Auth ＋ Postgres）。Next.js 連携は `@supabase/ssr`（Cookie セッション）
- Vitest（単体テスト）、Playwright（E2E）
- pnpm。Supabase CLI は devDependency（`pnpm supabase ...`）。Docker が必要

Next.js 16 は学習データと異なる点が多い（middleware は `src/proxy.ts` に改名など）。実装前に `node_modules/next/dist/docs/` を確認すること。

## コマンド

| コマンド | 内容 |
|---|---|
| `pnpm db:start` / `pnpm db:stop` | ローカル Supabase の起動／停止（API 54321、DB 54322、Studio 54323、Mailpit 54324） |
| `pnpm db:reset` | DB を作り直してマイグレーションを適用（ユーザーも消える） |
| `pnpm env:local` | `supabase status` から `.env.local` を生成 |
| `pnpm seed:users` | ローカル専用。評価用ユーザー（owner＝許可、intruder＝許可リスト外）を作成（冪等） |
| `pnpm auth:add-user --email <e> --password <p> [--reset-password]` | 許可リストへの追加とユーザー作成 |
| `pnpm dev` / `pnpm build` / `pnpm start` | http://localhost:3000（別のポートは `pnpm dev -p 3100`。E2E は `E2E_PORT=3100 pnpm test:e2e`） |
| `pnpm lint` / `pnpm typecheck` | ESLint / `tsc --noEmit` |
| `pnpm test` | Vitest（`src/**/*.test.ts`。`*.db.test.ts` を除く）。1ファイルだけ: `pnpm test src/lib/auth/next-path.test.ts` |
| `pnpm test:db` | DB 込みの結合テスト（`src/**/*.db.test.ts`、`vitest.db.config.mts`）。ローカル Supabase と `.env.local` が必要。外部 API だけを差し替えて、取り込み処理を実際の DB に対して動かす。作った行（銘柄コード 9999x）は後片付けされる。株価・財務の結合テストは、銘柄マスタにテスト以外の行が無く、株価の成功の実行・取得済みの開示日が無い DB（`db:reset` 直後）が前提 |
| `pnpm test:e2e` | Playwright（`e2e/`）。ローカル Supabase 起動・`seed:users` 済みで、市場データと実行履歴が0件の DB が前提（`db:reset` 直後。テストが投入した行は後片付けされる）。dev サーバーは未起動なら自動起動（`CRON_SECRET` に E2E 用の値を渡す）。J-Quants のキーが未設定のサーバーが前提（設定済みならキー未設定前提のテストはスキップ）。**リポジトリ直下の `.env`（git 管理外）に有効な `JQUANTS_API_KEY` がある環境では、Next.js がそれを読むので、キー未設定の確認はサーバーを `JQUANTS_API_KEY= pnpm dev -p 3100` のように空の値で起動する**（既にある環境変数は `.env` で上書きされない）。3000 番がほかのアプリで使われているときは `E2E_PORT=3100`、既に起動したサーバーを使うときはその `CRON_SECRET` を `E2E_CRON_SECRET` で渡す |

初回セットアップ: `pnpm install && pnpm db:start && pnpm db:reset && pnpm env:local && pnpm seed:users && pnpm dev`

## アーキテクチャ

- **ディレクトリ**: `src/app`（ルート）、`src/lib`（ロジック。`auth/`、`supabase/`、`http/`、`dashboard/`、`ingestion/`、`listing/`、`financials/`）、`src/components`（`ui/` は shadcn 生成物。`shell/`・`theme/`・`dashboard/`・`imports/` は画面の部品）、`supabase/migrations`（DB スキーマの正本）、`scripts/`（運用コマンド）、`e2e/`
- **認証・アクセス制御（多層）**
  1. Supabase Auth: `config.toml` で新規登録・匿名サインインを無効化。Custom Access Token Hook（`private.custom_access_token_hook`）が許可リスト（`private.allowed_emails`）外へのトークン発行を拒否
  2. `src/proxy.ts`: セッション更新と楽観的チェック（未ログインの画面は `/login?next=`、`/api/*` は 401）
  3. 保護画面: `src/app/(app)/layout.tsx` → `requireAllowedUser()`（`lib/auth/guard.ts`）が毎リクエスト `getUser` ＋ `current_user_is_allowed()` で検証。許可取り消し・無効な Cookie は `/auth/signout`（Cookie を消せる Route Handler。GET は状態を判定してから破棄）へ、Auth 障害時はセッションを残して `/login` へ
  - ログアウト（`POST /auth/signout`、同一オリジンのみ）とセッション破棄の応答は `Clear-Site-Data: "cache"` を返す。`next dev` は画面を `no-cache` で返すため、これが無いと「戻る」で保護画面がキャッシュから表示される
  4. API: 各 Route Handler の先頭で `requireApiUser()`（`lib/auth/api.ts`）。401／403／503（Auth 障害）
  5. DB: 市場データのテーブルは RLS 有効、anon に権限なし、`authenticated` かつ許可リスト登録済みのみ select。書き込みは service_role のみ。`alter default privileges` で新しいテーブル・関数に anon/authenticated の権限は自動で付かない（必要な権限はテーブル・関数ごとに明示的に grant する）。`e2e/db-privileges.spec.ts` が全テーブル・関数の権限を検査する
  - Auth のメール送信は Send Email Hook（`private.block_auth_email_hook`）ですべて拒否（アプリはメールを使わない）
- **DB のテーブル・関数は必ずマイグレーション（`supabase/migrations`）で作成する。** Studio や `supabase_admin` で直接作らない（`supabase_admin` が作るオブジェクトには、anon／authenticated への既定の権限付与が残っている）。追加後は `e2e/db-privileges.spec.ts` の許可リスト（authenticated が実行できる関数・参照できるテーブル）も更新する
- **新しい保護画面**は `src/app/(app)/` 配下に置き、`src/lib/navigation.ts` の `NAV_ITEMS` に1行足す（未実装の画面はナビゲーションに出さない）。**新しい API** は `requireApiUser()` を必ず呼び、`jsonNoStore` で返す。**新しい市場データのテーブル**は `public.stocks` と同じ RLS・権限方針にする
- サービスロール（`SUPABASE_SECRET_KEY`）は `src/lib/supabase/admin.ts`（server-only）からのみ使う。画面のデータ読み出しはユーザーのセッション（RLS 経路）で行う
- 配色は `src/app/globals.css` の `light-dark()` トークンで定義。`<html data-theme="light|dark">` で固定でき、未指定なら OS 設定に従う。利用者の選択は Cookie `theme`（`light`／`dark`／`system`）に保存し、ルートレイアウトがサーバー側で `data-theme` を出力する（`src/lib/theme.ts`、`components/theme/`）。淡い背景の上の文字は `*-strong` トークンを使う（WCAG AA 4.5:1）
- **404**: 一致しない URL は `src/app/global-not-found.tsx`（`next.config.ts` の `experimental.globalNotFound`）が、何も投げずに 404 を描画する。ルートレイアウトを通らないので、`<html>`・テーマ・フッターは `src/app/app-document.tsx` を共有し、認証（`requireAllowedUser()`）もこのファイルで行う。global-not-found の中では next/link のクライアント遷移が効かない（URL だけ変わる）ため、アプリ内のリンクは `AppLink`（`components/shell/app-link.tsx`）を使う。global-not-found の中では通常の `<a>` になる。404 の画面では、ナビゲーションのどの項目も現在の画面として示さない（`useIsNotFoundDocument()`。`/imports/zzz` のような配下のパスでも強調しない）
  - **dev の既知の落とし穴（Sprint 1 の B2'、Sprint 2 評価の B1）**: React 19.2 の開発用のパフォーマンス計測は、サーバーコンポーネントの時刻を「サーバーの timeOrigin − ブラウザの timeOrigin」で換算する。**エラーになったコンポーネント**（`notFound()`／`redirect()` や例外を投げたもの）の `performance.measure` だけ、終了時刻が負になる場合のガードが無い。そのため、サーバーの時計がブラウザより遅れていると `'<名前>' cannot have a negative time stamp` が出る。起動直後の dev サーバーでは出ない。長く動かしたサーバーでの発生は評価者が観測している。原因の仮説は、Node の単調時計と壁時計のずれ（実測で 24 分に約 -8ms）。ただし、ジェネレーターの環境で修正前のコードを 28 分動かした試行では、自然には再現しなかった。
    - 対策1（404）: 描画中に `notFound()` を投げない（上記の global-not-found）。
    - 対策2（すべての throw）: `src/instrumentation-client.ts` が、開発時だけ `performance.measure` に渡る負の時刻を 0 に丸める（`src/lib/dev/measure-guard.ts`。React が開始時刻に対して行っているのと同じ丸め）。`redirect()`（許可の取り消し後のクライアント遷移など）や、今後の `notFound()`（銘柄詳細など）も対象になる。本番の React はこの計測をしないので、本番では入れない。
    - 確認方法: E2E の `simulateServerClockBehind()`（`e2e/support.ts`）でブラウザ側の timeOrigin を 60 秒進めると、起動直後のサーバーでも確実に再現する。描画中に throw するページを追加したら、この状態でも確認すること
- **ダッシュボード**: DB 関数 `public.dashboard_summary()`（security invoker、authenticated のみ実行可）が件数と鮮度を1回で返す。画面（`src/app/(app)/page.tsx`）と `GET /api/dashboard` がユーザーのセッションで呼ぶ（`lib/dashboard/summary.ts`）。集計の失敗は 0 件として扱わずエラー表示にする。銘柄0件なら空状態
- **取り込みの実行履歴**は `public.ingestion_runs`。`financial_metrics`（Sprint 5）と `ownership_judgments`（Sprint 9）はダッシュボードの集計に必要な最小限の列だけで先に作ってあり、各スプリントでマイグレーションにより拡張する
- **取り込み（Sprint 3〜）**: `src/lib/ingestion/`
  - 起動経路は2つ。手動は `POST /api/ingestion/runs`（`requireApiUser()`＋同一オリジンの確認。実行を記録して 202 を返し、本体は `after()` で動かす）、定期実行は `GET /api/cron/daily`（Vercel Cron。`Authorization: Bearer <CRON_SECRET>` だけで認証し、完了まで待つ）。どちらも `runner.ts` の `startIngestionRun()` → `executeIngestionRun()` を呼び、`maxDuration = 300`。
  - `src/proxy.ts` は `/api/cron/` の配下だけを未ログイン判定から外す（`lib/auth/proxy-paths.ts`。`/api/cron`・`/api/cronx` などは外さない）。`/API/...` のような大文字小文字の違うパスも API として 401 にする。
  - 書き込みはサービスロールで、DB 関数（service_role のみ実行可）を通す: `start_ingestion_run`（応答の無くなった実行の後片付け＋開始）、`finish_ingestion_run`（`running` の行だけを更新）、`complete_stock_master_run`（銘柄マスタの upsert と成功の記録を1トランザクション。実行が `running` でなくなっていたら何も保存しない）。読み出し（画面、`GET /api/ingestion`）はユーザーのセッション。
  - 二重実行の防止: `ingestion_runs` の部分一意インデックスで、`running` は全体で1行まで。開始から 15 分以上の `running` は応答なしとみなし、次の開始時に `failed` にする（`STALE_RUN_MINUTES` と SQL の interval を一致させる）。
  - 失敗のメッセージは `errors.ts` の決まった日本語だけ（キーの値や外部 API の応答本文を含めない）。キー未設定なら外部 API を呼ばずに「J-Quants の API キーが設定されていません」で `failed`。
  - 銘柄マスタ: J-Quants API V2 `GET /v2/equities/master`（ヘッダー `x-api-key`）。保存するのは `ProdCat=011`（内国株券）・`Mkt` 0111〜0113・`S33≠9999` の行だけ。対象外の件数は `ingestion_runs.details` に理由ごとに記録する。一覧から消えた銘柄は削除しない（上場廃止の扱いは Sprint 11）。形式の違い（必須項目の欠け、`pagination_key`、コードの重複）は一部だけを保存せずに失敗にする。
  - 設定状態（`config.ts`）は環境変数の有無だけで判定し、画面を開いても外部 API は呼ばない。`CRON_SECRET` は16文字未満なら未設定扱い（画面の表示と Route Handler の認証が同じ `getCronSecret()` を使う）。比較はハッシュ＋`timingSafeEqual`。
  - 取り込み状況の画面（`/imports`）の「今すぐ取り込み」（`components/imports/manual-ingestion.tsx`）は、実行中の間 `router.refresh()` で画面を取り直す。テスト用のフィクスチャは `src/lib/ingestion/jquants/__fixtures__/`（テストからだけ import する）。
  - 新しい取り込み対象を足すときは、`runner.ts` の `SUPPORTED_TARGETS` と `RUNNERS` に加え、`schedule.ts` の `CRON_JOBS` のどれかの `targets` に入れる（`runner.test.ts` が、すべての対象がちょうど1回ずつ定期実行に入っていることを確かめる）。Cron のルートは `lib/ingestion/cron.ts` の `handleCronRequest()` を使う（認証・409・`skipped`・期限を共通にする）。
  - `HEAD /api/cron/*` は明示的に 405（Next.js は HEAD を GET として処理するため。Sprint 3 評価の M2）。
  - J-Quants への1回の要求と応答の分類（210・401・キーの本文の 403・キー以外の 403・429・接続できない・JSON でない）は `jquants/http.ts` の `requestJQuants()` で共通にしている。
- **株価の初出日と推定上場年数（Sprint 4）**: 取り込みは `lib/ingestion/listing-dates.ts`（target `daily_quotes`）、J-Quants の `GET /v2/equities/bars/daily` は `jquants/bars-daily.ts`（`Date`・`Code` だけを検証）
  - 対象は銘柄マスタにあって `stock_listing_dates` に行の無い銘柄だけ（DB 関数 `listing_dates_pending()`）。確定した行は更新しない（保存は `save_stock_listing_dates` の `on conflict do nothing`。AC4.4）。行が無い銘柄だけを処理するので、打ち切られても次の実行で続きから再開する。
  - データ期間の開始日 W: Standard プランの株価は「10年前まで」（移動する期間）。実行日（JST）の10年前の翌日から `date=` で最大14日試し、最初に行のある日を W にする（`listing-period.ts`）。200 の0件・210・400・キー以外の本文の 403 は次の日へ。本文がキーの無効・欠如（`The incoming api key is invalid or expired.`／`The api key is required.`）の 403 と 401・429 は即失敗。試した日ごとの状態は `details.dataStartProbe`。
  - W の日に現れた銘柄は `first_price_date = data_start_date = W`（「データ期間開始以前から上場」）。残りは `code=X&from=W` を全ページ取得して最も古い日付。210・0件は「株価データなし」（行を作らず次回再試行）、500 などはその銘柄だけ失敗。
  - 要求の間隔は 600ms 以上。新しい要求はルートの開始から 210 秒まで（`clock.ts` の `REQUEST_BUDGET_MS`。Cron は銘柄マスタの時間も含めて数える）。超えたら `partial`（残りの銘柄数を文言と `details.remaining` に記録）。保存は 50 銘柄ごとで、そのたびに `processed_count` を足す（`finish_ingestion_run` は `p_processed_count` が NULL なら件数を変えない）。
  - 算出は DB の1か所だけ: `listing_years_between(from, to)`（暦の年。整数部分・正確な値・整数演算での小数1桁の切り上げ）、ビュー `listing_reference_date`（基準日 = `daily_quotes` の成功・一部失敗の最新の終了日時の JST の日付）、ビュー `stock_listing_ages`（security_invoker）。画面と `GET /api/stocks` は DB の値を表示するだけで、アプリ側で年数を計算しない（丸めのずれを作らない）。
  - 表示は `estimated_listing_years`（小数1桁に切り上げた数値。API では JSON の数値なので 3.0 は `3`）。**Sprint 6 の絞り込み・並べ替えは `listing_years_exact`（丸める前）を使う**（閾値が小数1桁までなら「表示 ≤ X ⇔ 正確 ≤ X」）。データ期間開始以前の N は `listing_years_lower_bound`（整数部分。取り込み直後は 9、約2週間で 10）。
  - 画面は `/imports` の区画「株価の初出日と推定上場年数」（`components/imports/listing-dates-panel.tsx`）。1銘柄の確認は Sprint 5 から独立した区画「銘柄コードで確認」（`components/imports/code-lookup.tsx`。`?code=`。フォームは正規化したコードの URL に `router.push` する。描画中に throw しない）で、推定上場年数と財務指標のカードを並べる。`GET /api/stocks?code=` で1銘柄に絞れる（4文字は末尾に 0）。
- **財務データと指標（Sprint 5）**: 取り込みは `lib/ingestion/financials.ts`（target `financials`）、J-Quants は `jquants/fins-summary.ts`（`/v2/fins/summary`）と `jquants/calendar.ts`（`/v2/markets/calendar`）
  - 開示日（`date=`）ごとに全銘柄分を取る。取得範囲は実行日（JST）の6年前〜実行日（`financials-period.ts`）。最初に取引カレンダーを1回取り、`HolDiv` が 1・2 の営業日だけを要求する（取れなければ平日で代用し `details.calendar = "weekdays_fallback"`。キーの無効・401・429 は打ち切り）。順番は、直近7日の営業日（取得済みでも毎回取り直す。速報→確報）→ 未取得の営業日（新しい順）。
  - 開示日ごとに、全ページを取り終えてから DB 関数 `save_financial_statements`（service_role のみ）で、通期の開示の保存と `financial_fetched_dates` の記録を1トランザクションで行う。取得済みの記録が無い日だけを処理するので、打ち切られても次の実行で続きから再開する。J-Quants 側のデータ全般の修正を取り直すときは `financial_fetched_dates` の行を消す。
  - 要求の間隔は**前の要求の開始から** 1,100ms 以上（`/fins/summary` は 60 回/分の専用枠）。期限は開始から 210 秒（1回で約190回。初回は約8回の実行で取得範囲を埋める）。開示日ごとの失敗（500・210・400・キー以外の 403・形式の違い）は取得済みにせず、5回続いたら打ち切り。
  - 通期実績: `DocType` が `FYFinancialStatements_(Consolidated|NonConsolidated)_(JP|US|IFRS|JMIS|Foreign)`（REIT を除く）かつ `CurPerType = FY` の行だけ。使うのは `Sales`・`OP`（実測: 非連結の短信も値は `Sales`・`OP` に入る。空のときだけ項目ごとに `NCSales`・`NCOP`）。四半期・予想の修正・予想の項目は保存する経路が無い（テーブルの制約でも拒否）。金額は円（実測で確認済み）。値は文字列で、空は `""`。
  - DB は3層（**算出の定義は出典に依存しない**。仕様の改訂2、F15 で EDINET の期が加わる）: ① 出典ごとの保存（決算短信は `financial_statements`。主キーは (code, disclosure_no)。訂正は別の行）→ ② ビュー `financial_periods`（security_invoker。銘柄・事業年度の終了日ごとに1行。出典の優先順位 `source_priority` → 同じ出典の中で開示日・時刻・開示番号の新しい順。`source`・`source_document_id` を持つ。`is_irregular` は 358〜371 日の外）→ ③ 純粋な関数 `financial_metrics_from_periods(jsonb)`（期の配列だけを受け取る。出典の項目は無視）。`recalculate_financial_metrics(codes)` が ② を集めて ③ を呼び、`financial_metrics` に保存する。**`financial_statements` の insert・update・delete（stocks の削除の連鎖を含む）で、文単位のトリガーが同じトランザクションの中で再計算する**（`financial_metrics` は直接書き換えない）。Sprint 9 は、EDINET のテーブルを足し、`financial_periods` の候補に union で加え、同じ再計算をトリガーから呼ぶ。
  - 売上CAGR: FY0 から連続（新しい期の開始日の前日 = 古い期の終了日）する最大5期で (FY0/FY-4)^(1/4) − 1。理由の優先順位は `irregular_period` → `insufficient_periods`／`non_consecutive_periods` → `revenue_not_disclosed` → `base_revenue_not_positive` → `latest_revenue_negative`。営業利益率は FY0 だけで `operating_profit_not_disclosed` → `revenue_not_disclosed` → `revenue_not_positive`。理由の表示は `lib/financials/display.ts`。連結・単体や会計基準の混在は算出不可にせず `revenue_cagr_mixed_basis`。
  - 丸め: 比率を小数点以下10桁に丸めて保存（`power` の近似で 0.2 が 0.1999… にならないように）。表示は生成列 `*_display_pct`（百分率の小数点以下1桁に**切り捨て**。負の値は小さい方へ）。**Sprint 6 の絞り込み・並べ替えは `revenue_cagr`・`operating_margin`（索引あり）を使う**（「表示 ≥ X ⇔ 保存 ≥ X/100」）。4,000 銘柄での絞り込みは 1ms 未満（`financial-metrics.db.test.ts` の性能のテスト）。
  - 画面は `/imports` の区画「財務指標（売上CAGR・営業利益率）」（`components/imports/financial-metrics-panel.tsx`。要約は DB 関数 `financial_metrics_summary()`（authenticated、security invoker）を1回呼ぶ。取得済みの開示日は最後の財務の実行の `details` から）と、銘柄コードで確認の財務のカード（`financial-card.tsx`）。API は `GET /api/stocks`（指標の列）と `GET /api/financials?code=`（`metrics` と `periods`。無いコードは 404）。
  - 定期実行は `/api/cron/financials`（`0 13 * * *` = 22:00 JST）。株価の初回の取り込みと 210 秒を取り合わないよう、`/api/cron/daily` とは別の関数にし、Hobby の1時間のずれで重ならないよう2時間あけた。
- **同一オリジンの確認**（手動取り込み・ログアウト）: `lib/http/same-origin.ts`。`Origin` のホストを `X-Forwarded-Host`（最初の値）または `Host` と比べる（Server Actions と同じ）。`request.nextUrl.origin` はサーバーの既定のホスト名になるので使わない。拒否は 403 `{"error":"cross_origin"}`。`GET /auth/signout` のリダイレクトは相対パス（別のホスト名で開いた利用者を localhost に移さない）。dev を 127.0.0.1 で開けるよう `next.config.ts` に `allowedDevOrigins` を設定している。
- **Vercel での設定**: `vercel.json` の Cron は `/api/cron/daily` を `0 11 * * *`（UTC。毎日 20:00 JST）に、`/api/cron/financials` を `0 13 * * *`（22:00 JST）に呼ぶ。Cron は本番のデプロイでだけ動き、Hobby プランでは最大 59 分ずれる。画面の表示（`lib/ingestion/schedule.ts`）と `vercel.json` の一致は `schedule.test.ts` が確かめる。Vercel のプロジェクトの環境変数に、Supabase の3つ（本番の値）と `JQUANTS_API_KEY`、`EDINET_API_KEY`、`CRON_SECRET`（`openssl rand -hex 32` などで生成した16文字以上）を設定する。
- **許可の取り消しの理由（N1）**: クライアント遷移中にガードが `/auth/signout?reason=revoked` へ送ると、ルーターがこの URL を同時に2回要求することがある。後の要求は「未ログイン」になるため、セッションの Cookie を持っていて `reason=revoked` のときは、未ログインでも `/login?reason=revoked` へ送る（理由は表示にしか使わない）。
- ローカルの環境変数: `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`、`SUPABASE_SECRET_KEY`、`JQUANTS_API_KEY`、`EDINET_API_KEY`、`CRON_SECRET`（`.env.example`。`pnpm env:local` は Supabase の3つだけを書き換え、ほかの行は残す）

## 開発ハーネス（planner → generator → evaluator）

起動: `/harness <1〜4行のプロンプト>`（`.claude/skills/harness/SKILL.md`）。メインセッションはオーケストレーターに徹し、自分では実装もテストもしない。

- `planner`（`.claude/agents/planner.md`）: プロンプトを `docs/harness/spec.md` に展開する。「何を作るか」だけを書き、実装の詳細（DB スキーマ、ライブラリ、API 設計）は書かない。受け入れ基準は、ブラウザ操作で合否を判定できる形にする。
- `generator`（`.claude/agents/generator.md`）: 1スプリントで1機能を実装する。モードは契約・実装・修正の3つ。スタブやダミーデータで動いているように見せることは禁止。git リポジトリであれば、スプリントごとに `sprint-NN: <機能名>` でコミットする。
- `evaluator`（`.claude/agents/evaluator.md`）: Playwright MCP（`.mcp.json`）で実際に操作し、画面・API・データベースの3段階で検証する。ソースコードは編集しない（Edit 禁止）。

サブエージェント同士は直接会話できない。受け渡しはすべて次のファイルで行う。

```
docs/harness/spec.md
docs/harness/sprints/sprint-NN/{contract.md, contract-review.md, self-review.md, evaluation-R.md}
```

合否判定: 機能性 ≥8、仕様充足度 ≥7、デザイン ≥6、コード品質 ≥6。1つでも閾値を下回るか、契約の完了条件が1つでも未達、または起動失敗・リグレッションがあれば不合格。同じスプリントで5ラウンド不合格になったら、ループを止めてユーザーに判断を仰ぐ。
