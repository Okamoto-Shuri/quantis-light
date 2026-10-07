# Sprint 16 自己評価（ラウンド 1）

## 実装内容

F16 事業の内容（有報の最初の段落）。契約 rev 1（`contract.md`）に沿って実装した。

- **DB**（`supabase/migrations/20261012000000_business_description.sql`）
  - テーブル `business_description_extractions`。RLS は許可ユーザーの select だけで、書き込みは service_role。check 制約は、段落が ok のときだけあること、1〜20,000 コードポイント、前後に空白が無いこと。進み具合のトリガーも付けた。
  - 選び方の1か所 `business_description_sections_for(codes)`。規則は大株主の区画と同じ。
  - 詳細 `business_description_detail(code)`。
  - `save_edinet_extractions` を5引数にした（4引数の版は削除）。
  - `edinet_ingestion_state` に、事業の内容の pending の書類と `needsBusinessDescription` を足した。
  - `annual_reports_summary()` に `businessDescription` を足した（上場中だけで数える）。
  - **既存のテーブルへの DML（insert・update・delete）は、このマイグレーションに無い**（C9-8。AC16.8 のマイグレーションの部分）。`annual_report_sections_for`・`annual_report_candidates_for`・`annual_report_detail` も変えていない。
- **抽出**
  - `src/lib/ingestion/edinet/business-description.ts`（新規）: 段落への分割、見出しの判定、最初の段落、4つの結果。
  - `xbrl.ts`: `readInlineXbrl(docs, { textBlocks })` で、指定した要素だけ本文の構造（text・br・boundary・table・figure）を返す。指定しない呼び出しの結果は今までと同じ。
- **取り込み**（`edinet-reports.ts`）: 3つ目の処理として、同じ ZIP の同じ解析から読む。`details` に `businessDescription`・`businessDescriptionDiscardedFacts`・`documentsTargetedByKind.businessDescription` を足した。
- **画面**
  - `components/stocks/business-description-section.tsx`（新規）を、銘柄詳細の `StockDetail` の中の「条件の判定」のグリッドの直前に置いた。
  - 引用のラベル、`blockquote`、出典、元の有報の注記、状態の表示を出す。段落は React のテキストとして描画する。
  - 値の形と文言は `lib/stocks/business-description.ts`（画面と API で共有）。
  - 読み出しは `fetchStockPage`（`queries.ts`）に `business_description_detail` を1つ足した。
- **API**: `GET /api/stocks/[code]` に `businessDescription` を足した。
- **取り込み状況**
  - 有報の区画にタイル「事業の内容を取得できた銘柄」（上場中の N 銘柄のうち M 銘柄、取り込み待ちの有報 K 件、記載なし・読み取れなかった数）を足した。区画の説明文も直した。
  - 手動の取り込みの説明文に「事業の内容」を加えた。
- **フィクスチャ**
  - 実データの抜粋: `__fixtures__/S100W7OT-business-description.htm`・`S100W4KN-…`・`S100W5PD-…`
  - 組み立ての関数: `synthetic.ts` の `businessDescriptionDocument` など
  - E2E の投入例: `e2e/fixtures/business-description-{example,new-fy,fill-pending,cleanup}.sql`
- **テスト**
  - 単体 `edinet/business-description.test.ts`（C6）
  - DB `stocks/business-description.db.test.ts`（C7）、`ingestion/edinet-business-description.db.test.ts`（C8）
  - E2E `e2e/business-description.spec.ts`（C1〜C5）
- `CLAUDE.md` に、「現状」と「事業の内容（Sprint 16。F16）」の節、`pnpm test:db` の接頭辞を追記した。

## 起動方法

- `pnpm db:reset && pnpm env:local && pnpm seed:users`
- `JQUANTS_API_KEY= EDINET_API_KEY= CRON_SECRET=local-cron-secret-0123456789 pnpm dev -p 3100`
  - 本番相当: `pnpm build && … pnpm start -p 3100`
- 投入例: `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f e2e/fixtures/business-description-example.sql`
- 確認する画面と API:
  - http://localhost:3100/stocks/9R001
  - http://localhost:3100/imports
  - http://localhost:3100/api/stocks/9R001
- 補足: 実装中は、別のセッションの `pnpm start -p 3100` が同じ作業ツリーで動いていた。そのため、開発中の確認は `pnpm dev -p 3200` で行った。最終の確認は、コミットを `git worktree` に取り出して行った（node_modules は `pnpm install --offline`、別の `.next`）。そこで `pnpm build` と `pnpm start -p 3300`、dev の `-p 3301` を動かした（「既知の問題」の3を参照）。

## 完了条件チェック

| 条件 | 状態 | 確認方法 |
|---|---|---|
| C1-1・C1-2 位置（直前に1つ、間にほかの section なし、下端 ≤ 条件の判定の上端） | ✅ | E2E。7銘柄（6つの状態と上場廃止）で DOM の兄弟と bounding box を確かめた |
| C1-3〜C1-5 状態の文言・書類ID・リンク・ラベルなし・社名や業種なし | ✅ | E2E（9R005〜9R009） |
| C1-6 上場廃止でも表示 | ✅ | E2E（9R012） |
| C2-1〜C2-3 段落の完全一致・ラベル・出典・大株主と同じ書類ID | ✅ | E2E（9R001）、スクリーンショットでも確認 |
| C2-4 長い段落（約 600 文字＋120 文字の英字）を切らない・375px／1280px で横スクロールなし | ✅ | E2E（`scrollHeight == clientHeight`、`scrollWidth − clientWidth ≤ 0`） |
| C2-5・C2-6 `<b>`・`&amp;`・`<script>` を文字のまま表示、dialog なし、`dangerouslySetInnerHTML` を使わない | ✅ | E2E。部品は `{row.paragraph}` のテキストで描画 |
| C3-1・C3-2 訂正に区画なし → 元の有報と注記、訂正に段落あり → 訂正 | ✅ | E2E（9R003・9R004）。注記の全文も比べた |
| C3-3 取り下げ → 元の有報 → 有報が未取得。不開示も同じ | ✅ | E2E（9R011）、DB（C7-7） |
| C3-4・C3-5 新しい事業年度の有報 → 段落と書類IDが変わる。行を消すと pending | ✅ | E2E |
| C4-1〜C4-5 API の形・画面と同じ状態・理由、未ログインは 401 | ✅ | E2E。intruder は既存のログインの経路で拒否される（Sprint 1） |
| C4-6 キーなしの EDINET の実行は「EDINET の API キーが設定されていません」で failed | ✅ | E2E |
| C5-1・C5-2 「上場中の 11 銘柄のうち 6 銘柄」・待ち 1 → 7 銘柄・待ち 0 | ✅ | E2E |
| C5-3 上場廃止を外すと 12 銘柄のうち 8 銘柄 | ✅ | E2E |
| C5-4（R3）上場廃止の書類は待ちに数えない | ✅ | E2E（上場廃止のままなら 0 件・7 銘柄、外すと 12 銘柄のうち 7 銘柄・1 件） |
| C5-5 既存のタイルの値は変わらない | ✅ | E2E（`annual_reports_summary` の既存のキー、上場中の大株主・役員の待ちの数と一致） |
| C6-1〜C6-17 抽出の規則 | ✅ | 単体テスト 22 件（実データ3通、AC16.2 の例、見出しの例「＜当社グループの事業＞」「【事業系統図】」、空行、表・図・alt、40／41 文字の境、br、文字参照、ix:exclude、4つの失敗の種類、軸付き・ほかのコンテキスト）。既存の annual-report・business-results・xbrl のテストは変更なしで通る |
| C7-1〜C7-9 選び方 | ✅ | DB テスト |
| C7-10 権限 | ✅ | DB テスト（許可・許可リスト外・anon・書き込み・保存の関数）と `e2e/db-privileges.spec.ts` |
| C7-11 性能 | ✅ | 下の実測値 |
| C8-1〜C8-7 取り込み・導入前の書類・2回目は0件・期限・訂正（R1） | ✅ | DB 込みの結合テスト。C8-1 は、大株主・役員の5つの表・期・指標・判定・内訳・補正・スクリーニングを、`processed_at`・`judged_at` を含めて実行の前後で比べた |
| C9-3 lint・typecheck・test・test:db・build | ✅ | 次のすべてが成功した。<br>・`pnpm lint`・`pnpm typecheck`<br>・`pnpm test`（56 ファイル・587 件）<br>・`pnpm test:db`（`db:reset` 直後に全件で 20 ファイル・276 件）<br>・`pnpm build`（コミットを取り出した worktree で実行） |
| C9-4 E2E | ✅ | 本番相当（worktree の `pnpm start -p 3300`、キーなし）で全件 **340 件すべて成功**（7.2 分）。dev（3301）では `stock-detail.spec.ts`・`business-description.spec.ts`・`ingestion-reliability.spec.ts`・`ownership-override.spec.ts` を流し、58 件が成功した。`ownership-override.spec.ts` の C5-1〜C5-4 の1件は dev でだけ落ちる。Sprint 16 の前のコミット（c5e7ebe）でも dev で同じように落ちることを確かめたので、このスプリントのリグレッションではない（既知の問題の6） |
| C9-6 コミット | ✅ | 第2章の10 の一時的なインデックスの方法（下記） |

### 性能の実測値（C7-11。4,000 銘柄・有報 6,000 通、authenticated）

| 関数 | 変更前 | 変更後 |
|---|---|---|
| `business_description_detail` | — | 2.5ms（上限 20ms） |
| `annual_reports_summary` | 約 40ms | 58〜65ms（上限 80ms ＝ 2 倍） |
| `edinet_ingestion_state` | 約 150ms | 167〜196ms（上限 300ms） |

- 変更前の値は、同じ規模の投入（事業の内容の行なし）で、マイグレーションの適用前に psql の `explain analyze` で測った。
- 投入の直後に `analyze` をしないと、計画が悪くなる（1.6 秒・2.5 秒）。性能のテストは投入の後に関係する表を `analyze` する。

### 既存のテストのアサーションの変更（C9-1）

| ファイル | 変更 | 種類 |
|---|---|---|
| `e2e/db-privileges.spec.ts` | 次の5点（前 → 後）<br>・authenticated が実行できる関数の一覧に `business_description_detail`・`business_description_sections_for` を追加<br>・`save_edinet_extractions(bigint,text,jsonb,jsonb)` → `(…,jsonb)`<br>・REST の拒否の一覧に、新しい2関数と `p_business_description` を追加<br>・authenticated が読めるテーブルの一覧に `business_description_extractions` を追加<br>・Sprint 8 の REST で読めないテーブルの一覧に同じテーブルを追加 | 1 |
| `src/lib/ingestion/ingestion-consistency.db.test.ts` 172 行 | `save_edinet_extractions($1, 'S12NDB01', null, $2::jsonb)` → `(…, null)`（5つ目の引数） | 2（保存の関数の呼び出し） |
| `src/lib/stocks/annual-reports.db.test.ts` 222 行 | `edinet_ingestion_state` の対象の期待のオブジェクトに `needsBusinessDescription: true` を追加 | 2 に準ずる（取り込みの対象の形）。想定外のファイルだったので、ここに記す |

ほかの期待値は変えていない。既存の EDINET の取り込みの結合テスト（`edinet-reports.db.test.ts`・`edinet-business-results.db.test.ts`）は、変更なしで通った。

## 実データで確かめた点・確かめられなかった点

- **取得した実データ**: 閲覧サイト（`WZEK0040.aspx?<書類ID>,,`）を headless の Chromium（Playwright）で開き、`mokujiclick` で「第1 企業の概況」の章（`0101010_honbun_…_ixbrl.htm`）の iframe から、キー無しで取得した。対象は S100W7OT（ニップン）・S100W4KN・S100W5PD。
  - 要素は `jpcrp_cor:DescriptionOfBusinessTextBlock`、`contextref="FilingDateInstant"`、`escape="true"` だった（想定どおり）。
  - 区画の見出し（`<h3>３【事業の内容】</h3>`。S100W4KN は「３&nbsp;【事業の内容】」）はテキストブロックの中にあり、見出しの規則で飛ばされる。
  - 段落は `<p>` で、字下げは全角空白ではなく CSS の `text-indent` だった。空の段落は `<p>&nbsp;</p>`、S100W4KN・S100W5PD の先頭は改ページの `<p>&nbsp;</p>`。
  - S100W7OT の末尾には事業系統図の `<img>`（alt「0101010_001.png」）、S100W5PD には表と画像がある。
  - 3通とも、1つの `<p>` の中にソースの改行は無かった。そのため、「和文の途中のソースの改行が半角空白になる」形は実データでは見つからなかった（改善提案への回答）。
- **抽出の結果**（閲覧サイトの表示と同じ文字）:
  - S100W7OT: 「当社グループ（当社及び当社の関係会社）は、当社（株式会社ニップン）及び子会社58社、関連会社20社で構成されております。」
  - S100W4KN: 「当社グループは、当社及び連結子会社13社により構成されており、…等の事業を行っております。」（154 文字）
  - S100W5PD: 「当社の事業内容は次のとおりであります。なお、当社は単一セグメントであるため、サービス別に記載しております。」（「次のとおりであります。」を含む段落をそのまま採る例）
- **確かめられなかったこと**
  - ZIP（書類取得 API）の実物（キーなし）。ZIP の中のファイル名・章の分かれ方は、Sprint 8 と同じ前提にした。
  - 訂正有報の実物の事業の内容（区画の有無）。`synthetic.ts` で組み立てた。
  - 実データで最も長い段落の長さ。3通では S100W4KN の 154 文字が最大で、20,000 の上限に対して十分に短い。
  - キーありの環境の件数（約 20 回の初回の所要）。見積もりのまま。

## 既知の問題・未実装

1. **読み込み中の骨組み**: `src/components/stocks/stock-detail-skeleton.tsx` は、別のセッションの未コミット（未追跡）のファイルなので触れていない（契約の第2章の6）。骨組みに事業の内容の枠が無いので、読み込みが終わると「条件の判定」が事業の内容の高さの分だけ下にずれる。
2. **取り込み状況のタイルの値の折り返し**: 「上場中の 11 銘柄のうち 6 銘柄」は長いので、3列の幅では値が2行に折り返す（スクリーンショットで確認。「のうち」と「6 銘柄」の間で折れる）。読めるが、ほかのタイルより背が高い。
3. **作業ツリーとローカルの DB をほかのセッションと共有していた**。
   - 別のセッションの `pnpm start -p 3100` が、同じ作業ツリーの `.next` を使って動いていた。そのため、作業ツリーで `pnpm build` は実行せず、コミットを取り出した worktree で build・本番相当の E2E を行った。
   - 1回目の本番相当の全件の E2E は、途中でほかのセッションが `pnpm db:reset` と E2E を実行したので、DB が作り直されて連鎖して失敗した（`relation "public.screening_presets" does not exist`）。そのセッションの実行が終わってから流し直し、340 件すべて成功した。
   - 作業ツリーの dev（3200）での全件の E2E では、キーボード・ホバーの操作の5件が落ちた（dev の初回のコンパイルの遅さと、ほかのセッションの未コミットの Suspense の変更を含む状態）。コミットの状態の本番相当では、すべて成功している。
4. **`pnpm test:db` の全件の実行の1回目**: `ownership.db.test.ts` の性能のテストが 64 秒かかり、afterAll（10 秒）が時間切れになった。後片付けされない行が残り、後続のファイルが「テスト以外の銘柄がある」で連鎖して落ちた。
   - 同じファイルを単独で流しても、`ingestion` と一緒に流しても、17 秒で通った。
   - その後の全件の実行（2回）では、どちらも時間切れにならなかった（最後の実行は 276 件すべて成功）。
   - ほかのセッションの処理と重なった一時的な負荷によるものとみているが、原因は特定していない。
5. 有価証券届出書の事業の内容は読まない（契約の第8章）。
6. dev のサーバーでは、`e2e/ownership-override.spec.ts` の「訂正有報で自動判定が変わると知らせ…（C5-1〜C5-4）」が、スクリーニングの判定のポップオーバーの `owner-override-auto-changed-hint` を見つけられずに落ちる。
   - Sprint 16 の前のコミット（c5e7ebe）でも、dev で同じように落ちる。
   - 本番相当では成功する。
   - このスプリントの変更とは関係が無いので、直していない。

## エバリュエーターに重点的に見てほしい点

- 実データの3通で、「最初の段落」が閲覧サイトの表示と一致するか（単体テストの期待値。閲覧サイトで見比べられる）。
- 導入前に処理済みの有報を取り込んでも、ほかの値が変わらないこと（C8-1）。テストは、`processed_at`・`judged_at` を含む行全体を比べている。
- 新しい訂正が未処理のときは「取り込み待ち」になり、元の有報の段落を出さない（第2章の3。Sprint 8 の表示と同じ規則）。この判断が妥当か。
- コミットの範囲。別のセッションのスケルトン・rename・`CLAUDE.md` の該当の部分が含まれず、作業ツリーに残っていること。
