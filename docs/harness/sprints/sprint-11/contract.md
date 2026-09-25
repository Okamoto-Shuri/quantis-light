# Sprint 11 契約: F10 判定の手動補正（条件④）

> **改訂1（rev 1）の変更点**（contract-review.md の R1・R2・推奨と、★ へのユーザーの決定の反映。詳細は第9章）
> - **ユーザーの決定**: ★ 補正の選択肢は **3択（推奨案）で承認**。メモは必須のまま。
> - R1: 補正の行は BEFORE INSERT OR UPDATE のトリガーで守る（記録 `auto_*` は常に DB が求め直す、`created_at` の固定、`updated_at` は `now()`、`user_id`・`code` の変更は拒否）。`verdict` の check 制約。authenticated のテーブル権限は select・insert・update・delete だけ。直接の書き込みの完了条件 C6-4 を追加（第2章の2）。
> - R2: メモの空白の文字集合・保存する値（前後の空白を除いた値）・コードポイントでの文字数を、画面・API・DB でそろえた（第2章の6）。全角空白だけ・改行だけ・「𠮷」1,000/1,001 個の完了条件を C1-3・C4-8・C6-4 に追加。
> - 推奨: 比較は `is distinct from`。C5-9（有報未取得 → 取り込み → 知らせ）。`sort=owner` で補正された判定不能の銘柄は最後。`stocks` の削除で補正が連鎖して消える注記（Sprint 12 向け）。RLS は `(select auth.uid())` の形。

## 1. 対象機能

F10。条件④（オーナー企業／社長が筆頭株主）の自動判定を、ユーザーが銘柄ごとに上書きし、理由のメモを残せるようにする。補正はユーザーごとに保存し、そのユーザーのスクリーニングと銘柄詳細の判定に使う。補正の後に自動判定が変わったら、詳細画面で知らせる。

土台は Sprint 10 のものを使う。

| 使うもの | 出どころ |
|---|---|
| 判定の根拠の保存（`ownership_judgments`・`ownership_holder_classifications`）と再計算のトリガー | Sprint 10 |
| 判定の式の1か所（`screening_evaluate`）、一覧・詳細の読み出し（`screen_stocks`・`stock_detail`・`ownership_summary`） | Sprint 6・7・10 |
| 条件④のセル・ポップオーバー・判定根拠の区画・条件の判定の区画 | Sprint 10 |
| API の認証（`requireApiUser()`）、同一オリジンの確認（`lib/http/same-origin.ts`）、`jsonNoStore` | Sprint 1・3 |

外部 API は呼ばない。取り込み（target）も増やさない。

### 仕様書の受け入れ基準（引用）

- AC10.1 銘柄詳細画面で、条件④を「該当」「非該当」に手動で上書きし、理由のメモを入力して保存できる。
- AC10.2 上書き後は、スクリーニング結果と詳細画面の両方で補正後の判定が使われ、「手動補正」のラベルと元の自動判定が並んで表示される。
- AC10.3 補正を取り消すと、自動判定に戻る。
- AC10.4 補正はリロードしても保持される。別の許可ユーザーでログインしたときは、その補正は見えず、影響もしない。
- AC10.5 補正した後に新しい有報が取り込まれて自動判定が変わった場合、詳細画面に「補正後に自動判定が更新されました」と表示される。

関連する仕様の記述:
- F10 概要「補正はユーザーごとに保存され、スクリーニングにも反映される」。
- デザインの方向性「ヒューリスティック判定には必ず『自動判定』のラベルを付け、根拠を1クリックで確認できるようにする。ユーザーに判定の確からしさを誤解させない」。
- F14（後続）AC14.2「ユーザーが手動補正したときだけ変わる」。補正はスクリーニングの結果を変える唯一の人手の経路になる。

### 持ち越し事項（Sprint 10 評価の改善提案）

| 提案 | 扱い |
|---|---|
| m1（375px の内訳の明細で、氏名・名称の列が狭い） | 取り込む（C8-1） |
| m2（一覧のバーの幅 40px） | 後に回す（第8章） |
| m3（姓の読みの辞書の別の読みの抜け） | 取り込む。評価者が挙げた6姓の読みを足す（C8-3） |
| m4（閾値 0 でオーナー系 0.0% の銘柄がオーナー企業になる） | 変えない。規則（合計 ≥ 閾値）どおりで、変えるなら仕様の判断が要る（第8章） |
| m5（判定不能の根拠に「使った有報」と出る） | 取り込む（C8-2） |
| m6（一覧と詳細で区分名の表記が違う） | 取り込む（C8-4） |
| 環境（E2E を全件流した後の dev サーバーのメモリの再起動） | CLAUDE.md に1行書く（C10-8） |
| コード（`ownership_name_key` などに `set search_path` が無い） | 後に回す（第8章） |

## 2. 仕様上の論点と、このスプリントでの解釈

評価者は、この解釈が妥当かも判断してほしい。★ の項目は、仕様の「該当」「非該当」を具体化したもので、**改訂1でユーザーが推奨案（3択）を承認した**。

### 1. 補正の選択肢と、モード・閾値との関係 ★（ユーザー承認: 3択）

条件④には2つのモード（「オーナー企業または社長が筆頭株主」「社長が筆頭株主のみ」）と閾値がある。一方、仕様の補正は「該当」「非該当」だけである。「該当」をどのモードで満たすとみなすかを決める必要がある。

| 案 | 選択肢 | モード「オーナー企業または社長が筆頭株主」 | モード「社長が筆頭株主のみ」 |
|---|---|---|---|
| **推奨（契約の既定）** | 「該当（社長が筆頭株主）」「該当（オーナー企業）」「非該当」の3つ。自動判定の結果と同じ名前 | 該当2種は満たす。非該当は満たさない | 「該当（社長が筆頭株主）」だけが満たす。「該当（オーナー企業）」と「非該当」は満たさない |
| 別案 | 「該当」「非該当」の2つ | 該当は満たす | 該当は満たす（モードを無視） |

- 推奨の理由: 補正の後も、モードの意味（「社長が筆頭株主のみ」）が崩れない。自動判定と同じ名前なので、「元の自動判定」と並べたときに比べやすい。「該当」を2つに分けただけで、仕様の「該当」「非該当」の範囲に収まる。
- **閾値は補正に当てない**（どちらの案でも）。補正は「この銘柄はオーナー企業だ」という利用者の判断である。閾値の比較の元になるオーナー系合計は、自動判定の値のまま変えない。
- 条件④がオフのときは、補正があっても条件の印は「オフ」（①〜③と同じ）。列には補正後の結果を出す。

### 2. 補正の保存（ユーザーごと）

- 新しいテーブル `public.ownership_overrides`（名前は目安）。主キー (`user_id`, `code`)。1人・1銘柄に補正は1つ。
  - 列: `user_id`（`auth.users` への参照、削除で連鎖）、`code`（`stocks` への参照、削除で連鎖）、`verdict`（`president_top`／`owner_company`／`not_matched`）、`memo`、`created_at`、`updated_at`、補正時の自動判定の記録（第2章の4）。
- **これは利用者のデータで、市場データではない。** 書き込みは、そのユーザー自身のセッション（RLS）で行う。サービスロールは使わない。
  - RLS: select・insert・update・delete のすべてで「`user_id = (select auth.uid())` かつ `(select public.current_user_is_allowed())`」。insert・update の with check も同じ。`(select …)` の形で書き、行ごとの評価を避ける（既存のポリシーと同じ形）。
  - anon には権限なし。`authenticated` には、このテーブルに限って **select・insert・update・delete だけ**を明示的に grant する（TRUNCATE・REFERENCES・TRIGGER は付けない）。CLAUDE.md の「市場データのテーブルは service_role だけが書く」の例外で、理由をマイグレーションのコメントと CLAUDE.md に書く。`e2e/db-privileges.spec.ts` は、authenticated の権限がこの4つちょうどであることを確かめる。
- **直接の書き込み（PostgREST）からの保護（R1）**: 利用者は公開キーと自分の JWT で、API を通らずにこのテーブルを書ける。そこで、行の中身はすべて DB が決める。
  - **BEFORE INSERT OR UPDATE のトリガー**（行単位）が、次を行う。
    - 記録の列（`auto_*`。第2章の4）を、受け取った値に関係なく、常に現在の `ownership_judgments` から求め直す（行が無ければ「有報が未取得」を表す値）。したがって、どの書き込み（新規・編集・確認済み）も「記録を現在の自動判定で置き換える」（第2章の4の規則と同じ）。
    - insert では `user_id` を `auth.uid()` にし（違う値を渡せば with check で拒否）、`created_at`・`updated_at` を `now()` にする。
    - update では `created_at` を元の値に固定し、`updated_at` を `now()` にする。`user_id`・`code` の変更は例外で拒否する。
    - メモの前後の空白を除く（第2章の6の文字集合）。
  - check 制約: `verdict in ('president_top', 'owner_company', 'not_matched')`、メモ（第2章の6）。
  - 保存・確認済みの API は、このトリガーを通る普通の insert・update（または security invoker の関数）で書く。API から受け取った値を記録に使わない。
- **メモは必須**（ユーザーの確認済み）。規則は第2章の6。
- 許可リストから外れたユーザーの補正は、行としては残るが、読めず、判定にも使われない（RLS）。発行済みの JWT が有効な間も、RLS の `current_user_is_allowed()` が防ぐ。ユーザーを削除すれば連鎖で消える。
- **銘柄の削除で補正は連鎖して消える**（`code` は `stocks` への参照）。Sprint 12 の上場廃止では `stocks` の行を消さない（消すと利用者の補正とメモが黙って消える）。CLAUDE.md にも書く。

### 3. 補正後の判定（判定の式は DB の1か所）

- `screening_evaluate` が、呼び出したユーザーの補正を結合して、次を返す（security invoker のまま。RLS で自分の補正だけが見える。述語にも `user_id = auth.uid()` を書き、索引を使う）。
  - `owner_auto_result`: 自動判定の結果（Sprint 10 の `owner_result` と同じ。現在のモード・閾値で求める）
  - `owner_override`: 補正の選択肢（無ければ NULL）
  - `owner_result`: 補正があれば補正の選択肢、無ければ自動判定の結果（**実際に使う結果**）
  - `s_owner`: `owner_result` とモードから求める（第2章の1）。補正があれば判定不能（`unavailable`）にならない。
- 結果に含まれるか（`screen_stocks`・`stock_detail` の `included`）は `s_owner` を使う（既存の規則のまま）。したがって、判定不能だった銘柄に補正を付けると、「判定不能を含める」がオフでも結果に出うる。除外の件数（`excludedUndeterminable`）にも数えない。
- 並べ替え `sort=owner` は、自動判定のオーナー系合計のまま（補正は合計を持たないため）。補正で結果に入った判定不能の銘柄（例 9U004）は合計を持たないので、既存の「値の無い行は最後」の規則どおり、昇順・降順とも最後に来る。
- ダッシュボードと取り込み状況の「条件④を判定できた銘柄数」は、自動判定の数のまま（データの取り込みの状態を示す数で、利用者ごとに変えない）。
- 画面・API は DB の値を表示するだけで、TypeScript で補正後の判定を求めない。

### 4. 「補正後に自動判定が更新されました」（AC10.5）

- 補正を保存したときに、その時点の自動判定の**記録**を補正の行に残す。記録する項目は次のとおり（`ownership_judgments` の値。行が無ければ「有報が未取得」）。
  - 判定の状態（判定できた／判定不能）と判定不能の理由
  - 社長が筆頭株主か
  - オーナー系合計（丸める前）
  - 判定に使った書類（大株主・役員それぞれの書類ID）
- 現在の自動判定の同じ項目が、記録と1つでも違えば「自動判定が更新された」とみなす（`auto_changed`）。比較は DB で、項目ごとに `is distinct from` で行う（有報が未取得のときの NULL を正しく比べるため）。
- 知らせの表では、変わった項目を強調する（例: 書類だけが変わったと分かるように）。
  - 判定の日時（`judged_at`）と、取り込み待ちの書類（`pending_doc_id`）は比べない。同じ内容で再計算されただけのとき、未処理の新しい有報が一覧に載っただけのときは知らせない。
  - 判定に使った書類が変われば、数値が同じでも知らせる（新しい有報で判定し直したことを利用者が確かめられるように）。
  - 自動判定が記録と同じ内容に戻れば、知らせは消える（例: 新しい書類が取り下げられた）。
- 知らせには、補正時と現在の自動判定を並べて示す（結果・オーナー系合計・社長が筆頭株主か・書類ID）。補正時の結果の名前も、現在のモード・閾値で求める（記録の値に、`screening_evaluate` と同じ式を当てる。式は DB の1か所。関数に切り出す）。
- 「確認済みにする」を押すと、補正（選択肢とメモ）はそのまま、記録を現在の自動判定で置き換える。知らせは消える。
- 補正を編集して保存したときも、記録は現在の自動判定で置き換える（編集した時点で現在の自動判定を見ているため）。
- 一覧では、補正のポップオーバーの中に「補正後に自動判定が更新されました」の1行を出す（詳細への誘導。仕様の必須は詳細だけ）。

### 5. 表示の方針

- 補正後の判定には必ず「手動補正」のラベル（`data-testid="manual-override-label"`）を付け、元の自動判定を「自動判定」のラベル付きで並べる（AC10.2）。
- 見た目: 「手動補正」は「自動判定」と区別できる別の色（`globals.css` にトークンを足す。ライト・ダークで WCAG AA）と、アイコン（例: 鉛筆）。色だけに頼らない。
- 補正の結果の名前は、自動判定と同じ `OWNER_RESULT_LABELS`（`lib/ownership/display.ts`）。
- モード「社長が筆頭株主のみ」で補正が「該当（オーナー企業）」のときは、「『社長が筆頭株主のみ』では、この補正は条件を満たしません」と添える。

### 6. メモの空白と文字数（R2。画面・API・DB で同じ定義）

- **空白の文字集合**: JavaScript の正規表現 `\s` と同じ集合。すなわち U+0009〜U+000D（タブ・改行 \n・\r など）、U+0020、U+00A0、U+1680、U+2000〜U+200A、U+2028、U+2029、U+202F、U+205F、U+3000（全角空白）、U+FEFF。
  - DB の check 制約とトリガーは、この集合を**明示した文字クラスの正規表現**で書く（`[[:space:]]` や `btrim` の既定はロケール・範囲が違うので使わない）。TypeScript 側は1か所の定数（例 `lib/ownership/memo.ts`）にし、単体テストで DB と同じ文字の一覧を確かめる。
- **保存する値**: 前後の空白を除いた値（途中の改行・空白は保つ）。除く処理は画面・API・DB のトリガーのどれでも同じ集合で行う。
- **必須と上限**: 除いた後が 1 文字以上、**1,000 コードポイント以下**。
  - DB: check 制約 `char_length(memo) between 1 and 1000` と、前後に空白が無いこと（トリガーが除いた後の値に対して）。
  - API・画面: コードポイントで数える（`[...s].length` など。`String.length` は使わない）。画面の「N / 1,000」も除いた後のコードポイント数。
  - 例: 末尾に改行の付いた 1,000 文字の本文は、除いた後が 1,000 なので受理し、改行は保存しない。全角空白だけ・改行だけのメモは拒否する。「𠮷」（サロゲートペア）1,000 個は受理、1,001 個は拒否。

## 3. 起動方法

ポート 3000 は別のプロジェクトが使っているので、すべて **3100 番**で行う。3000 番のプロセスには触れない。3100 番のサーバーを止めるときは、`lsof -ti tcp:3100` で得た PID だけを止める。

```bash
cd /Users/shuriokamoto/dev/quantis-light
pnpm install
pnpm db:start          # Docker が必要
pnpm db:reset          # Sprint 11 のマイグレーションを含めて適用
pnpm env:local
pnpm seed:users        # owner・owner2（許可）、intruder（許可リスト外）
# キーなし（リポジトリ直下の .env にキーがあっても、空の値で上書きする）
JQUANTS_API_KEY= EDINET_API_KEY= CRON_SECRET=local-cron-secret-0123456789 pnpm dev -p 3100
# 本番相当: pnpm build && JQUANTS_API_KEY= EDINET_API_KEY= CRON_SECRET=local-cron-secret-0123456789 pnpm start -p 3100
```

- アプリ:
  - http://localhost:3100/stocks/9U003 （詳細。補正の操作）
  - http://localhost:3100/screening （既定の4条件）
- Postgres: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
- 評価用ユーザー（`pnpm seed:users` が作る。冪等）:

  | メール | パスワード | 許可リスト |
  |---|---|---|
  | `owner@quantis.local` | `Quantis-Owner-2026!` | 登録あり（既存） |
  | `owner2@quantis.local` | `Quantis-Owner2-2026!` | **登録あり（Sprint 11 で追加。AC10.4 の「別の許可ユーザー」）** |
  | `intruder@quantis.local` | `Quantis-Intruder-2026!` | 登録なし（既存） |

- 投入例: Sprint 10 の `e2e/fixtures/ownership-example.sql`（9U001〜9U014）をそのまま使う。AC10.5 用の追加は `e2e/fixtures/ownership-override-add.sql`（第5章）。
- E2E: `E2E_PORT=3100 E2E_CRON_SECRET=local-cron-secret-0123456789 pnpm test:e2e`。DB 込みのテスト: `pnpm test:db`。
- 追加する環境変数は無い。

## 4. 画面とエンドポイント

### 銘柄詳細画面 `/stocks/[code]`

**「条件④ 判定根拠」区画**（`ownership-evidence`）の先頭に、補正の区画（`data-testid="owner-override"`、`data-state="none|saved|editing"`）を置く。

- 補正が無いとき（`none`）:
  - 「判定を手動で補正する」ボタン（`owner-override-open`）。
  - 短い説明「自動判定が誤っていると確認できた場合に、この銘柄の条件④の判定を上書きできます。補正はあなたのアカウントだけに保存され、スクリーニングにも使われます」。
- 編集中（`editing`）:
  - 選択肢のラジオ（`owner-override-verdict-president_top`・`-owner_company`・`-not_matched`。見出し「補正後の判定」）。
  - メモ（`owner-override-memo`、`textarea`。ラベル「理由のメモ（必須）」。文字数の表示「N / 1,000」）。
  - 「保存」（`owner-override-save`）と「キャンセル」（`owner-override-cancel`）。
  - 検証: 選択肢が未選択・メモが空（空白だけを含む）・1,000 文字超のときは、保存せずに入力欄の下に日本語の文言（`owner-override-error`）を出す。例「補正後の判定を選んでください」「理由のメモを入力してください」「メモは 1,000 文字以内で入力してください」。
  - 保存に失敗したとき（ネットワーク・5xx・401・403）は、入力を保ったまま「保存できませんでした。…」を出す（`role="alert"`）。
  - 保存中はボタンを無効にし、二重に送らない。
- 保存済み（`saved`）:
  - 「手動補正」のラベルと補正後の判定（`owner-override-verdict`、`data-verdict`）。
  - 「元の自動判定」: 「自動判定」のラベルと、現在のモード・閾値での自動判定の結果（`owner-override-auto-result`、`data-result`）。
  - メモ（`owner-override-memo-text`。改行を保つ。`whitespace-pre-line`）と、補正日時・更新日時（JST の `YYYY-MM-DD HH:mm`）。
  - モード「社長が筆頭株主のみ」で補正が「該当（オーナー企業）」なら、第2章の5の注記。
  - 「編集」（`owner-override-edit`。現在の選択肢とメモを入れた編集中の形になる）と「補正を取り消す」（`owner-override-delete`）。取り消しは確認のダイアログ（「補正を取り消すと、自動判定に戻ります。メモも消えます」、「取り消す」「キャンセル」）を出してから行う。
  - **自動判定が更新されたとき**（AC10.5）: 区画の上部に知らせ（`data-testid="owner-override-auto-changed"`、`role="status"`）。
    - 見出し「補正後に自動判定が更新されました」。
    - 補正時と現在の自動判定の表（結果・オーナー系合計（切り捨て1桁）・社長が筆頭株主か・大株主と役員の書類ID）。
    - 「確認済みにする」ボタン（`owner-override-acknowledge`）と、「補正を見直す場合は『編集』から変更できます」。
- 保存・編集・取り消し・確認済みの後は、`router.refresh()` で画面を取り直す（URL・スクロール位置は保つ）。判定の区画・条件の判定の区画・「結果に含まれるか」がすぐ補正後の値になる。`router.refresh()` はクライアントのルーターのキャッシュも捨てるので、この後にスクリーニングへ戻っても（パンくず・ヘッダー・ブラウザの「戻る」のどれでも）、補正後の結果が出る（C3-5）。
- 判定根拠の区画のそのほか（筆頭株主・社長・一致した株主・使った有報）は自動判定の根拠のまま。区画の結果の表示（`evidence-result`）は補正後の判定にし、補正があるときはその横に「手動補正」のラベルと「自動判定: …」を並べる。
  - `ownership-evidence` の `data-result` は**自動判定の結果**のまま（根拠の区画なので）。`data-effective-result` に補正後の判定を出す。補正が無ければ両者は同じ。
- 「保有状態の内訳」区画は変えない（自動判定の分類。補正は区分を変えない）。

**条件の判定の区画**（`stock-evaluation.tsx`、`evaluation-owner`）:
- `data-status` は補正後の状態（第2章の3）。
- 補正があるときは、値の欄に「手動補正」のラベルと補正後の判定、その横に「自動判定: …」を出す。
- 「結果に含まれるか」も補正後の状態で求める（DB の `included`）。

### スクリーニング画面 `/screening`

**結果テーブルの条件④のセル**（`cell-owner-judgment`）:
- `data-result` は**補正後の判定**（補正が無ければ自動判定と同じ）。`data-auto-result` に自動判定の結果、補正があれば `data-override="true"`。
- 補正があるとき、セルに「手動補正」のラベル（アイコン付き）と補正後の判定を出し、その下に小さく「自動: 非該当」のように元の自動判定を出す（1行に収まらなければ2行）。
- ポップオーバー（`owner-judgment-detail`）の先頭に、補正の欄を加える。
  - 「手動補正」と補正後の判定、メモ（先頭の 120 文字。長ければ「…」）、更新日。
  - 自動判定が更新されていれば「補正後に自動判定が更新されました（詳細で確認できます）」の1行（`owner-override-auto-changed-hint`）。
  - その下に、既存の自動判定の内容（「自動判定」、結果、筆頭株主、社長）。
- 条件の印 ④ の `title` は、補正があれば末尾に「（手動補正）」を付ける。例「④ オーナー企業（≥20%）または社長が筆頭株主: 満たす（手動補正）」。
- 条件④のパネルの注記に1文を足す: 「手動補正した銘柄は、補正後の判定で絞り込みます（閾値は補正に当てません）」。
- 1280×800 で `results-scroll` が横スクロールしない（Sprint 10 の C3-7 を保つ）。375px でページ全体が横スクロールしない。

### エンドポイント

すべて `requireApiUser()`（未ログイン 401・許可リスト外 403・Auth 障害 503）、`jsonNoStore`。書き込みは同一オリジンの確認（違えば 403 `{"error":"cross_origin"}`）。コードは `normalizeStockCode`（4文字は末尾に 0）。形が不正なら 400 `invalid_code`、銘柄マスタに無ければ 404 `not_found`。

| メソッドとパス | 内容 |
|---|---|
| `GET /api/stocks/[code]/ownership-override` | 自分の補正。`{"data": <override> \| null}` |
| `PUT /api/stocks/[code]/ownership-override` | 本文 `{"verdict": "president_top"\|"owner_company"\|"not_matched", "memo": "…"}`。新規・更新（記録は現在の自動判定で置き換える）。200 `{"data": <override>}`。本文が JSON でない 400 `invalid_body`、値が不正 400 `invalid_override`（`fields` に `verdict`・`memo`） |
| `DELETE /api/stocks/[code]/ownership-override` | 取り消し。200 `{"deleted": true}`。補正が無ければ 200 `{"deleted": false}` |
| `POST /api/stocks/[code]/ownership-override/acknowledge` | 確認済みにする（記録だけを置き換える）。200 `{"data": <override>}`。補正が無ければ 404 `override_not_found` |
| `GET /api/stocks/[code]` | **変更**。`evaluation` に `ownerAutoResult`・`ownerOverride` を足す（`ownerResult` は補正後）。`ownership` に `auto_result`・`override` を足す（`result` は補正後） |
| `GET /api/screening` | **変更**。行の `ownership` に `auto_result`・`override`（下の形から `auto_at_override` を除いたもの）を足す。`ownership.result` と `status.owner` は補正後 |

`<override>` の形（数値は十進の文字列。日時は JST の ISO 8601）:

```json
{
  "verdict": "not_matched",
  "memo": "山田興産は社長の親族ではなく取引先（有報の関係会社の状況で確認）",
  "created_at": "2026-09-25T10:00:00+09:00",
  "updated_at": "2026-09-25T10:00:00+09:00",
  "auto_changed": false,
  "auto_at_override": {
    "status": "determined",
    "undeterminable_reason": null,
    "president_is_top_holder": false,
    "owner_total_pct": "35.00",
    "shareholders_doc_id": "SXTEST06",
    "officers_doc_id": "SXTEST06",
    "result": "owner_company"
  }
}
```

- `auto_at_override.result` は、記録の値に現在のモード・閾値を当てた結果（詳細の API はクエリの条件、書き込みの API は既定の条件）。
- 画面は API を経由せず、同じ DB 関数をユーザーのセッションで呼んでもよい（既存の方式）。書き込みは画面からも上の API を使う。
- 補正のエクスポート・一覧だけを返すエンドポイントは作らない。

## 5. データの保存形式と追加する DB オブジェクト

マイグレーション `supabase/migrations/20261004000000_ownership_overrides.sql`（名前は目安）。

| オブジェクト | 内容 |
|---|---|
| `public.ownership_overrides`（新しい） | 第2章の2。RLS 有効。記録の列の例: `auto_status`・`auto_undeterminable_reason`・`auto_president_is_top_holder`・`auto_owner_total_pct`・`auto_shareholders_doc_id`・`auto_officers_doc_id` |
| BEFORE INSERT OR UPDATE のトリガー（行単位）と check 制約 | 第2章の2（R1）・第2章の6（R2）。トリガーの関数は authenticated が直接実行できない（トリガーとしてだけ動く） |
| （使うなら）保存・確認済みの関数 | security invoker。`auth.uid()` の行だけを扱う。記録はトリガーが求める。authenticated に実行を許す |
| 結果の式の関数（例: `ownership_result_of(status, president_is_top_holder, owner_total_pct, mode, threshold)`） | Sprint 10 の `screening_evaluate` の中の式を切り出す。現在の判定と、記録の判定の両方に使う（式を1か所に保つ） |
| `public.screening_evaluate`（置き換え） | 第2章の3の列を返す |
| `public.ownership_summary`・`public.screen_stocks`・`public.stock_detail`（置き換え） | `auto_result`・`override`（`auto_changed` を含む）を返す |
| `public.surname_readings` への追加 | m3 の読み（C8-3）。既存のマイグレーションは書き換えず、新しいマイグレーションで足す |

- `e2e/db-privileges.spec.ts` の許可リストを更新する（authenticated が書き込めるテーブルは `ownership_overrides` だけ、という形で明示する）。

### 投入例（AC10.5 用の追加。`postgres` ユーザーで実行）

ファイル `e2e/fixtures/ownership-override-add.sql`（後片付けは `ownership-override-cleanup.sql`）。`ownership-example.sql` の後に入れる。9U006 の有報 SXTEST06 の**訂正有報**（新しく取り込まれた書類）で、山田興産が大株主から外れる。

```sql
insert into public.edinet_documents
  (doc_id, sec_code, edinet_code, filer_name, doc_type_code, ordinance_code, form_code,
   period_start, period_end, submitted_at, parent_doc_id, doc_description, withdrawn, withheld, xbrl_available, list_date)
values ('SYTEST16', '9U006', 'E99U06', '検証用内訳株式会社', '130', '010', '030001',
        '2025-04-01', '2026-03-31', '2026-09-20 15:00+09', 'SXTEST06', '訂正有価証券報告書－第10期', false, false, true, '2026-09-20');

insert into public.annual_report_extractions
  (doc_id, processed_at, shareholders_status, officers_status, shareholders_detail, officers_detail,
   officers_basis, officers_has_post_agm_table, officers_order_source)
values ('SYTEST16', now(), 'ok', 'ok', null, null, 'filing_date', false, 'inline_document');

insert into public.annual_report_shareholders (doc_id, rank, name, address, shares_held, ratio_pct, ratio_decimals)
values ('SYTEST16', 1, '日本マスタートラスト信託銀行株式会社（信託口）', '東京都港区', 2000000, 20.00, 2),
       ('SYTEST16', 2, '山田　太郎', '東京都港区', 1200000, 12.00, 2),
       ('SYTEST16', 3, '山田　花子', '東京都港区', 500000, 5.00, 2);

insert into public.annual_report_officers (doc_id, seq, name, title)
values ('SYTEST16', 1, '山田　太郎', '代表取締役社長'),
       ('SYTEST16', 2, '中村　健', '取締役');
```

- これを入れると、9U006 の自動判定は SYTEST16 で判定し直され、オーナー系合計 17.0%（社長本人 12.0、同姓の親族 5.0）、筆頭株主は信託口で、既定の条件では「非該当」になる。
- 後片付け（`ownership-override-cleanup.sql`）は `SYTEST…` の書類を消す（抽出・大株主・役員は連鎖で消え、9U006 は SXTEST06 の判定に戻る）。補正の行は `ownership-cleanup.sql` の銘柄の削除で連鎖して消える。

### 期待される結果（`ownership-example.sql` だけの DB に、owner が補正した場合）

owner の補正（テストの操作で作る。SQL の投入例は用意しない。評価者も画面か API で作る）:

| コード | 自動判定（既定） | 補正 | 補正後（既定の条件） |
|---|---|---|---|
| 9U003 | 非該当 | 該当（オーナー企業） | 満たす |
| 9U006 | 該当（オーナー企業） | 非該当 | 満たさない |
| 9U004 | 判定不能 | 該当（社長が筆頭株主） | 満たす |

**スクリーニングの件数**（owner のセッション。Sprint 10 の既定は7件: 9U001・002・006・008・009・010・014）:

| 補正の状態 | URL のクエリ | 結果 |
|---|---|---|
| 9U003 だけ | なし（既定） | **8件**（9U003 が加わる）。「判定不能のため除外: 3 件」 |
| 9U003 だけ | `ownermode=president` | 5件（9U001・008・009・010・014。「該当（オーナー企業）」の補正は満たさない） |
| 9U003 だけ | `owner=40` | **6件**（9U001・003・008・009・010・014。9U006 は外れ、9U003 は閾値に関係なく残る） |
| 9U003・9U006・9U004 | なし（既定） | **8件**（9U001・002・003・004・008・009・010・014。既定の7件から 9U006 が外れ、9U003・9U004 が加わる）。「判定不能のため除外: 2 件」（9U005・9U013） |
| 9U003・9U006・9U004 | `undeterminable=include` | **10件**（上の8件に、判定不能の 9U005・9U013 が加わる） |

- owner2 のセッションでは、同じ時点でも既定の7件・「判定不能のため除外: 3 件」のまま（AC10.4）。

## 6. テスト可能な完了条件

前提:
- 第3章の手順で 3100 番に起動し（キーなし）、`owner@quantis.local` でログイン済み。画面の幅は特記の無い限り 1280×800。
- DB は `pnpm db:reset && pnpm seed:users` の直後から始め、`ownership-example.sql` を入れる。補正は0件から始める。
- 特記の無い限り、`pnpm dev -p 3100` と `pnpm build && pnpm start -p 3100` の両方で満たすこと。

### C1. 補正の保存（AC10.1）
1. `/stocks/9U003` の判定根拠の区画に `owner-override`（`data-state="none"`）と「判定を手動で補正する」がある。自動判定は「非該当」。
2. 「判定を手動で補正する」を押すと、3つの選択肢・メモ・保存・キャンセルが出る。キャンセルで元に戻り、DB に行は無い。
3. 選択肢を選ばずに保存 → 「補正後の判定を選んでください」。「該当（オーナー企業）」を選び、メモを次の値にして保存 → どれも「理由のメモを入力してください」で、DB に行は作られない。
   - 半角空白だけ、全角空白（U+3000）だけ、改行だけ（`\n\n`）、タブと全角空白と改行の混在
   
   1,001 文字 → 「メモは 1,000 文字以内で入力してください」（行は作られない）。1,000 文字ちょうど、と、1,000 文字の本文の末尾に改行を付けた入力は保存でき、DB の `memo` は末尾の改行を含まない 1,000 文字（`char_length = 1000`）。「𠮷」1,000 個は保存でき、文字数の表示は「1,000 / 1,000」。「𠮷」1,001 個は「メモは 1,000 文字以内で入力してください」。確かめたら戻す。
4. 「該当（オーナー企業）」と、改行を含むメモ「関係会社の状況で資産管理会社と確認\n2026年6月の有報」を入れて保存すると、ページの URL は変わらずに `data-state="saved"` になる。
   - `owner-override-verdict` が「該当（オーナー企業）」、`owner-override-auto-result` が「非該当」、メモが2行で表示される。補正日時が `YYYY-MM-DD HH:mm`。
   - psql で `ownership_overrides` に owner の `user_id`・`9U003`・`owner_company`・メモ（改行を含む）の1行があり、記録の列が `determined`・`false`・`0`（または 0.00）・`SXTEST03`・`SXTEST03`。
5. メモに `<script>alert(1)</script>` を含めて保存しても、文字列としてそのまま表示され、スクリプトは動かない（`dialog` イベントが0件）。
6. 「編集」で選択肢を「非該当」に変えて保存すると、表示と DB が更新され、`updated_at` が新しくなり、`created_at` は変わらない。確かめたら「該当（オーナー企業）」に戻す。
7. 小文字のコード（API の `PUT /api/stocks/9u003/ownership-override`）でも、正規化して同じ銘柄（9U003）の行に保存される。

### C2. 補正後の判定の表示（AC10.2）
1. C1-4 の後の `/stocks/9U003`:
   - `evidence-result` に「該当（オーナー企業）」と「手動補正」のラベル、その横に「自動判定: 非該当」。`ownership-evidence` の `data-result="not_matched"`、`data-effective-result="owner_company"`。
   - `evaluation-owner` の `data-status="met"`。「手動補正」のラベルと「自動判定: 非該当」がある。
   - 「結果に含まれるか」が「含まれる」。
   - 「保有状態の内訳」は変わらない（オーナー系 0.0%）。
2. `/screening`（既定）の件数が **8件**で、9U003 の行がある。
   - `cell-owner-judgment` が `data-result="owner_company"`・`data-auto-result="not_matched"`・`data-override="true"`。セルに「手動補正」と「該当（オーナー企業）」、小さく「自動: 非該当」。
   - ポップオーバー（ホバー・クリック・Enter）に「手動補正」、補正後の判定、メモの先頭、更新日、その下に「自動判定」と自動判定の内容（筆頭株主「株式会社日本カストディ銀行（信託口）」「12.0%」、社長「渡辺　健一」）。詳細へは移らない。
   - 条件の印 ④ の `title` の末尾が「（手動補正）」。
   - 補正の無い行（例 9U006）には「手動補正」のラベルが無い。
3. `ownermode=president` で5件（9U003 は出ない）。`/stocks/9U003?ownermode=president` の `evaluation-owner` は `data-status="unmet"` で、「『社長が筆頭株主のみ』では、この補正は条件を満たしません」が出る。
4. `owner=40` で6件（9U003 が残る）。
5. 条件④をオフ（`off=owner`）にすると、9U003 の条件の印 ④ は「オフ」。セルには補正後の判定と「手動補正」が出る。
6. 9U006 を「非該当」に、9U004 を「該当（社長が筆頭株主）」に補正すると、既定の結果が第5章の8件になり、「判定不能のため除外: 2 件」。
   - 9U004 の詳細の `evaluation-owner` は `data-status="met"`、自動判定は「判定不能」と並んで出る。
   - `undeterminable=include` では **10件**（9U004 は判定不能ではなく「満たす」として含まれ、9U005・9U013 が判定不能で加わる。9U006 は出ない）。
7. `GET /api/screening`（既定）の 9U003 の行: `ownership.result = "owner_company"`・`ownership.auto_result = "not_matched"`・`ownership.override.verdict = "owner_company"`・`status.owner = "met"`。`GET /api/stocks/9U003` の `evaluation.ownerResult = "owner_company"`・`evaluation.ownerAutoResult = "not_matched"`・`ownership.override.memo` が保存したメモ。補正の無い銘柄は `override: null` で、`result` と `auto_result` が同じ。
8. 1280×800 で `results-scroll` の `scrollWidth <= clientWidth`（補正のセルがある状態で）。375px で `document.documentElement.scrollWidth <= 375`、補正の区画・ポップオーバーが画面の中。

### C3. 取り消し（AC10.3）と再読み込み（AC10.4 前半）
1. `/stocks/9U003` をリロードしても補正が表示される。ログアウトして再ログインしても残っている。
2. 「補正を取り消す」を押すと確認のダイアログが出る。「キャンセル」では何も変わらない。「取り消す」で `data-state="none"` になり、`evidence-result` は「非該当」、「手動補正」のラベルは無い。DB の行が消える。
3. 取り消し後の `/screening`（既定）は7件に戻る（9U003 が無い）。
4. `DELETE /api/stocks/9U003/ownership-override` をもう一度呼ぶと 200 `{"deleted": false}`。
5. 詳細で補正を保存・取り消した直後に、パンくずの「スクリーニング」・ヘッダーの「スクリーニング」・ブラウザの「戻る」のそれぞれでスクリーニングに移ると、直前の操作が反映された件数・行になる（古い結果が出ない）。条件と並べ替えは保たれる（AC7.6）。

### C4. ユーザーごとの分離（AC10.4 後半）
1. owner が 9U003 を「該当（オーナー企業）」に補正した状態で、別のブラウザのコンテキストで `owner2@quantis.local` にログインする。
   - `/stocks/9U003` に補正は無く（`data-state="none"`）、判定は「非該当」、「手動補正」のラベルが無い。
   - `/screening`（既定）は7件で、9U003 は無い。`GET /api/stocks/9U003` の `ownership.override` は `null`。
2. owner2 が 9U003 を「非該当」に、9U006 を「非該当」に補正しても、owner の画面（リロード後）は C2 のまま（9U003 は owner の補正、9U006 は自動判定）。owner2 の画面では 9U006 が外れて6件。
3. owner2 の JWT で PostgREST を直接呼ぶ（公開キー＋ owner2 のアクセストークン）:
   - `ownership_overrides` の select は owner2 の行だけ（owner の行は返らない）。
   - owner の行の `update`・`delete`（`user_id=eq.<owner の id>`）は0行に作用し、owner の行は変わらない。
   - `user_id` に owner の id を指定した insert は RLS で拒否される。
4. 公開キーだけ（anon）では `ownership_overrides` の select が0行または権限エラー。保存の関数の呼び出しは権限エラー。
5. intruder（許可リスト外）のセッションでは、`ownership_overrides` の読み書きができない（`pnpm test:db`）。API は 403。
6. 未ログインで `GET`・`PUT`・`DELETE /api/stocks/9U003/ownership-override` と `POST …/acknowledge` は 401 で、`Cache-Control: no-store`。行は作られない。
7. `PUT`・`DELETE`・`POST …/acknowledge` に別のオリジンの `Origin` を付けると 403 `cross_origin` で、DB は変わらない。
8. API の検証: `verdict` が `president`・`met`・空・欠け → 400 `invalid_override`（`fields` に `verdict`）。`memo` が欠け・半角空白だけ・全角空白だけ・改行だけ・1,001 文字・「𠮷」1,001 個・文字列以外 → 400（`fields` に `memo`）。「𠮷」1,000 個は 200 で、応答の `memo` は同じ 1,000 個。前後に空白・改行のあるメモは、除いた値で保存され、応答もその値。本文が JSON でない → 400 `invalid_body`。`/api/stocks/ABC!/ownership-override` → 400 `invalid_code`。`/api/stocks/9U999/ownership-override` の `PUT` → 404 `not_found`。
9. 許可の取り消し: 評価者が `private.allowed_emails` から owner2 を消すと、owner2 のセッションの API は 403 になり、owner2 の補正は読めず・書けない。owner の画面は変わらない。確かめたら `pnpm seed:users` で戻す。

### C5. 自動判定の更新の知らせ（AC10.5）
1. owner が 9U006 を「非該当」（メモあり）に補正する。この時点で `owner-override-auto-changed` は無い。
2. `ownership-override-add.sql`（SYTEST16）を入れて `/stocks/9U006` をリロードすると、ほかの操作なしで:
   - `owner-override-auto-changed` に「補正後に自動判定が更新されました」がある。
   - 補正時「該当（オーナー企業）」35.0%・書類 SXTEST06、現在「非該当」17.0%・書類 SYTEST16 が並ぶ。
   - 補正（「非該当」とメモ）は変わらない。判定根拠の区画の「使った有報」は SYTEST16。
   - `GET /api/stocks/9U006` の `ownership.override.auto_changed = true`。
   - 一覧の 9U006 の条件④のポップオーバーに `owner-override-auto-changed-hint`。
3. SYTEST16 を消す（`ownership-override-cleanup.sql`）とリロードで知らせが消える（自動判定が記録と同じに戻る）。もう一度入れると再び出る。
4. 知らせが出ている状態で「確認済みにする」を押すと、知らせが消え、補正は残る。DB の記録の列が SYTEST16・17.00 になる。リロードしても出ない。この後に SYTEST16 を消すと、今度は知らせが出る（現在 SXTEST06・35.00 が記録と違う）。
5. 知らせは次のときには出ない:
   - 補正の後に、同じ内容で再計算されただけ（例: 有報の行の `address` だけの update。トリガーで再計算されるが判定の内容は同じ）。
   - 取り込み待ちの新しい有報が一覧に載っただけ（抽出の行の無い書類の insert。`pending_doc_id` だけが変わる）。
6. 自動判定の状態が変わる場合も知らせが出る: 9U003 に補正を付けた後、SXTEST03 を `withdrawn = true` にすると（自動判定が判定不能に変わる）知らせが出て、補正時「非該当」・現在「判定不能」。補正後の判定（補正の選択肢）は変わらない。確かめたら戻す。
7. `POST …/acknowledge` は補正が無い銘柄で 404 `override_not_found`。
8. 補正を「編集」して保存すると、記録が現在の自動判定で置き換わり、知らせが消える。
9. **有報未取得 → 取り込み → 知らせ**（AC10.5 の最も素直な筋書き）: 9U004（有報未取得。自動判定は判定不能）を「該当（社長が筆頭株主）」に補正する（記録は「有報が未取得」＝ `ownership_judgments` の行なし）。この時点で知らせは無い。次に 9U004 の有報（書類 `SYTEST04`。`ownership-override-add.sql` と同じ形で、抽出 ok、大株主1位「石井　修」40.00%、役員「石井　修」代表取締役社長）を入れてリロードすると、知らせが出て、補正時「判定不能（有報が未取得）」・現在「該当（社長が筆頭株主）」40.0%・SYTEST04 が並ぶ。補正はそのまま。SYTEST04 を消すと知らせは消える。
   - この投入は `e2e/fixtures/ownership-override-add-9u004.sql`（名前は目安。後片付けは `ownership-override-cleanup.sql` の `SYTEST…`）に置く。
10. `sort=owner`（降順・昇順）で、補正で結果に入った 9U004（判定不能・合計なし）は最後に来る。

### C6. DB と判定の式
1. `pnpm test:db`（`ownership-override.db.test.ts` など）で次を確かめる。
   - 第2章の1の表のすべての組み合わせ（補正3種 × モード2種 × 自動判定4種）で、`screening_evaluate` の `s_owner`・`owner_result`・`owner_auto_result` が期待どおり。閾値を変えても補正の結果は変わらない。条件④オフでは `off`。
   - `screen_stocks` の件数・`excludedUndeterminable`・`included` が補正に従う。別のユーザーの補正は影響しない。
   - `auto_changed` の真偽（第2章の4の各項目の変化、`judged_at`・`pending_doc_id` だけの変化、元に戻った場合）。
   - 補正時の結果の名前（`auto_at_override.result`）が、同じ値の現在の判定と同じ式で求まる（式の関数を両方が使う）。
   - RLS（C4-3〜C4-5）。メモの check 制約（空白だけ・1,001 文字は拒否）。
   - `stocks` の行を消すと補正も消える（連鎖）。後片付けの後に、テストの接頭辞の補正が残らない。
2. 判定の式（補正後の判定・モードの適用）は DB の1か所だけにある。TypeScript に同じ式が無い（評価者がコードで確かめる）。
3. 画面・API の読み出しは、ユーザーのセッション（RLS 経路）で行う。補正の読み書きにサービスロールを使わない（`src/lib/supabase/admin.ts` を補正のコードから import しない）。
4. **直接の書き込みへの防御（R1・R2）**: owner の JWT（公開キー＋ owner のアクセストークン）で PostgREST から直接、次を試す（`pnpm test:db` で固定し、評価者も curl で確かめられる）。
   1. `auto_owner_total_pct`・`auto_shareholders_doc_id`・`auto_status` を偽った insert と update: 成功しても、行の記録の列は現在の `ownership_judgments` と同じ値になる（偽った値は保存されない）。
   2. `created_at` を過去の日時にする update: `created_at` は変わらない。`updated_at` を過去にする update: `updated_at` は更新時の `now()` になる。
   3. 自分の行の `user_id` を owner2 の id にする update、`code` を別の銘柄にする update: どちらも拒否され、行は変わらない。
   4. `verdict = 'met'` の insert・update: check 制約で拒否。
   5. メモが半角空白だけ・全角空白だけ・改行だけ・1,001 コードポイント・「𠮷」1,001 個の insert: 拒否。前後に全角空白・改行のあるメモの insert: 除いた値で保存される。「𠮷」1,000 個: 保存される。
   6. `user_id` を省いた insert: owner の id で保存される。
   - `e2e/db-privileges.spec.ts` で、authenticated の `ownership_overrides` のテーブル権限が select・insert・update・delete ちょうど（TRUNCATE・REFERENCES・TRIGGER なし）、anon の権限なし、トリガーの関数を authenticated が実行できないことを確かめる。

### C7. 性能
`pnpm test:db` で確かめる。合成データは Sprint 10 の性能テストと同じ 4,000 銘柄（接頭辞は `T0000`〜`T3999`、書類ID `SYPERF…`）で、1人のユーザーが 1,000 銘柄に補正を持ち、もう1人が 1,000 銘柄に補正を持つ。
1. `screen_stocks`（既定の4条件・`sort=owner`）が、authenticated として 100ms 以内（既存の基準）。
2. `stock_detail`（補正あり）が 20ms 以内。

### C8. 改善提案（Sprint 10 の m1・m3・m5・m6）
1. **m1**: 375px の `/stocks/9U006` で、`breakdown-holders` の氏名・名称のセルの幅が 120px 以上。「日本マスタートラスト信託銀行株式会社（信託口）」の行の氏名のセルが4行以下。持株比率と区分のセルは Sprint 10 の C4-10 のまま（`right <= 375`）、ページ全体の横スクロールなし。
2. **m5**: 判定不能の銘柄（`/stocks/9U013`・`/stocks/9U005`）の判定根拠で、書類の見出しが「対象の有報（判定には使っていません）」になり、「使った有報」の文字が無い。判定できた銘柄（9U006）は「使った有報」のまま。
3. **m3**: 姓の読みの辞書に次の読みが加わる（`pnpm test:db` で確かめる）。既存の読みは消さない。
   - 岩崎 イワザキ、宮崎 ミヤサキ、中沢 ナカサワ、小島 オジマ・コシマ、塩谷 シオタニ・エンヤ、清野 キヨノ
   - 例: 社長「岩崎　健」のとき「株式会社イワザキ興産」が資産管理会社（推定）になる。
4. **m6**: 区分名の表記を一覧と詳細でそろえる。一覧のポップオーバー・詳細の区分別の合計・詳細の明細のどれも、区分名の文字列（`textContent`）が「同姓の親族（推定）」「資産管理会社（推定）」になる。「（推定）」の部分は推定のラベル（`data-testid="estimated-label"`、区別できる見た目）として描く。区分1・2・5には推定のラベルが無い（AC9.15 を保つ）。

### C9. 画面のそのほか
1. ライト・ダークの両方で、「手動補正」のラベル・補正の区画の文字・知らせの文字が WCAG AA（4.5:1）を満たす。「手動補正」と「自動判定」のラベルは色以外（文字とアイコン）でも区別できる。
2. dev で `simulateServerClockBehind()` の状態で、`/stocks/9U003`（補正あり・なし）・`/stocks/9U006`（知らせあり）・`/screening` を開き、補正の保存・取り消しを行って、コンソールのエラーと `pageerror` が0件。
3. キーボードだけで、補正を開く → 選択肢を選ぶ → メモを入力 → 保存 → 取り消し（ダイアログ）まで操作できる。ダイアログはフォーカスを閉じ込め、Esc で閉じる。閉じた後、フォーカスは「補正を取り消す」に戻る。
4. 詳細・スクリーニングの画面を開く前後、補正の保存の前後で、`ingestion_runs` の行数が変わらない。
5. どの画面を開いても、ブラウザのコンソールにエラーが出ない（dev と prod）。

### C10. リグレッション・品質
1. **既存のテストの変更の範囲**: 変えてよいのは次の3種類だけ。
   1. API の応答の形の厳密な比較に、新しい項目（`auto_result`・`override`・`ownerAutoResult`・`ownerOverride`）を足すこと。
   2. `e2e/db-privileges.spec.ts` の許可リストに、新しいテーブル・関数を足すこと（authenticated の書き込みは `ownership_overrides` だけ）。
   3. m6（C8-4）による区分名の表示の変更に合わせた、区分名の文字列の期待値（詳細の「資産管理会社」→「資産管理会社（推定）」など）。
   
   ほかの期待値は変えない。self-review に、変えたアサーションを、ファイル・行と前後の値つきで一覧にする。3種類に当たらない想定外の変更が要るときは、理由を self-review に書き、契約の修正として扱う（呼び出し元に報告する）。
2. Sprint 1〜10 の完了条件が引き続き満たされる（評価者の判断で抜き取り確認）。特に、補正が0件のときの条件④の表示・件数（Sprint 10 の C1〜C4）が変わらないこと。
3. `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm test:db`、`pnpm build` がすべて成功する。
4. `E2E_PORT=3100 pnpm test:e2e` がすべて成功する（キーなしのサーバー）。
   - 追加する E2E（`e2e/ownership-override.spec.ts`）: C1-1〜C1-6、C2-1〜C2-8、C3-1〜C3-5、C4-1〜C4-3・C4-6〜C4-8、C5-1〜C5-4・C5-6・C5-9・C5-10、C6-4、C8-1・C8-2・C8-4、C9-2・C9-3。
   - E2E の後、DB の市場データ・EDINET・判定・補正・実行履歴は、開始前（0件）に戻る。`seed:users` のユーザーは残る。
5. `pnpm test:db` の後片付けは、自分の接頭辞だけを消す（コード `9T…`・`T0000`〜`T3999`、書類ID `SYTEST…`・`SYDB…`・`SYPERF…`、提出者 `E99T…`）。補正の行は銘柄の連鎖で消える。
6. `pnpm seed:users` が owner2 を作る（冪等）。`scripts/seed-users.ts` の変更だけで、本番の Supabase には作らない（既存のローカル限定の確認のまま）。
7. `sprint-11: 条件④の手動補正` でコミットされている。未追跡の `docs/harness/sprints/sprint-10/evaluation-1.md` も同じコミットに含める。
8. `CLAUDE.md` に次が追記され、「現状」が Sprint 11 までになっている。
   - 補正のテーブルと RLS（利用者が自分の行だけを書ける、市場データの方針の例外であること）、判定の式の場所、記録と `auto_changed` の規則、API
   - 評価用ユーザー owner2
   - E2E を全件流した後に dev サーバーがメモリの閾値で再起動することがある（Sprint 10 評価の環境の注記）
   - テストの接頭辞
9. self-review に、第2章の ★ の論点へのユーザーの決定と、C10-1 の変更の一覧を書く。

## 7. 評価者への補足

- すべての完了条件は、キーなしの環境で確かめられる。
- 補正は画面か API で作る（ユーザーごとの行で、`user_id` が要るため）。psql で直接入れる場合は、`auth.users` の owner の `id` を使う。記録の列を手で入れると `auto_changed` の確認にならないので、保存の関数を通すこと。
- 自動判定の変化は、Sprint 10 と同じく有報のテーブル（`edinet_documents`・`annual_report_extractions`・`annual_report_shareholders`・`annual_report_officers`）の変更で起こす。`ownership_judgments` に直接書かない。
- 第2章の1（★）は、ユーザーが3択を承認した（改訂1）。
- 直接の書き込み（C6-4）は、公開キーと owner のアクセストークン（`/auth/v1/token?grant_type=password` で取得）で `/rest/v1/ownership_overrides` を呼ぶ。

## 8. 今回やらないこと（後続スプリント）

- 条件④以外（①〜③）の手動補正。仕様の範囲外（F10 は条件④）。
- 補正の一覧画面・件数の集計・補正だけの絞り込み（「手動補正した銘柄だけ」など）。ウォッチリスト（F13。Sprint 14）とあわせて検討する。
- 補正の履歴（過去の選択肢・メモの版）。最新の1つだけを持つ。
- 大株主ごとの区分の補正（「この法人は資産管理会社ではない」など）。補正は銘柄の判定単位。
- 取り込みの失敗の一覧、データの鮮度の警告、上場廃止（F11。Sprint 12）。条件プリセット（F12）、ウォッチリスト（F13）、AI の判定補助（F14）。
- Sprint 10 評価の m2（一覧のバーの幅）、m4（閾値 0 の扱い。変えるなら仕様の判断が要る）、`ownership_name_key` などの `search_path`。
- データのエクスポート（仕様のスコープ外）。
- 複数のタブで同じ補正を同時に編集したときの競合の検出。後の書き込みが勝つ。

## 9. 改訂履歴

- 初版: 契約作成
- 改訂1（rev 1）: contract-review.md（1回目）の R1・R2・推奨と、ユーザーの決定を反映した。完了条件の削除・緩和は無い。
  - **ユーザーの決定**: ★ 補正の選択肢は3択（「該当（社長が筆頭株主）」「該当（オーナー企業）」「非該当」。「社長が筆頭株主のみ」では「該当（オーナー企業）」は満たさない。閾値は補正に当てない）を承認した。メモ必須の解釈はそのまま進める。
  - R1: 補正の行を BEFORE INSERT OR UPDATE のトリガーで守る（記録 `auto_*` の求め直し、`created_at` の固定、`updated_at = now()`、`user_id`・`code` の変更の拒否、メモの前後の空白の除去）。`verdict` の check 制約。authenticated のテーブル権限を select・insert・update・delete に限る（第2章の2）。完了条件 C6-4 を追加し、E2E の対象に C4-3・C6-4 を加えた。
  - R2: メモの空白の文字集合（JS の `\s` と同じ集合を明示）、保存する値（前後の空白を除いた値）、コードポイントでの文字数を、画面・API・DB でそろえた（第2章の6）。C1-3・C4-8 に全角空白だけ・改行だけ・末尾の改行・「𠮷」1,000/1,001 個を追加した。
  - 推奨:
    - 比較は `is distinct from`、知らせの表で変わった項目を強調（第2章の4）。
    - C5-9（9U004 に補正 → 有報 SYTEST04 を取り込む → 知らせ）と、C5-10（`sort=owner` で補正された判定不能の銘柄は最後）を追加した。第2章の3にも記載。
    - `stocks` の削除で補正が連鎖して消えることと、Sprint 12 の上場廃止では行を消さないことを第2章の2に書いた（CLAUDE.md にも書く）。
    - RLS のポリシーは `(select auth.uid())`・`(select public.current_user_is_allowed())` の形（第2章の2）。
    - 第8章に、複数タブの同時編集は後の書き込みが勝つことを加えた。
