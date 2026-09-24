# Sprint 01 契約: F1 認証とアクセス制御

## 1. 対象機能

F1 認証とアクセス制御。Supabase Auth でログインし、全画面と全データ取得をログイン必須にする。許可されたメールアドレス以外は使えないようにする。

このスプリントでは、アプリの土台（Next.js プロジェクト、Supabase のローカル環境、DB マイグレーション、テスト基盤）もあわせて作る。

### 仕様書の受け入れ基準（引用）

- AC1.1 未ログインで任意のアプリ URL（`/`、スクリーニング画面、銘柄詳細画面など）にアクセスすると、ログイン画面にリダイレクトされる。
- AC1.2 許可されたメールアドレスと正しいパスワードでログインするとダッシュボードが表示され、リロードしてもログイン状態が保たれる。
- AC1.3 パスワードが間違っている場合は、日本語のエラーメッセージが表示され、ログインできない。
- AC1.4 許可リストにないメールアドレスではアカウントを作れず、ログインもできない（画面に拒否メッセージが表示される）。ログイン画面に誰でも使える新規登録の導線はない。
- AC1.5 ヘッダーのメニューからログアウトすると、ログイン画面に戻る。ブラウザの「戻る」で保護された画面に戻ってもデータは表示されない。
- AC1.6 未ログインのままアプリのデータ取得用エンドポイントを直接リクエストすると、401 または 403 が返り、銘柄データは含まれない。
- AC1.7 公開用のクライアントキーだけを使ってデータベースの市場データを読もうとしても、行は1件も返らない。
- AC1.8 全画面のフッターに、データ出典（J-Quants / EDINET）と「投資助言ではない」旨の注記が表示される。

## 2. 技術スタックとコマンド（Sprint 1 で確定）

| 項目 | 採用 |
|---|---|
| 言語 | TypeScript（strict） |
| フレームワーク | Next.js（App Router、実装時点の最新安定版）。サーバーコンポーネントとサーバーアクションを使う |
| UI | shadcn/ui ＋ Tailwind CSS。アイコンは lucide-react |
| 認証・DB | Supabase（Auth ＋ Postgres）。Next.js との連携は `@supabase/ssr`（Cookie ベースのセッション） |
| ローカル Supabase | Supabase CLI（`supabase` を devDependency として導入し `pnpm supabase ...` で実行。グローバルインストール不要）。Docker が必要 |
| パッケージマネージャ | pnpm |
| 単体テスト | Vitest |
| E2E テスト | Playwright（`@playwright/test`） |
| ホスティング | Vercel（本番デプロイは Sprint 1 の完了条件に含めない。必要な環境変数は README に記載） |

### コマンド（`package.json` の scripts）

| コマンド | 内容 |
|---|---|
| `pnpm install` | 依存関係のインストール |
| `pnpm db:start` | ローカル Supabase を起動（`supabase start`） |
| `pnpm db:stop` | ローカル Supabase を停止 |
| `pnpm db:reset` | DB を作り直し、全マイグレーションを適用（`supabase db reset`）。市場データは投入しない |
| `pnpm env:local` | `supabase status` の出力から `.env.local` を生成する（URL、公開キー、サービスロールキー） |
| `pnpm seed:users` | ローカル専用。評価用のユーザー（後述）を作成する。接続先の `NEXT_PUBLIC_SUPABASE_URL` のホストが `127.0.0.1` / `localhost` 以外なら実行を拒否し、何も作らずに 0 以外で終了する。冪等（再実行しても重複せず、パスワードは契約記載の値に戻す） |
| `pnpm auth:add-user --email <e> --password <p>` | 本番・ローカル共通。許可リストへの追加とユーザー作成を同時に行う運用コマンド（仕様は C10） |
| `pnpm dev` | 開発サーバー（http://localhost:3000） |
| `pnpm build` / `pnpm start` | 本番ビルドと起動（http://localhost:3000） |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest（単体テスト） |
| `pnpm test:e2e` | Playwright（ローカル Supabase と開発サーバーが起動している前提） |

環境変数の読み込み順: スクリプトは `.env.local` を読むが、シェルで渡した環境変数が優先される（例: `NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co pnpm seed:users` は `.env.local` の値を上書きする）。

実装後、`CLAUDE.md` にこのコマンドとアーキテクチャの概要を追記する。

## 3. 評価環境での起動手順

前提: Node.js 22、pnpm、Docker Desktop（この Mac には `/Applications/Docker.app` がある。未起動なら `open -a Docker` で起動し、`docker info` が成功するまで待つ）。

```bash
cd /Users/shuriokamoto/dev/quantis-light
pnpm install
pnpm db:start          # 初回は Docker イメージの取得に数分かかる
pnpm db:reset          # マイグレーション適用（クリーンな状態）
pnpm env:local         # .env.local を生成
pnpm seed:users        # 評価用ユーザーを作成
pnpm dev               # http://localhost:3000
```

### ローカル Supabase のエンドポイント（CLI の既定ポート）

| 用途 | URL |
|---|---|
| Supabase API（Auth / PostgREST） | http://127.0.0.1:54321 |
| Postgres | `postgresql://postgres:postgres@127.0.0.1:54322/postgres`（`psql` で接続可） |
| Studio | http://127.0.0.1:54323 |
| メール確認用（Mailpit） | http://127.0.0.1:54324 |

公開キー（`PUBLISHABLE_KEY`＝`sb_publishable_...`。従来形式の `ANON_KEY` も同じ権限）とサービスロール相当のキー（`SECRET_KEY`＝`sb_secret_...`）は `pnpm supabase status` で表示される。`.env.local` には `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`、`SUPABASE_SECRET_KEY` として書き込まれる。curl の例の `$ANON` には、どちらの公開キーを使ってもよい。

### 評価用ユーザー（`pnpm seed:users` が作成。ローカル専用）

| 役割 | メールアドレス | パスワード | 許可リスト |
|---|---|---|---|
| 許可ユーザー | `owner@quantis.local` | `Quantis-Owner-2026!` | 登録あり |
| 許可リスト外（アカウントは存在） | `intruder@quantis.local` | `Quantis-Intruder-2026!` | 登録なし |

- 「許可リスト外だがアカウントは存在する」ユーザーは、許可リストから外されたユーザーがログインできないことを確かめるために作る。
- このユーザー情報はアプリの画面やコードの既定値としては表示・同梱しない（スクリプトの中にだけある）。

## 4. 設計の要点（評価者が確認に使う範囲）

- **新規登録の無効化**: `supabase/config.toml` で次を設定する。ユーザーは管理用コマンド（サービスロールキーによる Admin API）でしか作れない。
  - `[auth] enable_signup = false`（パスワード登録と、OTP／マジックリンクによる自動作成の両方を止める。どちらも `signup_disabled` になることを実測済み）
  - `[auth.email] enable_signup` は `true` のままにする（この項目はメールプロバイダー自体の有効・無効で、`false` にするとメールとパスワードでのログインもできなくなることを実測で確認したため）
  - `[auth] enable_anonymous_sign_ins = false`
- **許可リスト**: `private.allowed_emails`（`email` 主キー、小文字で正規化。`check (email = lower(email))`）。`private` スキーマは PostgREST（REST API）に公開しない（`config.toml` の `[api] schemas` に含めない）。
- **認証サーバーでの拒否**: Supabase Auth の Custom Access Token Hook（Postgres 関数 `private.custom_access_token_hook`）で、許可リストにないメールアドレスへのトークン発行を拒否する。フックは実行のたびに許可リストを参照する（パスワードログイン時もトークン更新時も）。メールアドレスが null のユーザー（匿名ユーザーなど）も拒否する。拒否時はフックが `{"error":{"http_code":403,"message":"このメールアドレスは利用が許可されていません"}}` を返し、Auth API は 403 と、`access_token` を含まないエラー本文を返す。
- **許可リストの照会手段**:
  - ログイン前の照会（パスワード照合より前に行う）: サーバーアクションがサービスロールで `public.is_email_allowed(email text)` を呼ぶ。この関数の実行権限は `service_role` だけに与え、`PUBLIC`・`anon`・`authenticated` からは `revoke execute ... from public, anon, authenticated` で剥奪する（Postgres は関数の実行権限を既定で `PUBLIC` に与えるため。`private` スキーマの関数とフック関数も同様に `PUBLIC` から剥奪し、フックは `supabase_auth_admin` にだけ実行を許可する。公開キーで「許可リストに入っているか」を外部から判定できないようにする）。
  - ログイン後の照会: `public.current_user_is_allowed()`（引数なし。呼び出したユーザー自身の JWT のメールアドレスだけを判定する）。実行権限は `authenticated` のみ。RLS ポリシーも同じ判定を使う。
- **アプリでの拒否**: ログインのサーバーアクションは、入力されたメールアドレスを前後の空白除去と小文字化で正規化し、パスワード照合の前に許可リストを確認する。許可リスト外なら拒否メッセージを返す。
- **画面と API の保護（二重化）**: middleware だけに頼らない。
  - 保護画面の共通レイアウト（サーバーコンポーネント）が、毎リクエスト、サーバー側でセッションを検証する（`getUser` 相当。Cookie の値を鵜呑みにしない）。さらに `current_user_is_allowed()` で許可リストを確認する。未ログインなら `/login?next=...` に、ログイン中に許可リストから外されていたら、`/auth/signout?reason=revoked` にリダイレクトする。トークンの有効期限切れを待たない。
  - サーバーコンポーネントは Cookie を書き換えられないため、セッションの破棄は Route Handler `/auth/signout` で行う。このハンドラーは `signOut()` を呼んだうえでセッション Cookie（`sb-...-auth-token` とその分割 Cookie）を削除し、`/login?reason=revoked` にリダイレクトする（ログイン画面に「このアカウントの利用許可が取り消されました」と表示）。`reason` は `revoked` 以外の値を無視する。ヘッダーの「ログアウト」も同じ仕組みでセッションを破棄する（ログアウトは POST。GET の `/auth/signout` は取り消し時のリダイレクト専用で、どちらも Cookie を削除する）。
  - `/login` ページで「ログイン済みなら `/` へリダイレクト」するのは、セッションが有効で、かつ許可リストに入っているユーザーだけ。セッションはあるが許可リスト外のユーザーが `/login` を開いた場合は、`/auth/signout?reason=revoked` に送ってセッションを破棄する。ただし `/login?reason=revoked` は、セッションの状態にかかわらず常にログインフォームをそのまま表示し、どこにもリダイレクトしない。これにより、Cookie が残る場合（curl で同じ Cookie を送り続けるなど）でも、`/`・`/login`・`/auth/signout` の間でリダイレクトがループしない。
  - `/api/*` のルートハンドラーも、それぞれ自身でセッションと許可リストを検証する。未ログインなら 401、ログイン中だが許可リスト外なら 403 を返す。共通のヘルパー（例 `requireAllowedUser()`）にまとめる。
  - Auth サーバーに到達できないなど、セッションを検証できない場合は未ログインとして扱う（fail closed）。
- **ルーティング（middleware）**: Next.js の middleware（または Next.js のバージョンに応じた同等の proxy）で、`/login` と静的アセット以外のすべてのパスを保護する。静的アセットの除外は、拡張子のパターンではなく明示的なパス（`/_next/static`、`/_next/image`、`/favicon.ico` など）で指定する。そのため `/stocks/72030.png` や `/api/stocks.json` のようなパスも保護対象になる。
  - 画面: 未ログインなら `/login?next=<元のパス>` へリダイレクト。
  - `/api/*`: 未ログインなら `401` と `{"error":"unauthorized"}` の JSON を返す（リダイレクトしない、データを含めない）。
- **`next` パラメーターの検証（オープンリダイレクト対策）**: 純粋関数 `sanitizeNextPath(raw)` で次をすべて満たす場合だけ採用し、それ以外は `/` にする。
  1. 文字列であり、制御文字（`\u0000`〜`\u001F`、`\u007F`。タブと改行を含む）を含まない
  2. `/` で始まり、2文字目が `/` でも `\` でもない。`\` はどこにあっても不可
  3. `new URL(raw, 'http://app.invalid')` でパースした結果の origin が `http://app.invalid` のまま
  4. 採用する値は、パース結果の `pathname + search + hash`
  - `next` は URLSearchParams でデコード済みの値に対して検証する。例: `?next=%2F%5Cexample.com` はデコード後の `/\example.com` として拒否され、`?next=/%09/example.com` はデコード後にタブを含むので拒否される。検証はリダイレクト先を決めるすべての場所（ログインのサーバーアクション、middleware が付ける `next`）で同じ関数を使う。
- **キャッシュとログアウト**: 保護された画面と `/api/*` の応答には `Cache-Control: no-store` を付ける（本番の `pnpm start` では画面の応答も `no-store`。開発サーバーの `pnpm dev` は、Next.js 16 の仕様で画面の応答に `no-cache, must-revalidate` を強制し、戻る／進むで HTTP キャッシュから復元できるようにしている。そのため、すべての画面に、ハイドレーション前に実行されるスクリプトを入れる。このスクリプトは、戻る／進むでキャッシュや bfcache から表示されたことを検出すると、画面を隠してサーバーに問い合わせ直す。未ログインなら、問い合わせの結果ログイン画面にリダイレクトされる）。ログアウトはサーバー側でセッションを破棄した後、クライアントのルーターキャッシュが残らないように、フルリロードで `/login` に遷移する（`window.location.replace('/login')`）。
- **異常系のメッセージ**（ログイン画面）: どのケースでも Next.js のエラー画面、英語の生エラー、未処理の例外にしない。
  | ケース | 表示するメッセージ |
  |---|---|
  | パスワード誤り、またはアカウントが無い許可メール | メールアドレスまたはパスワードが正しくありません |
  | 許可リスト外 | このメールアドレスは利用が許可されていません |
  | Auth の回数制限（HTTP 429） | ログインの試行回数が上限に達しました。しばらくしてから再度お試しください |
  | Auth／DB に到達できない | 認証サーバーに接続できません。しばらくしてから再度お試しください |
  | ログイン中に許可が取り消された（`?reason=revoked`） | このアカウントの利用許可が取り消されました |
  | 上記以外の想定外のエラー | ログインに失敗しました。しばらくしてから再度お試しください（詳細はサーバーのログにだけ出す） |
- **回数制限（ローカル用）**: `supabase/config.toml` の `[auth.rate_limit] sign_in_sign_ups` を 5 分あたり 300 回に上げる。理由: 評価での手動ログインと `pnpm test:e2e` を合わせると、既定の上限（30 回）に届き、評価が不安定になるため。本番（Supabase のホスト環境）の上限は既定値のままとする。429 の表示は、アプリ側の単体テストで Auth クライアントの 429 応答を模擬して確認する（C3-6）。
- **市場データのテーブル（RLS の土台）**: `public.stocks`（銘柄マスタ）をこのスプリントで作成する。列は Sprint 3 で追加する可能性があるが、以下は確定。
  - `code text primary key`（J-Quants の銘柄コード、例 `'72030'`）
  - `company_name text not null`
  - `market_name text`（例 `'プライム'`）
  - `sector33_name text`（例 `'輸送用機器'`）
  - `updated_at timestamptz not null default now()`
  - RLS 有効。`anon` ロールには権限もポリシーも与えない（`revoke all`）。`authenticated` ロールには「許可リストに含まれるメールアドレスのユーザーだけ `select` できる」ポリシーを付ける。書き込みはサービスロール（取り込み処理）だけ。
  - 以後のスプリントで追加する市場データのテーブルも、同じ方針（anon 不可、許可ユーザーのみ select）に従う。
- **データ取得用エンドポイント**: `GET /api/stocks` を作成する。ログイン中のユーザーのセッションで `public.stocks` を読み（サービスロールは使わない＝RLS が効く経路）、`{"data":[...]}` を返す。F3 以降の取り込み・F6 の検索はこのテーブルと同じ読み出し経路を使う。Sprint 1 では件数上限つき（先頭100件、コード順）の一覧だけでよい。
- **サービスロールキー**: サーバー専用モジュール（`server-only`）からしか参照しない。クライアントのバンドルに含めない。
- **ダッシュボード（`/`）**: Sprint 1 では、ログイン中であることがわかる最小限の画面（見出し「ダッシュボード」、ログイン中のメールアドレス）にする。件数や鮮度の表示は F2（Sprint 2）で作る。ダミーの数値は表示しない。
- **デザイン**: 落ち着いた金融ツールの基調（中立的なグレーのベースに控えめなアクセントカラー 1 色、日本語向けのフォント、数値は等幅数字）。配色は CSS 変数でライト／ダーク両方を定義し、OS の設定に従う（手動の切り替えは Sprint 2）。ログイン画面は製品名「Quantis Light」と、自分専用のスクリーナーであることが伝わる短い説明を持つ。

## 5. テスト可能な完了条件

各項目の「確認手順」は、エバリュエーターが Playwright MCP・curl・psql で実行する手順です。前提として、第3章の手順で起動済み、評価用ユーザー作成済みとします。

### C1. 未ログイン時のリダイレクト（AC1.1）
1. 新しいブラウザコンテキスト（Cookie なし）で `http://localhost:3000/` を開く → URL が `/login`（`?next=%2F` 付きでもよい）になり、ログインフォームが表示される。
2. 同様に `/screening`、`/stocks/72030`、`/imports`、`/settings`、存在しない任意のパス `/foo/bar` を開く → いずれも `/login?next=<元のパス>` にリダイレクトされる。保護画面の内容は一瞬も表示されない（サーバー側リダイレクト。`curl -sI http://localhost:3000/screening` が `307` または `302` で `location: /login?next=%2Fscreening` を返す）。
3. これらの画面自体（スクリーニング、銘柄詳細など）は後続スプリントで作るため、ログイン後に開くと 404 画面（日本語、アプリのレイアウト内）になってよい。
4. middleware 回避の手口に対する確認: `curl -sI http://localhost:3000/ -H 'x-middleware-subrequest: middleware:middleware:middleware:middleware:middleware'` を実行すると、ヘッダーなしの場合と同じく `/login` へのリダイレクトになる。`src/middleware:src/middleware:...` のようにパスを変えた値でも同じ。
5. 拡張子付きのパスも保護されている: 未ログインで `curl -sI http://localhost:3000/stocks/72030.png` を実行すると `/login` へのリダイレクトになる。`curl -si http://localhost:3000/api/stocks.json` は `401` になる。どちらも保護画面の内容や銘柄データを返さない。
6. 保護の二重化: middleware が無くても、保護画面の共通レイアウトと `/api/stocks` のルートハンドラーが、それぞれ自身で未ログインを拒否する。Vitest の単体テストで、セッションが無い状態でルートハンドラーの `GET` を直接呼ぶと 401、許可リスト外のユーザーでは 403 を返すことを確認する（Supabase クライアントを差し替えて検証）。

### C2. 許可ユーザーのログインと状態保持（AC1.2）
1. `/login` で `owner@quantis.local` / `Quantis-Owner-2026!` を入力し「ログイン」を押す → `/`（ダッシュボード）に遷移し、見出し「ダッシュボード」とヘッダーにログイン中のメールアドレス（またはアカウントメニュー）が表示される。
2. ページをリロードする → ログイン状態のまま、ダッシュボードが表示される。
3. ブラウザのタブを閉じて同じコンテキストで `http://localhost:3000/` を開き直す → ログイン状態が保たれている。
4. 未ログインで `/stocks/72030` を開いてリダイレクトされた後にログインすると、`next` のパス（`/stocks/72030`）に遷移する（その画面は 404 でよい）。クエリ付きのパス（`/login?next=%2Ffoo%3Fa%3D1`）では `/foo?a=1` に遷移する。
   - 次の URL をそのままブラウザで開き、許可ユーザーでログインすると、いずれも `/`（`http://localhost:3000/`）に遷移する。合否基準は、どの値でも遷移先のオリジンが `http://localhost:3000` のままで、パスが `/` であること。
     | 開く URL | デコード後の `next` | 拒否理由 |
     |---|---|---|
     | `/login?next=https%3A%2F%2Fexample.com` | `https://example.com` | `/` で始まらない |
     | `/login?next=%2F%2Fexample.com` | `//example.com` | 2文字目が `/` |
     | `/login?next=%2F%5Cexample.com` | `/\example.com` | 2文字目が `\` |
     | `/login?next=%252F%255Cexample.com` | `%2F%5Cexample.com` | `/` で始まらない（二重エンコード） |
     | `/login?next=/%09/example.com` | `/<タブ>/example.com` | 制御文字を含む |
     | `/login?next=%2F%0A%2Fexample.com` | `/<改行>/example.com` | 制御文字を含む |
     | `/login?next=https%3Aexample.com` | `https:example.com` | `/` で始まらない |
     | `/login?next=javascript%3Aalert(1)` | `javascript:alert(1)` | `/` で始まらない |
5. メールアドレスの大文字小文字は区別しない: `OWNER@Quantis.Local`（前後に空白があってもよい）と正しいパスワードでログインできる。
6. 許可リストに入っているユーザーでログイン済みの状態で `/login` を開くと `/` にリダイレクトされる（許可リスト外のセッションの扱いは C6-7）。
7. ログイン操作とダッシュボード表示の間、ブラウザのコンソールにエラーが出ない。

### C3. パスワード誤り（AC1.3）
1. `owner@quantis.local` と誤ったパスワード（例 `wrong-password`）でログインを押す → フォーム上に日本語のエラー「メールアドレスまたはパスワードが正しくありません」が表示され、`/login` のまま。
2. その後 `/` を開く → `/login` にリダイレクトされる（ログインしていない）。
3. 空欄のまま送信する、メール形式でない値を入れる → 日本語の入力エラーが表示され、送信されない（またはサーバー側でも同じエラーを返す）。
4. 送信中はボタンが無効化され、二重送信されない。
5. Auth に到達できない場合: ログイン画面を開いた状態で `pnpm db:stop` を実行し、許可ユーザーの正しい資格情報でログインを押す。「認証サーバーに接続できません。しばらくしてから再度お試しください」がフォーム上に表示され、Next.js のエラー画面や英語の生エラーにならない。ブラウザのコンソールに未処理の例外が出ない。この状態で `/` を開くと、`/login` へのリダイレクトになる（fail closed）。確認後は `pnpm db:start` で復旧する（`supabase stop` はデータを保持するので、再シードは不要。もし消えていれば `pnpm seed:users`）。
6. 回数制限（429）: 実際に上限まで試行するのは評価では必須にしない。代わりに、Vitest の単体テストで、Auth クライアントが 429（`over_request_rate_limit` など）を返したときに、ログイン処理が「ログインの試行回数が上限に達しました。しばらくしてから再度お試しください」を返すことを確認する。ローカルの上限値は、`supabase/config.toml` の `[auth.rate_limit] sign_in_sign_ups = 300` で確認できる。

### C4. 許可リスト外の拒否と新規登録の不在（AC1.4）
1. ログイン画面に「新規登録」「アカウント作成」「サインアップ」などの導線（リンク・ボタン・タブ）が無い。`/signup`、`/register` を開いても登録フォームは無い（未ログインなので `/login` にリダイレクトされる）。
2. アカウントが存在しない許可リスト外のアドレス（例 `stranger@example.com`、任意のパスワード）でログインを押す → 「このメールアドレスは利用が許可されていません」と表示され、ログインできない。
3. アカウントは存在するが許可リストにない `intruder@quantis.local` / `Quantis-Intruder-2026!`（正しいパスワード）でログインを押す → 同じ拒否メッセージが表示され、ログインできない。その後 `/` を開くと `/login` にリダイレクトされる。
4. アプリを経由せず Supabase Auth API を公開キーで直接呼んでも登録・ログインできない:
   ```bash
   ANON=<pnpm supabase status で表示される公開キー>
   # 新規登録 → エラー（例: "Signups not allowed for this instance"）。ユーザーは作られない
   curl -s -X POST 'http://127.0.0.1:54321/auth/v1/signup' \
     -H "apikey: $ANON" -H 'Content-Type: application/json' \
     -d '{"email":"stranger@example.com","password":"Stranger-Pass-2026!"}'
   # 許可リスト外ユーザーのパスワードログイン → エラー。access_token を含まない
   curl -s -X POST 'http://127.0.0.1:54321/auth/v1/token?grant_type=password' \
     -H "apikey: $ANON" -H 'Content-Type: application/json' \
     -d '{"email":"intruder@quantis.local","password":"Quantis-Intruder-2026!"}'
   ```
   - 新規登録の期待結果: HTTP 4xx（422 など）。本文にエラー（例 `"error_code":"signup_disabled"`）があり、ユーザーは作られない。
   - 許可リスト外ユーザーのログインの期待結果（ローカルで実測済み）: HTTP 403、本文 `{"code":403,"error_code":"unknown","msg":"このメールアドレスは利用が許可されていません"}`。`access_token` を含まない（必須）。`error_code` の値は Auth サーバーのバージョンで変わりうるため、合否はステータス 403 と `access_token` が無いことで判定する。
5. 匿名サインインの無効化: 次を実行するとエラー（例 `"error_code":"anonymous_provider_disabled"`）になる。`select count(*) from auth.users where is_anonymous;` は 0 のまま。
   ```bash
   curl -s -X POST 'http://127.0.0.1:54321/auth/v1/signup' \
     -H "apikey: $ANON" -H 'Content-Type: application/json' -d '{}'
   ```
6. OTP（マジックリンク）経由でも作れない: `POST /auth/v1/otp` に `{"email":"stranger@example.com"}` を送るとエラー（例 `"error_code":"otp_disabled"` または `signup_disabled`）になり、ユーザーは作られない。Mailpit（http://127.0.0.1:54324）にもメールは届かない。
   ```bash
   curl -s -X POST 'http://127.0.0.1:54321/auth/v1/otp' \
     -H "apikey: $ANON" -H 'Content-Type: application/json' \
     -d '{"email":"stranger@example.com"}'
   ```
7. DB で確認: `select email from auth.users;` に `stranger@example.com` が存在しない。

### C5. ログアウト（AC1.5）
1. ログイン後、ヘッダー右上のアカウントメニューを開き「ログアウト」を押す → `/login` に遷移する。
2. ブラウザの「戻る」を押す → ダッシュボードの内容（メールアドレスなど）は表示されず、`/login` にリダイレクトされる（またはログイン画面が表示されたまま）。
   - ルーターキャッシュの確認: ログイン後、アプリ内のリンク（ヘッダーの製品名など）でソフトナビゲーションを行い、`/` → 404 画面 → `/` のように数回遷移してからログアウトする。その後「戻る」を2回押しても、保護画面の内容は表示されない。
3. ログアウト後に `/` や `/api/stocks` をブラウザで開く → それぞれ `/login` へのリダイレクト、`401` になる。
4. ログアウト後、ブラウザの Cookie に Supabase のセッション Cookie（`sb-...-auth-token`）が残っていない。

### C6. データ取得エンドポイントの保護（AC1.6）
1. 事前に DB へ検証用の銘柄を1件投入する（第6章の SQL）。
2. `curl -si http://localhost:3000/api/stocks` → ステータス `401`、本文は `{"error":"unauthorized"}` のみで、投入した銘柄のコードや社名を含まない。
3. 公開キーを付けても同じ: `curl -si http://localhost:3000/api/stocks -H "apikey: $ANON" -H "Authorization: Bearer $ANON"` → `401`。
4. でたらめな Cookie（`Cookie: sb-127-auth-token=garbage`）を付けても `401`。
5. `/api/` 配下の存在しないパス（例 `/api/foo`）も未ログインなら `401`（404 で存在を漏らさない）。
6. ブラウザで許可ユーザーとしてログインした状態で `/api/stocks` を開く → `200` で、投入した銘柄が `{"data":[{...}]}` の形で返る（同じテーブルが RLS 経由で正しく読めることの確認）。
7. ログイン中に許可を取り消した場合（AC1.6 のコンプライアンス要件「許可されたユーザーにしか返さない」の確認）:
   1. owner でログインし、`/api/stocks` で検証用銘柄が返ることを確認する。
   2. psql で `delete from private.allowed_emails where email = 'owner@quantis.local';` を実行する。
   3. 同じブラウザで直後に `/api/stocks` を開く → `403`（本文 `{"error":"forbidden"}`）で、検証用銘柄を含まない。
   4. 同じブラウザで `/` を開く → サインアウトされて `/login?reason=revoked` に遷移し、「このアカウントの利用許可が取り消されました」と表示される。トークンの有効期限切れを待たずに、直後から拒否される。遷移の後、ブラウザの Cookie に `sb-...-auth-token`（分割された `.0` `.1` なども含む）が残っていない。
   4-b. リダイレクトがループしないことの確認: 手順 2 の前に、ブラウザの `sb-...-auth-token` Cookie を（分割されていればすべて）控えておく。取り消し後に、その Cookie を付けて `curl -sIL --max-redirs 5 -H 'Cookie: <控えた Cookie>' http://localhost:3000/` を実行すると、ループせずに `/login?reason=revoked` の `200` で止まる（`Maximum redirects` のエラーにならない）。同じ Cookie で `http://localhost:3000/login` から始めても、ループせずに `200` で止まる。セッションがまだ破棄されていなければ `/auth/signout?reason=revoked` を経由して `/login?reason=revoked` の `200` で止まる。上の `/` からの確認で既にセッションが破棄済みなら、Auth サーバー側でセッションが無効になっているため、未ログインとして `/login` の `200` がそのまま返る。
   5. 後片付け: `insert into private.allowed_emails (email) values ('owner@quantis.local');`（または `pnpm seed:users`）で元に戻す。

### C7. 公開キーだけでは市場データを読めない（AC1.7）
1. 第6章の SQL で `public.stocks` に1件投入した状態で:
   ```bash
   curl -s 'http://127.0.0.1:54321/rest/v1/stocks?select=*' \
     -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
   ```
   → 行が1件も返らない（`[]`、または権限エラー `permission denied`）。
2. 許可リストのテーブルも読めない:
   - `curl -s 'http://127.0.0.1:54321/rest/v1/allowed_emails' -H "apikey: $ANON"` → エラー（public に存在しない。例 `PGRST205`）
   - `curl -s 'http://127.0.0.1:54321/rest/v1/allowed_emails' -H "apikey: $ANON" -H 'Accept-Profile: private'` → スキーマ拒否のエラー（例 `PGRST106` "The schema must be one of the following: ..."）
3. 許可リストの照会関数を公開キーで呼べない:
   ```bash
   curl -s -X POST 'http://127.0.0.1:54321/rest/v1/rpc/is_email_allowed' \
     -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H 'Content-Type: application/json' \
     -d '{"email":"owner@quantis.local"}'
   ```
   → 権限エラー（例 `42501` permission denied）。`true` / `false` を返さない。`current_user_is_allowed` も、公開キーだけで呼ぶと権限エラーになる。
4. GraphQL 経由でも読めない: `curl -s -X POST 'http://127.0.0.1:54321/graphql/v1' -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H 'Content-Type: application/json' -d '{"query":"{ stocksCollection { edges { node { code } } } }"}'` → エラー、または `edges` が空。検証用銘柄のコードを含まない。
5. DB で確認: `select relname, relrowsecurity from pg_class where relname = 'stocks';` が `true`。`select * from pg_policies where tablename = 'stocks';` に anon 向けのポリシーが無い。`select has_function_privilege('anon', 'public.is_email_allowed(text)', 'execute');` と `select has_function_privilege('authenticated', 'public.is_email_allowed(text)', 'execute');` がどちらも `false`。
6. （参考）許可ユーザーのアクセストークンを付けた同じ REST 呼び出しでは行が返る。許可リストから外れたユーザーはトークンを得られない（C4-4）。

### C8. フッターの出典と注記（AC1.8）
1. ログイン画面、ダッシュボード、ログイン後の 404 画面のすべてで、フッターに次の2つが表示される。
   - データ出典: 「データ出典: J-Quants API（日本取引所グループ）／EDINET（金融庁）」
   - 注記: 「本アプリは情報提供を目的とした個人用ツールであり、投資助言ではありません。」
2. 横幅 375px でも、フッターの文言は折り返して全文が読め、横スクロールが発生しない。

### C9. 品質・非機能
1. `pnpm build`、`pnpm lint`、`pnpm typecheck`、`pnpm test` がすべてエラーなく終わる。
2. `pnpm test:e2e` に C1〜C6、C8 の主要な流れ（リダイレクト、許可ユーザーのログイン、パスワード誤り、許可リスト外の拒否、ログアウト、API の 401、フッター表示）と、ダークモード（Playwright の `colorScheme: 'dark'`）でログイン画面の背景がダーク配色になることのアサーションを含み、通る。
3. Vitest の単体テストがある。少なくとも次を含む。
   - `sanitizeNextPath`: 正常系（`/`、`/stocks/72030`、`/foo?a=1`）と、C2-4 の不正な値の全ケース（`https://example.com`、`//example.com`、`/\example.com`、`/\example.com`、`%2F%5Cexample.com`（二重エンコードのデコード後）、タブや改行を含む値、`https:example.com`、`javascript:alert(1)`、空文字、null）
   - ログイン処理のエラー変換（パスワード誤り、許可リスト外、429、接続不可、想定外のエラー）
   - `/api/stocks` のルートハンドラー（C1-6）
4. `pnpm build` 後、`.next/static` 配下にサービスロールキーの値が含まれない（`.env.local` の `SUPABASE_SECRET_KEY` の値で `grep -r "$SUPABASE_SECRET_KEY" .next/static` が0件。Supabase CLI 2.x の新形式キー `sb_secret_...` がサービスロール相当）。
5. ログイン画面は横幅 375px と 1280px の両方で崩れない。ダークモードは、Playwright のカラースキームのエミュレーション（`colorScheme: 'dark'`、MCP ではブラウザの `prefers-color-scheme` のエミュレーション）で確認する。ダーク配色で表示され、文字とボタンが判読できる。
6. アプリにサンプル銘柄やダミーデータを同梱しない（`pnpm db:reset` 直後の `select count(*) from public.stocks;` は 0）。`pnpm test:e2e` が検証用の行を `public.stocks` に投入する場合は、コード `99990` 番台だけを使い、テストの終了時（失敗時も）に削除する。E2E の実行後も `count(*)` は実行前と同じ。E2E が許可リストやユーザーを変更する場合も、終了時に元に戻す。
7. `.env.local` は git 管理外（`.gitignore` に含まれる）で、`.env.example` に必要な変数名だけが書かれている。
8. `CLAUDE.md` にコマンドとアーキテクチャの概要が追記されている。
9. 作業がコミット `sprint-01: 認証とアクセス制御` として記録されている。

### C10. 運用コマンド（`auth:add-user` と `seed:users`）
1. `pnpm auth:add-user --email New.User@Quantis.local --password 'New-User-Pass-2026!'` を実行すると 0 で終了する。`private.allowed_emails` に小文字の `new.user@quantis.local` が1行入り、`auth.users` にユーザーが作られる。そのユーザーで画面からログインできる。
2. 同じコマンドをもう一度実行しても 0 で終了し、`allowed_emails` と `auth.users` に重複行はできない（冪等）。既存のアカウントに対しては、パスワードを変更しない（「既存のユーザーです。パスワードは変更していません」と表示する）。パスワードを変更したい場合は `--reset-password` を付けると、指定したパスワードに更新する。
3. アカウントがあって許可リストに入っていない `intruder@quantis.local` に `pnpm auth:add-user --email intruder@quantis.local --password 'Quantis-Intruder-2026!'` を実行すると、許可リストに追加され、画面からログインできるようになる（フックが許可リストを実行時に参照していることの確認）。確認後に `delete from private.allowed_emails where email = 'intruder@quantis.local';` を実行すると、再びログインが拒否される（C4-3 のメッセージ）。
4. 引数が欠けている（`--email` のみ、`--password` のみ、どちらも無し）、メール形式が不正（`not-an-email`）、パスワードが短い（8文字未満）ときは、使い方と理由を日本語で表示し、0 以外で終了する。DB は変わらない。
5. `NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co pnpm seed:users` を実行すると、「ローカル以外の Supabase には評価用ユーザーを作成できません」と表示して 0 以外で終了し、何も作らない（ネットワーク接続も試みない）。
6. `pnpm seed:users` を2回続けて実行しても 0 で終了し、第3章の2ユーザーがそれぞれ1件だけ存在する。owner は許可リストに入り、intruder は許可リストに入っていない状態に戻る。
7. 後片付け: `new.user@quantis.local` は Studio または `pnpm db:reset` → `pnpm seed:users` で消してよい。

## 6. 評価用データの投入方法

このスプリントで保存形式が確定しているのは `public.stocks` だけです。エバリュエーターは次の SQL で直接投入できます（サービスロール相当の `postgres` ユーザーで実行）。

```bash
psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' -c "
insert into public.stocks (code, company_name, market_name, sector33_name)
values ('99990', '検証用銘柄株式会社', 'グロース', '情報・通信業')
on conflict (code) do nothing;"
```

削除: `delete from public.stocks where code = '99990';`

許可リストの確認・変更（運用上の手段。画面での管理は作らない）:

```bash
psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' -c "select * from private.allowed_emails;"
```

`pnpm db:reset` を実行すると評価用ユーザーも消えるため、その後は `pnpm seed:users` を再実行してください。

## 7. 今回やらないこと（後続スプリント）

- ナビゲーション、テーマの手動切り替え、ダッシュボードの件数・鮮度表示、モバイル用ハンバーガーメニュー（Sprint 2 / F2）。Sprint 1 のヘッダーは製品名とアカウントメニュー（メールアドレス、ログアウト）のみ。
- 取り込み処理、Cron エンドポイントとそのシークレット認証、取り込み状況画面、`public.stocks` の残りの列（Sprint 3 / F3）。Sprint 1 では middleware で `/api/cron/*` を特別扱いしない（すべて 401）。
- スクリーニング画面、銘柄詳細画面（Sprint 6, 7）。
- パスワードリセット、メール確認、多要素認証、許可リストの画面管理。ユーザー追加は `pnpm auth:add-user` による運用で行う。
- Vercel への本番デプロイの実施（設定ファイルと環境変数の説明は用意するが、完了条件には含めない）。

## 8. 改訂履歴
- 初版: 契約作成
- 改訂1: contract-review.md の修正依頼を反映
  - R1: `next` の検証規則を強化（`\`・制御文字の拒否、URL パースで origin を確認）。C2-4 と単体テストに不正な値のケースを追加
  - R2: 運用コマンドの完了条件 C10 を追加（冪等性、パスワードの扱い、フックが許可リストを実行時に参照すること、引数エラー、ローカル以外の URL の拒否）
  - R3: 異常系のメッセージ表を追加。Auth 停止の確認手順（C3-5）、429 の単体テスト（C3-6）、ローカルの回数制限値とその理由を追加
  - R4: ログイン中に許可を取り消した場合の振る舞い（API は 403、画面はサインアウトして `/login?reason=revoked`）と確認手順（C6-7）を追加
  - R5: 匿名サインインと OTP の無効化（C4-5・C4-6）、private スキーマの拒否、照会 RPC の権限、GraphQL（C7-2〜C7-5）を追加
  - R6: middleware 回避の確認、拡張子付きパスの保護、ルートハンドラーとレイアウトの自前検証（C1-4〜C1-6）を追加
  - 推奨: メールアドレスの大文字小文字の正規化（C2-5）、ログアウト時のフルリロードとルーターキャッシュの確認（C5-2）、ダークモードを Playwright のエミュレーションで確認、E2E の後片付け、C4-4 の期待レスポンスを採用
- 改訂2: 再レビュー（contract-review.md「再レビュー（契約 改訂1）」）と実装時の実測を反映
  - N1: セッションの破棄を Route Handler `/auth/signout` で行うことにした。`/login` で `/` へリダイレクトするのは、許可リストに入っているユーザーだけにした。`/login?reason=revoked` は常にフォームを表示し、リダイレクトしない。C6-7 に Cookie の消去と、`curl -sIL --max-redirs 5` でループしないことの確認（4-b）を追加
  - N2: 第2章のコマンド表を修復し、環境変数の読み込み順の段落を表の後ろに移動
  - N3: C2-4 を、実際に開く URL とデコード後の値の表に書き換えた。合否は「遷移先のオリジンが `http://localhost:3000` のままで、パスが `/`」
  - 注意事項: `is_email_allowed` などの関数の実行権限を `PUBLIC` からも剥奪することを明記。C10 のパスワードをシングルクォートで囲んだ。C4-4 の期待レスポンスを実測値（403、`error_code: unknown`）に合わせた
  - 実装時の実測による修正: `[auth.email] enable_signup` は `true` のままにする（`false` にするとメールでのログインが無効になる）。環境変数名を Supabase CLI 2.x の新形式キー（`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`、`SUPABASE_SECRET_KEY`）に合わせた。開発サーバーのキャッシュの挙動に対応するため、戻る／進むのガードを第4章に追記
