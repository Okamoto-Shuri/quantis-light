# Sprint 01 自己評価（ラウンド 1）

## 実装内容

### 土台
- Next.js 16.3（App Router、Turbopack）、TypeScript strict、shadcn/ui（radix）＋ Tailwind v4、pnpm
- Supabase CLI を devDependency として導入（`supabase/config.toml`、`supabase/migrations/20260924000000_auth_allowlist_and_stocks.sql`）
- テスト: Vitest（`src/**/*.test.ts`、46 件）、Playwright（`e2e/auth.spec.ts`、28 件）
- 運用スクリプト:
  - `scripts/env-local.mjs`（`pnpm env:local`）
  - `scripts/seed-users.ts`（`pnpm seed:users`）
  - `scripts/add-user.ts`（`pnpm auth:add-user`）
- ドキュメント: `CLAUDE.md` にコマンドとアーキテクチャを追記。`README.md`、`.env.example` を追加

### 認証とアクセス制御（多層）
1. **Supabase Auth**
   - `[auth] enable_signup = false` と `enable_anonymous_sign_ins = false` で、新規登録と匿名サインインを止めた。
   - Custom Access Token Hook `private.custom_access_token_hook` が、許可リスト `private.allowed_emails` にないユーザーへのトークン発行を 403 で拒否する。メールが null のユーザーと匿名ユーザーも拒否する。フックはトークン更新時にも実行される。
2. **`src/proxy.ts`**（Next 16 で middleware から改名されたもの）
   - セッションの更新と、楽観的なチェックを行う。未ログインの場合、画面は `/login?next=` に、`/api/*` は 401 にする。
   - matcher は `_next/static/`、`_next/image`、`favicon.ico` だけを明示的に除外している。拡張子による除外はしていない。
3. **保護画面**: `src/app/(app)/layout.tsx` から `requireAllowedUser()` を呼ぶ。
   - 毎リクエスト、`getUser` と `current_user_is_allowed()` で検証する。
   - 許可が取り消されていたら `/auth/signout?reason=revoked` にリダイレクトする。この Route Handler が `signOut` と Cookie の削除を行い、`/login?reason=revoked` に 303 で送る。
   - `/login?reason=revoked` は常にフォームを表示し、どこにもリダイレクトしない。これでリダイレクトのループを防ぐ。
4. **API**
   - `GET /api/stocks` は、ユーザー自身のセッションで RLS を通して読む。
   - `/api/[...path]` は存在しないパスの受け皿。未ログインには、パスの存在を漏らさず 401 を返す。
   - どちらも先頭で `requireApiUser()` を呼び、401／403 を返す。
5. **DB**
   - `public.stocks` は RLS を有効にし、anon の権限をすべて剥奪した。`authenticated` のうち、許可リストに入っているユーザーだけが select できる。
   - 関数の実行権限は `PUBLIC`・`anon`・`authenticated` から剥奪した。`is_email_allowed` と `admin_*` を実行できるのは service_role だけ。
6. **ログイン処理**（`src/lib/auth/login.ts`。依存を注入してテストできる形にした）
   - メールアドレスを正規化し、パスワード照合の前に許可リストを確認する。
   - Auth のエラーを日本語のメッセージに変換する。対象はパスワード誤り、許可リスト外、429、接続不可、想定外のエラー。
7. **`next` の検証**: `sanitizeNextPath` で行う。制御文字、`\`、2文字目の `/` を拒否し、`new URL` でパースして origin が変わらないことを確かめる。
8. **ログアウト**
   - POST `/auth/signout` の後、`window.location.replace('/login')` でフルリロードする。
   - あわせて、ハイドレーション前に実行されるスクリプト `src/lib/http/history-cache-guard.ts` を入れた。戻る／進むで HTTP キャッシュや bfcache から画面が表示されたら、画面を隠して再読み込みする。
   - このスクリプトが要る理由: Next 16 の開発サーバーは画面の応答に `no-cache, must-revalidate` を強制する（`next/dist/server/base-server.js` にコメント付きで実装されている）。そのため `no-store` だけでは、戻る操作でログアウト前の画面が表示された。

### 画面
- **ログイン画面**
  - 製品説明と4条件の概要（静的な説明文で、データではない）、ログインフォーム、エラー表示、送信中の無効化がある。
  - 新規登録の導線はない。
- **ダッシュボード（最小限）**: 見出しと、アカウントの情報を表示する。アカウント情報は、メールアドレス、許可リストへの登録状態、最終ログイン日時（JST、YYYY-MM-DD HH:mm）で、どれも実データ。
- **404 画面**: アプリのレイアウト内に表示する。
- **ヘッダー**: ブランドとアカウントメニュー（メールアドレス、ログアウト）。
- **フッター**: データ出典と注記。全画面に表示する。
- **配色**: `light-dark()` トークンで1か所に定義した。OS の設定に従い、`data-theme` で固定することもできる（手動切り替えは Sprint 2 で実装する）。

## 起動方法

```bash
open -a Docker   # Docker が止まっている場合
pnpm install && pnpm db:start && pnpm db:reset && pnpm env:local && pnpm seed:users && pnpm dev
# http://localhost:3000   owner@quantis.local / Quantis-Owner-2026!
```

## 完了条件チェック

| 条件 | 状態 | 確認方法 |
|---|---|---|
| C1-1〜3 未ログインのリダイレクト | ✅ | E2E（`/`、`/screening`、`/stocks/72030`、`/imports`、`/settings`、`/foo/bar`、`/stocks/72030.png`）。`curl -sI /screening` の結果は 307 と `location: /login?next=%2Fscreening` |
| C1-4 x-middleware-subrequest | ✅ | curl で 4 通りのヘッダー値（middleware/src/middleware/proxy/src/proxy）を試し、すべて 307 で `/login` に送られた |
| C1-5 拡張子付きパス | ✅ | curl で `/stocks/72030.png` は `/login?next=...` へリダイレクト、`/api/stocks.json` は 401 |
| C1-6 保護の二重化 | ✅ | Vitest `src/app/api/stocks/route.test.ts`（セッション無しは 401、許可リスト外は 403、Auth 例外は 401）。保護画面は layout のガードで担保 |
| C2-1〜3 ログイン、リロード、状態保持 | ✅ | E2E。スクリーンショットも確認 |
| C2-4 next と、不正な値 8 ケース | ✅ | E2E で 8 ケースすべて、遷移先のオリジンが localhost:3000 でパスが `/` であることを確認。Vitest でも確認 |
| C2-5 大文字小文字と空白 | ✅ | E2E で `  OWNER@Quantis.Local ` を使用 |
| C2-6 ログイン済みで /login を開く | ✅ | E2E |
| C2-7 コンソールエラーが出ない | ✅ | E2E で console error が 0 件。スクリーンショット取得時も error なし |
| C3-1〜4 パスワード誤り、入力エラー、二重送信 | ✅ | E2E。送信中は `disabled` と「確認しています…」の表示（`useActionState` の pending でボタンを無効化している。E2E では送信中の状態を直接はアサートしておらず、コードで確認した） |
| C3-5 Auth 停止 | ✅ | Playwright スクリプトでログイン画面を開いたまま `pnpm db:stop` を実行してからログインを押した。「認証サーバーに接続できません…」が表示され、pageerror と console error は 0 件。続けて `/` を開くと `/login` に、`/api/stocks` は 401 になった。`db:start` 後もユーザーは残っていた |
| C3-6 429 | ✅ | Vitest（`login.test.ts`）。`config.toml` の `sign_in_sign_ups = 300` |
| C4-1 新規登録の導線が無い | ✅ | E2E。`/signup` は `/login?next=%2Fsignup` にリダイレクト |
| C4-2・3 許可リスト外（アカウントの有無） | ✅ | E2E |
| C4-4 Auth API の直接呼び出し | ✅ | curl の結果: signup は 422 `signup_disabled`。intruder の password grant は 403、`access_token` 無し |
| C4-5 匿名サインイン | ✅ | 422 `anonymous_provider_disabled`。`is_anonymous` の行は 0 件 |
| C4-6 OTP | ✅ | 422 `signup_disabled`。`auth.users` に stranger は作られなかった |
| C4-7 DB | ✅ | psql で確認 |
| C5-1〜4 ログアウト、戻る 2 回、Cookie | ✅ | E2E（ソフトナビゲーションの後にログアウトし、戻るを 2 回押す。Cookie の消去と API の 401 も確認） |
| C6-1〜5 API の 401 | ✅ | curl で、ヘッダー無し、公開キー付き、でたらめな Cookie、`/api/foo` を試し、すべて `{"error":"unauthorized"}` 401 |
| C6-6 許可ユーザーは 200 | ✅ | E2E と curl で、99990 と 99991 の行が返ることを確認 |
| C6-7 許可の取り消し | ✅ | E2E（API は 403、画面は `/login?reason=revoked` とメッセージ、Cookie は消える）。curl で `-sIL --max-redirs 5` を `/` からと `/login` から実行し、どちらもループせずに 200 で止まった |
| C7-1〜5 公開キー、REST、GraphQL、DB | ✅ | curl の結果: stocks は 42501、`allowed_emails` は PGRST205、`Accept-Profile: private` は PGRST106、RPC は 3 関数とも 42501、GraphQL は `pg_graphql extension is not enabled`（行を返さない）。psql で RLS が `t`、ポリシーは authenticated のみ、`has_function_privilege` はすべて `f` |
| C8 フッター | ✅ | E2E でログイン画面、ダッシュボード、404 を確認。375px 幅でも横スクロールしない |
| C9-1 build、lint、typecheck、test | ✅ | すべて成功 |
| C9-2 E2E | ✅ | 28 件すべて成功。dev サーバーでも `pnpm build && pnpm start` の本番サーバーでも通った |
| C9-3 単体テスト | ✅ | `next-path`、`login`、`route`、`format` |
| C9-4 シークレットキーの漏えい | ✅ | `grep -rl "$SUPABASE_SECRET_KEY" .next/static` は 0 件（`service_role` の文字列も 0 件） |
| C9-5 375px・1280px、ダーク | ✅ | Playwright のスクリーンショット（ライトとダーク × 2 幅）で目視確認。E2E に背景輝度のアサーションを入れた |
| C9-6 ダミーデータ無し、E2E の後片付け | ✅ | `db:reset` 直後の stocks は 0 件。E2E の後も 0 件で、許可リストも元に戻る |
| C9-7 .env | ✅ | `.gitignore` の `.env*` に `!.env.example` を追加 |
| C9-8 CLAUDE.md | ✅ | 追記済み |
| C9-9 コミット | ✅ | `sprint-01: 認証とアクセス制御` |
| C10-1〜7 運用コマンド | ✅ | 実行して確認した。新規作成、冪等性（重複行なし・パスワードは変更しない）、`--reset-password`、intruder を追加するとログインでき削除すると拒否されること、引数の欠落・不正なメール・短いパスワードで終了コード 2、ローカル以外の URL で終了コード 1（接続前に判定）、seed を 2 回実行しても 1 件ずつ |

## 既知の問題・未実装
- **GraphQL（C7-4）**: ローカルでは `pg_graphql` 拡張が有効でないため、「extension is not enabled」のエラーになる。行が返らないので条件は満たす。ただし、拡張が有効な環境で `stocksCollection` がエラーになることは確かめていない。anon は `stocks` に対する権限を持たないため、スキーマにも現れないはず。
- **開発サーバーでの戻る操作**: キャッシュから復元されたページは、ハイドレーション前のスクリプトで隠してから再読み込みする。そのため、ログアウト後に「戻る」を押すと、一瞬白い画面になってからログイン画面に移る。内容は表示されない。本番サーバー（`pnpm start`）では、応答が `no-store` なので、このスクリプトが動かなくても再取得される。
- **E2E の前提**: E2E は `pnpm seed:users` 済みであることを前提にしている。また、許可リストを一時的に変更する（テスト終了時に元に戻す）ため、並列実行はしない（`workers: 1`）。
- **ダッシュボード**: 見出しとアカウント情報だけ。件数や鮮度は Sprint 2 で作る。
- **Vercel への本番デプロイ**: 実施していない（契約の対象外）。Supabase のホスト環境で必要な設定は README に書いた。
- **仕様との差異**: 無し。契約の改訂2で、実測に基づいて次を修正した。
  - `[auth.email] enable_signup` を `false` にすると、メールでのログインそのものが無効になるため、`true` のままにした。
  - 環境変数名を、Supabase CLI 2.x の新形式キーに合わせた。

## エバリュエーターに重点的に見てほしい点
- **C6-7 と 4-b（許可の取り消し）**: ログイン中に許可リストから行を削除した直後の API（403）、画面（`/login?reason=revoked`）、Cookie の消去、curl でループしないこと。
- **C5-2（ログアウト後の「戻る」）**: `pnpm dev` と `pnpm start` の両方で確認してほしい。開発サーバーのキャッシュの挙動への対策が効いているかを見てほしい。
- **C3-5（`pnpm db:stop` 中のログイン）**: 日本語のメッセージが出て、Next.js のエラー画面にならないこと。
- **C4-4（Auth API の直接呼び出し）**: フックによる 403 と、`access_token` を含まないこと。

---

# Sprint 01 自己評価（ラウンド 2：評価ラウンド 1 のフィードバックへの対応）

## 対応内容

### B1（`pnpm dev` で、ログアウト後の「戻る」で保護画面が再表示される）：根本原因から直した
- **原因**
  - Next.js 16 の開発サーバーは、画面の応答を `no-cache, must-revalidate` に強制する（`next/dist/server/base-server.js`）。Chrome は、戻る／進むのときに `no-cache` の応答も HTTP キャッシュから復元する。
  - 前回は、ブラウザ側で復元を検出するスクリプト（ルートレイアウトの `<Script beforeInteractive>`）で防いでいた。しかし、notFound() の画面ではこのスクリプトが実行可能な形で出力されず、防げていなかった。
- **方針の変更**: 「キャッシュから復元されたことを検出して隠す」という発想をやめた。代わりに、セッションを破棄する応答（`POST /auth/signout` と、破棄を伴う `GET /auth/signout`）に `Clear-Site-Data: "cache"` を付け、ログアウトの時点でこのオリジンの HTTP キャッシュと bfcache を消す方式にした。ログアウト後の「戻る」では、画面が必ずサーバーから取り直され、未ログインとして `/login` にリダイレクトされる。検出用のスクリプト（`history-cache-guard`）は削除した。
- **確認**
  - 評価の再現手順（`/foo` を直接開く → リンクで `/` → ログアウト → 戻る）を E2E に入れた。「戻る」の後 2 秒間、100ms ごとに観測し、メールアドレスが一度も表示されないことを確かめる。
  - 別の手順（ダッシュボードをドキュメントとして読み込む → 別の画面でログアウト → 戻る）のテストも追加した。
  - `pnpm dev` と `pnpm start` の両方で通った。

### B2（404 画面での script タグの警告と、Performance.measure の例外）
- **script タグの警告**: `<Script>` を削除したので出なくなった。
- **`Performance.measure ... 'UnknownPage' cannot have a negative time stamp`**
  - これは、キャッチオールのサーバーコンポーネント `(app)/[...rest]/page.tsx` が notFound() を投げたときに、開発時の React のパフォーマンス計測が起こす例外だった。関数を async にしても再現した。
  - そこでキャッチオールをやめた。存在しない URL は、ルートの `app/not-found.tsx` で表示する。このコンポーネントは `requireAllowedUser()` で検証し、ログイン後の画面と同じ枠（新しく作った `ProtectedShell`）で表示する。
  - 未ログインのときは、これまでどおり proxy が `/login?next=` に送る。
- **確認**: ログイン後に `/foo` を直接開き、1 秒間 `pageerror` と console error を監視する E2E を追加した。3 回連続で問題が出なかった（404 ステータスのリソースエラーは除く）。修正前はこのテストが 4 回中 4 回失敗することを確かめている。

### M1（E2E がバグを検出できていなかった）
- `expectNeverShown()`（`e2e/support.ts`）で、キャッシュからの復元や再読み込みが落ち着くまで観測してから判定するようにした。
- **検出できることの確認**: `Clear-Site-Data` を一時的に外して実行すると、ログアウトの2テストはどちらも失敗した（メールアドレスが表示された URL を報告する）。戻すと成功した。

### M2（signout の CSRF）
- `POST /auth/signout`: `Origin` が同一オリジンでなければ 403 を返す（Origin の無い要求も拒否する）。
- `GET /auth/signout`: サーバー側で状態を判定する。有効で許可されたセッションは破棄せず、`next`（既定は `/`）に戻す。破棄するのは、許可リスト外と、無効な Cookie の後片付けのときだけ。
- 確認: E2E（外部からの GET でログアウトされないこと、`Origin: https://evil.example` の POST が 403）と curl。

### M3（許可リスト外のアドレスへの OTP メール）：対応した
- Send Email Hook（`private.block_auth_email_hook`、`config.toml` の `[auth.hook.send_email]`）で、Auth からのメール送信をすべて拒否する。このアプリは、ユーザーを管理コマンドで作り、パスワードでログインするだけなので、メールは使わない。
- 確認:
  - intruder と owner への `/otp` と `/recover` は 403「このアプリではメールによる認証を利用できません」になった。stranger への `/otp` は 422 `signup_disabled`。
  - Mailpit は 0 件のまま。
  - パスワードでのログイン、`auth:add-user`、`seed:users` には影響が無かった。

### M4（無効になったセッションの Cookie が残る）
- 保護画面のガードは、セッションを検証できず、しかも Supabase の Cookie が残っている場合に、`/auth/signout?next=...` を経由させて Cookie を削除する。
- `/login` からは `/auth/signout` に送らない。Cookie を削除できないクライアント（同じ Cookie を送り続ける curl など）との間で、リダイレクトがループしないようにするため。
- 確認:
  - E2E: 破棄済みセッションの Cookie を別のコンテキストに入れて `/` を開くと、`/login` に着き、Cookie は 0 件になった。
  - curl `-sIL --max-redirs 5`（同じ Cookie を送り続ける）: `/` からは `/auth/signout` → `/login` の 200、`/login` からは 200 で、どちらもループしなかった。

### M5（Auth 障害時の案内）：対応した
- 状態に `unavailable` を加えた。対象は、Auth や DB に到達できない場合と、許可リストの照会に失敗した場合。
  - 画面: `/login` に送り、「認証サーバーに接続できません…」を表示する。
  - API: 503 `{"error":"auth_unavailable"}` を返す。
- 一時的な障害でログアウトさせないよう、この場合はセッションを破棄しない。
- 確認（Playwright スクリプト）: ログイン中に `pnpm db:stop` を実行すると、`/` は `/login` に移って案内が出た。API は 503、ログインを試すと同じ案内。`db:start` の後に `/` を開くと、ログインし直さずにダッシュボードが表示された。コンソールエラーは無かった。

### M6（今後のテーブルの権限）
- マイグレーション `20260924010000_privilege_hardening.sql`: `alter default privileges` で、public の新しいテーブル・シーケンス・関数に anon と authenticated の権限が自動で付かないようにした。関数の `PUBLIC` 実行権は、全体の既定から外した。
- `e2e/db-privileges.spec.ts`（5 件）で、次を検査する。以後のスプリントで追加したテーブルや関数も自動で対象になる。
  - public のテーブルに anon と PUBLIC の権限が無い
  - public のテーブルはすべて RLS が有効
  - authenticated に書き込み権限が無い
  - public と private の関数を anon が実行できない
  - 新しく作ったテーブル・関数に既定の権限が付かない（ロールバックする一時オブジェクトで確認）
- 最後の検査は、全体の既定を修正する前に失敗することを確かめている。

### M7（プロセスの停止漏れ）
- 前回は `pkill -f "next start"` で親プロセスだけを止め、`next-server` が残っていた。今回は、ポート 3000 を LISTEN しているプロセスを止め、`lsof` と `ps` で 0 件であることを確かめてから終えた。

## 起動方法（変更なし）

```bash
pnpm install && pnpm db:start && pnpm db:reset && pnpm env:local && pnpm seed:users && pnpm dev
```

- マイグレーションと `config.toml`（Send Email Hook）を追加した。すでに Supabase を起動している場合は、`pnpm db:stop && pnpm db:start && pnpm db:reset && pnpm seed:users` を実行すること。

## 完了条件チェック（ラウンド 2 で再確認したもの）

| 条件 | 状態 | 確認方法 |
|---|---|---|
| C5-2 ログアウト後の「戻る」 | ✅ | E2E の 2 テスト（評価の再現手順と、ダッシュボードのキャッシュの手順）。dev と prod の両方。`Clear-Site-Data` を外すと失敗することも確認 |
| C1-3 と C8 ログイン後の 404（アプリの枠内、フッター） | ✅ | E2E（見出し、アカウントメニュー、フッター、コンソールエラーが無いこと） |
| C1-1 未ログインの `/foo`、`/stocks/72030` など | ✅ | E2E と curl（307 → `/login?next=...`） |
| C3-5 Auth 停止 | ✅ | 上の M5 の確認 |
| C6-7 と 4-b 許可の取り消しとループ | ✅ | E2E と curl（`/`、`/login` のどちらから始めても、生きた Cookie でも破棄済みの Cookie でも 200 で止まる。破棄の応答には `clear-site-data: "cache"` が付く） |
| C4-6 OTP | ✅ | stranger は 422 `signup_disabled`。既存ユーザーは 403（メールは送られない） |
| C7-5 と、DB の権限全般 | ✅ | `e2e/db-privileges.spec.ts` |
| C9-1 と C9-2 | ✅ | lint、typecheck、Vitest 47 件、E2E 37 件（dev と prod の両方）、build はすべて成功。`.next/static` にシークレットキーは 0 件 |
| C10 | ✅ | `db:reset` の後に `seed:users` を実行し、E2E で owner と intruder の挙動を確認 |

## 既知の問題・未実装
- **`Clear-Site-Data` の対応状況**: `Clear-Site-Data` は、安全なコンテキスト（https、または localhost）でだけ有効になる。本番の Vercel（https）と評価環境（localhost）は条件を満たす。LAN の IP アドレス（http://10.x.x.x:3000）で dev サーバーを開いた場合には効かない。ただし、本番サーバーは画面を `no-store` で返すので、その場合も本番では問題にならない。
- **Firefox**: `Clear-Site-Data` の `"cache"` に対応しているが、自分では Chromium でしか確かめていない。
- **API の障害時のステータス**: Auth 障害時の API のステータスを、401 から 503 に変えた。データを返さないこと（fail closed）は変わらない。契約の第4章に記載した（改訂3）。
- **テスト対象外**: GraphQL（C7-4）の注記、Vercel への本番デプロイを実施していないことは、ラウンド 1 と同じ。

## エバリュエーターに重点的に見てほしい点
- `pnpm dev` での B1 の再現手順と、そのほかの戻る／進むのパターン（戻る→進む→戻る、別タブでログアウトしてから元のタブで戻る、など）。
- `GET /auth/signout` の新しい振る舞い（許可ユーザーはログアウトされない。許可取り消しと無効な Cookie は後片付けされる）。
- Auth 障害中と、障害から回復した後のセッションの扱い（M5）。
