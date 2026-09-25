# Sprint 14 契約: F13 ウォッチリストと新規該当銘柄の通知

> **改訂1（rev 1）の変更点**（contract-review.md の R1〜R4・m1〜m6 とユーザーの決定。詳細は第9章）
> - R1: 登録済みの銘柄の追加は、上限に達していても冪等に成功する（トリガーが上限の確認を飛ばす）
> - R2: 記録の失敗で日次の取り込みを止めない（セーブポイント、`details.snapshot`）
> - R3: `screening_evaluate` が除外の分類（`exclusion`・`blocking`）を返し、件数・ウォッチリスト・変化の理由がそれを使う。記録の側は入力の取り出し元だけを切り替える
> - R4: 記録を作る `pnpm test:db` は「記録0件」を前提にし、冒頭で確かめる
> - ユーザーの決定: 基準の記録は定期実行の開始時だけ（承認）、補正は両側に今の補正（承認）、Sprint 15 は実施しない（Sprint 14 が最終スプリント）
>
> **改訂2（rev 2）の変更点**（再レビューの R5・m7）
> - R5: 実行の終了（`finish_ingestion_run`・`complete_stock_master_run`）で `details.snapshot`・`snapshotId` を消さない。C7-1 に確認を足し、C3-5 は記録を実際に失敗させて画面を確かめる
> - m7: 銘柄詳細の判定不能の `data-kind` は `unavailable` のまま（互換）
> - 実装の注意: details の書き込みは内側のブロックの外、`when others` はキャンセルを捕まえない、トリガー関数は VOLATILE

## 1. 対象機能

F13。次の2つを作る。

- **ウォッチリスト**: 気になる銘柄を登録し、メモを残せる。
- **新たに該当・外れた**: 前回の取り込みの時点と今とで、既定の条件の「該当」が変わった銘柄を、ダッシュボードに表示する。スクリーニングの結果では、新たに該当した銘柄に「NEW」を付ける。

土台として使うもの:

| 使うもの | 出どころ |
|---|---|
| 判定の式の1か所 `screening_evaluate`（条件①〜④の状態、市場・業種、上場廃止、呼び出したユーザーの手動補正） | Sprint 7・10・11・12 |
| 既定のプリセット（`fetchDefaultPreset`・`parsePresetQuery`）と「画面を開いたときの条件」の規則。API には当てない | Sprint 13 |
| 利用者が自分で書くテーブルの設計（RLS・BEFORE トリガー・ユーザーごとの advisory lock・authenticated は select／insert／update／delete だけ・空白の文字集合 `lib/text/whitespace.ts`・コードポイントで数える） | Sprint 11・13 |
| 取り込みの実行（`start_ingestion_run`・定期実行 `/api/cron/daily`）、実行中・残り・鮮度（`data_freshness`）、上場廃止（`stocks.delisted_on`） | Sprint 3・12 |
| 結果の表・条件の印・手動補正のラベル・「補完」の印などの表示の部品 | Sprint 6・9・10・11 |
| API の認証（`requireApiUser()`）、同一オリジンの確認、`jsonNoStore` | Sprint 1・3 |
| 評価用ユーザー owner・owner2（許可）、intruder（許可リスト外） | Sprint 1・11 |

外部 API は呼ばない。取り込みの対象（target）も増やさない。

### 仕様書の受け入れ基準（引用）

- AC13.1 スクリーニング結果と詳細画面から、銘柄をウォッチリストに追加・削除できる。追加済みかどうかがアイコンでわかる。
- AC13.2 ウォッチリスト画面に、登録した銘柄の最新の指標、条件④の判定、メモ、追加日が表示される。メモは編集でき、リロードしても残る。
- AC13.3 ダッシュボードに「新たに該当」「該当から外れた」銘柄が、直近の取り込み日と一緒に表示される。スクリーニング結果でも、新たに該当した銘柄に「NEW」バッジが付く。
- AC13.4 前回の取り込み時点と今回とで、条件を満たすかどうかが変わるようにデータを投入すると、その銘柄が正しく「新たに該当」または「外れた」に分類される。
- AC13.5 ウォッチリストはユーザーごとで、他のユーザーからは見えない。

関連する仕様の記述:
- F13 概要「既定のプリセットで前回の取り込みから新しく条件を満たした銘柄、条件を満たさなくなった銘柄をダッシュボードに表示する」。
- ユーザーストーリー「毎朝『今日新しく条件に入った銘柄』だけを確認したい」。
- F2「ナビゲーション（ダッシュボード、スクリーニング、ウォッチリスト、取り込み状況、設定）」。AC2.1 により、ウォッチリストはこのスプリントでナビゲーションに加える。
- スコープ外「外部への通知配信（メール、Slack など）」。「通知」は画面の中の表示だけにする。

### 持ち越し事項

| 出どころ | 内容 | 扱い |
|---|---|---|
| Sprint 12 評価の改善提案（Sprint 13 の契約で Sprint 14 に回すと決めた） | ダッシュボードの銘柄数と、取り込み状況のカバー率の分母・分子を上場中にそろえる | 取り込む（第2章の12、C9-1〜C9-3） |
| Sprint 13 評価 m1 | C2-6 の括弧書き「cagr=15 は書かれない」は、入力欄から離れると確定する規則（Sprint 6）と両立しない | 取り込む。コードは変えず、Sprint 13 の契約の C2-6 の文言（改訂履歴に追記）と CLAUDE.md を直す（C9-4） |
| Sprint 13 評価 m2 | 削除の確定の直後の Esc が効かない | 取り込む（C9-5） |
| Sprint 13 評価 m3 | 既定のプリセットに無効な項目があるとき、銘柄詳細（クエリなし）に注記が出ない | 取り込む。ダッシュボード・ウォッチリストにも同じ注記を出す（第2章の7、C9-6） |
| Sprint 13 評価の改善提案 | `preset-bar.tsx`（898 行）をダイアログごとのファイルに分ける | 取り込む。振る舞いは変えない（C9-7） |
| Sprint 12 評価の改善提案 | bigint の最大値の ID が 400 になる | 後に回す（実害が無い） |

## 2. 仕様上の論点と、このスプリントでの解釈

評価者は、この解釈が妥当かも判断してほしい。ユーザーの判断が必要な論点（★）は無い。どれも仕様の文言の範囲の具体化である。振る舞いの選択を含む次の2点は、ユーザーが承認した（改訂1）。
- 第2章の5: 比較の基準は、定期実行の開始時だけに記録する
- 第2章の8: 手動補正は比較の両側に今の補正を当てる（補正による変化は出さない）

### 1. ウォッチリストの保存（ユーザーごと）と、直接の書き込みへの防御

- 新しいテーブル `public.watchlist_items`（名前は目安）。
  - 列:
    - `user_id`（`auth.users` への参照。削除で連鎖）
    - `code`（`stocks` への参照。削除で連鎖。上場廃止では `stocks` の行を消さないので、登録は残る）
    - `memo`（NULL か文字列）
    - `created_at`（追加日時）
    - `updated_at`
  - 主キーは (`user_id`, `code`)。同じ銘柄を2回登録することはできない。
- **これは利用者のデータで、市場データではない**。Sprint 11 の `ownership_overrides`、Sprint 13 の `screening_presets` と同じ方針にする。
  - 書き込みは、そのユーザー自身のセッション（RLS）で行う。サービスロールは使わない。
  - RLS: select・insert・update・delete のすべてで、「`user_id = (select auth.uid())` かつ `(select public.current_user_is_allowed())`」。insert・update の with check も同じ。
  - anon には権限なし。authenticated には select・insert・update・delete だけを grant する（TRUNCATE・REFERENCES・TRIGGER は付けない）。
  - CLAUDE.md の「書き込みは service_role のみ」の例外に、このテーブルを加える（3つ目）。
- **BEFORE INSERT OR UPDATE のトリガー**（行単位）が、行の中身を守る。
  - insert:
    - `user_id` が NULL のときだけ `auth.uid()` を入れる。値が渡されたときはそのまま残す（違えば with check で拒否。Sprint 11 の契約レビューの注意1）。
    - `created_at`・`updated_at` を `now()` にする。
  - update:
    - `user_id`・`code` の変更は 42501 で拒否する。
    - `created_at` は元の値に固定する。
    - `updated_at` は、**`memo` が変わったときだけ** `now()` にし、ほかは元の値に固定する。
  - `memo` の規則（第2章の2）: 前後の空白を除き、除いた後が空なら NULL にする。
  - insert で、そのユーザーの行が既に **500 件**あれば拒否する（SQLSTATE は決めた独自の値。例 `QW500`）。
    - 同じユーザーの同時の insert で上限を超えないよう、ユーザーごとのロック（`pg_advisory_xact_lock`。キーは `'watchlist_items:' || user_id` から作る。プリセットのキーとは別）を取ってから数える。
    - **（R1）ロックを取った後、同じ (`user_id`, `code`) の行が既にあれば、上限の確認を飛ばす**。その insert は、ON CONFLICT の重複として何もせずに終わる。
      - 理由: PostgreSQL は、BEFORE INSERT の行トリガーを ON CONFLICT の重複の確認より先に実行する。確認を飛ばさないと、次の2つが上限のエラーになり、冪等でなくなる。
        - 500 件のユーザーが登録済みの銘柄を追加したとき
        - 499 件のときに、同じ銘柄を同時に追加したとき
      - 直接の insert（PostgREST）でも同じ振る舞いにするため、API ではなくトリガーで扱う。
      - **トリガー関数は VOLATILE（既定）のままにする**。STABLE にすると、文の開始時のスナップショットを使い続けるため、ロックを待った後に、先に確定した同じ銘柄の行が見えない（同時の追加が上限のエラーになる）。
- **check 制約**: `memo` は NULL か、「前後に空白が無く、1〜1,000 コードポイント」。
- 追加は冪等にする。既に登録済みの銘柄の追加は、行を変えずに成功とする（`insert … on conflict do nothing`）。2つのタブから同時に追加しても、エラーにならない。
- 許可リストから外れたユーザーの行は、行としては残るが、読めず書けない（RLS）。

### 2. メモの規則（画面・API・DB で同じ定義）

- 空白の文字集合は、Sprint 11・13 と同じ（`lib/text/whitespace.ts`。DB は同じ文字を明示した文字クラス）。
- 保存する値は、前後の空白を除いた値。除いた後が空なら「メモなし」（NULL）。空のメモの保存は「メモを消す」操作になる。
- 最大 **1,000 コードポイント**（`[...s].length`。「𠮷」は1文字）。
  - **前後の空白を除いた後の値で数える**（m2）。画面の「N / 1,000」も、API・DB も同じ。Sprint 11 のメモと同じ定義。
  - したがって、前後に空白を足した 1,000 コードポイントの本文は保存できる。
- 改行・タブは途中に含められる（複数行のメモ）。表示は改行を保つ（`whitespace-pre-line`）。
- 画面の入力欄に `maxlength` は付けない（UTF-16 の単位で数えるため）。文字数の表示「N / 1,000」はコードポイントで数える。
- 文言: 「メモは 1,000 文字以内で入力してください」。

### 3. 追加・削除の操作（AC13.1）

- **アイコン**（`watchlist-toggle`）は星（lucide の `Star`）にする。登録済みは塗りつぶし、未登録は輪郭だけにする。
  - `aria-pressed` と `data-state="on|off"` を付ける。
  - 名前（`aria-label`）: 「ウォッチリストに追加: 9U001 検証用社長筆頭株式会社」／「ウォッチリストから外す: 9U001 検証用社長筆頭株式会社」。
  - ツールチップ（`title` は使わない。フォーカスでも出る説明）で、登録済みなら「ウォッチリストに登録済み（YYYY-MM-DD に追加）」と示す。
  - 色だけでなく、形（塗りつぶし）でも区別できる。
- 置き場所:
  - **スクリーニングの結果**: 各行のコードの列の中（コードの前）。列は増やさない。
    - 押しても行の遷移（詳細を開く）をしない。
    - キーボードで Tab で届き、Enter・Space で切り替わる。
    - 1280×800 で `results-scroll` の横スクロールを増やさない。
  - **銘柄詳細**: 見出し（コード・社名）の行。ボタンの文字は「ウォッチリストに追加」／「ウォッチリスト登録済み」（アイコン付き）。
    - 登録済みなら、その下に `watchlist-added-note`「YYYY-MM-DD にウォッチリストに追加」を出す。
    - 上場廃止の銘柄も追加・削除できる。
- 押したときの振る舞い:
  - API を呼び、成功してからアイコンを切り替える。待っている間はボタンを無効（`aria-busy`）にする。
  - 失敗したら元の状態のままにし、`watchlist-status`（`role="status"`）に「ウォッチリストを更新できませんでした。時間をおいてもう一度お試しください」と出す。上限なら「ウォッチリストは 500 銘柄まで登録できます」。
  - 成功したら `watchlist-status` に「『検証用社長筆頭株式会社』をウォッチリストに追加しました」／「…から外しました」と出す。
  - スクリーニングの URL・条件・結果・並びは変わらない。履歴も増えない。
  - 成功した後は `router.refresh()` などで、ほかの画面の表示（ウォッチリスト、ダッシュボードの星の印）が、戻る・ヘッダーの遷移で古いまま出ないようにする。
- **メモのある銘柄を外すとき**（どの画面からでも）は、確認のダイアログ（alertdialog `watchlist-remove-dialog`）を出す。
  - 見出し「『検証用社長筆頭株式会社』をウォッチリストから外しますか？」、本文「メモも削除されます。この操作は取り消せません。」。
  - ボタンは「外す」「キャンセル」。
  - メモの無い銘柄は、確認なしで外す。
- 閉じたダイアログのフォーカスは、開いたボタンに戻す（Sprint 13 と同じ）。

### 4. ウォッチリスト画面（AC13.2）

- パスは `/watchlist`。ナビゲーションの「スクリーニング」と「取り込み状況」の間に「ウォッチリスト」を加える（`NAV_ITEMS`。狭い画面のメニューも同じ）。
- 1行1銘柄。並びは**追加日時の新しい順**（同じ日時ならコード順）。並べ替えの操作は作らない。
- 列:
  1. 星（外す操作）
  2. コード・社名（銘柄詳細へのリンク。クエリなし。したがって、詳細は既定の条件で判定する）
  3. 市場区分（上場廃止なら `delisted-badge`「上場廃止」）
  4. 売上CAGR
  5. 営業利益率
  6. 推定上場年数
  7. 条件④の判定（補正後の結果。手動補正なら「手動補正」のラベルと元の自動判定）
  8. 既定の条件（第2章の7）での「該当」
  9. メモ
  10. 追加日
  - 4〜7 の値と条件の印は、スクリーニングの結果の表と同じ部品・書式・丸めで出す（「補完」の印を含む）。条件の状態（満たす・満たさない・算出不可・判定不能）の色分けは、既定の条件で判定したもの。
  - 列 8 の「該当」（`watchlist-inclusion`、`data-kind` は `included`／`delisted`／`filters`／`unmet`／`unavailable`／`undeterminable`）:
    - 文言は、`included` が「該当」。ほかの値の文言と優先順位は、第2章の6の表のとおり（`screening_evaluate` の `exclusion` と `blocking` から作る）。
    - 詳しい説明は、既存の `describeInclusion` の文をツールチップで出す。
    - 新たに該当なら「NEW」、外れたなら「外れた」のバッジ（`watchlist-change-badge`、`data-change="new|removed"`）を添える（第2章の10）。
- 表の上に、判定の条件の出典（`watchlist-conditions`）を出す。「既定のプリセット『厳しめ』の条件で判定しています」か「既定の条件で判定しています」。あわせて「スクリーニングで開く」（`/screening?<その条件の正規形>`）へのリンクを置く。
  - （m5）このクエリは、Sprint 13 の正規形の関数（`presetQueryOf`。`serializeScreeningParams` から page を除いたもの）で作る。ダッシュボードの「スクリーニングで開く」も同じ。
- **メモの編集**:
  - メモのセルの「編集」（メモが無ければ「メモを追加」）を押すと、その行で textarea（ラベル「メモ（9U001）」）と「N / 1,000」、「保存」「キャンセル」になる。
  - ⌘／Ctrl＋Enter で保存、Esc で取り消し（元のメモのまま）。
  - 保存したら `watchlist-status` に「メモを保存しました」を出す。表示は保存した値（前後の空白を除いたもの）。
  - 空にして保存すると、メモが消え（NULL）、「メモを追加」に戻る。
  - 1,001 コードポイントは「メモは 1,000 文字以内で入力してください」を出し、保存しない。
  - 編集中に別の行を編集し始めたら、前の行の編集は取り消す（同時に開くのは1行だけ）。
  - 保存・取り消しの後のフォーカスは、その行の「編集」ボタンに戻す。
- 追加日（`watchlist-added-on`）は `created_at` の **JST の日付** `YYYY-MM-DD`。メモを編集しても変わらない。
- 空状態（`watchlist-empty`）: 「ウォッチリストはまだ空です。スクリーニングの結果や銘柄詳細の☆から追加できます」と、スクリーニングへのリンク。
- 読み出しに失敗したとき（第2章の11）: `watchlist-error`「ウォッチリストを読み込めませんでした。時間をおいて再読み込みしてください」。空状態は出さない。
- 狭い画面（375px）:
  - 表は横スクロールの枠（`watchlist-scroll`）の中に置き、コード・社名の列は左に固定する（スクリーニングと同じ）。ページ全体は横スクロールしない。
  - メモの編集は画面の中で行える（textarea とボタンが画面の外に出ない）。

### 5. 比較の基準（「前回の取り込み時点」の記録）

仕様の「前回の取り込みから」を、次の仕組みで具体化する。

- **判定の入力のスナップショット**を記録する。
  - 条件①〜④と市場・業種・上場廃止の判定に使う、銘柄ごとの値を記録する（ユーザーに依存しない市場データ）。
    - 売上CAGR、営業利益率
    - 初出日、データ期間の開始日
    - 条件④の自動判定の入力（`ownership_judgments` の状態・社長が筆頭株主か・オーナー系合計）
    - 市場区分、業種、上場廃止か、社名
  - あわせて、その時点の基準日（`listing_reference_date`）を記録する。
  - 判定の**結果**ではなく**入力**を残す。理由は、条件（閾値・プリセット）を後から変えても、同じ条件で「前回」と「今」を比べ直せるからである（第2章の7）。
- **記録する時点**: **定期実行の日次の取り込み（`/api/cron/daily`）が、銘柄マスタの実行を始めるとき**。
  - `start_ingestion_run('stock_master', 'cron')` が実行の行を作れたときに、同じトランザクションで記録する。二重実行で始められなかったとき（409）は記録しない。
  - **（R2）記録の失敗で取り込みを止めない**。記録の呼び出しは、`start_ingestion_run` の中の例外を捕まえるブロック（セーブポイント）で包む。
    - 記録が失敗したら、記録の変更だけを巻き戻し、実行は開始する（`started: true`）。
    - 実行の行の `details` に `{"snapshot": "failed"}` を残す。エラーの文は保存しない（決まった値だけ）。サーバーのログには SQLSTATE を出してよい。
    - 成功したときは、`details` に `{"snapshot": "captured", "snapshotId": <id>}` を残す。
    - 失敗した場合、比較には前回の記録がそのまま使われる。`changes-cycle` が前回の日付を示すので、利用者を誤らせない。
    - 実行の詳細（`/imports/runs/<id>`）には、記録に失敗したとき `run-snapshot-failed`「比較の基準（前回の取り込み時点）を記録できませんでした。前回の記録で比較します」を出す。
    - 理由: 日次の取り込み（Sprint 12 で守った経路）を、表示のための機能に依存させない。
    - **（R5）実行の終了で `snapshot`・`snapshotId` を消さない**:
      - 今の終了の2つの関数は `details` を置き換える。`finish_ingestion_run` は `coalesce(p_details, details)`、`complete_stock_master_run` は `coalesce(p_details, '{}') || …` である。
      - これを直して、置き換えた後の `details` に、行の既存の `details` の `snapshot`・`snapshotId` の2つのキーだけを残す。例: `… || jsonb_strip_nulls(jsonb_build_object('snapshot', details -> 'snapshot', 'snapshotId', details -> 'snapshotId'))`。
      - ほかのキーは、今までどおり置き換わる。
      - 呼び出し側（`p_details`）が同じキーを渡しても、開始時の値が勝つ。取り込みのコードは、このキーを書かない。
      - 別の列を足す案は採らない。実行の詳細の API・画面は、`details` から読む。
    - **実装の注意**（評価者の指摘。守ること）:
      - `details` への書き込み（`captured`／`failed`）は、巻き戻る内側のブロック（`begin … exception … end`）の**外**で行う。具体的には、ブロックの後か、例外の処理の中である。巻き戻りで一緒に消えないようにするためである。
      - `exception when others` は、`query_canceled`（statement_timeout などによるキャンセル）を捕まえない。記録がキャンセルされると、開始ごと失敗する。これは受け入れる（C8-1 の 1,000ms 以内の性能で、実害は小さい）。`query_canceled` を捕まえて握りつぶすことはしない。
      - 記録の呼び出しは、実行の行の insert（部分一意索引）に成功した**後**に行う。応答の無い実行の後片付けは、記録より前の外側で行う（今の順のまま）。
  - 記録するのは、取り込みがデータを変える前の状態、つまり**前回の取り込み（前日の 20:00・22:00・0:00 の実行と、その後の手動の実行）が終わった後のデータ**である。
  - 手動の実行と、財務（22:00）・EDINET（0:00）の定期実行では記録しない。
    - これらの変化は、直前の記録からの変化（その日の取り込みの変化）に含まれる。
    - そのため、朝に見ると、前夜の 20:00・22:00・0:00 の3つの定期実行の変化がまとめて見える。
- **比べるもの**: 最新の記録（前回の取り込み時点）と、**今のデータ**（スクリーニングが検索しているデータそのもの）。
  - 「今回」を今のデータにするので、スクリーニングの結果・NEW と、ダッシュボードの一覧が必ず一致する。
  - **直近の取り込み日**は、最新の記録の日時の JST の日付（`cycle_date`）。画面の表示は「直近の取り込み: 2026-09-26（20:02 開始）」の形。
- 最新の記録が無いとき（定期実行がまだ一度も始まっていない。ローカルでは cron が動かない）は「比較できません」と表示する（第4章）。
  - この場合、ダッシュボードの一覧・NEW は出さない。ダミーの比較はしない。
- 最新の記録に上場中の銘柄が1つも無いとき（データが空の状態で記録した）も、比較しない。
  - 全銘柄が「新規の銘柄」として並ぶのを避けるためで、「前回の取り込みの開始時点には銘柄データが無かったため、比較できません」と表示する。
- **保持**: 記録は最新の **7 回分**だけを残し、記録するときに古いものを消す。比較に使うのは最新の1回だけ。
- 記録は市場データ（J-Quants 由来の値を含む）なので、`public.stocks` と同じ RLS・権限にする。
  - authenticated は許可ユーザーのポリシーで select だけ。anon は権限なし。
  - 書き込みは service_role だけ（記録の関数を含む）。
- 評価・テストの補助として、記録の関数（例 `capture_screening_snapshot(p_run_id bigint default null)`、service_role だけが実行可）を `postgres` から直接呼んでよい。定期実行の経路もこの関数を呼ぶ（別の実装を持たない）。

### 6. 「該当」の定義と、判定の1か所

- **「該当」＝その条件でスクリーニングの結果に含まれること**。定義は次のとおり。
  - 上場廃止でない
  - 市場・業種の絞り込みに合う
  - オンの条件に「満たさない」が無い
  - 「算出不可を含める」がオフなら、①〜③ に算出不可が無い
  - 「判定不能の銘柄を含める」がオフなら、④ が判定不能でない
- 今は、この式が次の2か所にある。これを **`screening_evaluate` の1か所**にまとめる。
  - `screen_stocks`（`included` と、除外の件数の `ok_a`・`ok_b`）
  - `stock_detail`（`included`）
- **（R3）`screening_evaluate` は、条件ごとの状態に加えて、次の分類を返す**。
  - `included`（boolean）
  - `exclusion`: 除外の種類。値は `delisted`／`filters`／`unmet`／`unavailable`／`undeterminable`、該当なら NULL。
    - **優先順位**（最初に当たった1つだけを返す）:
      1. 上場廃止
      2. 絞り込みの外
      3. 満たさない
      4. 算出不可（①〜③。「算出不可を含める」がオフのとき）
      5. 判定不能（④。「判定不能の銘柄を含める」がオフのとき）
    - 「満たさない」と「判定不能」が同時にあるときは `unmet`（満たさないが優先）。文言は「該当しない（条件①）」の形で、判定不能は並べない。
  - `blocking`: 該当を妨げている条件の配列。並びは ①〜④ の順。各要素は条件と状態。
    - 例: `[{"condition":"cagr","status":"unmet"},{"condition":"owner","status":"unavailable"}]`
    - 「妨げる」の定義は1つ: 状態が「満たさない」か、含める設定がオフのときの「算出不可（①〜③）・判定不能（④）」。
    - 上場廃止・絞り込みの外の銘柄でも、条件ごとの `blocking` は同じ定義で求める（変化の理由の比較に使う）。
- この分類を、次のすべてが使う。どれも自分では式を持たない。
  - `screen_stocks`:
    - 結果は `included` で決める。
    - 除外の件数は、`excludedUnavailable` が `exclusion = 'unavailable'` の数、`excludedUndeterminable` が `exclusion = 'undeterminable'` の数。
    - 件数の値は今と同じになる。今の `excl_undet` は「①〜③ で除外されず、④ が判定不能」で、上の優先順位と同じだからである。既存の `screening.db.test.ts`・E2E の値で確かめる。
  - `stock_detail`: `included` と、詳細の「結果に含まれるか」の種類。`describeInclusion` の `kind` もこの分類から作り、TypeScript は文言の対応だけを持つ。
  - ウォッチリスト: `data-kind` と、「該当しない（条件①・条件③）」の条件の並び（`blocking` の条件）
  - `screening_changes`: 変化の理由（第2章の9）
- ウォッチリストの文言（`data-kind` ＝ `exclusion`、該当は `included`）:

  | `data-kind` | 文言 |
  |---|---|
  | `delisted` | 上場廃止 |
  | `filters` | 該当しない（絞り込みの対象外） |
  | `unmet` | 該当しない（条件①・条件③）。`blocking` のうち `unmet` の条件だけを並べる |
  | `unavailable` | 該当しない（条件① 算出不可）。算出不可の条件を並べる |
  | `undeterminable` | 該当しない（条件④ 判定不能） |

  第2章の4の `data-kind` の値も、この5つと `included` にする。
- **（m7）銘柄詳細の `evaluation-inclusion` の `data-kind`・`data-reason` は、今の値のまま**（互換のため）。④ の判定不能は、今までどおり `unavailable` を出す。
  - 詳細は `exclusion` から `describeInclusion` の `kind`（`included`／`delisted`／`filters`／`unmet`／`unavailable`）を作る。`undeterminable` は `unavailable` に対応させる（文言は今までどおり「条件④が判定不能のため…」）。
  - この対応は `lib/stocks/detail.ts` の1か所に置く。
  - 詳細の `data-kind`・`data-reason` の既存の値と E2E は変えない。`undeterminable` を `data-kind` に出すのは、ウォッチリストだけ。
- **記録の判定も、同じ `screening_evaluate` を通す**。
  - 形:
    1. 最初に「銘柄ごとの入力の行」（CTE）を作る。
    2. その取り出し元を、今の表（`stocks`・`financial_metrics`・`stock_listing_dates`・`ownership_judgments`）か、記録の表（`screening_snapshot_stocks`）に切り替える（例: 引数に記録の id を渡す）。基準日も記録の値にする。
    3. その後の処理は1つだけにする。状態の CASE 式、④の結果（`owner_result_of`・補正）、`included`・`exclusion`・`blocking`。
  - **記録用に CASE 式を複製しない**（C7-2 で確かめる）。
- 判定の式・分類・理由の決定の2つ目の実装を、SQL にも TypeScript にも作らない（評価者がコードで確かめる）。
- 比較の関数（例 `screening_changes(p_params jsonb)`、security invoker）は、同じ条件で「記録」と「今」を判定し、次を返す。
  - 新たに該当: 記録で該当せず、今は該当する銘柄
  - 外れた: 記録で該当し、今は該当しない銘柄
  - それぞれに変化の理由（第2章の9）

### 7. どの条件で比べるか

- **ダッシュボードとウォッチリスト（画面）は「既定の条件」で判定する**。
  - 既定の条件とは、既定のプリセットがあればその条件、無ければ標準の条件（`DEFAULT_CONDITIONS`）。
  - Sprint 13 の「スクリーニング画面を開いたとき」の条件と同じで、ページ番号は使わない。
  - 条件の解決は1つの関数（`lib/screening/` に置く）にし、次の4か所で共有する。
    - ダッシュボード
    - ウォッチリスト
    - 銘柄詳細（クエリなし）
    - `/screening` のリダイレクト
- 既定のプリセットに無効な項目があるとき（Sprint 13 評価 m3）:
  - 寛容な解釈（無効な項目は既定値）で判定する。
  - 「既定のプリセット『範囲外』の条件の一部（cagr）が無効なため、既定値で判定しています」と注記する（`default-preset-invalid-note`）。
  - 正規形でないプリセットは、正規形に直して判定する。注記は「既定のプリセット『並び違い』の条件を標準の形に直して判定しています」。
  - この注記は、ダッシュボード・ウォッチリスト・銘柄詳細（クエリなし）で同じ部品にする。
- 既定のプリセットを読めないとき:
  - 標準の条件で判定し、「既定のプリセットを読み込めませんでした（標準の条件で判定しています）」と注記する（Sprint 13 の詳細と同じ）。
- **比べる両側に同じ条件を当てる**。既定のプリセットを昨日から変えても、「前回」は今の既定の条件で判定し直す。
  - プリセットを変えただけで銘柄が「新たに該当」に並ぶことは無い。一覧は、取り込みによるデータの変化だけを示す。
- **API は既定のプリセットを当てない**（Sprint 13 の規則のまま）。
  - `GET /api/screening/changes`・`GET /api/watchlist` は、条件のパラメータが無ければ標準の条件で判定する。
  - 画面と同じ結果を得るには、プリセットの API で得たクエリを付けて呼ぶ。
- **スクリーニングの NEW は、表示中の条件で判定する**（第2章の10）。表示中の条件が既定の条件なら、NEW の銘柄はダッシュボードの「新たに該当」のうち結果に含まれるものと一致する。

### 8. 手動補正の扱い

- 比べる両側に、**そのユーザーの今の手動補正**を当てる（`screening_evaluate` が今までどおり補正を結合する）。
- したがって、補正を付けた・外したことで該当が変わった銘柄は、「新たに該当」「外れた」に**並ばない**。NEW も付かない。
  - 理由: 補正は利用者自身の操作で、利用者は変化を知っている。一覧は「取り込みによって変わったもの」を毎朝知るためのもので、自分の操作を混ぜると区別できなくなる。
  - 自動判定の変化は、補正のある銘柄では判定に影響しない（Sprint 11 の「補正後に自動判定が更新されました」の知らせで分かる）。
- 補正はユーザーごとなので、同じデータでも、ユーザーによって「今」の結果が違いうる。ただし、変化の一覧に並ぶかどうかは、データの変化だけで決まる。

### 9. 変化の理由

各銘柄に、少なくとも1つの理由を付ける（`change-reason`、`data-reason`）。

| 種類 | `data-reason` | 表示 | 付ける条件 |
|---|---|---|---|
| 新規の銘柄 | `new_stock` | 新規の銘柄（前回は銘柄データなし） | 新たに該当で、記録にその銘柄が無い（ほかの理由は付けない） |
| 上場廃止から戻った | `relisted` | 上場廃止から戻った | 新たに該当で、記録では上場廃止（ほかの理由は付けない。m4） |
| 上場廃止 | `delisted` | 上場廃止 | 外れたで、今は上場廃止（ほかの理由は付けない） |
| 銘柄データなし | `missing` | 銘柄データなし | 外れたで、今の銘柄マスタにその銘柄が無い（通常は起きない） |
| 絞り込み | `filters` | 市場区分・業種の変更 | 市場・業種の絞り込みに合うかどうかが変わった |
| 条件の変化 | `<条件>:<前>><後>`（例 `cagr:unmet>met`） | 「① 売上CAGR: 満たさない → 満たす」 | その条件が、片方では該当を妨げ、もう片方では妨げない |

- 条件の名前は「① 売上CAGR」「② 営業利益率」「③ 上場年数」「④ オーナー企業／社長が筆頭株主」。
- 状態の名前は「満たす」「満たさない」「算出不可」（④は「判定不能」）。
- 「妨げる」は、「満たさない」か、含める設定がオフのときの「算出不可・判定不能」。
  - `screening_evaluate` の `blocking` をそのまま使う（第2章の6）。
  - 条件の変化の理由は、片方の `blocking` にだけある条件。
  - 絞り込みの理由は、`matches_filters` が変わったこと。
- 理由は DB の比較の関数が決め、画面・API は表示するだけにする。表示の文言は `lib/` の1か所に置く。
- 値（例 CAGR 18.2% → 21.4%）は出さない。詳細は銘柄詳細で確かめる。

### 10. NEW バッジ（スクリーニング）と、ウォッチリストの印

- スクリーニングの結果の行のうち、**表示中の条件で**「新たに該当」の銘柄に「NEW」のバッジ（`new-badge`）を付ける。
  - バッジの説明（ツールチップ）は「前回の取り込み（2026-09-26 20:02 の開始時点）から新たに該当」と、理由。
  - 置き場所はコードの列の中（列は増やさない）。
- 結果の要約に `new-count-note`「うち NEW 2 件（前回の取り込みの開始時点 2026-09-26 20:02 から新たに該当）」を出す。
  - 件数は、ページではなく結果の全件で数える。
  - NEW が0件でも、比較できるときは「うち NEW 0 件」を出す。
  - 比較できないとき（記録なし・空の記録）は出さない。
- NEW の判定に失敗したとき（記録を読めないなど）:
  - 結果は今までどおり出す。
  - `new-load-error`「NEW の判定を取得できませんでした」を出し、NEW を付けない。
- ウォッチリスト画面の各行にも、既定の条件での「NEW」／「外れた」を出す（第2章の4）。

### 11. 読めないとき（0件として扱わない）

CLAUDE.md の「集計の失敗は 0 件として扱わずエラー表示にする」と同じ方針にする。

| 読めないもの | 画面の振る舞い | API |
|---|---|---|
| ウォッチリスト（`watchlist_items`） | ウォッチリスト画面は `watchlist-error`（空状態を出さない）。<br>スクリーニングと詳細は描画を続け、星を無効にして `watchlist-load-error`「ウォッチリストを読み込めませんでした」を出す（未登録として表示しない）。<br>ダッシュボードの変化の一覧は表示し、星の印（`change-watchlisted`）だけを出さない（m3）。そのため `watchlisted` は、比較の関数の外で別の問い合わせとして求める | `GET /api/watchlist` は 500 `internal_error`。<br>`GET /api/screening` の `watchlisted` は、読めなければ 500。<br>`GET /api/screening/changes` は 500（API は部分的な結果を返さない） |
| 比較（記録・比較の関数） | ダッシュボードの区画は `changes-error`「新たに該当・外れた銘柄を取得できませんでした」（「変化はありません」を出さない）。<br>スクリーニングは `new-load-error`。<br>ウォッチリストは NEW・外れたの印を出さず、`watchlist-change-error`「前回の取り込みとの比較を取得できませんでした」 | `GET /api/screening/changes` は 500 |
| 既定のプリセット | 標準の条件で判定し、注記（第2章の7） | （API は当てない） |

- スクリーニングの星と NEW は、結果の検索（`screen_stocks`）とは別の問い合わせで求める。片方の失敗で、結果の表を失わない。
  - ただし `GET /api/screening` は、どれかに失敗したら 500 にする（API は部分的な結果を返さない）。

### 12. 件数の分母を上場中にそろえる（Sprint 12 評価の持ち越し）

- ダッシュボード:
  - 「保存済みの銘柄数」を上場中の銘柄だけで数え、見出しを「保存済みの銘柄数（上場中）」にする。
  - 上場廃止があれば、その下に「ほかに上場廃止 N 銘柄（スクリーニングの対象外）」（`dashboard-delisted-count`）を出す。
  - 「財務指標を算出できた銘柄数」「条件④を判定できた銘柄数」の値と分母も、上場中の銘柄だけで数える。
- `dashboard_summary()`: `stockCount` を上場中の数にする（`screen_stocks` の `stockCount` と同じ意味になる）。財務・判定の件数も上場中だけ。`delistedCount` は変えない。
  - 空状態の判定は、上場中と上場廃止の合計が0件のとき（上場廃止だけの DB を空と扱わない）。
- 取り込み状況: 次の区画の「銘柄マスタ N 銘柄のうち」「N / M 銘柄」の M と、分子の数を、上場中の銘柄だけで数える。
  - 財務指標の区画: 文言は「上場中の N 銘柄のうち」
  - 株価の初出日の区画: 未確定の数
  - 有報の区画: 「有報を取得できた銘柄」「条件④を判定できた銘柄」
  - 上場前の期の補完の区画
  - 各区画の説明に「上場廃止の銘柄は数えません」と添える。
- 上場廃止の銘柄が無い DB では、どの数も今までと同じ値になる（既存の E2E の値は変わらない）。

## 3. 起動方法

ポート 3000 は別のプロジェクトが使っているので、すべて **3100 番**で行う。3000 番のプロセスには触れない。3100 番のサーバーを止めるときは、`lsof -ti tcp:3100` で得た PID だけを止める。

```bash
cd /Users/shuriokamoto/dev/quantis-light
pnpm install
pnpm db:start          # Docker が必要
pnpm db:reset          # Sprint 14 のマイグレーションを含めて適用
pnpm env:local
pnpm seed:users        # owner・owner2（許可）、intruder（許可リスト外）
# キーなし（リポジトリ直下の .env にキーがあっても、空の値で上書きする）
JQUANTS_API_KEY= EDINET_API_KEY= CRON_SECRET=local-cron-secret-0123456789 pnpm dev -p 3100
# 本番相当（全件の E2E はこちらが標準）
pnpm build && JQUANTS_API_KEY= EDINET_API_KEY= CRON_SECRET=local-cron-secret-0123456789 pnpm start -p 3100
```

- アプリ:
  - http://localhost:3100/ （ダッシュボードの「新たに該当・外れた」）
  - http://localhost:3100/watchlist （ウォッチリスト）
  - http://localhost:3100/screening （星・NEW）
  - http://localhost:3100/stocks/9U001 （星）
- Postgres: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
- 評価用ユーザー: Sprint 11 と同じ。
  - `owner@quantis.local` / `Quantis-Owner-2026!`
  - `owner2@quantis.local` / `Quantis-Owner2-2026!`
  - `intruder@quantis.local` / `Quantis-Intruder-2026!`
- 投入例（第5章）:
  - 市場データは Sprint 10 の `e2e/fixtures/ownership-example.sql`（9U001〜9U014）をそのまま使う。
  - 比較の基準の記録は、定期実行（`curl -s -H "Authorization: Bearer local-cron-secret-0123456789" http://localhost:3100/api/cron/daily`。キーなしなので実行は失敗するが、記録は残る）か、psql の `select public.capture_screening_snapshot();`。
  - 記録の後のデータの変化 `e2e/fixtures/screening-changes-after.sql`。
  - ウォッチリスト `e2e/fixtures/watchlist-example.sql`（owner の4件）。
  - 後片付け: `watchlist-cleanup.sql`（`seed:users` のユーザーの行を消す）と `screening-snapshots-cleanup.sql`（記録をすべて消す）。
- E2E: 本番相当のサーバーを起動した状態で `E2E_PORT=3100 E2E_CRON_SECRET=local-cron-secret-0123456789 pnpm test:e2e`。dev だけの検査（時計のずれ）は dev で別に流す。DB 込みのテスト: `pnpm test:db`。
- 追加する環境変数は無い。`vercel.json` の Cron も変えない。

## 4. 画面とエンドポイント

### ダッシュボード `/`: 区画「新たに該当・外れた」（`data-testid="screening-changes"`）

- 置き場所は、データの鮮度の区画（`FreshnessPanel`）の直下、件数の区画の上。見出し（h2）は「前回の取り込みからの変化」。
- データが1件も無いときの空状態（AC2.3）は今までどおりで、この区画は出さない。
- 見出しの下に、次の2行を出す。
  - `changes-cycle`: 「直近の取り込み: 2026-09-26（20:02 開始）。その開始時点のデータと、現在のデータを比べています」
  - `changes-conditions`: 「判定の条件: 既定のプリセット『厳しめ』」か「判定の条件: 既定の条件」。条件の要約（Sprint 13 の `presetSummary`）をツールチップか小さな文字で添え、「スクリーニングで開く」（`/screening?<その条件の正規形>`）へのリンクを置く。
  - 既定のプリセットの注記（第2章の7）があれば、この下に出す。
- 2つの一覧を並べる（640px 未満は縦に積む）。
  - 「新たに該当」（`changes-added`。件数 `changes-added-count`）
  - 「該当から外れた」（`changes-removed`。件数 `changes-removed-count`）
- 各一覧の行（`change-row`、`data-code`、`data-change="added|removed"`）:
  - コード・社名（銘柄詳細 `/stocks/<code>` へのリンク。クエリなし。したがって、詳細も既定の条件で判定する）
  - 市場区分
  - 理由（第2章の9。`change-reason` を1つ以上）
  - ウォッチリストに登録済みなら星の印（`change-watchlisted`。操作ではなく印。説明「ウォッチリストに登録済み」）
- 並びはコード順。各一覧は **50 行まで**表示し、それを超える分は `changes-more`「ほか N 銘柄」とする（新たに該当の方は「スクリーニングで NEW を確認できます」のリンクを添える）。
- 変化が無い一覧は「変化はありません」（`changes-none`）。
- 比較できないとき（第2章の5）は、一覧の代わりに次のどちらかを出す。
  - `changes-no-snapshot`: 「比較の基準がまだありません。毎日 20:00（日本時間）の定期実行が始まると、その時点のデータを記録し、以降の変化をここに表示します」
  - `changes-empty-snapshot`: 「前回の取り込みの開始時点（2026-09-26 20:02）には銘柄データが無かったため、比較できません。次の定期実行から表示します」
- 取り込みとの整合の注記:
  - `changes-running-note`: 取り込みを実行中なら「取り込み中です。一覧は途中の状態です（保存が済んだ銘柄から反映されます）」
  - `changes-incomplete-note`: 最新の記録の後に始まった実行のうち、`failed`・`partial` のものがあれば、「今回の取り込みで完了していない対象があります（銘柄マスタ・株価）。残りの変化は次回以降の取り込みで反映されます」と、取り込み状況へのリンクを出す。
    - 対象の名前は `RUN_TARGET_LABELS` の順。
    - その後に同じ対象が `succeeded` で終わっていれば、その対象は数えない。
  - データの鮮度の警告（Sprint 12）は今までどおり画面の上部に出る。この区画では重ねて出さない。
- 読めないときは `changes-error`（第2章の11）。
- 見た目:
  - 情報密度の高い一覧（1行に収まる）にする。
  - 「新たに該当」は控えめなアクセント、「外れた」はグレーの見出しの印にする。色だけでなく文字（見出し）で区別する。
  - 理由のチップは小さく、折り返してよい。
  - 375px でページが横スクロールしない。

### スクリーニング `/screening`

- 各行のコードの列に、星（`watchlist-toggle`）と、NEW（`new-badge`）を置く。列は増やさない。
- 結果の要約に `new-count-note`（第2章の10）を置く。
- 読めないときの `watchlist-load-error`・`new-load-error`（第2章の11）は、結果の要約の近くに出す。
- 1280×800 で、市場区分と AC6.12 の注記がスクロールなしで見える。`results-scroll` の `scrollWidth <= clientWidth`。
- 375px の条件（Sprint 13 の C2-10）を保つ。

### 銘柄詳細 `/stocks/[code]`

- 見出しの行に `watchlist-toggle`（文字付きのボタン）と `watchlist-added-note` を置く。
- 既定のプリセットの注記（m3）は、条件の判定の区画の説明（`data-condition-source="preset"`）の下に出す。

### ウォッチリスト `/watchlist`

第2章の4のとおり。見出し（h1）は「ウォッチリスト」。説明は「登録した銘柄の最新の指標とメモ（既定の条件で判定）」。

### エンドポイント

次の共通の規則に従う。
- すべて `requireApiUser()` を呼ぶ（未ログイン 401・許可リスト外 403・Auth 障害 503）。応答は `jsonNoStore`。
- 書き込みは同一オリジンの確認を行う（違えば 403 `{"error":"cross_origin"}`）。
- 読み書きはユーザーのセッション（RLS）で行う。

| メソッドとパス | 内容 |
|---|---|
| `GET /api/watchlist` | 自分のウォッチリスト（追加日時の新しい順）。<br>クエリにスクリーニングの条件のパラメータがあればその条件、無ければ標準の条件で、各銘柄の判定と変化を付ける。<br>200 `{"data": {"conditions": …, "comparison": …, "items": [<item>]}}`。<br>不正な条件は 400 `invalid_params`（`GET /api/screening` と同じ） |
| `PUT /api/watchlist/[code]` | 追加（冪等）。本文は不要。<br>新しく追加したら 201、既に登録済みなら 200（行は変えない）。<br>`{"data": <item の基本の項目>}` |
| `PATCH /api/watchlist/[code]` | メモの変更。本文 `{"memo": "…"}`（`null` か空白だけで消す）。200 `{"data": …}` |
| `DELETE /api/watchlist/[code]` | 外す。200 `{"deleted": true}` |
| `GET /api/screening/changes` | 新たに該当・外れた。<br>クエリにスクリーニングの条件のパラメータがあればその条件、無ければ標準の条件（既定のプリセットは当てない）。<br>200 `{"data": {"conditions": …, "comparison": …, "added": [<change>], "removed": [<change>]}}`。<br>一覧は全件（上限なし）、コード順 |

- `GET /api/screening`（既存）:
  - 各行に `watchlisted`（boolean）と `isNew`（boolean）を足す。
  - 全体に `comparison` と `newCount` を足す。比較できないときは `newCount: null`、`isNew` はすべて false。
  - 既存の項目は変えない。
- `GET /api/stocks/[code]`（既存）: `watchlist: {"addedAt": "…"} | null` を足す。
- `GET /api/dashboard`（既存）: `stockCount` と財務・判定の件数が上場中だけになる（第2章の12）。変化の一覧は含めない（`/api/screening/changes` を使う）。
- `code`:
  - `normalizeStockCode` で正規化する（4文字は末尾に 0）。
  - 形が不正なら 400 `invalid_code`。
  - 銘柄マスタに無ければ 404 `stock_not_found`（PUT）。
  - ウォッチリストに無ければ 404 `not_found`（PATCH・DELETE）。
- エラー:
  - 本文が JSON でない（PATCH）: 400 `invalid_body`
  - メモが文字列・null でない、または 1,000 コードポイントを超える: 400 `invalid_memo`（`fields: ["memo"]`）
  - 上限: 409 `watchlist_limit`
  - DB の失敗: 500 `internal_error`
- 日時は日本時間の ISO（`2026-09-26T09:00:00+09:00`）。

`<item>` の形（例）:

```json
{
  "code": "9U001",
  "memo": "決算説明会の資料を確認する",
  "addedAt": "2026-09-23T10:00:00+09:00",
  "memoUpdatedAt": "2026-09-23T10:00:00+09:00",
  "stock": { "company_name": "…", "market_code": "0113", "market_name": "グロース", "sector33_name": "…", "delisted_on": null },
  "metrics": { "revenue_cagr_display_pct": 25.0, "operating_margin_display_pct": 15.0, "estimated_listing_years": 3, "…": "（GET /api/screening の行と同じ名前の項目）" },
  "evaluation": { "status": { "cagr": "met", "margin": "met", "years": "met", "owner": "met" }, "ownerResult": "president_top", "ownerAutoResult": "president_top", "ownerOverride": null, "included": true, "delisted": false },
  "change": null
}
```

- `change` は `"added"`／`"removed"`／`null`（比較できないときも `null`）。

`comparison` の形:

```json
{ "status": "ok", "capturedAt": "2026-09-26T20:02:00+09:00", "cycleDate": "2026-09-26", "referenceDate": "2026-09-24", "previousReferenceDate": "2026-09-24" }
```

- `status` は `ok`／`no_snapshot`／`empty_snapshot`。`ok` 以外では `capturedAt` などは記録があれば出し、無ければ null。

`<change>` の形:

```json
{ "code": "9U011", "company_name": "…", "market_code": "0112", "market_name": "スタンダード",
  "reasons": [ { "kind": "condition", "condition": "cagr", "from": "unmet", "to": "met" } ], "watchlisted": true }
```

- `kind` は `new_stock`／`relisted`／`delisted`／`missing`／`filters`／`condition`。

## 5. データの保存形式と追加する DB オブジェクト

名前は目安。実装で変えた場合は、self-review と投入例の SQL で示す。

| オブジェクト | 内容 |
|---|---|
| テーブル `public.watchlist_items` | 第2章の1。索引は (`user_id`, `created_at`) |
| トリガー関数 `watchlist_items_before_write()` | 第2章の1。authenticated には実行の権限を付けない（トリガーの発火には要らない） |
| テーブル `public.screening_snapshots` | 記録の見出し: `id`、`captured_at`、`cycle_date`（JST の日付）、`reference_date`、`run_id`（`ingestion_runs` への参照。削除で NULL）、`stock_count`（上場中の数）。<br>RLS は市場データと同じ |
| テーブル `public.screening_snapshot_stocks` | 記録の銘柄ごとの値（第2章の5）。主キーは (`snapshot_id`, `code`)。見出しの削除で連鎖。`stocks` には参照しない（履歴なので）。<br>RLS は市場データと同じ |
| 関数 `capture_screening_snapshot(p_run_id bigint default null)` | 記録と、古い記録の削除（最新 7 回を残す）。service_role だけ。記録の id を返す |
| `start_ingestion_run` の変更 | `stock_master`・`cron` の実行を始められたときだけ、同じトランザクションで記録の関数を呼ぶ。<br>呼び出しはセーブポイントで包み、失敗しても実行は始める（R2。`details.snapshot`） |
| `finish_ingestion_run`・`complete_stock_master_run` の変更 | `details` を置き換えるときに、既存の `snapshot`・`snapshotId` の2つのキーだけを残す（R5） |
| `screening_evaluate` の変更 | `included`・`exclusion`・`blocking` を返す。<br>記録の id を渡すと、入力の取り出し元だけを記録の表に切り替えて判定する（第2章の6）。<br>`screen_stocks`・`stock_detail`・`screening_changes`・ウォッチリストの関数は、この分類を使う（式を持たない） |
| 関数 `screening_changes(p_params jsonb)` | 比較（第2章の6・9）。authenticated・security invoker。記録が無ければ `no_snapshot` を返す（例外にしない） |
| 関数 `watchlist_entries(p_params jsonb)` など | ウォッチリストの行と、指標・判定・変化（画面と API）。authenticated・security invoker |
| `dashboard_summary()` と取り込み状況の要約の関数の変更 | 第2章の12 |
| マイグレーション | `supabase/migrations/2026100700000x_watchlist_and_changes.sql` |

### 投入例 `e2e/fixtures/watchlist-example.sql`（`postgres` ユーザーで実行。owner の4件）

```sql
insert into public.watchlist_items (user_id, code, memo, created_at)
select u.id, w.code, w.memo, w.created_at
  from auth.users u
 cross join (values
   ('9U004', null, timestamptz '2026-09-20 10:00+09'),
   ('9U011', E'成長率の回復待ち\n来期の予想を見る', timestamptz '2026-09-21 10:00+09'),
   ('9U006', null, timestamptz '2026-09-22 10:00+09'),
   ('9U001', '決算説明会の資料を確認する', timestamptz '2026-09-23 10:00+09')
 ) as w(code, memo, created_at)
 where u.email = 'owner@quantis.local';
```

- トリガーは insert の `created_at` を `now()` にするので、この投入例では、続けて `update … set created_at = …` をトリガーを通さずに行う必要がある。
  - 例: `alter table … disable trigger …` をこのファイルの中だけで使う。または `session_replication_role = replica` を使う。
  - どちらの方法にするかは、ジェネレーターが投入例の SQL に書く。追加日の表示を確かめるため、日時は上の値にする。
- 後片付け `watchlist-cleanup.sql`: `delete from public.watchlist_items where user_id in (select id from auth.users where email like '%@quantis.local')`。
- 記録の後片付け `screening-snapshots-cleanup.sql`: `delete from public.screening_snapshots`（E2E の前提は記録0件）。

### 記録の後の変化 `e2e/fixtures/screening-changes-after.sql`（`ownership-example.sql` と記録の後に流す）

```sql
-- 9U011: 売上CAGR 10.0% → 25.0%（条件①を満たすように）
update public.financial_statements f
   set net_sales = v.sales * 100000000, operating_profit = v.sales * 0.15 * 100000000
  from (values (date '2022-03-31', 100::numeric), (date '2023-03-31', 125), (date '2024-03-31', 156.25),
               (date '2025-03-31', 195.3125), (date '2026-03-31', 244.140625)) as v(fy_end, sales)
 where f.code = '9U011' and f.fiscal_year_end = v.fy_end;
-- 9U012: 初出日 2018-09-24 → 2023-09-24（条件③ 8.0年 → 3.0年）
update public.stock_listing_dates set first_price_date = date '2023-09-24' where code = '9U012';
-- 9U002: 上場廃止
update public.stocks set delisted_on = date '2026-09-25' where code = '9U002';
-- 9U008: 直近通期の営業利益率 15.0% → 5.0%（条件②を満たさなくなる）
update public.financial_statements set operating_profit = net_sales * 0.05
 where code = '9U008' and fiscal_year_end = date '2026-03-31';
-- 9U006: 山田興産 18% → 4%、山田太郎 12% → 4%（オーナー系合計 35.0% → 13.0%、筆頭は信託口 9%）
update public.annual_report_shareholders set ratio_pct = 4.00, shares_held = 400000
 where doc_id = 'SXTEST06' and rank in (1, 2);
```

### 期待される結果（`ownership-example.sql` → 記録 → `screening-changes-after.sql`）

| 条件 | 記録の時点で該当 | 今、該当 | 新たに該当（理由） | 外れた（理由） |
|---|---|---|---|---|
| 標準の条件 | 9U001・9U002・9U006・9U008・9U009・9U010・9U014（7件） | 9U001・9U009・9U010・9U011・9U012・9U014（6件） | 9U011（① 満たさない → 満たす）、9U012（③ 満たさない → 満たす） | 9U002（上場廃止）、9U006（④ 満たす → 満たさない）、9U008（② 満たす → 満たさない） |
| 厳しめ（`owner=40&sort=owner&order=desc`） | 9U010・9U001・9U008・9U009・9U014（5件） | 9U012（50.0）→ 9U010（40.0）→ 9U011（35.0）→ 9U001（30.0）→ 9U009（28.0）→ 9U014（25.0）の6件 | 9U011（①）、9U012（③） | 9U008（②） |
| グロースのみ（`market=0113`） | 9U001・9U002・9U008・9U009・9U010・9U014（6件） | 9U001・9U009・9U010・9U014（4件） | なし | 9U002（上場廃止）、9U008（②） |
| `off=owner`（①〜③だけ） | 9U001〜9U010・9U013・9U014（12件） | 9U001・9U003〜9U007・9U009〜9U014（12件） | 9U011（①）、9U012（③） | 9U002（上場廃止）、9U008（②） |

- 厳しめの「今、該当」の並びは、オーナー系合計の降順（Sprint 10 の並べ替え）。9U011・9U012 は大株主が社長1人だけなので、合計はその比率。
- 手動補正（owner だけ。記録の後に付ける）: 9U003 に「オーナー企業」、9U009 に「該当しない」。
  - owner の標準の条件の結果は次の6件になる: 9U001・9U003・9U010・9U011・9U012・9U014。
  - 一方、変化の一覧は上の表と同じになる（9U003 は新たに該当に並ばず NEW も付かない。9U009 は外れたに並ばない。第2章の8）。
  - owner2 の結果は補正の影響を受けない（9U009 を含み 9U003 を含まない）。

### ウォッチリストの期待値（`ownership-example.sql`・`watchlist-example.sql`、既定のプリセットなし）

| 行の順 | コード | 指標（CAGR・利益率・年数） | 条件④ | 該当（記録なし） | 記録 → 変化の後 | メモ | 追加日 |
|---|---|---|---|---|---|---|---|
| 1 | 9U001 | 25.0%・15.0%・3.0年 | 該当（社長が筆頭株主） | 該当 | 該当（変化なし） | 決算説明会の資料を確認する | 2026-09-23 |
| 2 | 9U006 | 25.0%・15.0%・3.0年 | 該当（オーナー企業）35.0% | 該当 | 該当しない（条件④）＋「外れた」 | （なし） | 2026-09-22 |
| 3 | 9U011 | 10.0%・15.0%・3.0年 | 該当（社長が筆頭株主） | 該当しない（条件①） | 該当＋「NEW」 | 成長率の回復待ち／来期の予想を見る（2行） | 2026-09-21 |
| 4 | 9U004 | 25.0%・15.0%・3.0年 | 判定不能（有報が未取得） | 該当しない（条件④ 判定不能） | 同じ（変化なし） | （なし） | 2026-09-20 |

- 既定のプリセットが「厳しめ」なら、変化の前の 9U006 は「該当しない（条件④）」（35.0 < 40）。この場合、条件の出典は「既定のプリセット『厳しめ』」。

## 6. テスト可能な完了条件

前提:
- 第3章の手順で 3100 番に起動し（キーなし）、`owner@quantis.local` でログイン済み。画面の幅は特記の無い限り 1280×800。
- DB は `pnpm db:reset && pnpm seed:users` の直後から始め、`ownership-example.sql` を入れる。ウォッチリスト・プリセット・記録は0件から始める（投入例を使うときは明記する）。
- 特記の無い限り、`pnpm dev -p 3100` と `pnpm build && pnpm start -p 3100` の両方で満たすこと。

### C1. 追加・削除（AC13.1）

1. `/screening`（標準の条件、7件）の各行に、星（`watchlist-toggle`、`data-state="off"`、`aria-pressed="false"`）がある。名前は「ウォッチリストに追加: 9U001 検証用社長筆頭株式会社」の形。
2. 9U001 の星を押す。
   - 星が `data-state="on"`（塗りつぶし）になる。
   - `watchlist-status` に「『検証用社長筆頭株式会社』をウォッチリストに追加しました」が出る。
   - URL・結果の件数・並びは変わらず、詳細へ遷移しない。
   - psql で `watchlist_items` に owner の 9U001 の1行があり、`memo` は NULL。
   - リロードしても星は `on`。
3. キーボードだけで、次を操作できる。9U002 の行の星に Tab で移り、Enter で追加、Space で外す。詳細へ遷移しない。
4. `/stocks/9U001` の見出しの行のボタンは「ウォッチリスト登録済み」（`aria-pressed="true"`）で、`watchlist-added-note` に「<今日の JST の日付> にウォッチリストに追加」が出る。
   - 押すと（メモが無いので確認なしで）「ウォッチリストに追加」に戻り、行が消える。
   - もう一度押すと追加される。
   - ヘッダーの「スクリーニング」とブラウザの「戻る」のどちらでスクリーニングに戻っても、9U001 の星は詳細での最後の状態と一致する（古い状態が出ない）。
5. **メモのある銘柄を外す**: psql で 9U001 に `memo = 'テスト'` を入れてから、スクリーニングで星を押す。
   - `watchlist-remove-dialog`（`role="alertdialog"`）に「『検証用社長筆頭株式会社』をウォッチリストから外しますか？」と「メモも削除されます。この操作は取り消せません。」が出る。
   - 「キャンセル」では行が残り、フォーカスは星に戻る。
   - 「外す」で行が消える。
   - 詳細の「ウォッチリスト登録済み」でも同じダイアログが出る。
6. 上場廃止の銘柄: `update stocks set delisted_on = '2026-09-25' where code = '9U007'` の後、`/stocks/9U007` で追加・削除ができる。確かめたら戻す。
7. API:
   - `PUT /api/watchlist/9U003` → 201。もう一度 → 200 で、行は1行のまま（`created_at` は変わらない）。
   - `PUT /api/watchlist/9U00` → `9U000` に正規化され、404 `stock_not_found`（銘柄マスタに無い）。
   - `PUT /api/watchlist/abc!` → 400 `invalid_code`。
   - `DELETE /api/watchlist/9U003` → 200 `{"deleted":true}`。もう一度 → 404 `not_found`。
   - 同じ銘柄への `PUT` を2つ同時に送ると、どちらも 200 か 201 で、行は1行。
8. 上限:
   - owner の行を 500 件にする（SQL。銘柄は性能テストと同じ形の仮のコードでよい）。
   - 501 件目の `PUT` は 409 `watchlist_limit` で、行は作られない。
   - 画面の星を押すと、`watchlist-status` に「ウォッチリストは 500 銘柄まで登録できます」が出て、星は `off` のまま。
   - **（R1）** 500 件のとき、登録済みの銘柄（500 件の中の1つ）への `PUT` は 200 で、行は変わらない（`created_at` も同じ、件数は 500 のまま）。
   - 確かめたら戻す。
9. 星の操作の前後で、`ingestion_runs` の行数が変わらない。外部 API は呼ばない。

### C2. ウォッチリスト画面（AC13.2）

前提: `watchlist-example.sql` を入れる。

1. ナビゲーション（1280 と 375 のメニュー）に「ダッシュボード」「スクリーニング」「ウォッチリスト」「取り込み状況」「設定」がこの順にあり、「ウォッチリスト」で `/watchlist` に移る（`aria-current="page"`）。
2. 行の順と値は、第5章の「ウォッチリストの期待値」の「該当（記録なし）」の列のとおり。
   - 9U001・9U006・9U011・9U004 の4行。
   - 指標の書式はスクリーニングと同じ（「25.0%」「15.0%」「3.0年」）。
   - 条件④は「該当（社長が筆頭株主）」など。
   - 追加日は 2026-09-23・2026-09-22・2026-09-21・2026-09-20。
   - 9U011 のメモは2行で表示される。
   - 比較の記録が無いので、NEW・外れたのバッジは無い。
   - `watchlist-conditions` は「既定の条件で判定しています」。
3. **手動補正**: owner が 9U006 に「該当しない」の補正を付けると、9U006 の条件④は「手動補正」のラベルと元の自動判定（オーナー企業）で表示され、該当は「該当しない（条件④）」になる。補正を取り消すと戻る。
4. **メモの編集**:
   - 9U006 の「メモを追加」→「IR に問い合わせ中」→「保存」で、`watchlist-status` に「メモを保存しました」が出て、表示が変わる。
     - リロードしても残る。
     - psql の `memo` は「IR に問い合わせ中」。`updated_at` が新しくなり、`created_at` と追加日は変わらない。
   - 9U001 の「編集」→ 前後に全角空白と改行のある「　新しいメモ\n」→ ⌘／Ctrl＋Enter → 「新しいメモ」で保存される。
   - 「編集」→ 変更 → Esc で、元のメモのまま（DB も変わらない）。フォーカスは「編集」ボタンに戻る。
   - 空（全角空白だけ）にして保存すると、メモが消え（DB は NULL）、「メモを追加」になる。
   - 「𠮷」1,000 個は保存でき、文字数の表示は「1,000 / 1,000」。1,001 個は「メモは 1,000 文字以内で入力してください」で保存されない。
   - `<img src=x onerror=alert(1)>` は文字列として表示され、スクリプトは動かない（`dialog` イベントが0件）。
   - 確かめたら投入例の値に戻す。
5. 9U001 の星を押すと（メモがあるので）確認のダイアログが出て、「外す」で行が消える。`watchlist-status` に「…から外しました」が出る。
6. **既定のプリセット**: `screening-presets-example.sql` を入れ、「厳しめ」を既定にする。
   - `watchlist-conditions` が「既定のプリセット『厳しめ』の条件で判定しています」になる。
   - 9U006 は「該当しない（条件④）」になる。
   - 「スクリーニングで開く」は `/screening?cagr=20&margin=10&years=5&owner=40&ownermode=any&sort=owner&order=desc`。
7. 行の「9U001」のリンクで `/stocks/9U001`（クエリなし）に移る。
8. 空状態: 行を消すと `watchlist-empty` の文言とスクリーニングへのリンクが出る。
9. API: `GET /api/watchlist` は4件（追加日時の新しい順）で、第4章の `<item>` の形。
   - `GET /api/watchlist`（条件なし）は、既定＝厳しめでも標準の条件で判定する（9U006 の `evaluation.included = true`）。
   - `GET /api/watchlist?owner=40` は 9U006 が `included: false`。
   - `GET /api/watchlist?cagr=abc` は 400 `invalid_params`。
   - `PATCH /api/watchlist/9U001` について:
     - `{"memo":"x"}` → 200
     - `{"memo":null}` → メモが消える
     - `{"memo":123}` → 400 `invalid_memo`
     - 1,001 コードポイント → 400 `invalid_memo`
     - 本文が JSON でない → 400 `invalid_body`
     - 登録していない 9U003 → 404 `not_found`
10. 375×812:
    - ページ全体は横スクロールしない（`document.documentElement.scrollWidth <= 375`）。
    - 表は `watchlist-scroll` の中で横スクロールし、コード・社名の列は左に固定される。
    - メモの編集の textarea と「保存」「キャンセル」が画面の中にあり、押せる。

### C3. 比較の基準の記録

1. 記録が0件のとき:
   - ダッシュボードの区画に `changes-no-snapshot` が出て、一覧は無い。
   - `/screening` に `new-badge` と `new-count-note` が無い。
   - `GET /api/screening/changes` は `comparison.status = "no_snapshot"`、`added`・`removed` は空。
   - `GET /api/screening` は `newCount: null`。
2. **定期実行で記録される**:
   - `curl -s -H "Authorization: Bearer local-cron-secret-0123456789" http://localhost:3100/api/cron/daily` を呼ぶ（キーなしなので、2つの実行は失敗する）。
   - `screening_snapshots` に1行が増える。`run_id` はその銘柄マスタの実行の id、`stock_count` は 14、`reference_date` は 2026-09-24、`cycle_date` は今日の JST の日付。
   - `screening_snapshot_stocks` に 9U001〜9U014 の14行がある。9U011 の売上CAGR は 0.1。
   - この時点では変化は無い。ダッシュボードの2つの一覧は `changes-none`、NEW は0件、`new-count-note` は「うち NEW 0 件…」。
3. **記録されない経路**:
   - 手動の実行（`POST /api/ingestion/runs`、どの対象でも）
   - `/api/cron/financials`・`/api/cron/edinet`
   - 実行中に `/api/cron/daily` を呼んで 409 になったとき
   - 認証の無い `/api/cron/daily`（401）
   
   どれも `screening_snapshots` の行数は変わらない。
4. 記録は最新 7 回だけが残る（`pnpm test:db` で、8 回記録すると最も古い1回が消えることを確かめる。前提は C7-1 の「記録0件」）。
5. **（R2）** 記録に成功した定期実行の行の `details` は `{"snapshot": "captured", "snapshotId": …}` を含む。
   - 記録の失敗そのものは C7-1 で確かめる。
   - **（R5）実際の失敗で、画面を確かめる**（`details` を psql で書き換えない）:
     1. 前回の記録がある状態で、psql で記録を失敗させる制約 `alter table public.screening_snapshot_stocks add constraint e2e_fail_snapshot check (false) not valid` を一時的に付ける。
        - `not valid` は既存の行を検査しないが、新しい行の insert は拒否する。
     2. `/api/cron/daily` を呼ぶ。応答は 200 で、2つの実行が作られる（キーなしなので実行そのものは失敗）。
     3. 銘柄マスタの実行の行の `details.snapshot` は `"failed"`。`screening_snapshots` の行数は増えない。
     4. `/imports/runs/<その id>` に `run-snapshot-failed`「比較の基準（前回の取り込み時点）を記録できませんでした。前回の記録で比較します」が出る。
     5. ダッシュボードの `changes-cycle` は前回の記録の日時のまま。
     6. 制約を外す（E2E では `finally`・`afterAll` で必ず外す）。
   - 記録に成功した定期実行（C3-2）の詳細と、手動の実行の詳細には、`run-snapshot-failed` が出ない。
   - キーのある経路（`complete_stock_master_run`・details つきの `finish_ingestion_run` で終わる実行）でキーが残ることは、C7-1 で確かめる。
6. `changes-cycle` に「直近の取り込み: <cycle_date>（<記録の時刻 HH:mm> 開始）…」が出る。
7. **空の記録**: 市場データが0件の DB で記録すると、`stock_count = 0`。その後に `ownership-example.sql` を入れる。
   - ダッシュボードは `changes-empty-snapshot` を出す（14 銘柄が「新規の銘柄」に並ばない）。
   - スクリーニングに NEW は無い。
   - API は `comparison.status = "empty_snapshot"`。

### C4. 新たに該当・外れた（AC13.3・AC13.4）

前提: `ownership-example.sql` → 記録（C3-2 の定期実行か `select public.capture_screening_snapshot()`）→ `screening-changes-after.sql`。既定のプリセットなし。

1. ダッシュボードの `screening-changes`:
   - `changes-conditions` は「判定の条件: 既定の条件」。
   - `changes-added` は 9U011・9U012 の2行（`changes-added-count` は 2）。
     - 9U011 の理由は「① 売上CAGR: 満たさない → 満たす」（`data-reason="cagr:unmet>met"`）。
     - 9U012 は「③ 上場年数: 満たさない → 満たす」。
   - `changes-removed` は 9U002・9U006・9U008 の3行。
     - 9U002 は「上場廃止」だけ（`data-reason="delisted"`）。
     - 9U006 は「④ オーナー企業／社長が筆頭株主: 満たす → 満たさない」。
     - 9U008 は「② 営業利益率: 満たす → 満たさない」。
   - `changes-cycle` に直近の取り込み日が出る。
2. 各行のリンクで `/stocks/<code>` に移る。
   - 9U011 の詳細の条件①は「満たす」。
   - 9U002 の詳細は「上場廃止」。
   - 9U006 の条件④は「満たさない」。
3. **NEW**: `/screening`（標準の条件）は 9U001・9U009・9U010・9U011・9U012・9U014 の6件。
   - 9U011・9U012 の行だけに `new-badge` がある。
   - `new-count-note` は「うち NEW 2 件（前回の取り込みの開始時点 <日時> から新たに該当）」。
   - `GET /api/screening` の `newCount` は 2、9U011・9U012 の `isNew` は true、ほかは false。
4. **表示中の条件で判定する**:
   - `?…&off=owner`（①〜③だけ）では、NEW は 9U011・9U012。
   - `market=0113`（グロースのみ）では、NEW は0件（「うち NEW 0 件」）。
   - `GET /api/screening/changes?<それぞれの条件>` の `added`・`removed` は、第5章の表のとおり。
5. **既定のプリセットで判定する**: `screening-presets-example.sql` を入れ、「厳しめ」を既定にする。
   - ダッシュボードの `changes-conditions` は「判定の条件: 既定のプリセット『厳しめ』」。
   - 新たに該当は 9U011・9U012、外れたは 9U008 だけ（9U002・9U006 は並ばない）。
   - 「スクリーニングで開く」は厳しめのクエリの URL。
   - その画面の NEW は 9U011・9U012 で、ダッシュボードの「新たに該当」と一致する。
   - 「グロースのみ」を既定にすると、新たに該当は「変化はありません」、外れたは 9U002・9U008。
   - **両側に同じ条件を当てる**: 既定を「厳しめ」から「グロースのみ」に変えても、プリセットの変更そのものは変化にならない（「グロースのみ」の表のとおりで、「厳しめ」との違いの銘柄は並ばない）。
6. **手動補正（第2章の8）**: owner が 9U003 に「オーナー企業」、9U009 に「該当しない」の補正を付ける（既定のプリセットなし）。
   - owner の `/screening` は 9U001・9U003・9U010・9U011・9U012・9U014 の6件。9U003 に NEW は無い。
   - ダッシュボードの一覧は C4-1 と同じ（9U003 は新たに該当に無く、9U009 は外れたに無い）。
   - owner2 の `/screening` は C4-3 の6件（9U009 を含み、9U003 を含まない）。NEW は 9U011・9U012。
7. **ユーザーごと**: owner の既定＝厳しめ、owner2 は既定なしのとき、次のようになる。
   - owner2 のダッシュボードは「既定の条件」の一覧（C4-1）。
   - owner のダッシュボードは C4-5。
8. **ウォッチリストの印**: `watchlist-example.sql` を入れると、次のようになる。
   - ダッシュボードの 9U011（新たに該当）と 9U006（外れた）に `change-watchlisted` が付く。
   - ウォッチリストの 9U011 に「NEW」、9U006 に「外れた」のバッジ（第5章の「記録 → 変化の後」の列）。
   - owner2 のダッシュボードには、`change-watchlisted` が1つも無い。
9. **50 行を超えるとき**: `pnpm test:db` か E2E で、新たに該当が 51 件になるデータを作る。
   - ダッシュボードに 50 行と `changes-more`「ほか 1 銘柄」が出る。
   - `GET /api/screening/changes` は 51 件すべてを返す。
10. **理由の網羅**（`pnpm test:db` の `screening-changes.db.test.ts`）。記録と変化を作り、`screening_changes` の結果で次を確かめる。
    - 新規の銘柄（記録の後に `stocks` と各データを入れた銘柄）→ `new_stock` だけ。
    - 上場廃止から戻った → `relisted` だけ（戻ると同時に条件の状態が変わっても、ほかの理由は付けない。m4）。
    - 市場区分の変更（`market=0113` の条件で、0112 → 0113 に変わった銘柄）→ `filters`。
    - 算出不可 → 満たす（「算出不可を含める」オフ）→ `cagr:unavailable>met`。
      - 同じ変化は、「算出不可を含める」オンでは変化にならない（両側とも該当）。
    - 判定不能 → 満たす → `owner:unavailable>met`。
    - 複数の条件が同時に変わった → 理由が2つ。
    - **基準日の変化だけで外れる**: 記録の基準日 2026-09-24 に上場年数 5.0 年ちょうど（初出日 2021-09-24）で該当する銘柄がある。記録の後に株価の成功の実行（終了 2026-09-25 20:03 JST）を加えて基準日を 2026-09-25 にすると、その銘柄は外れたになり、理由は `years:met>unmet`。
      - 記録の側の判定は記録の基準日で行うこと（今の基準日で判定し直さない）を、これで確かめる。
    - 上場廃止で外れた銘柄の理由は `delisted` だけ（ほかの条件が変わっても付けない）。
    - 新たに該当・外れたの各銘柄に、理由が1つ以上ある（空の理由の銘柄が無い）。
    - `screening_changes` の新たに該当は、同じ条件の `screen_stocks` の結果のうち、記録で該当しなかったものと完全に一致する。外れたは、記録で該当し今の結果に無いものと一致する。
11. **取り込みとの整合**:
    - C3-2 の定期実行（キーなしで失敗）の後、ダッシュボードに `changes-incomplete-note`「今回の取り込みで完了していない対象があります（銘柄マスタ・株価）…」が出る。
      - その後に、それぞれの対象の `succeeded` の実行（投入例と同じ形。`details` の `fixture` で後片付けできる形）を加えると、注記は消える。
    - `running` の実行（開始 2 分前）を入れると `changes-running-note` が出る。
    - 記録より前の実行の失敗は、この注記に数えない。
    - 鮮度の警告（Sprint 12）が出る状態でも、区画は描画される。
12. dev で `simulateServerClockBehind()` の状態で、ダッシュボード・`/screening`・`/watchlist`・`/stocks/9U011` を開き、星の操作とメモの保存を行う。コンソールのエラーと `pageerror` が0件。

### C5. ユーザーごとの分離と永続性（AC13.5）

前提: `watchlist-example.sql` を入れる。

1. リロードしても、ログアウトして再ログインしても、owner のウォッチリストとメモが残る。
2. 別のブラウザのコンテキストで owner2 にログインすると、次のようになる。
   - `/watchlist` は `watchlist-empty`。
   - `/screening` の星はすべて `off`。
   - `/stocks/9U001` は「ウォッチリストに追加」。
   - `GET /api/watchlist` は `items: []`。
3. owner2 が 9U001 を追加し、メモ「owner2 のメモ」を付ける。owner の画面（リロード後）は変わらない（owner の 9U001 のメモのまま）。owner2 の 9U001 を外しても、owner の行は残る。
4. owner2 の JWT（公開キー＋ owner2 のアクセストークン）で PostgREST を直接呼ぶ。
   - `watchlist_items` の select は owner2 の行だけを返す。
   - owner の行（`user_id=eq.<owner>&code=eq.9U001`）の update・delete は0行に作用し、owner の行は変わらない。
   - `user_id` に owner の id を指定した insert は RLS で拒否される。
5. owner の JWT で PostgREST を直接呼ぶ（直接の書き込みへの防御。第2章の1）。どれも拒否されるか、DB が値を決め直す。
   1. 自分の行の `user_id` を owner2 の id にする update、`code` を変える update → 拒否。行は変わらない。
   2. `created_at` を過去にする update → 変わらない。`updated_at` を過去にする update（メモは同じ）→ 変わらない。
   3. `memo` について:
      - 1,001 コードポイントは拒否される。
      - 前後に全角空白・改行のある値は、除いた値で保存される。
      - 全角空白だけ・改行だけは NULL で保存される。
   4. `user_id` を省いた insert → owner の id で保存される。`created_at` を指定した insert → `now()` になる。
   5. 存在しない銘柄コードの insert → 外部キーで拒否される。
   6. 501 件目の insert → 拒否される。
6. anon（公開キーだけ）では、次のようになる。
   - `watchlist_items`・`screening_snapshots`・`screening_snapshot_stocks` の select は、0行または権限エラー。
   - `watchlist_items` の insert は権限エラー。
   - `rpc/screening_changes` と `rpc/capture_screening_snapshot` は権限エラー。
7. owner の JWT で次を試す。
   - `screening_snapshots` への insert・update・delete は権限エラー。
   - `rpc/capture_screening_snapshot` も権限エラー（記録は利用者から作れない）。
8. intruder（許可リスト外）のセッションでは、API は 403。DB の読み書きもできない（`pnpm test:db`）。
9. 未ログインでは、`GET /api/watchlist`、`PUT`・`PATCH`・`DELETE /api/watchlist/<code>`、`GET /api/screening/changes` が 401 で、`Cache-Control: no-store`。行は作られない。
10. `PUT`・`PATCH`・`DELETE` に別のオリジンの `Origin` を付けると 403 `cross_origin` で、DB は変わらない。
11. 許可の取り消し: 評価者が `private.allowed_emails` から owner2 を消す。
    - owner2 のセッションの API は 403 になり、owner2 のウォッチリストは読めず・書けない。
    - owner の画面は変わらない。
    - 確かめたら `pnpm seed:users` で戻す。

### C6. 読めないとき（第2章の11）

評価者が、authenticated の権限を一時的に外して確かめる。確かめたら権限を戻す。

1. `watchlist_items` の select を外す。
   - `/watchlist` は `watchlist-error` で、`watchlist-empty` は無い。
   - `/screening` は結果を表示し、星は無効で、`watchlist-load-error` が出る。
   - `/stocks/9U001` は描画され、ボタンは無効で注記がある。
   - `GET /api/watchlist`・`GET /api/screening` は 500 `internal_error`。
   - **（m3）** ダッシュボード（記録と変化がある状態。C4 の前提）の変化の一覧は表示される。`change-watchlisted` は1つも無い。`changes-error` は出ない。
   - **（m3）** `GET /api/screening/changes` は 500 `internal_error`（第2章の11。部分的な結果を返さない）。
2. `screening_snapshot_stocks` の select を外す（記録がある状態）。
   - ダッシュボードの区画は `changes-error`（「変化はありません」ではない）。件数の区画は表示される。
   - `/screening` は結果を表示し、`new-load-error` が出て、NEW は無い。
   - `/watchlist` は行を表示し、`watchlist-change-error` が出る。
   - `GET /api/screening/changes` は 500。
3. 権限を戻してリロードすると、元どおりに表示される。E2E で行う場合は、`finally`・`afterAll` で必ず戻す。

### C7. DB と設計

1. `pnpm test:db`（`lib/watchlist/watchlist.db.test.ts`・`lib/screening/screening-changes.db.test.ts` など）で、次を確かめる。
   - **（R4）前提**: 記録を作るテスト（記録・比較・`start_ingestion_run` の記録・保持の削除・性能）は、`screening_snapshots` が0件の DB（`db:reset` 直後）を前提にする。
     - テストの冒頭で0件を確かめ、そうでなければ前提の失敗として落とす（既存の株価・財務の結合テストと同じ書き方）。
     - 理由: 記録の関数は最新 7 回を残して古い記録を消し、比較は全体の最新の記録を使う。そのため、テストの外の記録を消さず、期待値も揺らさないためである。
     - CLAUDE.md の `pnpm test:db` の行の前提にも「比較の基準の記録が0件」を書く。
     - 巻き戻すトランザクションの中だけで記録を作るテストは、この前提を要らない（ジェネレーターがテストごとに選び、self-review に書く）。
   - C5-4〜C5-8 のすべて（トリガー・check 制約・RLS・上限・外部キー）。
   - 上限の同時実行: 499 件のユーザーで、別の銘柄の insert を2つ並行に行うと、1つだけが成功する。advisory lock の待ちは `pg_stat_activity` で確かめる。
   - **（R1）** 499 件のユーザーで、**同じ銘柄**の insert（`on conflict do nothing`）を2つ並行に行うと、両方とも成功し（上限のエラーにならない）、行は1行（500 件）になる。
   - **（R1）** 500 件のユーザーで、登録済みの銘柄の insert（`on conflict do nothing`）は成功し、行は変わらない。未登録の銘柄は上限のエラーになる。
   - 同じ銘柄の同時の追加（`on conflict do nothing`）は、両方が成功し、1行になる。
   - ユーザーの削除でウォッチリストが連鎖して消える。銘柄の削除でも連鎖して消える。上場廃止（`delisted_on`）では消えない。
   - `start_ingestion_run('stock_master', 'cron')` は記録を作り、`('stock_master', 'manual')`・`('financials', 'cron')`・二重実行で始められなかったときは作らない。
   - 記録の関数は、実行の開始と同じトランザクションで動く（開始が失敗したら記録も残らない）。
   - **（R2）記録の失敗で取り込みを止めない**:
     - 巻き戻すトランザクションの中で、記録を強制的に失敗させる。例: `screening_snapshot_stocks` に満たせない check 制約（`check (false) not valid`。既存の行は検査せず、新しい行を拒否する）を一時的に付ける。
     - その状態でも、`start_ingestion_run('stock_master','cron')` は `started: true` を返し、`running` の実行の行ができる。その行の `details.snapshot` は `"failed"` になる。
     - `screening_snapshots` の行は増えず、前回の記録が残る。
     - `screening_changes` は前回の記録で比較する（`comparison.capturedAt` が前回の日時）。
   - **（R5）終了で `snapshot` のキーが残る**:
     - 記録の成功（`captured`・`snapshotId`）と失敗（`failed`）の両方の開始について、実行を次の2つで終える。
       - `complete_stock_master_run`（details あり。例 `{"fixture": "sprint-14-db", "excluded": {…}}`）
       - `finish_ingestion_run`（`p_details` あり。例 `{"fixture": "sprint-14-db", "x": 1}`）
     - どちらでも、終了後の `details.snapshot`（と成功なら `snapshotId`）は開始時の値のまま。
     - ほかのキーは今までどおり置き換わる（渡した `details` のキーと、関数が足すキーになる。開始時に無かったキーは残らない）。
     - `p_details` が `snapshot` のキーを持っていても、開始時の値が勝つ。
     - `finish_ingestion_run` の `p_details` が NULL のときは、今までどおり `details` を変えない。
     - 記録の無い実行（手動・財務など）では、終了後の `details` に `snapshot` のキーが現れない（今までと同じ値）。
   - C4-10 のすべて。
   - **判定の1か所**:
     - 次の3つが、同じ条件の組み合わせで一致する（条件の組み合わせを網羅的に作る。含める2つの真偽、オフの組み合わせ、市場・業種、上場廃止を含む）。
       - `screening_evaluate` の `included`
       - `screen_stocks` の結果の集合
       - `stock_detail` の `included`
     - **（R3）** `screen_stocks` の `excludedUnavailable`・`excludedUndeterminable` が、`screening_evaluate` の `exclusion` の数と一致する。変更前の定義で求めた値とも一致する（同じ組み合わせで、既存の期待値を変えない）。
     - **（R3）** `exclusion` の優先順位を確かめる。例: 上場廃止かつ満たさない → `delisted`。絞り込みの外かつ満たさない → `filters`。満たさないかつ判定不能 → `unmet`。算出不可かつ判定不能（含める設定はどちらもオフ）→ `unavailable`。`blocking` はどの場合も ①〜④ の順で、妨げている条件をすべて含む。
     - 記録を今と同じ値で作った直後の `screening_changes` は、どの条件でも `added`・`removed` が空。
   - 後片付けは、テストが作った行だけを消す。対象は、銘柄コード 9S8xx・9S9xx、性能 S0000〜S3999、記録はテストが作った id、ユーザー `@quantis-db14.local`。
2. 次を評価者がコードで確かめる。
   - 「該当」と除外の分類（`included`・`exclusion`・`blocking`）の式が、`screening_evaluate` の1か所だけにある。次のどれにも式が無い（`ok_a`・`ok_b` のような式が残っていない）。
     - `screen_stocks`（除外の件数を含む）
     - `stock_detail`
     - `screening_changes`
     - ウォッチリストの関数
   - **（R3）** 記録の判定も同じ関数を通る。`screening_evaluate` の中で、今の表と記録の表で切り替わるのは入力の行（CTE）の取り出し元と基準日だけで、状態の CASE 式・④の結果・分類は1つずつしか無い。
   - TypeScript に判定・比較・理由の決定の式が無い（表示の文言だけ）。
3. ウォッチリストの読み書きは、ユーザーのセッション（RLS 経路）で行う。`src/lib/supabase/admin.ts` をウォッチリスト・比較のコードから import しない。記録の作成は `start_ingestion_run` の中だけ（アプリのコードから記録の関数を呼ばない）。
4. `e2e/db-privileges.spec.ts` で、次を確かめる。
   - authenticated の `watchlist_items` のテーブル権限が select・insert・update・delete ちょうど。anon の権限なし。
   - authenticated が書き込めるテーブルは `ownership_overrides`・`screening_presets`・`watchlist_items` だけ。
   - `screening_snapshots`・`screening_snapshot_stocks` は、authenticated が select だけ（許可ユーザーのポリシー）、anon は権限なし。
   - RLS のポリシーが本人かつ許可ユーザー（`(select …)` の形）。
   - トリガーの関数を authenticated が実行できない。
   - `capture_screening_snapshot` は service_role だけ。`screening_changes`・ウォッチリストの関数は authenticated が実行でき、anon は実行できない。

### C8. 性能

`pnpm test:db` で確かめる。上場中 4,000 銘柄（財務・初出日・判定あり）、記録 4,000 銘柄、1人のユーザーのウォッチリスト 500 件の DB で測る。

1. 記録の関数（4,000 銘柄）: 1,000ms 以内。
2. `screening_changes`（authenticated として。変化が約 200 件）: 150ms 以内。
3. `screen_stocks`: 既存の上限（100ms）のまま。NEW・星の問い合わせを加えた、スクリーニングの1回の表示に必要な DB の呼び出しの合計は 250ms 以内。
4. ウォッチリストの読み出し（500 件、指標・判定・変化つき）: 150ms 以内。
5. `dashboard_summary()`: 既存の値から大きく悪化しない（50ms 以内）。

実測値はテストの出力に出し、self-review に書く。

### C9. 持ち越し

1. **件数の分母**: `ingestion-reliability-example.sql`（9N003 が上場廃止）で、次を確かめる。
   - ダッシュボードの「保存済みの銘柄数（上場中）」は 3。`dashboard-delisted-count` は「ほかに上場廃止 1 銘柄（スクリーニングの対象外）」。
   - `GET /api/dashboard` の `stockCount` は 3、`delistedCount` は 1。
   - 財務・判定の件数と分母も、上場中の銘柄だけ。
   - 取り込み状況の財務の区画は「上場中の 3 銘柄のうち」の形。有報・補完・株価の初出日の区画の分母も3。
2. 上場廃止の銘柄が無い投入例（`screening-example.sql`・`ownership-example.sql` など）では、ダッシュボードと取り込み状況の数は今までと同じ。
3. 全銘柄が上場廃止の DB（例: `ownership-example.sql` の全銘柄に `delisted_on`）で、ダッシュボードは空状態にならず、「保存済みの銘柄数（上場中）0」と「ほかに上場廃止 14 銘柄」を出す。
4. **Sprint 13 m1**: 次を直す。
   - Sprint 13 の契約の C2-6 の文言（改訂履歴に「Sprint 14 で追記」として残す）を、次の形にする。「最終の URL と結果は『厳しめ』。履歴は増えない。入力欄から離れると確定するので、`cagr=15` が一時的に書かれることがある」。
   - CLAUDE.md の Sprint 13 の節に、「セレクターを開くと入力欄から離れるので、その時点で入力は確定する」と一言足す。
5. **Sprint 13 m2**: 管理 →「削除」→ 確認の「削除」を押した直後（待たずに）の Esc 1回で、管理のダイアログが閉じる。E2E で、待ち時間 0ms・100ms の両方を確かめる。
6. **Sprint 13 m3**: 既定のプリセットを C2-11 の「範囲外」（`cagr=99999`）にしたとき、`/stocks/9U006`（クエリなし）に `default-preset-invalid-note`「既定のプリセット『範囲外』の条件の一部（cagr）が無効なため、既定値で判定しています」が出る。
   - ダッシュボード・ウォッチリストにも同じ注記が出る。
   - 正規形でないプリセット（C2-11 の「並び違い」）では、「…標準の形に直して判定しています」が出る。
7. **preset-bar の分割**:
   - `preset-bar.tsx` をダイアログ（保存・管理・上書き・削除）ごとのファイルに分け、各ファイルを 400 行以下にする。
   - 振る舞いは変えない（`e2e/screening-presets.spec.ts` をそのまま通す）。

### C10. 画面のそのほか

1. ライト・ダークの両方で、次が WCAG AA（4.5:1）を満たす。色だけでなく、形・文字でも区別できる。
   - 星（登録済み・未登録）
   - NEW・外れたのバッジ
   - 変化の一覧の見出しと理由のチップ
   - ウォッチリストの該当の文言
   - メモの文字
2. 1280×800 で、次を満たす（既存の E2E の `toBeInViewport` の検査も成功する）。
   - スクリーニングの市場区分と AC6.12 の注記がスクロールなしで見える。
   - `results-scroll` の `scrollWidth <= clientWidth`。
   - ウォッチリストの表は横スクロールしない。
3. 375×812 で、次を満たす。
   - ダッシュボード・スクリーニング・ウォッチリスト・詳細のページ全体が横スクロールしない。
   - 確認のダイアログが画面に収まる。
   - スクリーニングの `cagr-supplement-note` はスクロールなしで見える（Sprint 13 の C2-10 と同じ条件）。
4. どの画面を開いても、ブラウザのコンソールにエラーが出ない（dev と prod）。
5. ウォッチリスト・比較の操作の前後で、`ingestion_runs` の行数が変わらない（C3-2 の定期実行を除く）。外部 API は呼ばない。

### C11. リグレッション・品質

1. **既存のテストの変更の範囲**: 変えてよいのは次の種類だけ。
   1. `e2e/db-privileges.spec.ts` の許可リストに、新しいテーブル・関数を足すこと。
   2. ナビゲーションの項目に「ウォッチリスト」を足すこと（`e2e/shell.spec.ts` の `NAV` など）。
   3. 件数の分母を上場中にそろえたことによる、上場廃止のある投入例の期待値と文言の変更（「銘柄マスタ N 銘柄のうち」→「上場中の N 銘柄のうち」、ダッシュボードの見出し・「うち上場廃止」→「ほかに上場廃止」）。上場廃止の無い投入例の値は変えない。
   4. `/api/cron/daily` を呼ぶ既存の spec（`ingestion.spec.ts`・`listing-dates.spec.ts`）の後片付けに、`screening-snapshots-cleanup.sql` を足すこと。
   5. `/screening`・`/stocks/`・`/` を開く既存の spec の `beforeAll` の前提の確認に、「記録0件・ウォッチリスト0件」を足すこと（Sprint 13 の `expectNoPresets()` と同じ形）。
   
   ほかの期待値は変えない。self-review に、変えたアサーションを、ファイル・行と前後の値つきで一覧にする。想定外の変更が要るときは、理由を self-review に書き、呼び出し元に報告する。
   - **（m6）** スクリーニングのコードのセルに星のボタンが入ると、Tab の順が変わる。Sprint 6・7・13 の E2E に、行のリンクへ Tab で移る前提の検査があれば、上の5種類には当たらない。
     - 変更が要るなら、self-review に理由と前後の値を書き、報告する。
     - 評価者は、変更されたアサーションをこの一覧と突き合わせる。
     - 星は行のリンクの**前**に置くので、Tab の順は「星 → コードのリンク」になる。
2. Sprint 1〜13 の完了条件が引き続き満たされる（評価者の判断で抜き取り確認）。特に次の点。
   - 記録が0件のときの `/screening` の URL・件数・並び・条件パネル（NEW が出ない）
   - 詳細からの戻り（AC7.6、`screening-detail-race.spec.ts`）。星を押しても詳細へ遷移しないこと
   - プリセット（Sprint 13）
   - 補正の表示（Sprint 11）
   - 鮮度の警告・上場廃止（Sprint 12）
   - `start_ingestion_run` の二重実行の防止と、応答の無い実行の後片付け（Sprint 3・12）
3. `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm test:db`、`pnpm build` がすべて成功する。
4. 本番相当のサーバー（キーなし）で `E2E_PORT=3100 pnpm test:e2e` がすべて成功する。dev でも、時計のずれの検査を含むファイル（新しい spec を含む）が成功する。
   - 追加する E2E:
     - `e2e/watchlist.spec.ts`: C1-1〜C1-9、C2-1〜C2-10、C5-1〜C5-3・C5-6・C5-9・C5-10、C6-1
     - `e2e/screening-changes.spec.ts`: C3-1〜C3-3・C3-5〜C3-7、C4-1〜C4-8・C4-11・C4-12、C6-2、C9-1〜C9-3・C9-5・C9-6、C10-2・C10-3
   - E2E の前提（CLAUDE.md）に「ウォッチリストと記録が0件」を加える。E2E の後、DB は開始前（0件）に戻る。対象は、市場データ・EDINET・判定・補正・プリセット・ウォッチリスト・記録・実行履歴。`seed:users` のユーザーは残る。
   - **後片付けの頑健さ**: 新しい spec は、`afterEach` に加えて `afterAll` でも後片付けの SQL を流す。権限を外すテストは、`finally`・`afterAll` で必ず戻す。
5. `pnpm test:db` の後片付けは、自分が作った行だけを消す（C7-1）。記録を作るテストは、記録0件の前提を冒頭で確かめる（R4）。
6. `sprint-14: ウォッチリストと新規該当` でコミットされている。未追跡の次のファイルも同じコミットに含める。
   - `docs/harness/sprints/sprint-13/evaluation-1.md`
   - Sprint 14 の契約・契約レビュー
7. `CLAUDE.md` に次が追記されている。
   - **「現状」**: Sprint 14 までで、スプリント計画の実施分はすべて実装済み、とする。
     - ユーザーの決定により、Sprint 15（F14 AI 判定補助。オプション）は実施しない。
     - 「現状」やほかの節で、後続のスプリント（Sprint 15、AI の判定補助）を予定として書いている箇所は、この決定に合わせる。
     - `docs/harness/spec.md` は planner の成果物なので変更しない。
   - ウォッチリストのテーブルと RLS（利用者のデータの3つ目の例外）
   - 比較の基準の記録の設計を、次の4点で書く。
     - いつ記録するか（定期実行の銘柄マスタの開始だけ）
     - 入力を残す理由
     - 両側に同じ条件と今の補正を当てる
     - 最新 7 回
   - 「該当」の式を `screening_evaluate` にまとめたこと
   - 既定の条件の解決の1か所
   - API（既定のプリセットを当てない）
   - 件数の分母
   - テストの接頭辞・後片付け
   - E2E の前提（記録0件・ウォッチリスト0件）と、`pnpm test:db` の前提（記録0件。R4）
   - 記録の失敗で取り込みを止めないこと（R2。`details.snapshot`）
   - 除外の分類（`exclusion`・`blocking`）と優先順位（R3）
   - C9-4
8. self-review に、C11-1 の変更の一覧と、C8 の実測値を書く。

## 7. 評価者への補足

- すべての完了条件は、キーなしの環境で確かめられる。
- 比較の基準の記録は、定期実行の経路（C3-2。キーなしでも記録される）か、psql の `select public.capture_screening_snapshot();` で作る。どちらも同じ関数を通る。
  - 記録の後に `screening-changes-after.sql` を流すと、AC13.4 の「前回の取り込み時点と今回とで変わるようにデータを投入する」を再現できる。
- `postgres` ユーザーは RLS を通らないが、トリガー・check 制約・外部キーは通る。ウォッチリストの投入例は、`created_at` を固定するためにトリガーを一時的に外す（第5章）。
- 直接の書き込み（C5-4・C5-5・C5-7）は、公開キーと owner／owner2 のアクセストークン（`/auth/v1/token?grant_type=password` で取得）で `/rest/v1/…` を呼ぶ。
- 期待値（第5章の表）は、`screen_stocks` を条件ごとに直接呼んで確かめられる。例: `select public.screen_stocks('{"cagr":"20","margin":"10","years":"5","owner":"20"}')` を、変化の前と後で比べる。
- 鮮度の警告の境（投入例の株価の成功の終了 2026-09-24 20:03 JST の 48 時間後）の後に評価する場合、C4-11 の最後の項目のとおり、区画は警告と一緒に描画されればよい。全件の E2E を境の後の状態で確かめる方法は、CLAUDE.md（Sprint 12 評価の改善提案）のとおり。

## 8. 今回やらないこと（後続スプリント）

- 外部への通知（メール・Slack・プッシュ）。仕様のスコープ外。
- 変化の履歴の画面（何日前に該当したか、過去の日ごとの変化）。記録は最新 7 回を残すが、比較に使うのは最新の1回だけ。
- ウォッチリストの並べ替え・フォルダ・タグ・一括操作、ウォッチリストだけを対象にしたスクリーニングの絞り込み。
- スクリーニングの「NEW のみ表示」の絞り込み。
- 銘柄詳細での NEW・外れたの表示（詳細は条件ごとの判定で分かる）。
- 変化の理由に値（前の値 → 今の値）を出すこと。
- 手動の実行で比較の基準を記録すること（第2章の5。定期実行だけ）。
- 複数のタブで同じメモを同時に編集したときの競合の検出。後の書き込みが勝つ。
- bigint の最大値の ID の扱い（Sprint 12 評価の改善提案）。
- AI の判定補助（F14）。ユーザーの決定により実施しない（Sprint 14 が最終スプリント）。

## 9. 改訂履歴

- 初版: 契約作成
- 改訂1（rev 1）: contract-review.md の R1〜R4 と m1〜m6 をすべて反映し、ユーザーの決定を記録した。完了条件の削除・緩和は無い（足しただけ）。
  - **ユーザーの決定**:
    - 比較の基準の記録を、定期実行の開始時だけにする（第2章の5）→ 承認
    - 手動補正は、比較の両側に今の補正を当てる（補正による変化は出さない。第2章の8）→ 承認
    - Sprint 15（F14 AI 判定補助）は実施しない。Sprint 14 を最終スプリントとし、CLAUDE.md の「現状」などをそれに合わせる（C11-7）。spec.md は変更しない
  - R1: トリガーは、ユーザーごとのロックの後に、同じ (`user_id`, `code`) の行が既にあれば上限の確認を飛ばす（第2章の1）。C1-8（500 件のときの登録済みの `PUT` は 200）と C7-1（499 件で同じ銘柄の同時の insert は両方成功して1行、500 件で登録済みの insert は成功）を足した。
  - R2: 記録の呼び出しをセーブポイントで包み、失敗しても実行は始め、`details.snapshot = "failed"` を残す（比較は前回の記録）。実行の詳細に `run-snapshot-failed` を出す（第2章の5、第5章）。C3-5 と C7-1（`check (false)` で記録を失敗させても `started: true`）を足した。
  - R3: `screening_evaluate` が `included`・`exclusion`・`blocking` を返す。
    - 優先順位は、上場廃止 → 絞り込み → 満たさない → 算出不可 → 判定不能。満たさないと判定不能が同時なら `unmet`。
    - この分類を、`screen_stocks` の除外の件数、`stock_detail`、ウォッチリストの `data-kind`（`undeterminable` を追加）、変化の理由が使う。
    - 記録の側は、入力の行の取り出し元と基準日だけを切り替え、状態の式を複製しない。
    - 第2章の4・6・9、第5章、C7-1・C7-2 を直した。
  - R4: 記録を作る `pnpm test:db` の前提を「記録0件」とし、冒頭で確かめる（巻き戻すトランザクションだけのテストは除く）。CLAUDE.md にも書く（C7-1・C3-4・C11-5・C11-7）。
  - m1: 第5章の「厳しめ」の行の列の区切りを直した。
  - m2: メモの 1,000 コードポイントは、前後の空白を除いた後で数える（第2章の2）。
  - m3: ウォッチリストを読めないとき、ダッシュボードの一覧は出し、星の印だけを出さない（`watchlisted` は比較の関数の外で求める）。`GET /api/screening/changes` は 500。第2章の11と C6-1 に足した。
  - m4: `relisted` には、ほかの理由を付けない（第2章の9、C4-10）。
  - m5: 「スクリーニングで開く」のクエリは、Sprint 13 の正規形の関数（`presetQueryOf`）で作る（第2章の4）。
  - m6: 星のボタンによる Tab の順の変化で既存の検査を直す場合は、self-review に書いて報告する（C11-1）。
- 改訂2（rev 2）: 再レビューの R5 と m7、実装の注意を反映した。完了条件の削除・緩和は無い。
  - R5: 終了の2つの関数（`finish_ingestion_run`・`complete_stock_master_run`）は、`details` を置き換えるときに、既存の `snapshot`・`snapshotId` だけを残す。ほかのキーは今までどおり置き換わり、開始時の値が勝つ（第2章の5、第5章）。
    - C7-1 に、次の確認を足した。記録の成功・失敗の両方の開始の後に、2つの終了の関数（details あり）で終える。そのときキーが残り、ほかのキーは置き換わる。記録の無い実行には現れない。
    - C3-5 の画面の確認は、`details` の書き換えをやめ、`check (false) not valid` で記録を実際に失敗させる形にした。
  - m7: 銘柄詳細の `evaluation-inclusion` の `data-kind`・`data-reason` は、互換のため今の値のままにする（④ の判定不能は `unavailable`）。`undeterminable` を出すのはウォッチリストだけ（第2章の6）。
  - 実装の注意（第2章の1・5）:
    - `details` への書き込みは、巻き戻る内側のブロックの外で行う。
    - `exception when others` はキャンセル（`query_canceled`）を捕まえない。これは受け入れ、握りつぶさない。
    - 記録は実行の行の insert の後に行う。
    - ウォッチリストのトリガー関数は VOLATILE のままにする。
