# Sprint 01 評価（ラウンド 1）

## 判定: 不合格

不合格の理由は、完了条件 C5-2（ログアウト後に「戻る」を押しても保護画面の内容が表示されない）が、契約の起動手順である `pnpm dev` で満たされていないことです（B1）。この1件を除けば、認証とアクセス制御は多層で堅く作られていて、C5-2 以外の完了条件はすべて実機で確認できました。修正範囲は小さいと見ています。

## スコア
| 基準 | スコア | 閾値 | 結果 |
|---|---|---|---|
| 機能性 | 7 | 8 | ❌ |
| 仕様充足度 | 8 | 7 | ✅ |
| デザイン品質 | 7 | 6 | ✅ |
| コード品質 | 7 | 6 | ✅ |

- 機能性: 契約の起動手順（`pnpm dev`）で、ログアウト後の「戻る」でログイン中のメールアドレスを含む保護画面が再表示されます（B1）。同じ 404 画面では、ブラウザで未処理の例外も出ます（B2）。これ以外は、異常系（Auth 停止、許可の取り消し、リダイレクトのループ、`next` の不正値 14 通り）まで正しく動きました。
- 仕様充足度: AC1.1〜AC1.8 を、画面・API・DB・Auth サーバーの4層で担保しています。運用コマンド（C10）も実用的に作られています。
- デザイン: 落ち着いた配色で、ライトとダーク、375px と 1280px のどれでも崩れません。ログイン画面の説明も製品の意図に合っています。
- コード品質: 依存の注入、`sanitizeNextPath` の純粋関数化、`requireApiUser()` による共通化など、構造は良好です。ただし、戻る／進むのガードが「ルートレイアウトの `beforeInteractive` Script」頼みです。notFound() の画面では、このスクリプトが実行可能な `<script>` として出力されません。さらに、それを検出するはずの E2E テストが、バグがあっても通ってしまいます（M1）。

## 完了条件の検証結果
| 条件 | 結果 | 検証方法（UI / API / DB） | 備考 |
|---|---|---|---|
| C1-1〜3 未ログイン時のリダイレクト | ✅ | UI（Playwright）/ curl | `/`、`/screening`、`/stocks/72030`、`/imports`、`/settings`、`/foo/bar`、`/signup`、`/register` はすべて 307 で `/login?next=...` に送られる。ログイン後の 404 は日本語で、アプリのレイアウト内に表示される |
| C1-4 x-middleware-subrequest | ✅ | curl | 4通りの値（middleware / src/middleware / proxy / src/proxy）で、すべて 307 で `/login` に送られる |
| C1-5 拡張子付きのパス | ✅ | curl | `/stocks/72030.png` は 307。`/api/stocks.json` は 401。追加で、`/_next/static/../../api/stocks`、`/favicon.ico/../api/stocks`、`/login/../api/stocks`（`--path-as-is`）、`/api` はすべて 401。`/_next/image?url=/api/stocks` は 400 で、データを返さない |
| C1-6 保護の二重化 | ✅ | Vitest / コード | `route.test.ts` で確認（未ログインは 401、許可リスト外は 403、例外時は 401） |
| C2-1〜3 ログインと状態保持 | ✅ | UI | ダッシュボードに遷移し、見出しとヘッダーにメールアドレスが出る。リロード後も、新しいタブでもログイン状態が続く |
| C2-4 `next` と不正な値 | ✅ | UI | 契約の8ケースに加え、`/\/example.com`、`///example.com`、`/..//example.com`、`/.//example.com` も試した。すべて `http://localhost:3000/` に遷移する。正常系の `/stocks/72030`、`/foo?a=1`、`/stocks/72030?x=1` は保持される |
| C2-5 大文字小文字と空白 | ✅ | UI | `  OWNER@Quantis.Local ` でログインできる |
| C2-6 ログイン済みで /login を開く | ✅ | UI | `/` に送られる |
| C2-7 コンソールエラー | ✅ | UI | ログインからダッシュボードまでの間、エラーは 0 件 |
| C3-1〜2 パスワード誤り | ✅ | UI | 「メールアドレスまたはパスワードが正しくありません」と出て `/login` にとどまる。その後 `/` は `/login` に送られる |
| C3-3 入力エラー | ✅ | UI | 空欄と形式不正で、日本語のフィールドエラーが出る（サーバー側でも同じ） |
| C3-4 送信中の無効化 | ✅ | UI | 応答を 1.5 秒遅らせて確認した。ボタンは disabled になり「確認しています…」と出る。クリックと Enter を追加しても、POST は増えない |
| C3-5 Auth 停止 | ✅ | UI | `pnpm db:stop` 中は「認証サーバーに接続できません…」と出る。`/` は `/login` に、`/api/stocks` は 401 になる。未処理の例外は無い。`db:start` の後、データは保持されていた |
| C3-6 429 | ✅ | Vitest / config | `login.test.ts` と `sign_in_sign_ups = 300` で確認 |
| C4-1 新規登録の導線が無い | ✅ | UI | 本文に登録系の文言が無い。`/signup` と `/register` は `/login` に送られる |
| C4-2・3 許可リスト外 | ✅ | UI | stranger と intruder の両方で「このメールアドレスは利用が許可されていません」と出る。intruder には Cookie も発行されない |
| C4-4 Auth API の直接呼び出し | ✅ | API | signup は 422 `signup_disabled`。intruder のパスワードグラントは 403 で、`access_token` を含まない |
| C4-5 匿名サインイン | ✅ | API / DB | 422 `anonymous_provider_disabled`。`is_anonymous` の行は 0 件 |
| C4-6 OTP | ✅ | API / DB | stranger は 422 `signup_disabled` で、ユーザーは作られない（既存の intruder 宛ての OTP については M3 を参照） |
| C4-7 DB | ✅ | DB | `auth.users` に stranger はいない |
| C5-1 ログアウト | ✅ | UI | アカウントメニューから `/login` に遷移する |
| **C5-2 ログアウト後の「戻る」** | **❌** | UI | **`pnpm dev` で、404 画面を経由した場合に、ログイン中のメールアドレスを含む保護レイアウトが再表示される（B1）**。`pnpm start` では再現しない |
| C5-3 ログアウト後の / と API | ✅ | UI | `/login` に送られ、API は 401 |
| C5-4 Cookie の削除 | ✅ | UI | ログアウト後、`sb-*` の Cookie は 0 件 |
| C6-1〜5 API の 401 | ✅ | API | ヘッダー無し、公開キー付き、でたらめな Cookie、`/api/foo`、POST のすべてで `{"error":"unauthorized"}` の 401 |
| C6-6 許可ユーザーの 200 | ✅ | UI / DB | 投入した 99990 が `{"data":[...]}` で返る。応答は `no-store` |
| C6-7 ログイン中の許可取り消し | ✅ | UI / API / DB | API は 403 `{"error":"forbidden"}`。画面は `/login?reason=revoked` に移ってメッセージが出て、Cookie は 0 件。取り消し後に古いアクセストークンで REST を直接呼んでも `[]`。4-b: 生きたセッションの Cookie では `/`→`/auth/signout?reason=revoked`→`/login?reason=revoked`（200、リダイレクト2回）。破棄済みの Cookie では `/login` の 200 で止まり、ループしない。dev と prod の両方で確認 |
| C7-1 REST | ✅ | API | 公開キーと従来の anon JWT の両方で `42501 permission denied` |
| C7-2 allowed_emails | ✅ | API | PGRST205 と PGRST106 |
| C7-3 RPC | ✅ | API | `is_email_allowed`、`current_user_is_allowed`、`admin_allow_email`、`admin_disallow_email` のすべてで 42501 |
| C7-4 GraphQL | ✅ | API | `pg_graphql extension is not enabled`。行は返らない |
| C7-5 DB | ✅ | DB | `relrowsecurity = t`。ポリシーは authenticated の SELECT だけ。`has_function_privilege` は、anon と authenticated で `is_email_allowed`、`admin_*`、フック、`private.email_is_allowed` のすべてが `f` |
| C8 フッター | ✅ | UI | ログイン、ダッシュボード、404 のすべてに、規定の文言が出る。375px でも `scrollWidth = 375` |
| C9-1 build / lint / typecheck / test | ✅ | CLI | すべて成功（Vitest 46 件） |
| C9-2 E2E | ✅（ただし M1） | CLI | 28 件すべて成功。ただし、ログアウト後の「戻る」のテストは B1 を検出できていない |
| C9-3 単体テスト | ✅ | コード | 必要なケースがそろっている |
| C9-4 シークレットキーの漏えい | ✅ | CLI | `.next/static` で `$SUPABASE_SECRET_KEY`、`service_role`、`sb_secret` のどれも 0 件 |
| C9-5 375px・1280px・ダーク | ✅ | UI | `colorScheme: 'dark'` で、4通りのスクリーンショットを目視で確認した。背景は `lab(4.4 …)` |
| C9-6 ダミーデータ無し、E2E の後片付け | ✅ | DB | E2E の前後で stocks の件数は変わらず、許可リストも元に戻る |
| C9-7 .env | ✅ | git | `.env.local` は ignore されている。`.env.example` には変数名だけが書かれている |
| C9-8 CLAUDE.md | ✅ | ファイル | 追記済み |
| C9-9 コミット | ✅ | git | `3f132ff sprint-01: 認証とアクセス制御` |
| C10-1〜2 add-user と冪等性 | ✅ | CLI / DB / UI | 小文字で1行登録され、ログインできる。再実行しても重複せず、パスワードは変わらない。`--reset-password` で更新される |
| C10-3 intruder の追加と削除 | ✅ | CLI / UI / API | 追加するとログインでき、削除すると即座に拒否される（Auth API も 403） |
| C10-4 引数エラー | ✅ | CLI | 欠落、不正なメール、短いパスワード、不明なオプションのすべてで、日本語の理由と使い方を表示し、終了コード 2 で終わる。DB は変わらない |
| C10-5 ローカル以外の URL | ✅ | CLI | `example.supabase.co` で終了コード 1。何も作られない |
| C10-6 seed の冪等性 | ✅ | CLI / DB | 2回実行しても各1件。許可リストの状態も正しい |

## バグ（修正必須）

### B1: `pnpm dev` で、ログアウト後に「戻る」を押すと、404 画面（保護レイアウト）がログイン中のメールアドレス付きで再表示される
- 重要度: Major（完了条件 C5-2 の未達。AC1.5「戻るで保護された画面に戻ってもデータは表示されない」に反する）
- 再現手順（`pnpm dev`、Chromium。3回中3回再現した）:
  1. `owner@quantis.local` でログインする
  2. アドレスバーで `http://localhost:3000/foo`（存在しないパス）を開く。アプリのレイアウト内に 404 画面が出る
  3. 「ダッシュボードに戻る」リンクを押す（ソフトナビゲーションで `/` へ）
  4. アカウントメニューから「ログアウト」を押す。`/login` に遷移する
  5. ブラウザの「戻る」を押す
- 期待結果: 保護画面の内容は表示されず、`/login` に送られる
- 実際の結果: URL が `/foo` になり、ヘッダーに `owner@quantis.local` とアカウントメニューを含む 404 画面が表示されたままになる（3秒以上観測したが変わらなかった）。Next.js の開発オーバーレイに「2 Issues」と出る
- 根拠:
  - 300ms 間隔で観測した結果: `/foo:EMAIL /foo:EMAIL …`（10回とも同じ）。ドキュメントの取得は `404 GET /nope`（HTTP キャッシュからの復元）
  - 原因: ログイン時の `/foo` の応答は `Cache-Control: no-cache, must-revalidate`（dev）。Chrome は、戻る／進むでは no-cache の応答もキャッシュから復元する。この経路を防ぐはずの `history-cache-guard` スクリプトは、ルートレイアウトの `<Script strategy="beforeInteractive">` で入れている。しかし、notFound() で描画された画面の HTML では、このスクリプトが実行可能な `<script>` として出力されず、RSC ペイロードの中の文字列としてしか存在しない（`curl` で比べると、`/` では `back_forward` が2か所にあり、`/foo` では1か所だけ）。ブラウザのコンソールにも「Encountered a script tag while rendering React component. Scripts inside React components are never executed when rendering on the client.」が出る
  - `pnpm build && pnpm start` では、同じ手順で `/login` に送られる（応答が `no-store` のため）。ただし、契約第3章の評価環境の起動手順は `pnpm dev` であり、第4章は dev でも「すべての画面に」ガードを入れると約束している
  - 今後のスプリントで、notFound() を使う画面（存在しない銘柄コードの銘柄詳細など）が増えると、同じ経路でデータが見えるおそれがある
- 修正の方向（参考）: ガードを、notFound やエラー境界の画面でも必ず出力される形で入れる。例えば、ルートレイアウトの `<head>` に素の `<script dangerouslySetInnerHTML>` を置く方法や、404 画面に独立したガードを置く方法がある。あわせて、dev でも保護画面の応答を `no-store` にできないかも検討してほしい。E2E には、この手順（404 を直接開く → リンクで `/` → ログアウト → 戻る → 数百 ms 待ってからメールアドレスが無いことを確認）を加える。

### B2: `pnpm dev` で、ログイン後の 404 画面を開くと、ブラウザで未処理の例外とコンソールエラーが出る
- 重要度: Minor（dev 限定。B1 と原因が同じ）
- 再現手順: 1. owner でログインする 2. `http://localhost:3000/foo` を直接開く
- 期待結果: コンソールエラーが出ない
- 実際の結果: 「Encountered a script tag while rendering React component…」（console.error）と、`Uncaught TypeError: Failed to execute 'measure' on 'Performance': '​UnknownPage' cannot have a negative time stamp.`（dev サーバーのログに `[browser]` として6回）が出る。開発オーバーレイに「Issue」バッジが表示される。`pnpm start` では、404 のリソースエラー以外は出ない
- 根拠: Playwright の `pageerror` と `console` のイベント、`dev.log`

## 改善提案（合格判定には影響しないが推奨）
- **M1（テスト）**: `e2e/auth.spec.ts` の「ログアウト後は戻る操作でも…」は、B1 と同じ手順なのに成功する。`goBack()` の直後に `toHaveCount(0)` を1回だけ判定しているため、キャッシュから復元される前の瞬間を見て成功してしまっている。復元が落ち着くまで待ってから、否定を確かめる形にすること。
- **M2（CSRF によるログアウト）**: `GET /auth/signout` は、Origin を確認せずにセッションを破棄する。そのため、外部サイトの `<img src="http://…/auth/signout">` でログアウトさせられる。取り消しのリダイレクト専用にするなら、「許可リスト外であることを確かめたときだけ破棄する」などの条件を付けることを勧める（影響はログアウトだけなので Minor）。
- **M3（OTP メール）**: 許可リスト外でもアカウントが存在する intruder に対しては、公開キーで `POST /auth/v1/otp` を呼ぶと 200 が返り、マジックリンクのメールが実際に送られる（Mailpit で確認した）。リンクを開いてもフックが `access_denied` で拒否するため、ログインはできない。ただ、許可リスト外のアドレスにメールを送れる経路が残っている。本番では、許可を外したユーザーを Auth から削除する、または ban する運用も検討してほしい。
- **M4**: サーバー側で無効になったセッションの Cookie を持つブラウザで `/` を開くと、`/login` には送られるが、Cookie は削除されずに残る（害は無いが、残骸になる）。
- **M5**: ログイン中のユーザーは、Auth が停止している間に画面を開くと、理由の表示なしに `/login` に送られる。「認証サーバーに接続できません」のような案内があると親切。
- **M6（今後のテーブル）**: Supabase の既定の権限では、public スキーマの新しいテーブルに anon と authenticated の権限が自動で付く。Sprint 3 以降、テーブルごとに `revoke` を忘れると、AC1.7 がすぐに破れる。`alter default privileges` で anon の既定の権限を外すか、全テーブルの anon 権限が 0 であることを確かめる DB テストを入れることを勧める。
- **M7（運用）**: 評価の開始時点で、ジェネレーターが起動した `pnpm start`（PID 19732 と 19768、11:28 開始。コミット前のビルド）が :3000 で動いたまま残っていた。評価者側で停止した。スプリントの終わりには、起動したプロセスを必ず止めること。
- `/login?reason=revoked` は、誰でもリンクで開けて、「利用許可が取り消されました」と表示させられる（実害は無い）。

## 不審な変更の確認（外部からの更新の報告への対応）
- `git status` はクリーンで、作業ツリーはコミット `3f132ff` と一致している。`.claude/`（エージェントの定義とスキル）、`.mcp.json`、`docs/harness/spec.md` は、初回コミット `22034ef` から変わっていない。
- `contract.md` の `22034ef` から `3f132ff` への差分を1行ずつ確認した。変更は、再レビューの N1〜N3 と注意事項への対応、実測に基づく修正（キーの名前、403 の実測の本文、dev のキャッシュ対策）だけだった。完了条件の削除や緩和は無い。緩和に見える唯一の変更は `[auth.email] enable_signup = true` だが、その結果として守るべき性質（signup と OTP による新規作成の拒否）は、C4-4〜C4-6 で私が実測し、満たされていることを確かめた。
- `self-review.md`、`contract.md`、`CLAUDE.md`、`README.md`、`src/`、`scripts/`、`supabase/`、`e2e/` を対象に、ゼロ幅文字と双方向制御文字、HTML コメント、評価者に向けた文言（合格、スコア、エバリュエーターなど）を検索した。該当は無かった。`AGENTS.md` の HTML コメントは、`next dev` が生成する Next.js の標準のブロックで、評価を誘導する内容ではない。
- `package.json` の依存 `cn` は、shadcn-ui の公式リポジトリ（`github.com/shadcn-ui/cn`）のパッケージで、問題は無い。
- 手続き上の指摘: `contract-review.md` は、改訂1への「修正依頼」で終わっていて、改訂2の承認の記録が無い。改訂2の内容は、今回の評価で妥当と判断した。

## 評価環境と後片付け
- 契約第3章の手順で起動した（ローカル Supabase は起動済みだった）。`pnpm dev` と `pnpm build && pnpm start` の両方で検証した。Playwright MCP はこのセッションで使えなかったため、リポジトリの `@playwright/test`（Chromium、新しいブラウザコンテキスト）のスクリプトで、クリック、入力、戻る操作、スクリーンショット、コンソールの監視を行った。
- 後片付け:
  - dev サーバーと prod サーバーは停止した。
  - DB は、評価前に取ったダンプ（auth.users、identities、sessions、refresh_tokens、mfa_amr_claims、`private.allowed_emails`、`public.stocks`）から復元した。ユーザーは2名（ID は評価前と同じ）、許可リストは owner だけ、stocks は 0 件、sessions と refresh_tokens は 12 件で、評価前と一致する。
  - 評価中に送った OTP のメールは、Mailpit から削除した。
  - `auth.audit_log_entries` には、評価中の記録が残っている。
