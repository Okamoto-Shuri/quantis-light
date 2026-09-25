# Sprint 12 契約: F11 日次取り込みの信頼性（増分更新・再開・失敗の可視化）

> **改訂1（rev 1）の変更点**（contract-review.md の R1〜R5・推奨と、★ へのユーザーの決定の反映。詳細は第9章）
> - **ユーザーの決定**: ★1（AC11.5）は「銘柄単位の整合＋注記」で承認。注記に「未取得の残り」（target ごとの残りの件数）を加える（第2章の5、C5-4〜C5-6）。★2（AC11.3）は target ごとの判定で承認（R3 の修正込み）。
> - R1: 実行履歴の表に列を足さない。「開始」の日時を実行の詳細へのリンクにする（第4章）。
> - R2: 処理0件の応答なしの実行は、`failed` で**旧い文言のまま**（第2章の1、C1-4）。
> - R3: 保存のたびに `last_progress_at` を更新し、鮮度は「最後に保存した時刻」で判定する。後片付けの時刻は使わない（第2章の4、C4-10）。
> - R4: 固定日時の投入例を一時的に古くした状態でも、ジェネレーターが全件の E2E を流して self-review に書く。375px の警告の高さの上限（C4-8・C4-9・C10-4）。
> - R5: `data_freshness()` が失敗したときは、警告を出さずにページを描画する。ダッシュボード・API は失敗を示す（第2章の4、C4-11）。
> - 推奨: C5-1 に `save_stock_listing_dates`・`save_edinet_document_list` を追加。`Retry-After` の解釈。大量の上場廃止の保留を解く手順を CLAUDE.md に。`/imports/runs/[id]` の `aria-current`。レイアウトの警告がクライアント遷移で更新されないことの記載。

## 1. 対象機能

F11。取り込みを毎日確実に終わらせるための仕組みを整える。Sprint 3〜9 で作った取り込み（銘柄マスタ、株価の初出日、財務、EDINET）は、すでに次の設計になっている。

- 保存の単位ごとに続きから再開する（初出日の行が無い銘柄だけ、取得済みでない開示日・一覧の日だけ、未処理の書類だけを処理する）
- 期限（ルートの開始から 210 秒）を過ぎたら新しい要求を始めず、`partial` で終える

このスプリントでは、足りない部分を加える。

- 中断した実行の「一部完了」と残り件数の記録
- 失敗した対象（銘柄・開示日・書類）の一覧の保存と、実行履歴の詳細の画面
- 呼び出し回数の制限に当たったときの待機と再試行
- データの鮮度の警告
- 取り込み中の検索の整合と、その表示
- 上場廃止の扱い

対象は F15（上場前の期の補完）も含む EDINET の取り込み（target `edinet_reports`）を含め、4つの target すべて。

土台として使うもの:

| 使うもの | 出どころ |
|---|---|
| 実行の開始・終了・二重実行の防止・応答の無い実行の後片付け（`start_ingestion_run`・`finish_ingestion_run`） | Sprint 3 |
| 銘柄マスタの取り込み（`complete_stock_master_run`） | Sprint 3 |
| 株価の初出日（`listing-dates.ts`）、財務（`financials.ts`）、EDINET（`edinet-reports.ts` の `runEdinetPipeline`） | Sprint 4・5・8・9 |
| J-Quants の要求の分類（`jquants/http.ts`）、EDINET の要求の分類（`edinet/http.ts`） | Sprint 5・8 |
| 判定の式の1か所（`screening_evaluate`）と、一覧・詳細の読み出し（`screen_stocks`・`stock_detail`） | Sprint 6・7・10・11 |
| 保護画面の枠（`ProtectedShell`。global-not-found も使う） | Sprint 1・2 |

### 仕様書の受け入れ基準（引用）

- AC11.1 取り込みが途中で中断された場合（時間切れなど）、実行履歴に「一部完了」と処理済み件数・残り件数が記録され、次の実行で残りの銘柄から処理が続く。
- AC11.2 一部の銘柄だけ外部 API がエラーを返しても、他の銘柄の取り込みは続く。失敗した銘柄の一覧（コード、エラー内容）を実行履歴の詳細で確認できる。
- AC11.3 最後に成功した取り込みから48時間以上たつと、全画面の上部に「データが古くなっています（最終更新: YYYY-MM-DD HH:mm）」という警告が表示される。
- AC11.4 外部 API の呼び出し回数の制限を超えないよう、取り込みの速度が調整されている。制限に当たったときは待ってから再試行し、それでも失敗したらその旨が履歴に記録される。
- AC11.5 取り込み中も、スクリーニング画面では前回までの完全なデータで検索でき、途中までのデータが混ざった結果にはならない。または、どの銘柄が更新中かが表示される。
- AC11.6 上場廃止になった銘柄は、スクリーニング結果に出なくなる（詳細画面では「上場廃止」と表示される）。

関連する仕様の記述:
- F11 概要「実行時間の制限で途中で止まっても次の実行で続きから処理する。失敗した銘柄を記録し、データの鮮度が落ちていることを画面で警告する。対象には、上場前の期の補完（F15）の取り込みも含む」。
- F11 ユーザーストーリー「何が古いままなのかを知りたい」。
- AC3.3「結果（成功・一部失敗・失敗）」。このスプリントで「一部完了」を加える（第2章の1）。
- 検証方針「キーが無い評価環境」。外部 API の振る舞い（失敗・429・時間切れ・銘柄マスタからの消失）は、Sprint 3〜9 と同じく `pnpm test:db`（外部 API だけを差し替えて実際の DB に対して動かす）で確かめる。画面の表示は、第5章の保存形式で投入した行で確かめる。

### 持ち越し事項（Sprint 11 評価の改善提案）

| 提案 | 扱い |
|---|---|
| m1（一覧の `ownership.override` の形が契約と違う。`auto_current` が契約に無い） | 取り込む。CLAUDE.md の API の説明に `auto_current` と `auto_at_override` を追記する（実装の形を正とする）（C8-5） |
| m2（条件④がオフのとき、④ の印の title に「（手動補正）」が付く） | 取り込む（C8-1） |
| m3（保存・取り消しの後にフォーカスが `body` に落ちる） | 取り込む（C8-2） |
| m4（「確認済みにする」で `updated_at` が新しくなり「更新」と出る） | 後に回す（第8章）。補正のテーブルの意味を変えるので、取り込みのスプリントでは扱わない |
| m5（性能のテストの実測値が記録されない） | 取り込む（C8-4） |
| m6（`toApiOverride()` が形の違いを黙って `null` にする） | 取り込む（C8-3） |
| 環境（dev サーバーのメモリの閾値による再起動で、全件の E2E が落ちる） | 取り込む。全件の E2E は本番相当のサーバー（`pnpm build && pnpm start`）で流すことを CLAUDE.md の標準の手順にする（C8-6） |

## 2. 仕様上の論点と、このスプリントでの解釈

評価者は、この解釈が妥当かも判断してほしい。★ の2項目は、仕様の「または」「成功」を具体化したもので、**改訂1でユーザーが承認した**。★1 には、未取得の残りの注記を加えた。★2 は R3 の修正込みで承認された。

### 1. 「一部完了」と「一部失敗」（AC11.1）

DB の `status` は今までどおり4値（`running`／`succeeded`／`partial`／`failed`）にする。実行の行に次の列を加え、表示の名前を列から決める。

| 追加する列 | 内容 |
|---|---|
| `stopped_reason` | 打ち切りの理由。`time_budget`（期限）／`stale`（応答なしで中断。下記）／`rate_limited`／`unauthorized`／`redirect`／`consecutive_failures`／`save_failed`／`delisting_held`（第2章の6）／NULL（最後まで処理した） |
| `remaining_count`・`remaining_unit` | 残りの件数と単位。単位は `stocks`（株価: 銘柄）、`disclosure_dates`（財務: 開示日）、`list_dates`（EDINET: 書類一覧の日）、`documents`（EDINET: 書類）。残りが無い・数えられないときは NULL |
| `failed_count` | 失敗した対象の数（第2章の2。上限で打ち切らない全数） |
| `last_progress_at` | 最後に保存した時刻（R3）。保存の関数（`complete_stock_master_run`・`save_stock_listing_dates`・`save_financial_statements`・`save_edinet_document_list`・`save_edinet_extractions`）が、保存のたびに `now()` にする。保存が無ければ NULL |

表示の名前の規則（`lib/ingestion/runs.ts` の1か所）:

- `partial` かつ `failed_count = 0` かつ `stopped_reason` が `time_budget` か `stale` → **「一部完了」**（`data-partial-kind="incomplete"`）
- ほかの `partial` → **「一部失敗」**（`data-partial-kind="failed"`）。新しい列の無い、過去の行も「一部失敗」のまま
- `succeeded`・`failed` は今までどおり

残りの件数の数え方:

| target | 単位 | 数え方 |
|---|---|---|
| `stock_master` | なし | 1回の要求なので途中の中断は無い |
| `daily_quotes` | 銘柄 | 未確定の銘柄 − 保存 − 株価データなし − 失敗（今の `details.remaining`） |
| `financials` | 開示日 | 取得範囲の営業日のうち取得済みでない日（今の `datesRemaining`） |
| `edinet_reports` | 書類一覧の日 → 書類 | 一覧を取り終えていなければ一覧の残りの日。取り終えていれば、本文が未処理の書類 |

**応答の無くなった実行の後片付け**: 次の実行の開始時の後片付け（開始から 15 分以上の `running`）は、今までどおり行う。

- `processed_count > 0` の実行 → `partial`（`stopped_reason = stale`）で、「一部完了」と表示する。メッセージは「応答が無くなったため中断されたものとみなしました（15 分以上）。保存済みの分は残っています。残りは次回の取り込みで処理します」。関数が強制終了されたなどの場合に当たる。
- 0 件の実行 → 今までどおり `failed` で、**文言も今までどおり**（`15 分以上応答が無かったため、中断されたものとみなしました`）。保存が無いので「保存済みの分は残っています」とは書かない。

**続きからの再開**: 仕組みは Sprint 4・5・8 のまま。このスプリントでは、4つの target すべてについて `pnpm test:db` で固定する。1回目が期限で止まり、2回目は残りだけを要求して終わることを確かめる（C1）。

### 2. 失敗した対象の記録（AC11.2）

「失敗した銘柄の一覧」は、target ごとに取り込みの単位で記録する。

| target | 失敗の単位（`item_type`） | 一覧の「コード」 |
|---|---|---|
| `daily_quotes` | 銘柄（`stock`） | その銘柄 |
| `financials` | 開示日（`disclosure_date`） | 無し。財務は開示日ごとに全銘柄をまとめて取るので、その日に開示したすべての銘柄が未取得。画面に注記する |
| `edinet_reports` | 書類一覧の日（`list_date`）、書類（`document`） | 書類は結び付く銘柄（ビュー `edinet_document_codes`）。一覧の日は無し |

- 新しいテーブル `public.ingestion_run_failures`（名前は目安）に、実行ごと・対象ごとに1行を保存する。今の `details.failedDocuments`（上限 50）はこのテーブルに置き換える。
- **エラー内容は理由のコードで保存し、画面の文言は TypeScript の1か所で作る**。保存する列は、理由のコード（`http_error`／`not_found`／`unreachable`／`invalid_format`／`row_mismatch`／`pdf_returned`／`invalid_archive`）、HTTP ステータス、接続の失敗の種類（`timeout`／`network`）。外部 API の応答の本文、URL、キーは保存しない。
- 文言の例:
  - 「J-Quants から予期しない応答がありました（HTTP 500）」
  - 「J-Quants に接続できませんでした（タイムアウト）」
  - 「応答の形式が想定と異なります」
  - 「応答に別の銘柄の行が含まれていました」
  - 「EDINET から書類を取得できませんでした（HTTP 404）」
  - 「PDF の応答（不開示の書類など）」
  - 「ZIP を読めませんでした」
- 「株価データなし」（200 の0件・210）は失敗ではない（Sprint 4 の定義）。一覧に載せず、件数だけを今までどおり記録する。
- 1回の実行で保存する行は **1,000 行まで**。`failed_count` は全数を持ち、画面は「ほか N 件」と示す。
- **続けての失敗の打ち切り**: 株価にも、財務・EDINET と同じく「対象の取得が5回続けて失敗したら打ち切る」を加える（`stopped_reason = consecutive_failures`）。J-Quants 側の全面的な障害のときに、期限まで全銘柄を失敗で埋めないため。1銘柄ずつの失敗は続行する（AC11.2）。
- 失敗した対象は処理済みにしないので、次の実行で再試行される（今の設計のまま）。
- 失敗の行は、遅くとも実行の終了時（期限・打ち切りを含む）に保存する。関数が強制終了された実行（`stale`）では、一覧が一部欠けることがある。画面の詳細にその旨を注記する。

### 3. 呼び出し回数の制限（AC11.4）

- **速度の調整**（今のまま）: 要求の間隔は、J-Quants の株価・銘柄マスタ 600ms（100 回/分以下）、財務・取引カレンダー 1,100ms（`/fins/summary` の 60 回/分の枠）、EDINET 1,000ms。どれも前の要求の開始から数える。
- **待って再試行（新規）**: 制限の応答を受けたら、待ってから同じ要求を再試行する。制限の応答は、J-Quants は HTTP 429、EDINET は本文のステータス 429・503。
  - 待ち時間は、応答に `Retry-After`（秒の整数）があればその値（1〜120 秒に収める）。無い、または HTTP 日付の形・数でない値なら 15 秒 → 30 秒 → 60 秒。EDINET はエラーを HTTP 200 の本文で返すので、ふつう `Retry-After` は無い（既定の待ち時間になる）。
  - 1つの要求につき**再試行は3回まで**。
  - 回復した後は、その実行の残りで要求の間隔を2倍にする。
  - 待ちの終わりが期限（210 秒）を超えるときは待たずに打ち切る。
  - 対象は、J-Quants と EDINET のすべての要求（銘柄マスタ・株価・取引カレンダー・財務・書類一覧・書類取得）。今の「429 ならすぐに打ち切る」を置き換える。
- **それでも失敗したら**: `stopped_reason = rate_limited` で打ち切る。保存済みがあれば `partial`、無ければ `failed`。メッセージは例えば「J-Quants の呼び出し回数の上限に達しました（HTTP 429）。3 回待って再試行しましたが解消しなかったため中断しました」、期限による中断なら「待ち時間が取り込みの時間の上限を超えるため中断しました」。これに残りの件数の文言を続ける。
- 記録: `details.rateLimit = { hits, retries, waitedMs, exhausted }`（制限の応答の回数、再試行の回数、待った合計ミリ秒、解消せずに打ち切ったか）と `details.apiCalls`（今のまま）。実行の詳細の画面に表示する。
- キーの無効（401・キーの本文の 403）は、今までどおりすぐに打ち切る（再試行しない）。

### 4. データの鮮度の警告（AC11.3）★

- **「最後に成功した取り込み」は target ごとに求める**。対象は定期実行の4つ（`stock_master`・`daily_quotes`・`financials`・`edinet_reports`）。target ごとに、`status` が `succeeded` か `partial` の実行の最新の `finished_at`（＝その target のデータが最後に更新された日時）を求める。
  - `partial` も含める理由: 保存済みの分があり、データは更新されている。初回の取り込みの間は毎日 `partial` になるのが正常なため。`failed` は含めない。**保存が1件でもあれば更新とみなす**（毎日 `rate_limited` で少しだけ保存して止まる状態は警告にならない。その状態は実行履歴の「一部失敗」で見える）。CLAUDE.md にも書く。
  - **時刻は「最後に保存した時刻」**（R3）: 応答なしで後片付けされた実行（`stopped_reason = stale`）の `finished_at` は、次の実行の開始時刻（後片付けの時刻）になり、実際の保存より新しい。そこで、stale の行は `finished_at` ではなく `last_progress_at` を使う（NULL の行は数えない）。ほかの行は `finished_at` を使う（最後の保存と終了の差は数秒〜数分で、「その実行で更新した」時刻として分かりやすい）。
  - target ごとにする理由: 1つのデータソースだけが止まったとき（例: J-Quants のキーの期限切れ）に、EDINET の成功で隠れないように。ユーザーストーリーの「何が古いままなのか」に答えるため。
- **古い**: 現在時刻 − その日時 ≥ 48 時間。境界の 48 時間ちょうどは古い（「48時間以上」）。
- 一度も成功していない target は警告に含めない。キー未設定などで一度も取り込めていない状態は、取り込み状況の画面（設定状態・実行履歴）とダッシュボードの空状態が示す。全く取り込んでいない DB では警告を出さない。
- **警告の文言**:
  - 1行目: 「データが古くなっています（最終更新: YYYY-MM-DD HH:mm）」。日時は日本時間で、古い target のうち最も古い日時。
  - その下: 古い target ごとの名前（`RUN_TARGET_LONG_LABELS`）と最終更新日時。
  - 取り込み状況の実行履歴へのリンク「実行履歴を確認」。
- **表示する場所**: ログイン後のすべての画面の上部（ヘッダーの直下、本文の上）。`ProtectedShell` に置くので、ダッシュボード・スクリーニング・銘柄詳細・取り込み状況・実行の詳細・設定・404 のすべてに出る。ログイン画面には出さない。
- 判定は DB 関数 `data_freshness()`（authenticated・security invoker。名前は目安）の1か所。画面、`GET /api/dashboard`（`freshness` を追加）が同じ関数を使う。48 時間の比較は DB の `now()` で行う。テストのために基準の時刻を引数で渡せる形にする。
- **取得に失敗したとき**（R5。関数のエラー、DB の一時的な障害、形の違い）:
  - 保護画面の枠: 警告を出さずにページを描画し、サーバーのログに残す。ページが 500・エラー境界になったり、ほかの機能が止まったりしない。
  - ダッシュボード: 鮮度の欄に「データの鮮度を確認できませんでした」を出す。既存の集計は、鮮度の失敗の影響を受けない。
  - `GET /api/dashboard`: `freshness: null` を返す（200 のまま。ほかの項目は返す）。
- **クライアント遷移では更新されない**: 警告は保護画面の枠（レイアウト）に置くので、next/link の遷移ではレイアウトが描き直されず、直前の状態が残る。リロード、`router.refresh()`、フルページの遷移で更新される。実行は1日に数回なので実害は小さい。CLAUDE.md に書く。
- 既存の E2E の投入例は、`daily_quotes` の成功の実行を固定の日時（2026-09-24 20:03 JST）で入れている。2026-09-26 20:03 JST 以降は、その投入例の画面に警告が出る（正しい振る舞い）。警告があっても既存の E2E が変更なしに通るよう、次を守る。
  - 1280 幅で3行以内（1行目＋内訳2行。C4-8）に収まる、控えめな見た目にする。
  - 375px では、1行目の折り返しを含めて**4行以内**の高さ（内訳が多いときは `<details>` などで折りたたんでよい）。
  - `role="status"` を使わない。
  - リンクの名前に「取り込み状況」「スクリーニング」を含めない（既存のロケーターと衝突しないように）。

### 5. 取り込み中の検索（AC11.5）★

仕様は「前回までの完全なデータで検索でき、途中までのデータが混ざった結果にはならない」**または**「どの銘柄が更新中かが表示される」。次の2つを組み合わせる。

1. **銘柄ごとの値は常に1回の保存でそろって変わる**（途中の状態は見えない）。保存の単位ごとに、保存と指標・判定の再計算が1つのトランザクションで行われる。保存の単位は、銘柄マスタ全体、初出日の 50 銘柄、開示日 1 日、書類 1 通。スクリーニングは1回の DB 関数の呼び出し（1つのスナップショット）で読む。このため、1つの結果の中に「保存されたが再計算されていない」値や、1つの書類の一部だけが反映された値は現れない。今の設計のままで、このスプリントでは `pnpm test:db` で固定する（C5-1）。
2. **取り込みの実行中は、スクリーニングと銘柄詳細にその旨を表示する**（`ingestion-running-note`）。
   - 注記の文言は「取り込みを実行中です（財務・HH:mm 開始）。保存が済んだ銘柄から順に新しいデータが反映されます。1つの銘柄の値が途中まで更新された状態で表示されることはありません」。
   - 検索はそのまま使える（止めない・待たせない）。
   - 応答の無くなった実行（15 分以上）には出さない。

3. **未取得の残りを表示する**（ユーザーの決定で追加。実行中の数分間だけでなく、初回の取り込みのように何日も残りがある期間にも伝わるように）。
   - target ごとに、**最新の終了済みの実行**（応答なしを含む。`running` は除く。`failed` で `remaining_count` が NULL の実行（保存0件で残りを数えていない）は判定に使わず、1つ前の実行を見る）の `remaining_count` が 1 以上なら、その target は「残りあり」。最新の実行の残りが 0・NULL（成功など）なら「残りなし」。
   - スクリーニングに `ingestion-remaining-note`: 「未取得の残りがあります（株価 3,512 銘柄・財務 20 日分・EDINET 15 件の書類）。残りは次回以降の取り込みで処理します」。単位は第2章の1。並びは定期実行の順（株価・財務・EDINET）。
   - 残りのある target が無ければ出さない。実行中の注記と同時に出ることもある。
   - 求め方は DB の1か所（`data_freshness()` の結果に含めるか、同じ形の関数）。ダッシュボードの API にも含める（`freshness.targets[].remainingCount`・`remainingUnit`）。
   - 行ごとの「今回更新」の印は付けない（任意の追加案。後に回す）。

「前回の取り込みの完了時点の全体のスナップショット」を別に持つ案は採らない。F11 は、1回で終わらない取り込みを複数の実行に分けて続きから処理する設計（AC11.1）なので、「前回の実行の完了時点」でも全体はそろっていない。実行ごとのスナップショットを持っても「途中までのデータ」は無くならず、表の二重化の費用に見合わない。

### 6. 上場廃止（AC11.6）

- **定義**: 銘柄マスタの取り込み（成功）で、取り込み対象の行（内国株券・プライム／スタンダード／グロース・業種 9999 以外。Sprint 3 の規則）に無かった保存済みの銘柄を「上場廃止」とする。J-Quants の一覧に行はあるが対象外になった銘柄（市場区分の変更など）も同じく扱う。
- **行は消さない**（Sprint 11 の決定。補正とメモが連鎖して消えるため）。`stocks` に `delisted_on date`（名前は目安。上場廃止を確認した銘柄マスタの日付 = J-Quants の `Date`）を加える。NULL なら上場中。
  - 再び一覧に現れたら NULL に戻す（再上場・一時的な欠落）。
  - 上場廃止を確認した銘柄の、ほかの列（社名など）は最後の値のまま。
- **一度に大量に消えたときの保護**: 1回の取り込みで新たに消えた銘柄が **100 を超える**ときは、J-Quants の一時的な欠落とみなして上場廃止を反映しない。
  - 銘柄マスタの上場中の行の upsert は行う。
  - 実行は `partial`（`stopped_reason = delisting_held`）で、メッセージは「銘柄マスタから一度に N 銘柄が消えたため、上場廃止の反映を保留しました」。
  - 実際の上場廃止は1日に数銘柄なので、正常時には当たらない。
  - **保留を解く手順**を CLAUDE.md の既知の制限に書く。本当に 101 銘柄以上が消えた場合は、毎日 `delisting_held` が続くため。手順の例: 最新の銘柄マスタの日付より `listed_info_date` が古く、`delisted_on` が NULL の銘柄を確かめてから、SQL でその日付を `delisted_on` に入れる。
- **影響**:
  - スクリーニング（`screen_stocks`・`GET /api/screening`）: 上場廃止の銘柄は、条件・「算出不可を含める」「判定不能を含める」に関係なく結果に出さない。除外の件数にも「銘柄マスタ N 銘柄中」の N にも数えない。上場廃止の銘柄が1つ以上あれば「上場廃止の N 銘柄は検索の対象外です」と注記する。判定は `screening_evaluate` の1か所に加える。
  - 銘柄詳細（`/stocks/[code]`・`GET /api/stocks/[code]`）: 404 にしない。見出しの横に「上場廃止」のラベルと「YYYY-MM-DD の銘柄マスタで確認」。「結果に含まれるか」は条件に関係なく「含まれない（上場廃止）」。保存済みのデータ（財務・大株主・判定・補正）はそのまま表示する。
  - ダッシュボード: 銘柄数の横に「うち上場廃止 N 銘柄」（N > 0 のときだけ）。ほかの件数は変えない。
  - 取り込み: 株価の初出日の対象（`listing_dates_pending`）と、EDINET の本文の対象から、上場廃止の銘柄を除く（API の呼び出しを節約する）。財務は開示日ごとの取得なので、変えない。
  - 手動補正（`ownership_overrides`）は残る。再上場すれば、そのまま使われる。

### 7. このスプリントで決めた実装の方針

- 画面の文言・名前（「一部完了」、残りの単位、失敗の理由の文言、target の名前）は `lib/ingestion/` の1か所から出す。
- 外部 API の応答の本文・URL・キーを、`error_message`・`details`・失敗の行・ログに出さない（今の方針のまま）。
- 新しいテーブル・関数はマイグレーションで作る。市場データと同じ RLS・権限にし、書き込みは service_role の DB 関数だけにする。`data_freshness()` と読み出しの関数は authenticated（security invoker）。`e2e/db-privileges.spec.ts` を更新する。

## 3. 起動方法

ポート 3000 は別のプロジェクトが使っているので、すべて **3100 番**で行う。3000 番のプロセスには触れない。3100 番のサーバーを止めるときは、`lsof -ti tcp:3100` で得た PID だけを止める。

```bash
cd /Users/shuriokamoto/dev/quantis-light
pnpm install
pnpm db:start          # Docker が必要
pnpm db:reset          # Sprint 12 のマイグレーションを含めて適用
pnpm env:local
pnpm seed:users        # owner・owner2（許可）、intruder（許可リスト外）
# キーなし（リポジトリ直下の .env にキーがあっても、空の値で上書きする）
JQUANTS_API_KEY= EDINET_API_KEY= CRON_SECRET=local-cron-secret-0123456789 pnpm dev -p 3100
# 本番相当（全件の E2E はこちらが標準。C8-6）
pnpm build && JQUANTS_API_KEY= EDINET_API_KEY= CRON_SECRET=local-cron-secret-0123456789 pnpm start -p 3100
```

- アプリ:
  - http://localhost:3100/imports （実行履歴。「詳細」から実行の詳細へ）
  - http://localhost:3100/imports/runs/<id> （実行の詳細）
  - http://localhost:3100/screening?off=cagr,margin,years,owner （上場廃止の除外の確認）
  - http://localhost:3100/stocks/9N003 （上場廃止の銘柄の詳細）
- Postgres: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
- 評価用ユーザー: Sprint 11 と同じ（`owner@quantis.local` / `Quantis-Owner-2026!` など）。
- 投入例: `e2e/fixtures/ingestion-reliability-example.sql`（第5章）。後片付けは `ingestion-reliability-cleanup.sql`。
- E2E: `pnpm build && E2E_PORT=3100 E2E_CRON_SECRET=local-cron-secret-0123456789 pnpm test:e2e`（本番相当のサーバーを起動した状態で）。dev だけの検査（時計のずれ）は dev で別に流す（C8-6 の手順を CLAUDE.md に書く）。DB 込みのテスト: `pnpm test:db`。
- 追加する環境変数は無い。

## 4. 画面とエンドポイント

### 全画面: データの鮮度の警告
- ヘッダーの直下に `data-testid="stale-data-warning"`。第2章の4の条件のときだけ出る。
- 1行目「データが古くなっています（最終更新: YYYY-MM-DD HH:mm）」（`stale-data-warning-latest`）。
- 古い target ごとの行（`stale-data-target`、`data-target="daily_quotes"` など）に、名前と最終更新日時。
- リンク「実行履歴を確認」（`/imports#history`）。
- 見た目は注意（caution）の配色とアイコン。ライト・ダークで WCAG AA。375px で横スクロールしない。

### 取り込み状況 `/imports`（実行履歴）
- 結果の列: バッジ（`RunStatusBadge`）に「一部完了」を加える（`data-status="partial"`・`data-partial-kind="incomplete|failed"`）。
  - 残りがあればバッジの下に `run-remaining`「残り 3,512 銘柄」（単位は第2章の1）。
  - 失敗があれば `run-failed-count`「失敗 2 件」。
- **列は足さない**（R1。`e2e/dashboard.spec.ts` が見出しの7列を完全一致で比べている）。
  - 「開始」の列の日時を、実行の詳細（`/imports/runs/<id>`）へのリンク `run-detail-link` にする。文字は日時のまま。`aria-label` は「実行の詳細（株価・2026-09-25 20:00 開始）」の形。
  - 375px のカード形式では、開始の日時を同じリンクにする。
  - 既存の列の順番・見出しは変えない。
- 「今すぐ取り込み」の結果の文言（`formatRunResult`）に「一部完了: …」を加える。

### 実行の詳細 `/imports/runs/[id]`（新規。ナビゲーションの項目ではない）
- `/imports` の配下なので、ヘッダーのナビゲーションの「取り込み状況」に `aria-current="page"` を付ける（既存の `isNavItemActive` の規則のまま）。銘柄詳細はナビゲーションの項目の配下ではないので付けない、という既存の方針とも矛盾しない。
- パンくず「取り込み状況 › 実行の詳細」。見出し「実行の詳細」。タイトル「実行の詳細（株価・2026-09-25 20:00）」の形。
- 概要（`run-overview`）: 対象（長い名前）、起動、開始、終了、結果（バッジ）、処理件数、残り（単位つき）、失敗の件数、中断の理由（`run-stopped-reason`。例「時間の上限（210 秒）に達したため」「呼び出し回数の制限が解消しなかったため」「応答が無くなったため（15 分以上）」「上場廃止の反映を保留したため」）、エラーのメッセージ。
- API の呼び出し（`run-api-calls`）: 呼び出しの回数と、制限の記録（`run-rate-limit`）。例「呼び出し回数の制限: 4 回（3 回再試行、待機 合計 1分45秒）。解消しなかったため中断しました」「…2 回（2 回再試行、待機 合計 45 秒）。再試行で回復しました」。制限が0回なら「呼び出し回数の制限には当たっていません」。
- 失敗した対象（`run-failures`）: 表の列は「種類」「コード」「銘柄名」「対象」「エラー内容」。
  - 種類: 銘柄／開示日／書類一覧の日／書類。
  - コードは銘柄詳細へのリンク（銘柄マスタにあれば）。
  - 対象: 開示日・一覧の日は日付、書類は書類ID と書類種別。
  - 財務の開示日の行には「この日に開示したすべての銘柄の財務が未取得です。次回の取り込みで再試行します」と注記する。
  - 上限を超えた分は「ほか N 件」。失敗が0件なら「失敗した対象はありません」。
  - `stale` の実行には「応答が無くなった実行では、失敗した対象の一覧が一部欠けていることがあります」。
- 実行中の実行: 結果は「実行中」、終了は「—」。応答の無くなった実行には、Sprint 3 の注記。
- 存在しない id（`/imports/runs/999999`）、形の違う id（`abc`・`0`・`-1`・`1.5`・`01`）は、保護画面の枠の中の 404（HTTP 404）。文言は「実行が見つかりません」と「取り込み状況に戻る」のリンク（名前は「取り込み状況に戻る」）。

### スクリーニング `/screening`
- 実行中の実行があれば、結果の見出しの近くに `ingestion-running-note`（第2章の5）。
- 残りのある target があれば、`ingestion-remaining-note`（第2章の5の3）。
- 上場廃止の銘柄は結果に出ない。上場廃止が1つ以上あれば `delisted-excluded-note`「上場廃止の N 銘柄は検索の対象外です」。「銘柄マスタ N 銘柄中」の N は上場中の銘柄の数。

### 銘柄詳細 `/stocks/[code]`
- 上場廃止の銘柄: 見出しの横に `delisted-badge`「上場廃止」、その近くに「2026-09-18 の銘柄マスタで確認」。条件の判定の区画の「結果に含まれるか」は「含まれない（上場廃止）」（`data-included="false"`・`data-reason="delisted"`）。
- 実行中の実行があれば `ingestion-running-note`。

### ダッシュボード `/`
- 銘柄数のタイルに `dashboard-delisted-count`「うち上場廃止 N 銘柄」（N > 0 のときだけ）。

### エンドポイント
- `GET /api/ingestion/runs/[id]`（新規）: `requireApiUser()`、`jsonNoStore`。
  - 200 `{ "data": { "run": <実行>, "failures": [<失敗>], "failuresOmitted": n } }`。
    - `<実行>` = 既存の `ApiRun` に `stoppedReason`・`remainingCount`・`remainingUnit`・`failedCount`・`partialKind`（`incomplete`／`failed`／null）・`apiCalls`・`rateLimit`（`{hits, retries, waitedMs, exhausted}` または null）を加えたもの。
    - `<失敗>` = `{ itemType, itemKey, code, companyName, reason, httpStatus, message }`（`message` は画面と同じ文言）。
  - id の形が違えば 400 `{"error":"invalid_id"}`、無ければ 404 `{"error":"not_found"}`、未ログイン 401、許可リスト外 403。
- `GET /api/ingestion`: `runs[]`・`activeRun` に上の `stoppedReason`・`remainingCount`・`remainingUnit`・`failedCount`・`partialKind` を加える。
- `GET /api/dashboard`: `freshness`（`{ stale: boolean, lastUpdatedAt: string|null, targets: [{ target, lastUpdatedAt, stale, remainingCount, remainingUnit }] }`。取得に失敗したら `null`）と `delistedCount` を加える。
- `GET /api/screening`: 上場廃止を除いた結果。`delistedCount` を加える。`stockCount` は上場中の数。
- `GET /api/stocks/[code]`: `stock.delisted_on`（日付または null）。`evaluation.delisted`（真偽値）。上場廃止なら `evaluation.included = false`。
- `/api/cron/*`・`POST /api/ingestion/runs`: 認証・応答の形は変えない（中身の取り込みが第2章の1〜3・6の振る舞いになる）。

## 5. データの保存形式と追加する DB オブジェクト

名前は目安。実装で変えた場合は、self-review と投入例の SQL で示す。

| オブジェクト | 内容 |
|---|---|
| `ingestion_runs` の列 | `stopped_reason text`（第2章の1の値の check）、`remaining_count integer`（≥0）、`remaining_unit text`（`stocks`／`disclosure_dates`／`list_dates`／`documents` の check）、`failed_count integer not null default 0`（≥0）、`last_progress_at timestamptz`（R3） |
| `ingestion_run_failures` | `run_id`（`ingestion_runs` への参照、削除で連鎖）、`item_type`（`stock`／`disclosure_date`／`list_date`／`document`）、`item_key`（コード・日付・書類ID）、`code`（銘柄コードまたは NULL。参照にしない＝銘柄が消えても行は残る）、`reason`（第2章の2のコード）、`http_status`、`network_error`（`timeout`／`network`／NULL）、`created_at`。一意 (`run_id`, `item_type`, `item_key`)。RLS: 許可ユーザーの select だけ。書き込みは service_role の関数 |
| `stocks.delisted_on` | date。NULL = 上場中 |
| `data_freshness(p_now timestamptz default now())` | 第2章の4。authenticated・security invoker |
| 変更する関数 | `start_ingestion_run`（stale の後片付け）、`finish_ingestion_run`（新しい列と失敗の行）、保存の関数5つ（`last_progress_at`）、`complete_stock_master_run`（上場廃止の確認・保護）、`listing_dates_pending`・`edinet_ingestion_state`（上場廃止を除く）、`screening_evaluate`・`screen_stocks`・`stock_detail`（上場廃止）、`dashboard_summary`（`delistedCount`） |
| `details` | `rateLimit`（第2章の3）。`failedDocuments` は廃止（失敗の行に移す） |

### 投入例 `e2e/fixtures/ingestion-reliability-example.sql`（`postgres` ユーザーで実行）

ジェネレーターがこの内容の SQL を作る。実行はすべて `details ->> 'fixture' = 'sprint-12'` を持ち、後片付け（`ingestion-reliability-cleanup.sql`）はそれと 9N… だけを消す。

銘柄（すべて `product_category '011'`、グロース 0113、情報・通信業 5250）:

| コード | 社名 | 上場廃止 |
|---|---|---|
| 9N001 | 検証用株価失敗一株式会社 | — |
| 9N002 | 検証用株価失敗二株式会社 | — |
| 9N003 | 検証用上場廃止株式会社 | `delisted_on = 2026-09-18` |
| 9N004 | 検証用書類失敗株式会社 | — |

実行（日時は `now()` からの相対。どれも終了済み）:

| 名前 | target・起動 | 開始 | status | processed | stopped_reason | remaining | failed_count | 期待する表示 |
|---|---|---|---|---|---|---|---|---|
| A | daily_quotes・cron | 3 時間前（3分30秒後に終了） | partial | 350 | time_budget | 3,512 stocks | 0 | 一部完了、残り 3,512 銘柄。メッセージ「時間内に処理しきれなかったため、残り 3,512 銘柄は次回の取り込みで処理します」。`details.apiCalls = 362`、`rateLimit = {hits:0, retries:0, waitedMs:0, exhausted:false}` |
| B | daily_quotes・manual | 2 時間前 | partial | 120 | NULL | 0 stocks | 2 | 一部失敗、失敗 2 件。失敗の行: 9N001 `http_error` 500、9N002 `unreachable` `timeout`。メッセージ「2 銘柄で株価を取得できませんでした。次回の取り込みで再試行します」 |
| C | financials・cron | 1 時間前 | partial | 812 | rate_limited | 20 disclosure_dates | 1 | 一部失敗、残り 20 日分、失敗 1 件。失敗の行: 開示日 2026-09-01 `http_error` 500。`rateLimit = {hits:4, retries:3, waitedMs:105000, exhausted:true}`。メッセージは第2章の3の「3 回待って再試行しましたが解消しなかったため中断しました」を含む |
| D | edinet_reports・cron | 30 分前 | partial | 40 | time_budget | 15 documents | 2 | 一部失敗、残り 15 件の書類、失敗 2 件。失敗の行: 書類 `S12NTST1`（9N004 に結び付く。書類の行も投入）`not_found` 404、一覧の日 2026-09-20 `invalid_format` |
| E | stock_master・cron | 20 分前 | succeeded | 3,861 | NULL | NULL | 0 | 成功。失敗の行なし（詳細は「失敗した対象はありません」） |

A〜E の `last_progress_at` は、それぞれの終了の数秒前。A〜E はすべて 3 時間以内に終わっているので、この投入例だけでは鮮度の警告は出ない。

target ごとの最新の実行は次のとおり。
- 株価 = B（残り 0）
- 財務 = C（残り 20 日分）
- EDINET = D（残り 15 件の書類）
- 銘柄マスタ = E

したがって `/screening` の `ingestion-remaining-note` は「未取得の残りがあります（財務 20 日分・EDINET 15 件の書類）…」になる。株価は、最新の B の残りが 0 なので出ない。

### 鮮度の確認用（C4 で使う SQL の例）
```sql
-- 48 時間ちょうど前に終わった株価の成功（古い）
insert into public.ingestion_runs (target, trigger, status, started_at, finished_at, details)
values ('daily_quotes', 'cron', 'succeeded', now() - interval '48 hours 3 minutes', now() - interval '48 hours', '{"fixture":"sprint-12"}');
```

## 6. テスト可能な完了条件

前提:
- 第3章の手順で 3100 番に起動し（キーなし）、`owner@quantis.local` でログイン済み。画面の幅は特記の無い限り 1280×800。
- DB は `pnpm db:reset && pnpm seed:users` の直後から始める（市場データ・実行履歴は0件）。
- 特記の無い限り、`pnpm dev -p 3100` と `pnpm build && pnpm start -p 3100` の両方で満たすこと。
- 「test:db」とある項目は、外部 API（fetch）と時計だけを差し替え、実際の DB に対して取り込みを動かすテスト。評価者は `pnpm test:db` の結果と、テストのコードの内容で確かめる。

### C1. 一部完了と再開（AC11.1）
1. test:db（株価）: 未確定 10 銘柄、期限が 4 銘柄分の時点。
   - 1回目は `partial`・`stopped_reason = time_budget`・`remaining_count = 6`・`remaining_unit = stocks`・`failed_count = 0`・`processed_count = 4`。
   - 2回目（同じ差し替え、期限なし）は、残りの6銘柄の要求だけを送り（1回目に保存した4銘柄のコードでの要求が0回）、`succeeded`・`remaining_count = 0`。
2. test:db（財務）: 1回目が期限で `partial`・`remaining_unit = disclosure_dates`。2回目は、取得済みの開示日を要求しない（直近7日の取り直しを除く）で終える。
3. test:db（EDINET）:
   - 書類一覧の途中の期限で `remaining_unit = list_dates`。
   - 一覧を取り終えた後、本文の途中の期限で `remaining_unit = documents`。
   - 2回目は処理済みの書類を要求しない。
4. 応答の無い実行の後片付け:
   - `processed_count = 120`・開始 16 分前の `running` の行（`daily_quotes`）を入れて、「今すぐ取り込み」（銘柄マスタ。キー未設定で失敗）を押す。その行が `partial`・`stopped_reason = stale` になり、実行履歴に「一部完了」とメッセージ（第2章の1）が出る。
   - `processed_count = 0` の同じ行は `failed` で、メッセージは今までどおり `15 分以上応答が無かったため、中断されたものとみなしました`（完全一致。既存の `e2e/ingestion.spec.ts` の `STALE_MESSAGE` と同じ）。
   - `processed_count = 120` の行の `last_progress_at` は、入れた値のまま変わらない（後片付けで上書きしない）。
5. 投入例の実行履歴:
   - A: `data-partial-kind="incomplete"` の「一部完了」と「残り 3,512 銘柄」、処理件数 350。
   - B: 「一部失敗」と「失敗 2 件」。C: 「一部失敗」「残り 20 日分」「失敗 1 件」。D: 「一部失敗」「残り 15 件の書類」「失敗 2 件」。E: 「成功」。
   - 新しい列の無い `partial` の行（`insertRun` で入れる）は「一部失敗」のまま。
   - 375px のカード形式でも同じ。
6. 「今すぐ取り込み」の結果の文言（`formatRunResult`）は、時間切れの `partial` で「一部完了: …（時間内に処理しきれなかったため、残り N 銘柄は次回の取り込みで処理します）」（単体テスト）。

### C2. 失敗の一覧（AC11.2）
1. test:db（株価）: 5銘柄のうち2銘柄だけ 500・接続の失敗（タイムアウト）を返す。
   - 残りの3銘柄は保存され、`partial`・`failed_count = 2`。
   - 失敗の行は2行（`stock`、コード、`http_error`/500、`unreachable`/`timeout`）。
   - 2回目は失敗した2銘柄だけを要求する。
2. test:db（株価）: 5銘柄続けて 500 なら、6銘柄目を要求せずに打ち切る（`consecutive_failures`）。1銘柄の失敗の後に成功があれば数え直す。
3. test:db（財務）: ある開示日が 500 なら、`disclosure_date` の行が1行でき、ほかの開示日は保存される。
4. test:db（EDINET）:
   - 書類の 404 は `document` の行（`code` は結び付く銘柄）。
   - 書類一覧のある日の形式の違いは `list_date` の行。
   - `details.failedDocuments` は無くなっている。
5. test:db: 失敗の行・`error_message`・`details` に、差し替えた応答の本文に入れた目印の文字列、URL、キーが含まれない。
6. test:db（または単体テスト）: 失敗が 1,001 件のとき、行は 1,000 行、`failed_count = 1001`、API の `failuresOmitted = 1`。
7. 実行履歴の B の行の「開始」の日時のリンク（`run-detail-link`）を押すと、`/imports/runs/<B の id>` に移る。
   - ヘッダーの「取り込み状況」に `aria-current="page"` が付いている。
   - 実行履歴の表の見出しは、今までどおり7列。
   - `run-failures` に 9N001「検証用株価失敗一株式会社」「J-Quants から予期しない応答がありました（HTTP 500）」、9N002「J-Quants に接続できませんでした（タイムアウト）」の2行。
   - コードのリンクで `/stocks/9N001` に移る。
8. C の詳細: 開示日 2026-09-01 の行と、第4章の注記。D の詳細: 書類 `S12NTST1`（9N004・銘柄名・書類種別）と、一覧の日 2026-09-20 の行。E の詳細: 「失敗した対象はありません」。
9. `GET /api/ingestion/runs/<B の id>`: 第4章の形で、`failures` が2件、`message` が画面と同じ。
   - 未ログインは 401・`no-store`。
   - `/api/ingestion/runs/abc`・`/0` は 400 `invalid_id`、`/999999` は 404 `not_found`。
10. `/imports/runs/999999`・`/imports/runs/abc` は保護画面の枠の中の 404（HTTP 404）で、「実行が見つかりません」と「取り込み状況に戻る」。未ログインでは `/login?next=…` へ移る。

### C3. 呼び出し回数の制限（AC11.4）
1. test:db（株価）: ある銘柄の要求に 429 を2回返してから 200 を返す。
   - 待ち時間は 15 秒・30 秒（差し替えた時計の `sleep` の記録で確かめる）で、同じ要求を再試行する。
   - 実行は `succeeded`、`rateLimit = {hits:2, retries:2, waitedMs:45000, exhausted:false}`。
   - 回復後の要求の間隔は 1,200ms 以上。
2. test:db（株価）: 429 を4回返すと、3回再試行した後に打ち切る（それ以降の要求なし）。
   - `stopped_reason = rate_limited`・`exhausted = true`。
   - 保存済みがあれば `partial`、無ければ `failed`。メッセージに「3 回待って再試行しましたが解消しなかったため中断しました」。
3. test:db: `Retry-After: 7` なら 7 秒待つ。`Retry-After: 600` なら 120 秒に収める。
4. test:db: 待ちの終わりが期限を超えるときは、`sleep` せずに打ち切る（`rate_limited`、メッセージは「待ち時間が取り込みの時間の上限を超えるため中断しました」を含む）。
5. test:db: 財務（`/fins/summary` と取引カレンダー）、銘柄マスタ、EDINET（書類一覧・書類取得の 429 と 503）でも、1〜2 と同じ振る舞い。
6. 要求の間隔（600／1,100／1,000ms）の既存のテストが通る。
7. 投入例の C の詳細の `run-rate-limit` に「呼び出し回数の制限: 4 回（3 回再試行、待機 合計 1分45秒）。解消しなかったため中断しました」。A の詳細は「呼び出し回数の制限には当たっていません」と「API の呼び出し 362 回」。

### C4. データの鮮度の警告（AC11.3）
実行履歴が0件の DB から始める（投入例は入れない）。
1. 実行が0件: `/`・`/screening`・`/imports`・`/settings`・`/zzz`（404）に `stale-data-warning` が無い。
2. `daily_quotes` の `succeeded`（終了 47 時間 59 分前）だけ: 警告なし。終了を 48 時間前に変えると、1 の各画面と `/stocks/<任意の既存コード>` の上部に警告が出る。
   - 1行目は「データが古くなっています（最終更新: <その終了日時の JST の YYYY-MM-DD HH:mm>）」。
   - `stale-data-target` は `daily_quotes` の1行で「株価（初出日）」。
   - ログイン画面（ログアウト後の `/login`）には出ない。
3. 2 に `daily_quotes` の `partial`（終了 1 時間前）を足すと、警告が消える。代わりに `failed`（終了 1 時間前）を足した場合は、警告は消えない。
4. 複数の target:
   - 入れる行: `stock_master` 成功（1 時間前）、`financials` 成功（50 時間前）、`edinet_reports` 一部失敗（72 時間前）。`daily_quotes` は無し。
   - 1行目の日時は `edinet_reports` のもの。`stale-data-target` は `financials`・`edinet_reports` の2行で、それぞれの日時。`stock_master`・`daily_quotes` は出ない。
5. 「実行履歴を確認」で `/imports` の実行履歴に移る。
6. `GET /api/dashboard` の `freshness` が 2〜4 のそれぞれで画面と一致する（`stale`、`lastUpdatedAt`、`targets[].stale`）。
7. test:db: `data_freshness(p_now)` の境界。`p_now − finished_at` が 47:59:59.999 なら古くない、48:00:00 ちょうどは古い。
8. 375px（警告あり）で `document.documentElement.scrollWidth <= 375`。警告の高さは C4-4 の2 target の状態で測り、次に収まる。
   - 1280 幅: 3行以内（1行目＋内訳2行）
   - 375px: 4行以内（1行目の折り返しを含む）
9. 警告があっても、既存の E2E が変更なしで通る。特に Sprint 6 の「1280×800・375×812 で注記が画面の中」（`screening.spec.ts` の `toBeInViewport`）。
   - **ジェネレーター**: 固定日時の3つの投入例（`screening-example.sql`・`ownership-example.sql`・`business-results-example.sql`）の実行の日時を、一時的に 72 時間より前にした状態でも全件の E2E を流す。この変更は**コミットしない**。結果は self-review に書く。
     - 3つの投入例は、どれも `daily_quotes` の成功の終了が 2026-09-24 20:03 JST。
     - 今日（2026-09-25）は警告の無い状態なので、警告のある状態を評価より先に確かめるため。
   - **評価者**: 境（2026-09-26 20:03 JST）の前後どちらの時刻に評価しても、両方の状態（警告なし・警告あり）を確かめる。
10. test:db（R3）: 次の状態で後片付け（`start_ingestion_run`）を走らせる。
    - 前提: `daily_quotes` の `running` の行が1つだけある（開始 3 日前・`processed_count = 120`・`last_progress_at` = 3 日前）。
    - その行は `partial`・`stale` になる。
    - `data_freshness()` の `daily_quotes` の最終更新は 3 日前（`last_progress_at`）で、`stale = true`（警告は消えない）。
    - `last_progress_at` が NULL の stale の行は数えない。
11. R5: `data_freshness()` の呼び出しが失敗したときの振る舞い。単体テストで、読み出しを失敗させるか、形の違う値を返させて確かめる。
    - 保護画面の枠は、警告なしで描画され、例外を投げない。
    - ダッシュボードの取得の関数は `freshness: null` を返す。API も 200 で `freshness: null`。
    - ダッシュボードには「データの鮮度を確認できませんでした」が出る。

### C5. 取り込み中の検索（AC11.5）
1. test:db（整合）: 対象は保存の関数5つ（`complete_stock_master_run`・`save_stock_listing_dates`・`save_financial_statements`・`save_edinet_document_list`・`save_edinet_extractions`）。
   - **主眼はコミットの後**。各関数の呼び出しがコミットされた直後に、authenticated の接続から `screen_stocks`・`stock_detail` を呼ぶ。保存した値と、それから求めた値（指標・判定・上場廃止・初出日の年数）が、そろって返る（保存と再計算が同じトランザクション）。
   - `save_edinet_document_list` は、取り下げ・不開示・提出者の更新がトリガーで期と指標・判定を再計算する経路として確かめる。例: 補完に使っていた届出書を取り下げると、コミットの後の CAGR が補完なしの値になる。
   - 補助として、別の接続で `begin` して呼んだだけ（コミット前）の間は、保存の前の値が返ることも確かめる。
2. `running` の実行（`financials`、開始 2 分前）を入れると、`/screening` と `/stocks/99990`（`screening-example.sql` を入れた状態）に `ingestion-running-note` が出る。文言は「取り込みを実行中です（財務・HH:mm 開始）」で始まり、第2章の5の説明を含む。検索（閾値の変更・並べ替え）は今までどおり動く。
3. 開始 16 分前の `running`（応答なし）では注記は出ない。実行が無い・終了済みだけのときも出ない。
4. 投入例を入れると、`/screening` に `ingestion-remaining-note`「未取得の残りがあります（財務 20 日分・EDINET 15 件の書類）」があり、株価は含まれない（第5章）。
   - `GET /api/dashboard` の `freshness.targets` の `financials` は、`remainingCount = 20`・`remainingUnit = "disclosure_dates"`。
5. 投入例に加えて、`daily_quotes` の `partial`（`remaining_count = 3,000`・`stocks`、終了 10 分前）を入れると、注記の先頭が「株価 3,000 銘柄」になる。続けて `daily_quotes` の `succeeded`（残り 0、終了 5 分前）を入れると、株価が注記から消える。
6. 実行が0件のとき、または残りのある target が無いときは、`ingestion-remaining-note` が無い（既存の E2E の画面に新しい注記は出ない）。

### C6. 上場廃止（AC11.6）
1. test:db（銘柄マスタ）:
   - 保存済み 9N901・9N902・9N903 に対して、一覧が 9N901・9N902 だけを返す（`Date = 2026-09-18`）。9N903 の `delisted_on = 2026-09-18` になり、行と、ほかの列は残る。
   - 実行は `succeeded` で、`details` に上場廃止を確認した数 1。結果の文言に「上場廃止を確認: 1 銘柄」。
2. test:db: 次の一覧に 9N903 が戻ると `delisted_on` は NULL（`details` に再び現れた数 1）。一覧に行はあるが対象外（例 `Mkt = 0109`）になった銘柄も、上場廃止として扱う。
3. test:db（保護）: 保存済みの上場中の銘柄から、1回で 101 銘柄が消える一覧。
   - 上場廃止は1つも付かない（上場中の行の upsert は行われる）。
   - 実行は `partial`・`stopped_reason = delisting_held`、メッセージは第2章の6のもの。
   - 100 銘柄ちょうどなら反映する。
4. test:db: 上場廃止の銘柄は、株価の初出日の対象（`listing_dates_pending`）と EDINET の本文の対象に入らない。
5. test:db: 上場廃止の銘柄に付けた手動補正（`ownership_overrides`）は残り、再上場すると一覧の判定に使われる。
6. 投入例を入れて `/screening?off=cagr,margin,years,owner` を開く。
   - 9N001・9N002・9N004 があり、9N003 は無い。
   - `delisted-excluded-note`「上場廃止の 1 銘柄は検索の対象外です」がある。
   - `unavailable=include&undeterminable=include` を足しても 9N003 は出ない。
   - `GET /api/screening?off=cagr,margin,years,owner` も同じで、`delistedCount = 1`。`stockCount` は 9N003 を数えない。
7. `/stocks/9N003`:
   - `delisted-badge`「上場廃止」と「2026-09-18 の銘柄マスタで確認」がある。
   - 「結果に含まれるか」は「含まれない（上場廃止）」。条件をすべてオフにしても同じ。
   - `GET /api/stocks/9N003` の `stock.delisted_on = "2026-09-18"`、`evaluation.delisted = true`、`evaluation.included = false`。
   - `/stocks/9N001` にはラベルが無く、`evaluation.delisted = false`。
8. ダッシュボードに「うち上場廃止 1 銘柄」。`GET /api/dashboard` の `delistedCount = 1`。上場廃止が0なら表示しない。
9. 9N003 の `delisted_on` を NULL に戻すと、リロードで一覧に現れ、ラベルが消える。

### C7. 性能
`pnpm test:db` で確かめ、**実測値を self-review に書く**（C8-4）。
1. `screen_stocks`（既定の4条件・`sort=owner`）が、4,000 銘柄のうち 200 銘柄が上場廃止のデータで、authenticated として 100ms 以内（既存の基準）。
2. `data_freshness()` が、実行履歴 5,000 行で 20ms 以内。
3. `GET /api/ingestion/runs/[id]` の読み出し（失敗 1,000 行の実行）が 100ms 以内（DB の関数・クエリの時間）。

### C8. 持ち越し（Sprint 11 の m1・m2・m3・m5・m6、E2E の手順）
1. **m2**: 9U003 に補正がある状態で `/screening?off=owner`。条件の印 ④ の `title` に「（手動補正）」が無い。条件④がオンのときは今までどおり付く。
2. **m3**:
   - 補正を保存した後、フォーカスが「編集」ボタン（または補正後の判定の見出し）にある。
   - 取り消しのダイアログで「取り消す」を押した後、フォーカスが「判定を手動で補正する」ボタンにある。
   - `document.activeElement` が `body` でない。
3. **m6**: `toApiOverride()` は、DB の値の形が想定と違うときに `null` を返さない。API は 500 `internal_error` を返し、ログを残す（単体テスト）。
4. **m5**: 性能のテストが実測値を出力する（`expect` のメッセージに値を含めるなど。`pnpm test:db` の出力に値が出る）。self-review に C7 の実測値を書く。
5. **m1**: CLAUDE.md の手動補正の API の説明に、一覧・詳細・書き込みの応答の `auto_current`（現在の自動判定）と `auto_at_override`（補正時の記録）を書く。
6. **E2E の手順**: CLAUDE.md のコマンドの表に、次の2点を書く。Sprint 10・11 の評価の注記（dev のメモリの閾値での再起動）も残す。
   - 全件の E2E は本番相当のサーバー（`pnpm build && … pnpm start -p 3100`）で流すこと。
   - dev でしか意味の無い検査（`simulateServerClockBehind()` を使うもの）は、`pnpm dev` で対象のファイルだけを流すこと。

### C9. 画面のそのほか
1. ライト・ダークの両方で、鮮度の警告・「一部完了」のバッジ・実行の詳細・「上場廃止」のラベル・取り込み中の注記の文字が WCAG AA（4.5:1）。「一部完了」と「一部失敗」は色以外（文字）でも区別できる。
2. dev で `simulateServerClockBehind()` の状態で、`/imports/runs/<id>`・`/imports/runs/999999`（404）・`/stocks/9N003`・`/screening`（警告あり）を開き、コンソールのエラーと `pageerror` が0件。
3. 実行の詳細の表は 1280 で横スクロールなし、375px でページの横スクロールなし（表だけが横にスクロールするのは可）。
4. 画面を開いても `ingestion_runs` の行数が変わらない（警告・詳細・注記は読むだけ）。
5. どの画面を開いても、ブラウザのコンソールにエラーが出ない（dev と prod）。

### C10. リグレッション・品質
1. **既存のテストの変更の範囲**: 変えてよいのは次の種類だけ。
   1. 429 を受けたらすぐに打ち切ることを前提にしたテスト（例: `listing-dates.db.test.ts` の C4-7、財務・EDINET・銘柄マスタの同種のテスト）を、待って再試行する振る舞い（第2章の3）に書き換えること。
   2. `details.failedDocuments` を読むテストを、失敗の行を読むように書き換えること。
   3. 時間切れの `partial` の文言・表示の名前（「一部失敗」→「一部完了」）の期待値。新しい列を持つ実行だけが対象で、列の無い行の期待値は変えない。
   4. 応答の無い実行の後片付けで、`processed_count > 0` の行の期待値（`failed` → `partial`）。
   5. API の応答の形の厳密な比較に、新しい項目を足すこと。`e2e/db-privileges.spec.ts` の許可リストに、新しいテーブル・関数を足すこと。
   
   ほかの期待値は変えない。self-review に、変えたアサーションを、ファイル・行と前後の値つきで一覧にする。想定外の変更が要るときは、理由を self-review に書き、呼び出し元に報告する。
2. Sprint 1〜11 の完了条件が引き続き満たされる（評価者の判断で抜き取り確認）。特に、上場廃止が0件のときのスクリーニングの件数・並び、ダッシュボードの件数、補正の表示が変わらないこと。
3. `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm test:db`、`pnpm build` がすべて成功する。
4. 本番相当のサーバー（キーなし）で `E2E_PORT=3100 pnpm test:e2e` がすべて成功する。dev でも、時計のずれの検査を含むファイルが成功する。
   - 追加する E2E（`e2e/ingestion-reliability.spec.ts`）: C1-4・C1-5、C2-7〜C2-10、C3-7、C4-1〜C4-6・C4-8、C5-2〜C5-6、C6-6〜C6-9、C8-1・C8-2、C9-2・C9-3。
   - C4-9 のとおり、固定日時の投入例を一時的に古くした状態でも全件の E2E を流す。結果（件数と失敗の有無）を self-review に書く。
   - E2E の後、DB の市場データ・EDINET・判定・補正・実行履歴は、開始前（0件）に戻る。
5. `pnpm test:db` の後片付けは、自分の接頭辞だけを消す（コード `9N…`、書類ID `S12N…`、提出者 `E12N…`、性能 `N0000`〜`N3999`、実行は `details ->> 'fixture'` などの目印）。
6. `sprint-12: 日次取り込みの信頼性` でコミットされている。未追跡の `docs/harness/sprints/sprint-11/evaluation-1.md` も同じコミットに含める。
7. `CLAUDE.md` に次が追記され、「現状」が Sprint 12 までになっている。
   - 実行の新しい列と「一部完了」の規則、失敗の行、呼び出しの制限の再試行、鮮度の判定（`data_freshness`）、取り込み中の注記、上場廃止（`delisted_on`・保護・行を消さない）、実行の詳細の画面と API
   - C8-5・C8-6
   - 鮮度は「保存が1件でもあれば更新とみなす」こと
   - 警告が、クライアント遷移では更新されないこと
   - 大量の上場廃止の保留（`delisting_held`）を解く手順
   - テストの接頭辞
8. self-review に、第2章の ★ の論点の扱い（ユーザーの決定があればそれ）と、C10-1 の変更の一覧と、C7 の実測値を書く。

## 7. 評価者への補足

- すべての完了条件は、キーなしの環境で確かめられる。外部 API の振る舞い（失敗・429・時間切れ・銘柄マスタからの消失）は `pnpm test:db` で、画面の表示は投入例で確かめる。
- 投入例の実行の行は、取り込みが書く値と同じ形である（ジェネレーターは、test:db で実際の取り込みが書いた行と、投入例の行の列の集合が同じことを確かめる）。
- 鮮度の警告の確認（C4）は、投入例を入れずに、実行の行だけを入れる（投入例の実行は新しいので、警告を消してしまう）。
- 上場廃止は `stocks.delisted_on` を直接書き換えて確かめてよい（銘柄マスタの取り込みが書く列と同じ）。
- 取り込み中の注記（C5-2）は、`running` の行を入れて確かめる。確かめたら行を消す（残すと「今すぐ取り込み」が押せない）。

## 8. 今回やらないこと（後続スプリント）

- 取り込みを速く終わらせるための、定期実行の回数の追加（例: EDINET の初回の書類を1日に何回かに分けて処理する）。Vercel の Cron の制限（プランごとの回数・間隔）の確認が要るので、別の判断にする。今の初回の所要（CLAUDE.md）は変わらない。
- 失敗が続く銘柄・書類の「要注意」の一覧や、実行をまたいだ失敗の集計。実行ごとの一覧までにする。
- 実行の詳細の自動更新（実行中の進み具合をその場で更新する）。取り込み状況の画面の既存の `router.refresh()` はそのまま。
- 上場廃止の日付の正確な取得（J-Quants の上場廃止日）。「銘柄マスタで確認した日」までにする。
- 通知（メール・Slack など）。仕様のスコープ外。
- Sprint 11 の m4（確認済みの日時の列）。補正の機能を触るスプリント（ウォッチリストなど）で検討する。
- 条件プリセット（F12）、ウォッチリスト（F13）、AI の判定補助（F14）。

## 9. 改訂履歴

- 初版: 契約作成
- 改訂1（rev 1）: contract-review.md（1回目）の R1〜R5・推奨と、ユーザーの決定を反映した。完了条件の削除・緩和は無い。
  - **ユーザーの決定**:
    - ★1（AC11.5）: 「銘柄単位の整合＋実行中の注記」で承認された。
      - あわせて、レビューの追加案の「未取得の残り」の注記（target ごとの最新の実行の残り）を加えた（第2章の5の3、第4章、C5-4〜C5-6）。
      - 行ごとの「今回更新」の印は任意とし、今回は付けない。
      - C5-1 に `save_stock_listing_dates`・`save_edinet_document_list` を加えた。
    - ★2（AC11.3）: target ごとの判定で承認された（R3 の修正込み）。
  - R1: 実行履歴の表に列を足さず、「開始」の日時を実行の詳細へのリンクにした（第4章、C2-7）。
  - R2: 処理0件の応答なしの実行は `failed`・旧い文言のまま（第2章の1、C1-4）。
  - R3: `last_progress_at` を追加した。stale の行は、鮮度にこの時刻を使う（第2章の1・4、第5章、C1-4、C4-10）。
  - R4: 次の3つを加えた（第2章の4、C4-8・C4-9、C10-4）。
    - ジェネレーターは、固定日時の投入例を一時的に古くした状態でも全件の E2E を流す。
    - 評価者は、境の前後の両方の状態を確かめる。
    - 375px の警告の高さの上限を4行にした。
  - R5: `data_freshness()` の失敗時の振る舞い（枠は警告なしで描画、ダッシュボード・API は失敗を示す）と、その検査を加えた（第2章の4、C4-11）。
  - 推奨:
    - `Retry-After` の解釈（第2章の3）
    - 大量の上場廃止の保留を解く手順（第2章の6、C10-7）
    - `/imports/runs/[id]` の `aria-current`（第4章）
    - CLAUDE.md への記載: 警告がクライアント遷移で更新されないこと、「保存が1件でもあれば更新とみなす」こと（第2章の4、C10-7）
