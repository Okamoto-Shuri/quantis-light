# Sprint 03 契約: F3 取り込み基盤と銘柄マスタ

## 1. 対象機能

F3 取り込み基盤と銘柄マスタの取り込み。取り込み処理の土台（実行の記録、二重実行の防止、キー未設定の扱い）を作り、最初の対象として J-Quants の上場銘柄一覧を `public.stocks` に取り込む。起動経路は2つ。「取り込み状況」画面の「今すぐ取り込み」（手動）と、Vercel Cron（日次）。取り込み状況の画面に、データソースごとの認証情報の設定状態と、定期実行の設定を表示する。

あわせて、Sprint 2 の評価（`sprint-02/evaluation-2.md`）の改善提案のうち、次の2点をこのスプリントで直す。
- N1: 許可を取り消した後にナビゲーションで移動すると、`/login` に `?reason=revoked` が付かず、取り消しの理由が表示されない。
- N2: `/imports/zzz` のような、存在しない配下のパスの 404 で、ナビゲーションの項目に `aria-current="page"` が付く。

「その他」の2点（設定画面のラジオの矢印キー、375px の履歴カードの縦の長さ）は、このスプリントでは扱わない（第9章）。

### 仕様書の受け入れ基準（引用）

- AC3.1 「取り込み状況」画面に、データソースごと（J-Quants、EDINET）の認証情報の設定状態（「設定済み」または「未設定」）が表示される。キーの値そのものは表示されない。
- AC3.2 J-Quants のキーが未設定の環境で「今すぐ取り込み」を押すと、実行履歴に「失敗」として記録され、「J-Quants の API キーが設定されていません」と明示される。成功や0件成功としては記録されない。
- AC3.3 実行履歴には、開始日時、終了日時、対象（銘柄マスタ、株価、財務、有報など）、結果（成功・一部失敗・失敗）、処理件数、エラーメッセージが新しい順に表示され、リロードしても残っている。
- AC3.4 定期実行用のエンドポイントを、正しいシークレット無しで外部から呼び出すと拒否され（401 または 403）、取り込みは始まらず、実行履歴も増えない。
- AC3.5 Vercel Cron で毎日1回（取引日の夜間など、J-Quants のデータ更新後）に実行されるよう設定されている。設定内容は契約書に記載し、デプロイ設定で確認できる。
- AC3.6 （キーあり環境）取り込みが成功すると、銘柄マスタの件数が0件より多くなり、実行履歴に処理件数が表示される。
- AC3.7 取り込み処理の実行中に「今すぐ取り込み」を押しても二重に実行されない（「実行中」と表示される）。

## 2. 仕様上の論点と、このスプリントでの解釈

仕様を変えずに、次のように解釈する。評価者は、この解釈が妥当かも判断してほしい。

1. **J-Quants API のバージョンと認証方式**
   J-Quants API は V2 を使う。V2 の認証は API キー方式（リクエストヘッダー `x-api-key`）で、キーは J-Quants のダッシュボードで発行する。V1 のリフレッシュトークン／ID トークン方式には対応しない。銘柄マスタは `GET https://api.jquants.com/v2/equities/master`（パラメータ無し＝最新の一覧）から取得する。
2. **「認証情報の設定状態」の判定**
   サーバーの環境変数が、空白を除いて空でない値を持つかどうかだけで判定する（`JQUANTS_API_KEY`、`EDINET_API_KEY`）。画面を開くたびに外部 API を呼んでキーの有効性を確かめることはしない（画面は保存済みデータだけを見るという仕様の制約に合わせる）。キーが無効な場合は、取り込みを実行したときに「失敗」として理由付きで記録される（C4）。
3. **EDINET の扱い**
   EDINET の取り込み処理は Sprint 8 の機能。Sprint 3 では、AC3.1 のとおり EDINET のキーの設定状態を表示するだけにする。「今すぐ取り込み」と Cron は、Sprint 3 の時点では銘柄マスタだけを対象にし、EDINET の実行履歴は作らない（AC8.1 の「EDINET のキー未設定の失敗記録」は Sprint 8 で扱う）。
4. **銘柄マスタとして保存する範囲**
   J-Quants の上場銘柄一覧には、ETF・REIT、優先出資証券、外国株券や、TOKYO PRO MARKET の銘柄も含まれる。スクリーニングの対象は有価証券報告書を提出する国内の事業会社であり、F6 の市場区分の絞り込みも「プライム／スタンダード／グロース」の3つなので、次の条件をすべて満たす行だけを保存する。
   - 商品区分コード `ProdCat` が `011`（内国株券）。012 優先出資証券、013 REIT、014 ETF、021 外国株券、022 外国REIT、023 外国ETF、024 外国株預託証券は除く。外国株券（021）は国内の有報の大株主・役員の判定（F8・F9）の対象にならないため含めない
   - 市場区分コード `Mkt` が `0111`（プライム）、`0112`（スタンダード）、`0113`（グロース）のいずれか
   - 33業種コード `S33` が `9999`（その他）でない。`ProdCat = '011'` で ETF・REIT はほぼ除かれるが、念のための保険として残す

   処理件数（`processed_count`）は、保存（新規追加と更新）した行数とする。対象外として除いた件数は、理由ごとの内訳とともに実行履歴の詳細に記録する（第6章の `details`）。理由は、上の順（商品区分 → 市場区分 → 33業種）で最初に満たさなかった条件で1つに数える。
5. **一覧から消えた銘柄**
   前回の一覧にあって今回の一覧に無い銘柄（上場廃止など）は、Sprint 3 では削除も変更もしない。今回の一覧で確認できた日（`listed_info_date`）が更新されないことで区別できるようにしておき、上場廃止の扱いは Sprint 11（AC11.6）で行う。削除しないのは、後続スプリントで保存する財務指標などが連鎖削除されるのを防ぐため。
6. **取り込みの原子性**
   1回の銘柄マスタの取り込みは、全件の保存を1つのトランザクションで行う。途中で失敗したときは、`public.stocks` を1行も変えず、実行は「失敗」になる。公式ドキュメントでは、`equities/master` の応答に `pagination_key` は付かず、パラメータ無しの呼び出しで実行日時点の全銘柄が返る。万一、応答に `pagination_key` が付いていた場合は、一部だけを保存せず、「応答の形式が想定と異なります」の失敗にする（黙って一部の銘柄だけを保存しない）。銘柄マスタは1回の API 呼び出しで全件が返るので、Sprint 3 では「一部失敗」（`partial`）を使わない（銘柄ごとの処理が入る Sprint 4 以降で使う）。
7. **二重実行の防止の範囲**
   同時に「実行中」でいられる実行は、対象を問わず全体で1つだけにする。DB の一意制約で保証し、画面のボタンの無効化は補助にする。手動と Cron の間でも同じ制約が効く。
8. **応答の無くなった「実行中」**
   サーバーが途中で落ちると、実行が「実行中」のまま残り、以後の取り込みが永久に始まらなくなる。そこで、開始から 15 分以上たった「実行中」の実行は、応答が無くなったものとみなす。次に取り込みを開始するときに、その実行を「失敗」（エラーメッセージ「15 分以上応答が無かったため、中断されたものとみなしました」）に変えてから、新しい実行を始める。取り込みを動かす2つのルート（`POST /api/ingestion/runs` の `after()` の処理と、`GET /api/cron/daily`）は、どちらも `maxDuration = 300`（300 秒）にする。`after()` の処理は、そのルートの制限時間の中で動くからである。15 分（900 秒）は、この 300 秒より十分長い。
   後片付けで「失敗」にされた実行の処理が、遅れて終わることがありうる。実行を終える処理は `status = 'running'` の行だけを更新し、すでに「失敗」になった行を「成功」などで上書きしない。上書きしなかったときは、サーバーに警告のログを出す。
9. **Cron が起動しても取り込みが始まらないとき**
   Cron の起動時に、別の実行が「実行中」（15 分未満）なら、新しい実行は記録せずに 409 を返す。キー未設定などの失敗は、手動と同じく「失敗」として実行履歴に記録する。

## 3. 起動方法

```bash
cd /Users/shuriokamoto/dev/quantis-light
pnpm install
pnpm db:start          # Docker が必要（未起動なら open -a Docker）
pnpm db:reset          # Sprint 3 のマイグレーションを含めて適用
pnpm env:local         # .env.local を生成（既存の JQUANTS_API_KEY などの行は保持する）
pnpm seed:users        # owner@quantis.local / Quantis-Owner-2026!（許可ユーザー）
pnpm dev               # http://localhost:3000（本番相当は pnpm build && pnpm start）
```

- アプリ: http://localhost:3000
- Postgres: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
- 評価用ユーザー: `owner@quantis.local` / `Quantis-Owner-2026!`

### Sprint 3 で追加する環境変数（`.env.example` に追記する）

| 変数 | 用途 | 未設定のとき |
|---|---|---|
| `JQUANTS_API_KEY` | J-Quants API V2 の API キー | 取り込みは「失敗」（「J-Quants の API キーが設定されていません」） |
| `EDINET_API_KEY` | EDINET API の Subscription-Key（Sprint 8 で使う） | 取り込み状況に「未設定」と表示するだけ |
| `CRON_SECRET` | 定期実行用エンドポイントの認証。Vercel Cron は `Authorization: Bearer <CRON_SECRET>` を付けて呼ぶ。16 文字以上（例 `openssl rand -hex 32`） | 定期実行用エンドポイントは、どの要求も 401 で拒否する。16 文字未満の値は未設定として扱い、サーバーに警告のログを出す |

- 環境変数は起動時に読まれる。値を変えたら dev／prod のサーバーを再起動する。
- `pnpm env:local` は Supabase の3つの値だけを書き換え、`.env.local` にある上の3つの行は消さない。
- 評価者は、キーの有無を切り替えて確かめるときに、`.env.local` を書き換えるか、`JQUANTS_API_KEY=... pnpm dev` のように起動時に渡してよい。

## 4. 画面・エンドポイント・Cron の設定

### 画面

| 画面 | URL | 変更点 |
|---|---|---|
| 取り込み状況 | `/imports` | 「データソース」「定期実行」「手動取り込み」の区画を追加。実行中は自動で更新する |
| ダッシュボード | `/` | 変更なし（取り込みが成功すれば、Sprint 2 の集計に実データが反映される） |

### 取り込み状況の画面の構成（上から）

1. **データソース**: J-Quants と EDINET のカードを並べる（375px では縦に積む）。各カードに、名前、用途（J-Quants「銘柄マスタ・株価・財務」、EDINET「有価証券報告書（大株主・役員）」）、状態のバッジ（「設定済み」または「未設定」。色だけでなく文字とアイコンで区別する）を表示する。未設定のときは、設定すべき環境変数の名前（`JQUANTS_API_KEY` など）を添える。キーの値、値の一部、値の長さは、画面にも HTML にも API の応答にも出さない。
2. **定期実行**: 実行時刻「毎日 20:00（日本時間）」、対象「銘柄マスタ」、認証（`CRON_SECRET`）の「設定済み」「未設定」。
3. **手動取り込み**: 「今すぐ取り込み」ボタン（対象: 銘柄マスタ）。
   - 押すと、ボタンは無効になり、表示が「実行中…」（スピナー付き）に変わる。実行が終わるまで、この画面は約2秒ごとに自動で更新される（ページ全体の再読み込みはしない）。
   - 終わると、結果（「成功: N 件を保存しました」、または「失敗: <エラーメッセージ>」）をボタンの近くに表示する（`role="status"`）。
   - 実行中の実行（15 分未満）があれば、画面を開いた時点からボタンは無効で「実行中…」と表示され、その実行の対象と開始日時を添える。別のタブやリロード後も同じ。
   - J-Quants のキーが未設定でもボタンは押せる（AC3.2 のとおり、押すと失敗が記録される）。
4. **実行履歴**: Sprint 2 の表に加えて、失敗の行のエラーメッセージを省略せずに表示する（長い場合は折り返す）。

### エンドポイント

| メソッドとパス | 認証 | 内容 |
|---|---|---|
| `GET /api/ingestion` | `requireApiUser()`（未ログイン 401、許可リスト外 403） | 設定状態と実行履歴を返す（形式は C3-4） |
| `POST /api/ingestion/runs` | `requireApiUser()` ＋同一オリジンの確認（`Origin` がアプリと異なれば 403） | 手動取り込みを開始する（形式は C5-5） |
| `GET /api/cron/daily` | `Authorization: Bearer <CRON_SECRET>`（ログインのセッションは使わない） | 定期実行。Vercel Cron が呼ぶ（形式は C7） |

- 応答はすべて `jsonNoStore`（`Cache-Control: no-store`）。
- `src/proxy.ts` は、未ログインの `/api/*` を 401 にしている。`/api/cron/` 配下だけは proxy の未ログイン判定から外し、Route Handler が `CRON_SECRET` で認証する。ほかの `/api/*` の扱いは変えない。
- 手動取り込みは、実行を「実行中」として記録した後、応答（202）を返してから処理を続ける（`next/server` の `after()`）。Cron は処理の完了まで待ってから応答する。どちらも同じ取り込み処理を呼ぶ。
- `POST /api/ingestion/runs` と `GET /api/cron/daily` のルートは、どちらも `export const maxDuration = 300` を設定する（第2章の8）。
- proxy の除外は `/api/cron/` の配下（`pathname.startsWith("/api/cron/")` に相当）に限る。`/api/cron`、`/api/cronx` などは除外しない（C7-11）。
- 取り込み処理と実行履歴への書き込みは、サーバーの中でサービスロール（`src/lib/supabase/admin.ts`）で行う。画面と `GET /api/ingestion` の読み出しは、これまでどおりユーザーのセッション（RLS の経路）で行う。

### Vercel Cron の設定（AC3.5）

リポジトリ直下の `vercel.json` に次を置く。

```json
{
  "crons": [{ "path": "/api/cron/daily", "schedule": "0 11 * * *" }]
}
```

- `0 11 * * *` は UTC で毎日 11:00、日本時間で毎日 20:00。J-Quants の上場銘柄一覧は営業日の 17:30 以降に当日分が取得できるので、その後に実行する。取引が無い日にも実行するが、前回と同じ一覧を上書きするだけで害は無い（後続スプリントで株価などを加えるときに、取引日だけの処理にするかを見直す）。
- Vercel Cron は、本番のデプロイに対してだけ、`GET` で、`Authorization: Bearer <CRON_SECRET>` を付けて呼ぶ。Vercel のプロジェクトの環境変数に `CRON_SECRET`、`JQUANTS_API_KEY`、`EDINET_API_KEY` と Supabase の3つを設定する（CLAUDE.md に手順を書く）。
- Hobby プランでは、実行時刻が指定の時刻から最大 59 分ずれることがある。
- 画面の「毎日 20:00（日本時間）」の表示は、コードの定数から出す。Vitest で、その定数と `vercel.json` の `schedule` が一致することを確かめる。
- `GET /api/cron/daily` と `POST /api/ingestion/runs` の最大実行時間（`maxDuration`）は、どちらも 300 秒にする。

## 5. 取り込み処理の振る舞い

1. **開始**: DB 関数で、応答の無くなった「実行中」を「失敗」に変え（第2章の8）、新しい実行を `status='running'` で記録する。ほかに「実行中」があれば記録せずに「実行中あり」を返す（一意制約で、同時の要求でも1つしか記録されない）。
2. **キーの確認**: `JQUANTS_API_KEY` が未設定なら、外部 API を呼ばずに、実行を「失敗」、処理件数 0、エラーメッセージ「J-Quants の API キーが設定されていません」で終える。
3. **取得**: `GET https://api.jquants.com/v2/equities/master` を、ヘッダー `x-api-key` 付きで呼ぶ（タイムアウト 30 秒）。失敗時のエラーメッセージは次のとおり（いずれも「失敗」、処理件数 0、`public.stocks` は変わらない）。
   | 状況 | エラーメッセージ |
   |---|---|
   | 401 または 403 | `J-Quants の API キーが無効か、契約プランでは利用できません（HTTP 403）`（数字は実際のステータス） |
   | 429 | `J-Quants の呼び出し回数の上限に達しました（HTTP 429）。しばらくしてから再実行してください` |
   | そのほかの 200 以外（210 を含む） | `J-Quants から予期しない応答がありました（HTTP 500）` |
   | タイムアウト、接続できない | `J-Quants に接続できませんでした（<原因の短い説明>）` |
   | JSON でない、または形式が想定と違う（`data` が配列でない、必須の項目（`Code`、`CoName`、`Mkt`、`MktNm`、`S33`、`S33Nm`、`ProdCat`、`Date` など）が欠けている、`pagination_key` が付いている） | `J-Quants の応答の形式が想定と異なります` |
   | 保存の対象（第2章の4）が0件 | `J-Quants から取り込み対象の銘柄が1件も返りませんでした` |

   エラーメッセージに、キーの値や応答の本文（市場データ）は含めない。
4. **保存**: 対象の行を、1つのトランザクションで `public.stocks` に upsert する（第6章）。
5. **終了**: 実行を「成功」、処理件数＝保存した行数で終える。保存に失敗したら「失敗」（`銘柄マスタの保存に失敗しました`）。予期しない例外でも、実行を「実行中」のまま残さず「失敗」で終える。終了の記録は `status = 'running'` の行だけを更新する（第2章の8）。

## 6. データの保存形式（評価者の直接投入用）

Sprint 3 のマイグレーション（`supabase/migrations/2026092600xxxx_*.sql`）で次を行う。権限は Sprint 1・2 の方針のまま（RLS 有効、anon は権限なし、許可リストに入った authenticated だけが select、書き込みは service_role のみ）。

### `public.stocks` に追加する列

| 列 | 型 | J-Quants の項目 | 意味 |
|---|---|---|---|
| `company_name_en` | `text` | `CoNameEn` | 会社名（英語）。任意 |
| `market_code` | `text` | `Mkt` | 市場区分コード（`0111` など） |
| `sector17_code` | `text` | `S17` | 17業種コード |
| `sector17_name` | `text` | `S17Nm` | 17業種名 |
| `sector33_code` | `text` | `S33` | 33業種コード |
| `scale_category` | `text` | `ScaleCat` | 規模区分（`TOPIX Small 1` など） |
| `product_category` | `text` | `ProdCat` | 商品区分コード（取り込みで保存するのは `011` 内国株券だけ） |
| `listed_info_date` | `date` | `Date` | この行を確認した一覧の日付（情報適用年月日）。取り込むたびに更新される |

既存の列の対応: `code` ← `Code`、`company_name` ← `CoName`、`market_name` ← `MktNm`、`sector33_name` ← `S33Nm`、`updated_at` ← 保存した時刻。新しい列は NULL を許す（Sprint 2 までに評価者が投入した形式の行も入れられる）。

### `public.ingestion_runs` に追加する列と制約

| 列・制約 | 内容 |
|---|---|
| `details` | `jsonb`。任意。取り込みの補足。銘柄マスタでは `{"fetched": 取得件数, "skipped": 対象外として除いた件数, "skippedByProduct": 商品区分で除いた件数, "skippedByMarket": 市場区分で除いた件数, "skippedBySector": 33業種で除いた件数, "listedInfoDate": "YYYY-MM-DD"}`。`skipped` は3つの内訳の合計で、`fetched = processed_count + skipped`。市場データそのもの（銘柄名など）は入れない |
| 一意制約 | `status = 'running'` の行は、テーブル全体で1行まで（部分一意インデックス） |

### 追加する DB 関数（いずれも service_role だけが実行できる。anon・authenticated・PUBLIC には権限なし）

- 実行の開始（応答の無くなった実行の後片付け、二重実行の判定、記録を1回で行う）
- 実行の終了（結果、処理件数、エラーメッセージ、`details` の記録。`status = 'running'` の行だけを更新し、更新したかどうかを返す）
- 銘柄マスタの一括 upsert（1トランザクション）

関数の名前と引数は実装で決め、`e2e/db-privileges.spec.ts` の検査対象に加える。

### 投入例（`postgres` ユーザーで実行。RLS を迂回する）

実行中の実行を作る（C6 で使う）:

```sql
insert into public.ingestion_runs (target, trigger, status, started_at)
values ('stock_master', 'manual', 'running', now());
```

応答の無くなった実行を作る（C6-5 で使う）:

```sql
insert into public.ingestion_runs (target, trigger, status, started_at)
values ('stock_master', 'cron', 'running', now() - interval '20 minutes');
```

後片付け:

```sql
delete from public.ingestion_runs;
delete from public.stocks where code like '9999%';
```

## 7. テスト可能な完了条件

前提: 第3章の手順で起動し、`owner@quantis.local` でログイン済み。DB は `pnpm db:reset && pnpm seed:users` 直後（市場データと実行履歴は0件）から始める。**「キーなし」は `JQUANTS_API_KEY`・`EDINET_API_KEY` が未設定、`CRON_SECRET` は設定済み（例 `CRON_SECRET=local-cron-secret-0123456789`）でサーバーを起動した状態を指す。** 特記の無い限り、`pnpm dev` と `pnpm build && pnpm start` の両方で満たすこと。

### C1. データソースの設定状態（AC3.1）
1. キーなしで `/imports` を開くと、「データソース」に J-Quants と EDINET のカードがあり、どちらも「未設定」と表示され、`JQUANTS_API_KEY`、`EDINET_API_KEY` の名前が添えられている。「定期実行」に「毎日 20:00（日本時間）」と、認証「設定済み」が表示される。
2. `JQUANTS_API_KEY=qa-dummy-key-7f3a9c`（無効な値でよい）でサーバーを再起動すると、J-Quants だけが「設定済み」になり、EDINET は「未設定」のまま。`EDINET_API_KEY=qa-edinet-key-5b21e8` も加えると、両方が「設定済み」になる。
3. キーの値が漏れない: 2 の状態で、`/imports` の HTML（`curl -s -b <ログイン Cookie>`）、`GET /api/ingestion` の応答、ブラウザに読み込まれた JS のいずれにも、`qa-dummy-key-7f3a9c`、`qa-edinet-key-5b21e8`、その先頭4文字以上の部分文字列（`qa-d` など、ラベルと偶然一致するものを除く）が含まれない。`CRON_SECRET` の値も含まれない。
4. `CRON_SECRET` を未設定にして再起動すると、定期実行の認証が「未設定」になる。
5. 状態は色だけでなく、文字（「設定済み」「未設定」）とアイコンで区別できる。ライトとダークの両方で、バッジの文字が 4.5:1 以上のコントラスト比を満たす。

### C2. キー未設定での手動取り込み（AC3.2）
1. キーなしで `/imports` の「今すぐ取り込み」を押すと、数秒以内に「失敗: J-Quants の API キーが設定されていません」がボタンの近くに表示され、ボタンは再び押せる状態に戻る。
2. 実行履歴の先頭に、対象「銘柄マスタ」、起動「手動」、結果「失敗」、処理件数 `0`、エラー「J-Quants の API キーが設定されていません」の行が追加される。リロードしても残っている。
3. DB: `select target, trigger, status, processed_count, error_message, finished_at is not null from public.ingestion_runs;` が、上と同じ値の1行で、`status` は `failed`（`succeeded` や `partial` ではない）。`select count(*) from public.stocks;` は 0 のまま。
4. このとき外部 API は呼ばれていない（キーが無いので呼ぶ必要が無い）。単体テストで、キー未設定のときに fetch が呼ばれないことを確かめる。
5. ダッシュボードは空状態のままで、「直近の実行」に「失敗」とこのエラーメッセージが表示される（Sprint 2 の C2-5 と同じ表示）。最終取り込みの完了日時は更新されない。
6. もう一度押すと、同じ失敗の行がもう1行増える（2行になり、新しい順に並ぶ）。

### C3. 実行履歴の表示と API（AC3.3）
1. 実行履歴の表は、Sprint 2 の C4 と同じ列（開始、終了、対象、起動、結果、処理件数、エラー）で、開始日時の新しい順。C2 で作った行が、リロード後も残っている。
2. 取り込み処理が書いた行と、評価者が DB に投入した行が、同じ表に同じ形式で表示される（Sprint 2 の投入例の行を加えて確認）。
3. 200 文字以上のエラーメッセージを持つ行を投入しても、表が画面からはみ出さず、全文を読める（折り返し）。幅 375px でもページ全体が横スクロールしない。
4. `GET /api/ingestion`（ログイン済み）は、200 で次の形の JSON を返す。値は画面と一致する。キー名はこの例のとおりで確定とする。
   ```json
   { "data": {
       "sources": [
         { "id": "jquants", "configured": false },
         { "id": "edinet",  "configured": false }
       ],
       "cron": { "configured": true, "schedule": "0 11 * * *" },
       "activeRun": null,
       "runs": [
         { "id": 1, "target": "stock_master", "trigger": "manual", "status": "failed",
           "startedAt": "...", "finishedAt": "...", "processedCount": 0,
           "errorMessage": "J-Quants の API キーが設定されていません" }
       ],
       "hasMore": false
   } }
   ```
   `activeRun` は、15 分未満の「実行中」の実行があればその行（`runs` の要素と同じ形）、なければ `null`。`runs` は最大 50 件。未ログインは 401、許可リスト外は 403 で、実行履歴を含まない。応答に `Cache-Control: no-store` が付く。

### C4. 実 API の呼び出しの失敗（キーなし環境でも確認できる。ネットワークが必要）
1. `JQUANTS_API_KEY=qa-dummy-key-7f3a9c`（無効なキー）で起動して「今すぐ取り込み」を押すと、実際に J-Quants に問い合わせ、実行は「失敗」、エラーは「J-Quants の API キーが無効か、契約プランでは利用できません（HTTP 403）」（J-Quants が返したステータスの数字）になる。`public.stocks` は 0 件のまま。
2. ネットワークに出られない環境では、「J-Quants に接続できませんでした（…）」で失敗になり、「実行中」のまま残らない。
3. どちらの場合も、エラーメッセージとサーバーのログに、キーの値が含まれない。

### C5. 手動取り込みの API
1. `POST /api/ingestion/runs` を未ログインで呼ぶと 401、許可リスト外は 403。どちらも実行履歴は増えない。
2. ログイン済みの Cookie 付きでも、`Origin` ヘッダーが無い、または別のオリジン（`https://evil.example`）のときは 403 で、実行履歴は増えない。
3. `GET /api/ingestion/runs` など、`POST` 以外のメソッドは 405。
4. リクエスト本文は `{ "target": "stock_master" }`。本文が無い場合も `stock_master` として扱う。それ以外の `target`（`financials` など、まだ取り込み処理が無いもの、未知の値）は 400 `{"error":"unsupported_target"}` で、実行履歴は増えない。
5. 受け付けたときは 202 `{ "data": { "runId": <id>, "status": "running" } }` を返す。応答を返した時点で、`ingestion_runs` にその id の `running` の行がある。処理が終わると、その行が `succeeded` または `failed` に変わる（キーなしなら数秒以内に `failed`）。
6. 実行中の実行があるときは 409 `{ "error": "already_running", "data": { "activeRun": { ... } } }` を返し、実行履歴は増えない。

### C6. 二重実行の防止（AC3.7）
1. 第6章の投入例で「実行中」の行（開始 `now()`）を投入し、`/imports` を開くと、ボタンは無効で「実行中…」と表示され、実行中の実行の対象「銘柄マスタ」と開始日時が添えられる。実行履歴のその行は、結果「実行中」、終了「—」。
2. その状態で、無効なボタンを押しても何も起きない。ブラウザのコンソールから `fetch('/api/ingestion/runs', {method:'POST', headers:{'content-type':'application/json'}, body:'{"target":"stock_master"}'})` を呼ぶと 409 が返る。`select count(*) from public.ingestion_runs;` は 1 のまま。
3. `update public.ingestion_runs set status='failed', finished_at=now(), error_message='評価者が終了' where status='running';` を実行すると、約2秒以内に（リロードせずに）ボタンが「今すぐ取り込み」に戻り、押せるようになる。
4. 同時の要求: 実行中の実行が無い状態で、`POST /api/ingestion/runs` を並列に5回送る（例: `Promise.all` で5本の fetch）。202 はちょうど1つで、残りの4つは 409。`ingestion_runs` の行は1行だけ増える。Cron（C7）と手動を同時に送った場合も、新しい行は1行だけ。
5. 応答の無くなった実行: 第6章の投入例で、開始から 20 分たった「実行中」の行を投入して `/imports` を開くと、ボタンは押せる状態で、その行の近くに「応答がありません（15 分以上）」と表示される。ボタンを押すと、その行は結果「失敗」、エラー「15 分以上応答が無かったため、中断されたものとみなしました」になり、新しい実行が1行追加される（キーなしなら、その実行も「J-Quants の API キーが設定されていません」で失敗）。
6. DB の制約: postgres で `running` の行を2行 insert しようとすると、2行目が一意制約違反で失敗する。
7. 別のタブ: タブ A で「今すぐ取り込み」を押した直後（実行中）にタブ B で `/imports` を開くと、タブ B でもボタンは「実行中…」で無効。キーありで実行が数秒かかる場合に確認する。キーなしでは実行がすぐ終わるため、1 の投入例で代わりに確認する。

### C7. 定期実行のエンドポイント（AC3.4）
1. `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/cron/daily` （ヘッダー無し）は 401。
2. 誤ったシークレット（`-H 'Authorization: Bearer wrong'`）、`Bearer` の付かない正しい値（`-H 'Authorization: local-cron-secret-0123456789'`）、正しい値を `?secret=` などのクエリで渡したもの、はどれも 401。
3. ログイン済みのブラウザの Cookie を付けても、正しいシークレットが無ければ 401（ログインのセッションでは Cron を起動できない）。
4. 1〜3 のどの場合も、`select count(*) from public.ingestion_runs;` は増えない。応答の本文に市場データや実行履歴を含まない。
5. `CRON_SECRET` を未設定にして起動すると、`Authorization: Bearer ` （空）や任意の値を付けても 401 で、実行履歴は増えない。
6. 正しいシークレット（`-H 'Authorization: Bearer local-cron-secret-0123456789'`）で呼ぶと、処理の完了まで待ってから 200 で次の形の JSON を返し、実行履歴に起動「定期実行」の行が1行増える。キーなしなら、その行は「失敗」で「J-Quants の API キーが設定されていません」。
   ```json
   { "data": { "runs": [ { "runId": 3, "target": "stock_master", "status": "failed", "processedCount": 0 } ] } }
   ```
7. 実行中の実行がある状態で正しいシークレットで呼ぶと、409 `{"error":"already_running"}` で、実行履歴は増えない。
8. `POST /api/cron/daily` は 405。
9. シークレットの比較は、長さに依存しない定数時間の比較で行う（単体テストで、正しい値、誤った値、長さの違う値、空、`Bearer` 無しを確かめる）。
10. proxy の変更で、`/api/cron/` 以外の API の保護が弱まっていない: 未ログインで `/api/ingestion`、`/api/dashboard`、`/api/stocks`、`/api/zzz` は引き続き 401。`/api/cron/zzz`（存在しないパス）は 401 または 404 で、データを返さない。
11. proxy の除外が `/api/cron/` の配下に限られる: 未ログインで次の URL を開くと、どれも 401、または認証の判定を通ったうえでの 404 になり、データ（実行履歴、件数、銘柄）を返さず、実行履歴も増えない。`/api/cron`（末尾のスラッシュ無し）、`/api/cronx`、`/api/cron-daily`、`/api/cron/..%2Fingestion`、`/api/cron/%2e%2e/ingestion`、`/API/cron/daily`。除外の判定は `pathname.startsWith("/api/cron/")` に相当するもので、`/api/cron` の前方一致ではない。この一覧が E2E または Vitest に含まれている。
12. `CRON_SECRET` に 16 文字未満の値（例 `short`）を設定して起動すると、未設定として扱われ、`Authorization: Bearer short` でも 401。取り込み状況の画面では、定期実行の認証が「未設定」と表示される。

### C8. Cron の設定（AC3.5）
1. リポジトリ直下の `vercel.json` に、第4章のとおり `/api/cron/daily` と `0 11 * * *` が設定されている。
2. 取り込み状況の画面の「毎日 20:00（日本時間）」が、この設定と一致する（Vitest で、画面の表示に使う定数と `vercel.json` を照合するテストがある）。
3. CLAUDE.md に、Vercel での設定手順（環境変数の一覧、`CRON_SECRET` の生成方法、Cron は本番のデプロイでだけ動くこと）が書かれている。
4. （Vercel にデプロイした場合のみ、任意）Vercel のプロジェクトの「Cron Jobs」の設定に `/api/cron/daily` が表示される。ジェネレーターはデプロイを行わないので、この項目は合否の対象外とする。

### C9. 取り込みの成功（AC3.6）
キーが無い環境でも確認できる項目（1〜5）と、キーがある環境だけの項目（6〜8）に分ける。

1. **応答の解析（Vitest）**: J-Quants V2 の `equities/master` の実際の応答の形をしたフィクスチャから、保存する行が第2章の4と第6章の対応どおりに作られる。フィクスチャは公式ドキュメントの例と同じ項目名（`Date, Code, CoName, CoNameEn, S17, S17Nm, S33, S33Nm, ScaleCat, Mkt, MktNm, Mrgn, MrgnNm, ProdCat`）をすべての行に持ち、次の行を含む。
   - 保存される行: プライム・スタンダード・グロースの内国株券（`ProdCat=011`）、`CoNameEn` が空の行、英字を含むコード（`130A0` など）
   - 除外される行: ETF（`ProdCat=014`、`S33=9999`）、REIT（`ProdCat=013`）、プライムかスタンダードの優先出資証券（`ProdCat=012`）、グロースの外国株券（`ProdCat=021`）、TOKYO PRO MARKET の内国株券（`Mkt=0105`）、`ProdCat=011` で `S33=9999` の行

   除外される行がすべて除かれ、`skipped` と理由ごとの内訳（`skippedByProduct`、`skippedByMarket`、`skippedBySector`）が第2章の4の数え方どおりになる。
2. **エラーの分類（Vitest）**: 第5章の3の表のすべての場合（401、403、429、500、210、タイムアウト、接続できない、JSON でない、`data` が配列でない、必須の項目（`ProdCat` を含む）が欠けている行がある、`pagination_key` が付いている、対象が0件）について、決まったエラーメッセージになる。どのメッセージにもキーの値が含まれない。
3. **取り込み処理の結合テスト（DB 込み、`pnpm test:db`）**: fetch だけを差し替えて（ネットワークに出ずにフィクスチャを返す）、実際の取り込み処理をローカルの DB に対して実行するテストがある。次を確かめる。フィクスチャのコードは `99990`〜`99999` の範囲にし、テストの最後に、作った `stocks` と `ingestion_runs` の行を削除する。
   - 成功すると、`ingestion_runs` に `succeeded` の行ができ、`processed_count` が保存した行数、`details` の `fetched`・`skipped` が正しい。`stocks` に対象の行だけが、第6章の対応どおりの値で入る。
   - 2回目の取り込みで、社名や市場区分を変えたフィクスチャを渡すと、同じコードの行が更新され（重複しない）、`listed_info_date` と `updated_at` が新しくなる。2回目の一覧に無いコードの行は、削除も変更もされない。
   - 保存の途中で失敗させた場合（制約に反する行を混ぜる、など）、`stocks` は1行も変わらず、実行は `failed`。
   - 取得が失敗した場合（403 を返す fetch）、`stocks` は変わらず、実行は `failed` で第5章のエラーメッセージ。
   - 遅れて終わった処理が上書きしない: 実行を開始した後、その行を DB で `failed` に変えてから処理を終えさせると、行は `failed` のまま（`succeeded` に上書きされない）で、`processed_count` やエラーメッセージも変わらない。
   - `pnpm test:db` はローカルの Supabase が起動していることを前提にする。CLAUDE.md のコマンド表に追記する。
4. **結果の表示（Vitest）**: 「今すぐ取り込み」の結果の文言を組み立てる関数が、成功なら「成功: 4,123 件を保存しました」（3桁区切り）、失敗なら「失敗: <エラーメッセージ>」、実行中なら「実行中…」を返す。キーの無い画面では成功の表示を確かめられないため、その代わりとする。
5. **表示の経路**: 3 のテストで保存されたのと同じ形式の行（第6章の列を含む）を DB に投入すると、ダッシュボードの「保存済みの銘柄数」に反映される（Sprint 2 と同じ経路）。`GET /api/stocks` の応答に、新しい列（`market_code` など）が含まれる。
6. （キーあり環境）正しい `JQUANTS_API_KEY` で「今すぐ取り込み」を押すと、実行中の表示を経て「成功: N 件を保存しました」（N は数千）が表示される。実行履歴の先頭の行は、結果「成功」、処理件数 N（3桁区切り）。`select count(*) from public.stocks;` が N と一致し、0 より大きい。
7. （キーあり環境）`public.stocks` に、実在の銘柄（例 `86970` 日本取引所グループ、市場区分「プライム」）が、J-Quants の値どおりに入っている。`market_code` が `0111`〜`0113` 以外の行、`sector33_code = '9999'` の行、`product_category` が `011` 以外の行は無い。最新の実行の `details` で、`fetched = processed_count + skipped` が成り立つ。
8. （キーあり環境）取り込み後、ダッシュボードが空状態から件数の表示に変わり、最終取り込みの完了日時がこの実行の終了日時になる。もう一度取り込むと、`stocks` の件数は変わらず（重複しない）、実行履歴が1行増える。

### C10. Sprint 2 からの持ち越し（N1、N2）
1. **N1**: owner でログインしてダッシュボードを開き、`select public.admin_disallow_email('owner@quantis.local');` を実行した後、リロードせずにヘッダーのナビゲーションで「取り込み状況」を押す。`/login?reason=revoked` に移り、「利用許可が取り消されました」の旨のメッセージが表示される。認証の Cookie は0件になる。375px のドロワーから「設定」を押した場合も同じ。確認後、`select public.admin_allow_email('owner@quantis.local');` で戻す。
2. N1 の修正後も、URL を直接開いた場合（`/`、`/imports`、`/settings`、`/nope`）の振る舞い（`/login?reason=revoked`、Cookie は0件）は変わらない。許可されたユーザーが外部サイトのリンクなどで `/auth/signout?reason=revoked` を開いても、セッションは破棄されず、取り消しのメッセージも表示されない（Sprint 1 の方針）。
3. N1 の手順が E2E に含まれている（`simulateServerClockBehind()` を入れた状態でも `pageerror` が0件）。
4. **N2**: ログイン後に `/imports/zzz`、`/settings/x`、`/nope` を開くと、404 の画面で、ナビゲーションのどの項目にも `aria-current="page"` が付かず、見た目の強調（下線）も無い。375px のドロワーの中でも同じ。`/imports` と `/settings` では、これまでどおり該当の項目に付く。
5. N2 が Vitest または E2E で確認されている。

### C11. デザイン
1. 取り込み状況の画面の新しい区画は、既存の画面（ダッシュボード、実行履歴の表）と同じ部品と配色（`globals.css` のトークン）を使い、見出しの階層、余白、角丸がそろっている。「設定済み」は控えめなアクセント、「未設定」は注意の色で、どちらも文字とアイコン付き。
2. ライトとダークの両方で、新しい区画の文字（バッジ、補足の小さい文字、結果の表示を含む）が WCAG 2.1 AA（4.5:1。大きい文字は 3:1）を満たす。
3. 幅 375px で、データソースのカードは縦に積まれ、「今すぐ取り込み」のボタンと結果の表示が画面からはみ出さない。ページ全体に横スクロールが無い（`document.documentElement.scrollWidth <= 375`）。
4. 「今すぐ取り込み」はキーボードで操作でき（Tab でフォーカスが見え、Enter または Space で実行）、実行中は `aria-disabled` または `disabled` になり、結果の表示は `role="status"` でスクリーンリーダーに伝わる。

### C12. リグレッションと品質
1. Sprint 1・2 の完了条件が引き続き満たされる（評価者の判断で抜き取り確認）。特に、ログアウト後の「戻る」、許可の取り消し（URL を直接開いた場合）、ダッシュボードの件数と空状態、テーマ、375px のドロワー、404。
2. `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm test:db`、`pnpm build` がすべて成功する。
3. `pnpm test:e2e` がすべて成功する（キーなしの環境が前提。サーバーの J-Quants が「設定済み」のときは、キー未設定を前提にしたテストをスキップし、その旨を出力する）。Sprint 3 で次の E2E を追加する。
   - 設定状態の表示（C1-1）、キー未設定の手動取り込みと履歴（C2-1〜3）、実行中の表示と 409（C6-1〜3）、並列の要求（C6-4）、応答の無くなった実行（C6-5）、Cron の認証（C7-1〜7、C7-11。正しいシークレットは、E2E の起動時に `CRON_SECRET` を渡すか、サーバーに設定された値を環境変数 `E2E_CRON_SECRET` で受け取る）、N1、N2
   - E2E の後、DB の市場データと実行履歴は開始前と同じ状態（0件）に戻る
4. `e2e/db-privileges.spec.ts` が、追加した DB 関数を対象に含めて成功する。追加した関数は、service_role 以外（anon、authenticated、PUBLIC）には実行権限が無い。公開キーだけで `POST /rest/v1/rpc/<関数名>` を呼んでも実行できない。`ingestion_runs` と `stocks` に、authenticated のセッションから insert／update／delete できない。
5. どの画面を開いても、ブラウザのコンソールにエラーが出ない（dev と prod の両方）。「今すぐ取り込み」を押して結果が表示されるまでの間も同様。
6. アプリの本体（`src/`）に、銘柄のサンプル・ダミーデータが含まれない。J-Quants のフィクスチャはテストのファイル（`*.test.ts` とその fixtures）の中だけにあり、アプリのバンドルに含まれない。
7. `CLAUDE.md` に、Sprint 3 のアーキテクチャ（取り込み処理の場所、起動経路、二重実行の防止、応答の無くなった実行の扱い、環境変数、Cron、`/api/cron/` を proxy から外していること、`pnpm test:db`）が追記されている。`.env.example` に3つの環境変数が追記されている。
8. `sprint-03: 取り込み基盤と銘柄マスタ` でコミットされている。

## 8. 評価者への補足（キーの無い環境での合否判定）

- キーの無い環境では、C9-6〜8 を除くすべての完了条件を確認できる。C9-6〜8 は、キーがある場合だけ確認し、無い場合は「対象外（キーなし）」として合否に含めない。代わりに、C4（無効なキーで実 API に問い合わせる）、C9-1〜4（フィクスチャによる単体テスト、DB 込みの結合テスト、結果の文言のテスト）、C9-5（投入した行の表示）で、成功の経路を確かめる。
- ジェネレーターは J-Quants のキーを持っていない。実 API の成功時の応答は、公式ドキュメント（`https://jpx-jquants.com/ja/spec/eq-master`）の項目名と例に基づいてフィクスチャを作る。キーのある環境で項目名の違いが見つかった場合は、バグとして扱う。

## 9. 今回やらないこと（後続スプリント）

- 株価（初出日）、財務、有報の取り込み処理（Sprint 4、5、8）。`ingestion_runs.target` の値はすでにあるが、Sprint 3 の手動取り込みと Cron は `stock_master` だけを実行する。
- EDINET のキー未設定の失敗記録（AC8.1。Sprint 8）。Sprint 3 では EDINET の設定状態の表示だけ。
- 実行履歴の詳細画面、銘柄ごとの失敗の一覧、中断からの再開、呼び出し回数の制限への対応（待ってからの再試行）、データが古いときの全画面の警告、上場廃止の扱い（Sprint 11）。Sprint 3 の 429 は、再試行せずに失敗として記録する。
- 取引日カレンダーに基づく実行日の判定（毎日実行する。第4章）。
- 実行履歴のページ送り（Sprint 2 と同じく新しい 50 件）。
- Vercel へのデプロイそのもの（設定ファイルと手順の用意まで）。
- Sprint 2 の評価の「その他」の2点（設定画面のテーマのラジオで、Tab の直後の最初の矢印キーが選択を変えない件。375px の実行履歴のカードが縦に長い件）。どちらも受け入れ基準に関わらない表示・操作の粗なので、画面を触る後続スプリントでまとめて見直す。

## 10. 改訂履歴
- 初版: 契約作成
- 改訂1: contract-review.md を反映（条件の削除や緩和は無い）
  - 必須1: 保存の条件に商品区分 `ProdCat = '011'`（内国株券）を加え、`S33 ≠ 9999` は保険として残した（第2章の4）。`stocks.product_category` 列を追加（第6章）。C9-1 のフィクスチャに `ProdCat`・`Mrgn`・`MrgnNm` と、優先出資証券（012）、外国株券（021）、REIT（013）などの除外される行を加え、C9-7 に `product_category` の確認を加えた。`ProdCat` の欠けた行は形式の誤りとした
  - 必須2: `POST /api/ingestion/runs` にも `maxDuration = 300` を設定し、第2章の8の根拠を「両ルートとも 300 秒。15 分はこれより長い」に直した（第4章）
  - 必須3: C7-11 に、proxy の除外範囲を確かめる URL（`/api/cron`、`/api/cronx`、`/api/cron-daily`、`/api/cron/..%2Fingestion`、`/api/cron/%2e%2e/ingestion`、`/API/cron/daily`）を加えた
  - 任意1: 実行を終える処理は `running` の行だけを更新し、後片付け済みの行を上書きしない（第2章の8、第5章、C9-3）
  - 任意2: 結果の文言を組み立てる関数の Vitest を C9-4 に加えた（以降の C9 の番号を1つずつ繰り下げ、キーありの項目は C9-6〜8 になった）
  - 任意3: `pagination_key` が付かないという公式の記述を第2章の6の根拠にし、付いていたら形式の誤りとして失敗にする
  - 任意4: `details` に除外の理由ごとの内訳（`skippedByProduct`、`skippedByMarket`、`skippedBySector`）を加えた
  - 任意5: 16 文字未満の `CRON_SECRET` は未設定として扱い、警告のログを出す（第3章、C7-12）
