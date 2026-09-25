# Sprint 10 自己評価（ラウンド 1）

## 実装内容

F9（条件④のオーナー企業／社長筆頭株主の自動判定、保有状態の内訳、スクリーニングへの統合）。契約は改訂1（ユーザーの決定を反映したもの）。

### DB（マイグレーション）

- `supabase/migrations/20261003000000_surname_readings.sql`（生成物。手で編集しない）
  - 姓の読みの辞書 `surname_readings`: 1,396 姓・1,432 読み。ローマ字はヘボン式の3つの形。
  - 元データは `scripts/data/surname-readings.txt`、生成は `scripts/generate-surname-readings.ts`、ローマ字は `src/lib/ownership/romaji.ts`。
- `supabase/migrations/20261003000001_ownership_judgments.sql`
  - 正規化の関数:
    - `ownership_name_key`、`ownership_title_key`（除く語を含む）
    - `ownership_corporate_text`（常任代理人の括弧を除く）
    - `ownership_is_corporate`、`ownership_is_excluded_corporate`
    - `ownership_name_parts`、`ownership_surname_of`
  - 純粋な関数 `ownership_judgment_from_sections(shareholders, officers)`（language sql の1つの問い合わせ）。
  - 書類の選び方を、銘柄で絞れる関数にした。
    - `annual_report_candidates_for(codes)`・`annual_report_sections_for(codes)` を加えた。
    - 既存のビュー `annual_report_candidates`・`annual_report_sections` はこれを読むだけにした。
    - `annual_report_detail(code)` は1銘柄だけを計算する（Sprint 8 の m5）。
  - 保存 `recalculate_ownership_judgments(codes)`:
    - 1つの文で判定し、`ownership_judgments`（拡張）と `ownership_holder_classifications`（新規）に保存する。
    - 取り込み待ちの区画は、処理済みの直前の有報で判定する（ユーザーの決定）。
  - トリガー（文単位）: 抽出・大株主・役員の insert・update・delete、書類の insert・update・delete、銘柄の insert。
  - 条件④を加えた関数:
    - `screening_evaluate`（`s_owner`・`owner_result`）
    - `screen_stocks`（`includeUndeterminable`、`excludedUndeterminable`、`sort=owner`、行の `ownership`、`ownershipDeterminedCount`）
    - `stock_detail`（`status.owner`・`ownerResult`・`ownership` の明細と書類）
    - `ownership_summary(code, result)`
  - `annual_reports_summary()` に `ownership` を加えた。
  - 権限を付けた。導入時に、既存の有報の銘柄を判定する。

### アプリ

- `src/lib/ownership/display.ts`
  - 値の形（zod）と表示の文言を1か所にまとめた。
  - 文言: 区分名、判定結果のラベル、理由の文、判定不能の理由、社長の特定の根拠の注記、推定の注記。
  - 比率の切り捨て1桁 `formatTruncPct`。
- `src/lib/screening/params.ts`:
  - パラメータ `owner`・`ownermode`・`undeterminable` を加え、`off` と `sort` に `owner` を加えた。
  - 正規形の順を変え、`toScreenStocksParams`・`toApiConditions` を広げた。
- `src/lib/screening/result.ts`・`src/lib/stocks/detail.ts`:
  - 応答の形を広げた。
  - `describeInclusion` に、条件④が判定不能のときの文言を加えた。
- スクリーニングの画面:
  - `condition-panel.tsx`: 条件④の区画（自動判定のラベル、モード、閾値、判定不能を含める）。
  - `threshold-field.tsx`: 入力だけの無効、見出しの横の部品、モードの差し込み。
  - `results-table.tsx`: 条件④と保有状態の2列。市場区分と業種は1列に2段。④の印。
  - `owner-cells.tsx`: 判定のセルと要約のセル。
  - `hover-popover.tsx`: ホバー・クリックで開くポップオーバーを共通化。
  - `screening-view.tsx`: 除外の件数、判定が無いときの注記、狭い画面の要約。
  - `status-mark.tsx`: 条件④の印と、判定不能のラベル。
- 銘柄詳細:
  - `ownership-sections.tsx`: 「条件④ 判定根拠」と「保有状態の内訳」。
  - `stock-evaluation.tsx`: 条件④の行と判定根拠へのリンク。狭い画面では行を折り返す。
  - `ownership-bar.tsx`: 積み上げバー、凡例、「推定」「自動判定」のラベル。
  - 色は `globals.css` の `owner-*` トークン。
- 取り込み状況: 有報の区画に「条件④を判定できた銘柄」と、判定不能の理由ごとの数を出した。
- 幅: スクリーニングの画面だけ `max-w-7xl` にし、ヘッダーとフッターもそろえた（`data-layout="wide"` と `has-[]` で判定）。1280×800 で表を横スクロールさせないため。

### 改善提案への対応

| 提案 | 対応 |
|---|---|
| Sprint 9 の m1 | 財務指標の説明の文言を直した |
| Sprint 9 の m2 | 書類の列を `whitespace-nowrap` にした |
| Sprint 9 の m3 | 「補完」の印の `title` を外し、共通のポップオーバーにした |
| Sprint 9 の m5 | 「銘柄コードで確認」の表の見出しを「出典（売上高・営業利益）」にした |
| Sprint 8 の m1 | 375px では所有株式数を氏名の下に移し、持株比率が横スクロールせずに見えるようにした |
| Sprint 8 の m5 | `annual_report_detail` を銘柄で絞った計算にした（上の「DB」） |

### テスト

- `src/lib/ownership/ownership.db.test.ts`（31件）。確かめている内容:
  - 第5章の期待値、スクリーニングの件数・並び、ダッシュボードと取り込み状況の数
  - 判定ロジック: 空白・全角半角、異体字 23 組、社長が複数、社長の特定、姓、区分の優先、法人と除く語、常任代理人、證券、新井とアライアンス、同率、合計、辞書
  - 判定不能の理由の順番
  - 再計算のトリガー: C5-1〜C5-11、訂正有報が取り込み待ちのとき
  - 実データ（S100W7OT・S100W4KN・S100W5PD）
  - 権限、性能
- `e2e/ownership.spec.ts`（17件）: C1〜C5・C7・C8-4・C9-2・C10。
- `src/lib/ownership/display.test.ts`（11件）: 比率の切り捨て、文言、ローマ字の生成。
- 既存テストの変更: 第「既存テストの変更」節を参照。

## 起動方法

```bash
cd /Users/shuriokamoto/dev/quantis-light
pnpm install && pnpm db:start && pnpm db:reset && pnpm env:local && pnpm seed:users
JQUANTS_API_KEY= EDINET_API_KEY= CRON_SECRET=local-cron-secret-0123456789 pnpm dev -p 3100
# 本番相当: pnpm build && JQUANTS_API_KEY= EDINET_API_KEY= CRON_SECRET=local-cron-secret-0123456789 pnpm start -p 3100
# 投入例: psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f e2e/fixtures/ownership-example.sql
```

- 主な画面: http://localhost:3100/screening 、http://localhost:3100/stocks/9U006
- E2E: `E2E_PORT=3100 E2E_CRON_SECRET=local-cron-secret-0123456789 pnpm test:e2e`

## 完了条件チェック

| 条件 | 状態 | 確認方法 |
|---|---|---|
| C1-1〜C1-5 4つの結果・根拠・API | ✅ | E2E（ownership.spec の C1）。psql で第5章の表どおりの状態・合計・筆頭株主を確かめた（test:db にもある） |
| C1-6 DB と一致 | ✅ | test:db（第5章の期待値） |
| C1-7 取り込み待ちの間は直前の有報 | ✅ | E2E・test:db（9U014: SXTEST14 で判定、`pending_doc_id` SXTEST15、Sprint 8 の区画は取り込み待ちのまま、一覧に出る） |
| C2-1〜C2-7 既定の4条件・閾値・スライダー・モード・判定不能・オフ・戻る／進む | ✅ | E2E（既定7件・40で5件・30で6件・president 5件・include 10件・オフ12件・`unavailable=include` だけでは判定不能は出ない） |
| C2-8 API の件数と 400 | ✅ | E2E（6種の不正な値がすべて 400 `invalid_params`） |
| C2-9 詳細への遷移・戻り先・`owner=40` で含まれない | ✅ | E2E |
| C3-1〜C3-4 列・ポップオーバー・クリック／Enter で詳細へ移らない・0.0%・内訳なし | ✅ | E2E。スクリーンショットで見た目も確かめた |
| C3-5 並べ替え（判定不能は最後） | ✅ | E2E・test:db |
| C3-6 バーの幅と aria-label | ✅ | E2E（12:5 と 18:9 の比、aria-label に 35.0%） |
| C3-7 1280 で横スクロールなし、375 でポップオーバーが画面の中 | ✅ | E2E。各セルの中身が隣の列にはみ出さないことも確かめている |
| C3-8 API の `ownership` と `status.owner` | ✅ | E2E |
| C4-1〜C4-10 判定根拠・区分別の合計・明細・推定・異体字・社長2名・代表者・姓・④の行・375px | ✅ | E2E。375px のダークのスクリーンショットも確かめた |
| C5-1〜C5-11 トリガー | ✅ | test:db（全件）、E2E（C5-1・C5-2・C5-5・C5-9・C5-10） |
| C6-1〜C6-13 判定ロジックの自動テスト | ✅ | test:db（純粋な関数を実際の DB で呼ぶ）、test（`params`・`detail` など） |
| C7-1〜C7-3 ダッシュボード 11/14・取り込み状況・データなしの注記 | ✅ | E2E・test:db |
| C8-1 公開キー | ✅ | db-privileges.spec（REST の rpc の拒否に4関数を追加） |
| C8-2 許可リスト外 | ✅ | test:db |
| C8-3 権限の検査 | ✅ | db-privileges.spec を更新し、条件④の関数が service_role だけであることを確かめる検査を加えた（下の「権限の判断」） |
| C8-4 401・403・no-store | ✅ | E2E |
| C9-1 コントラスト | ✅ | 計算で確かめた（下の「コントラスト」）。スクリーンショットはライトとダーク |
| C9-2 時計のずれ | ✅ | E2E |
| C9-3 外部 API を呼ばない | ✅ | `src/lib/ownership`・`screening`・`stocks` は `lib/ingestion` を import しない（アプリ本体。テストは実データのフィクスチャを読むために import する） |
| C9-4 コンソールのエラー | ✅ | E2E の `collectPageProblems`、スクリーンショットのスクリプトでも0件 |
| C10-1〜C10-6 改善提案 | ✅ | E2E（C10-1〜C10-5）、test:db（C10-6 は性能） |
| C11 性能 | ✅ | 下の「性能」 |
| C12-1 既存テストの変更 | ✅ | 下の「既存テストの変更」 |
| C12-2 リグレッション | ✅ | E2E の全件（dev・prod）と test:db の全件 |
| C12-3 lint・typecheck・test・test:db・build | ✅ | すべて成功（下の「テストの結果」） |
| C12-4 E2E | ✅ | 下の「テストの結果」 |
| C12-5 後片付け | ✅ | test:db の afterAll で、9U・Q の判定・明細・銘柄が0件になることを確かめる。E2E の後も DB は0件 |
| C12-6 ダミーデータなし | ✅ | 判定の値は DB の行だけから作る。辞書は参照データ（マイグレーション） |
| C12-7 判定の式は DB だけ | ✅ | TypeScript には表示の文言だけ |
| C12-8 コミット | ✅ | `sprint-10: 条件④の自動判定と保有状態の内訳`。`sprint-09/evaluation-1.md` を含める |
| C12-9 CLAUDE.md | ✅ | 現状を Sprint 10 に更新し、条件④の節とテストの接頭辞を追記した |
| C12-10 実データの確認 | ✅ | 下の「実データの確認」 |

### テストの結果

| 対象 | 結果 |
|---|---|
| `pnpm lint`・`pnpm typecheck` | 成功 |
| `pnpm test` | 494 件成功（`lib/ownership/display.test.ts` の11件を含む） |
| `pnpm test:db` | 179 件成功（うち条件④が31件） |
| `pnpm build` | 成功 |
| E2E（dev。キーなし・3100 番） | 221 件すべて成功（6.5 分） |
| E2E（prod。`pnpm start -p 3100`） | 221 件すべて成功（5.8 分） |

- prod で2回目に回した全件は、1件（stock-detail の修飾キーのクリック）がタイムアウトした。
  - その回は全体に 1.9 時間かかっていた（途中で環境が止まっていたとみられる）。
  - 同じファイルを流し直すと成功した。
  - 最終のビルド（列の幅の調整の後）で回し直した全件は、221 件すべて成功（4.2 分）。

### 性能

条件は 4,000 銘柄・有報 6,000 通・大株主と役員が各10名。

| 項目 | 実測 | 検査の基準 |
|---|---|---|
| 全件の再計算 | 約 4.2 秒 | 10 秒 |
| 1銘柄の再計算 | 約 7ms | 50ms |
| 1通の取り下げ（トリガー込み） | 約 7ms | 50ms |
| `annual_report_detail` | 約 3.5ms（Sprint 8 は約 20ms） | 10ms |
| `screen_stocks`（オーナー系合計の順） | 約 27ms | 100ms |

`ownership.db.test.ts` が、これらを基準の値の以内で検査する。

- 最初の実装は、純粋な関数が plpgsql で、株主ごとに問い合わせていた。全件で 27 秒かかった。
- 次の2つで 4.2 秒にした。
  - 1つの問い合わせにし、名前の正規化を株主・役員ごとに1回にした。
  - 小さな正規化の関数を展開できるようにした（`set search_path` を付けない）。

### 実データの確認（C12-10）

- **S100W7OT**: 役員の氏名は、すべて姓と名の間に全角空白がある。
  - 社長候補は前鶴 俊哉の1名だけになる。木村 富雄（「代表取締役 専務執行役員 社長補佐」）は社長にならない（R1）。
  - 大株主は、持株会・信託口・銀行・保険・事業会社だけ。判定は非該当（オーナー系 0.0%）。
- **S100W4KN**: 役員「宗政　　寛」（全角空白2つ）と、大株主「宗政　寛」が一致する。姓は「宗政」（S5）。
  - オーナー系合計は 13.5%。筆頭株主は株式会社バイオンで、判定は非該当（閾値 20%）。
  - 「取締役 副社長執行役員」は社長にならない。
- **S100W5PD**: 社長は平尾 泰文。
  - 「ＮＯＭＵＲＡ … （常任代理人野村證券株式会社）」と「ＭＳＩＰ ＣＬＩＥＮＴ ＳＥＣＵＲＩＴＩＥＳ （常任代理人 …）」は、括弧の外の NOMINEES・SECURITIES で法人のまま（区分5）。
- 3通とも、1文字ずつ空白で区切った役員の氏名（S2）は無かった。
- 上の内容は、`ownership.db.test.ts` の「実データの形」の4件で、Sprint 8 の抽出の関数を実際に通して確かめている。

### コントラスト（C9-1）

oklch から相対輝度を計算した。

| 対象 | ライト | ダーク | 基準 |
|---|---|---|---|
| バーの区分（背景のカードに対して） | 社長 6.05、役員 6.10、親族 4.10、資産管理会社 5.98、以外 3.64 | 9.17、7.01、9.23、7.16、3.61 | 非テキスト 3:1 |
| 「推定」のラベル（caution-strong / caution-muted） | 6.26 | 9.22 | 4.5:1 |
| 「自動判定」のラベル（info-strong / info-muted） | 7.28 | 9.21 | 4.5:1 |
| 補足の文字（muted-foreground） | 5.99 | 6.56 | 4.5:1 |

区分どうしの境は1px の隙間（カードの色）で区切り、各区分が背景に対して 3:1 を満たすようにした（隣り合う色どうしの 3:1 は、5色では満たせないため）。

## 権限の判断（C8-3）

authenticated に実行権限を与えた関数は、次の3つだけ（どれも security invoker で、RLS が効く）。

| 関数 | 理由 |
|---|---|
| `annual_report_candidates_for` | ビュー `annual_report_candidates` の本体。authenticated がビューを読むのに必要 |
| `annual_report_sections_for` | ビュー `annual_report_sections` の本体。同上 |
| `ownership_summary` | `screen_stocks`・`stock_detail`（security invoker）の中から呼ぶ |

- 正規化・分類・保存・トリガーの関数は、service_role だけ。
- `surname_readings` は参照データだが、市場データと同じく、許可ユーザーの select だけにした。

## 既存テストの変更（C12-1）

契約の5種類で済んだものが大半。**5種類に当たらない変更が3つあり、契約の修正として報告する**（下の「想定外の変更」）。行ごとの一覧は末尾の付録にある。

1. **種類1（`off=owner` を足す）**
   - `e2e/screening.spec.ts`・`e2e/stock-detail.spec.ts`・`e2e/screening-detail-race.spec.ts`・`e2e/business-results.spec.ts` の、URL の文字列と API の要求に `off=owner` を足した。
     - 足したのは、有報の無い投入例（9999x・9Y・9V）の銘柄を使う箇所だけ。
     - 既存の `off` があれば `off=…,owner` にした。
   - ナビゲーションから開くテスト（screening.spec の C1・C6-6、stock-detail.spec の C1）は、URL を付けられない。そのため、画面の条件④のスイッチでオフにしてから確かめる。
   - `src/lib/screening/screening.db.test.ts`・`src/lib/stocks/stock-detail.db.test.ts` は、URL を作る補助の関数で `off` に `owner` を足した。性能の場合分けの `allOff` に `ownerOn: false` を足した。
   - 状態の比較は①〜③だけにした（④が `off` であることは確かめる）。全部オフの行は `owner: "off"` を加えた。
2. **種類2（正規形）**
   - 期待する URL・`href`・定数（`DEFAULT_QUERY`・`Q15`・`Q14`）に `owner=20&ownermode=any` を入れた。
   - 「既定の条件に戻す」の後の URL は `off=owner` の無い既定の正規形にした。
   - `src/lib/screening/params.test.ts`・`navigation-href.test.ts`・`src/lib/stocks/detail.test.ts` の正規形の期待値も同じ。
   - `params.test.ts` の「有効な値を読む」の期待値に、`owner`・`ownerMode`・`includeUndeterminable` の既定値を加えた。
3. **種類3（印と列）**: 条件の印の正規表現・状態の比較に④を加えた。
4. **種類4（ダッシュボード）**
   - `e2e/dashboard.spec.ts` の `ownership_judgments` への直接の insert を、有報の投入（SDASH01 は社長が筆頭株主、SDASH02 は大株主の抽出失敗）に置き換えた。期待値「1 / 3 銘柄（33.3%）」は変えていない。
   - `e2e/support.ts` の `cleanupDashboardData` に、SDASH の書類の削除を加えた。
5. **種類5（API の形）**
   - `src/app/api/stocks/[code]/route.test.ts` の模擬の DB の応答に `status.owner`・`ownerResult`・`ownership` を加えた。
   - 期待する `conditions` に `owner`・`ownermode`・`undeterminable` を加えた。

### 想定外の変更（契約の修正として報告する）

- **A. `e2e/edinet.spec.ts` の Sprint 8 の C8-2（375px）**
  - 変更前は「大株主の表が枠からはみ出して横スクロールする（scrollWidth > clientWidth）」ことを確かめていた。
  - これは、この契約の C10-5（Sprint 8 の m1: 持株比率が横スクロールせずに見える）と両立しない。
  - そこで、次の2点を確かめる形に置き換えた。
    - 枠は引き続き `overflow-x: auto`。
    - 持株比率のセルが 375px の中にある。
- **B. `e2e/stock-detail.spec.ts` の C4-1「既定の条件」（14銘柄の状態）**
  - 既定の条件では条件④がオンなので、有報の無い投入例はどれも判定不能で、結果に含まれなくなる。
  - ①〜③の既定の判定を確かめる意図を保つため、`?off=owner` を付けた（種類1）。
  - その結果、判定の出どころの表示が「既定の条件」から「スクリーニングの条件で判定しています」に変わる。この期待値も変えた。
- **C. `e2e/stock-detail.spec.ts` の API（C8）の既定の条件の `evaluation`**
  - `off=owner` を付けずに、既定の条件のまま確かめる形に残した。
  - 期待値を次のとおりに変えた。
    - `status.owner: "unavailable"`
    - `ownerResult: "undeterminable"`
    - `included: false`（変更前は true）
  - あわせて、`?off=owner` で `included: true` になることを加えた。
  - 既定の条件の意味が変わった（仕様どおり）ことを、そのまま確かめるため。

## 既知の問題・未実装

- **姓の読みの辞書の正確さ**
  - 1,396 姓の読みは、名字のランキング（名字由来net・日本の苗字七千傑）の上位を参考に、知っている一般的な読みを書いた。1件ずつ出典と照合してはいない。
  - 主な14姓は test:db で固定している。
  - 読みが抜けている姓は、カタカナ・ローマ字の法人名と照合されない（誤って推定するのではなく、推定しない）。
- **既知の制限**（CLAUDE.md に記載）: 外来語との誤一致（新井／アライアンス）。代表者による補いでは、会長・副社長も社長候補になる。旧姓・婚姻による姓の違いは見ない。取り込み待ちの間は、1つ前の事業年度で判定することがある。
- **一覧の積み上げバーの幅**: 1280px で10列を横スクロールなしに収めるため、バーは幅 40px の小さな表示にした。内訳はポップオーバーと詳細で確かめる。
- **レイアウトの変更**
  - スクリーニングの画面だけ、ヘッダー・本文・フッターの最大幅が `max-w-6xl` → `max-w-7xl` に広がる（1280px では左右の余白が小さくなる）。
  - 市場区分と業種は1つの列に2段で並べた（並べ替えのボタンは2つのまま、テストIDも同じ）。
- **テストの実行時間**: E2E の dev サーバーは、長く動かすと Next.js のメモリの閾値で再起動する（ログに "approaching the used memory threshold, restarting"）。その瞬間の `page.goto` が1回タイムアウトしたことがある（再実行で成功）。
- **`ownership_name_key` などに `set search_path` が無い**
  - 性能のためで、Supabase の advisor が警告する可能性がある。
  - 中で使うのは組み込みの関数だけ（normalize・translate・regexp_replace・upper）。pg_catalog は常に先に探されるので、置き換えられる心配は小さいと判断した。

## エバリュエーターに重点的に見てほしい点

- 社長の特定と区分の規則が、実データの表記で妥当か。特に、除く語、代表者による補い、読み・ローマ字の照合。
- 取り込み待ちの訂正有報（130）のケース。元の有報が処理済みなら、元の有報で判定する（test:db に「取り込み待ちの書類が訂正有報のとき」を入れた）。
- 1280×800 の一覧の列の配分と、375px の詳細の内訳の表の読みやすさ。
- 既存テストの変更の一覧（付録）と、想定外の変更 A〜C の妥当性。

## 付録: 既存テストの変更の一覧（git diff から生成）

「⏎」は改行。長い行は 300 文字で切っている。

| ファイル | 行（変更後） | 変更前 | 変更後 |
|---|---|---|---|
| e2e/business-results.spec.ts | 136 | `await page.goto("/screening?cagr=40&margin=10&years=5");` | `await page.goto("/screening?cagr=40&margin=10&years=5&off=owner");` |
| e2e/business-results.spec.ts | 175 | `await page.goto("/screening?cagr=45&margin=10&years=5");` | `await page.goto("/screening?cagr=45&margin=10&years=5&off=owner");` |
| e2e/business-results.spec.ts | 183 | `await page.goto("/screening?cagr=20&margin=10&years=5");` | `await page.goto("/screening?cagr=20&margin=10&years=5&off=owner");` |
| e2e/business-results.spec.ts | 187 | `await page.goto("/screening?cagr=20&margin=10&years=5&unavailable=include");` | `await page.goto("/screening?cagr=20&margin=10&years=5&unavailable=include&off=owner");` |
| e2e/business-results.spec.ts | 191 | `const api = await (await page.request.get("/api/screening?cagr=40&margin=10&years=5")).json();` | `const api = await (await page.request.get("/api/screening?cagr=40&margin=10&years=5&off=owner")).json();` |
| e2e/business-results.spec.ts | 199 | `const api20 = await (await page.request.get("/api/screening?cagr=20&margin=10&years=5")).json();` | `const api20 = await (await page.request.get("/api/screening?cagr=20&margin=10&years=5&off=owner")).json();` |
| e2e/business-results.spec.ts | 208 | `await page.goto("/screening?cagr=40&margin=10&years=5");` | `await page.goto("/screening?cagr=40&margin=10&years=5&off=owner");` |
| e2e/business-results.spec.ts | 448 | `await page.goto("/screening?cagr=40&margin=10&years=5");` | `await page.goto("/screening?cagr=40&margin=10&years=5&off=owner");` |
| e2e/business-results.spec.ts | 454 | `for (const path of ["/api/stocks/9V001", "/api/screening?cagr=40&margin=10&years=5", "/api/financials?code=9V001"]) {` | `for (const path of ["/api/stocks/9V001", "/api/screening?cagr=40&margin=10&years=5&off=owner", "/api/financials?code=9V001"]) {` |
| e2e/business-results.spec.ts | 462 | `for (const path of ["/stocks/9V001", "/screening?cagr=40&margin=10&years=5", "/imports"]) {` | `for (const path of ["/stocks/9V001", "/screening?cagr=40&margin=10&years=5&off=owner", "/imports"]) {` |
| e2e/dashboard.spec.ts | 58 | `await sql(`insert into public.ownership_judgments (code, status) values ⏎ ('99901', 'determined'), ('99902', 'undeterminable')`);` | `// Sprint 10: 条件④の判定は有報の抽出結果からトリガーで保存される（直接は書かない。契約の C12-1 の種類4）。 ⏎ // 99901 は判定できる（社長が筆頭株主）、99902 は大株主を抽出できず判定不能 ⏎ await sql(`insert into public.edinet_documents (doc_id, sec_code, edinet_code, doc_type_code, ordinance_code, form_code, period_end, submitted_at, xbrl_available, list_date) ⏎ values (` |
| e2e/edinet.spec.ts | 381 | `expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth && getComputedStyle(el).overflowX === "auto")).toBe(true);` | `// Sprint 10（Sprint 8 評価の m1。契約の C10-5）: 狭い画面では所有株式数を氏名の下に移し、表は枠に収まる（持株比率が横スクロールせずに見える）。 ⏎ // 枠は引き続き横スクロールできる（overflow-x: auto）。以前の「表が枠からはみ出す」確認は、m1 の修正と両立しないので置き換えた ⏎ expect(await scroller.evaluate((el) => getComputedStyle(el).overflowX)).toBe("auto"); ⏎ for (const ratio of await section(page).getB` |
| e2e/screening-detail-race.spec.ts | 16 | `const Q15 = "cagr=15&margin=10&years=5&sort=cagr&order=desc"; ⏎ const Q14 = "cagr=14&margin=10&years=5&sort=cagr&order=desc";` | `const Q15 = "cagr=15&margin=10&years=5&owner=20&ownermode=any&off=owner&sort=cagr&order=desc"; ⏎ const Q14 = "cagr=14&margin=10&years=5&owner=20&ownermode=any&off=owner&sort=cagr&order=desc";` |
| e2e/screening.spec.ts | 59 | ` ⏎ await expectCodes(page, ["99991", "99990"]); ⏎ await expect(page.getByTestId("result-summary")).toContainText("該当 2 件（銘柄マスタ 10 銘柄中）");` | （削除） |
| e2e/screening.spec.ts | 64 | （追加） | `// Sprint 10: 既定では条件④もオン。有報の無いこの投入例の銘柄は判定不能で除かれるので、条件④をオフにして①〜③を確かめる（契約の C12-1 の種類1） ⏎ await expect(toggle(page, "条件④ オーナー企業／社長が筆頭株主 を使う")).toBeChecked(); ⏎ await toggle(page, "条件④ オーナー企業／社長が筆頭株主 を使う").click(); ⏎ await expect(page).toHaveURL(/off=owner/); ⏎ await expectCodes(page, ["99991", "99990"]` |
| e2e/screening.spec.ts | 95 | `await page.goto("/screening");` | `await page.goto("/screening?off=owner");` |
| e2e/screening.spec.ts | 103 | `await expect(page).toHaveURL("/screening?cagr=20&margin=10&years=5&sort=cagr&order=desc");` | `await expect(page).toHaveURL("/screening?cagr=20&margin=10&years=5&owner=20&ownermode=any&off=owner&sort=cagr&order=desc");` |
| e2e/screening.spec.ts | 111 | `await page.goto("/screening");` | `await page.goto("/screening?off=owner");` |
| e2e/screening.spec.ts | 124 | `await page.goto("/screening?cagr=20&margin=10&years=5&sort=cagr&order=desc");` | `await page.goto("/screening?cagr=20&margin=10&years=5&owner=20&ownermode=any&off=owner&sort=cagr&order=desc");` |
| e2e/screening.spec.ts | 155 | `await page.goto("/screening");` | `await page.goto("/screening?off=owner");` |
| e2e/screening.spec.ts | 157 | `await expect(page).toHaveURL(/[?&]off=margin(&\|$)/);` | `await expect(page).toHaveURL(/[?&]off=margin,owner(&\|$)/);` |
| e2e/screening.spec.ts | 169 | `await expect(page).toHaveURL(/[?&]off=years(&\|$)/);` | `await expect(page).toHaveURL(/[?&]off=years,owner(&\|$)/);` |
| e2e/screening.spec.ts | 177 | `await expect(page).toHaveURL(/[?&]off=cagr,margin,years(&\|$)/);` | `await expect(page).toHaveURL(/[?&]off=cagr,margin,years,owner(&\|$)/);` |
| e2e/screening.spec.ts | 190 | `await page.goto("/screening");` | `await page.goto("/screening?off=owner");` |
| e2e/screening.spec.ts | 221 | `await page.goto("/screening?off=cagr,margin,years&unavailable=include");` | `await page.goto("/screening?off=cagr,margin,years,owner&unavailable=include");` |
| e2e/screening.spec.ts | 246 | `const URL_WITH_CONDITIONS = "/screening?cagr=15&margin=10&years=8&unavailable=include&market=0113&sort=years&order=asc";` | `const URL_WITH_CONDITIONS = "/screening?cagr=15&margin=10&years=8&owner=20&ownermode=any&off=owner&unavailable=include&market=0113&sort=years&order=asc";` |
| e2e/screening.spec.ts | 290 | `const res = await page.goto(`/screening?${query}`);` | `// Sprint 10: 条件④をオフにして①〜③を確かめる（契約の C12-1 の種類1） ⏎ const res = await page.goto(`/screening?${query}${query.startsWith("off=") ? ",owner" : "&off=owner"}`);` |
| e2e/screening.spec.ts | 297 | `await page.goto("/screening?market=0111,9999");` | `await page.goto("/screening?market=0111,9999&off=owner");` |
| e2e/screening.spec.ts | 302 | `await page.goto("/screening?off=margin,foo");` | `await page.goto("/screening?off=margin,foo,owner");` |
| e2e/screening.spec.ts | 306 | `await page.goto("/screening?foo=1&unavailable=exclude&market=0111,0111&cagr=020.0");` | `await page.goto("/screening?foo=1&unavailable=exclude&market=0111,0111&cagr=020.0&off=owner");` |
| e2e/screening.spec.ts | 310 | `await expect(page).toHaveURL("/screening?cagr=20&margin=10&years=5&market=0111&sort=code&order=asc");` | `await expect(page).toHaveURL("/screening?cagr=20&margin=10&years=5&owner=20&ownermode=any&off=owner&market=0111&sort=code&order=asc");` |
| e2e/screening.spec.ts | 312 | `await page.goto("/screening?sector=0050");` | `await page.goto("/screening?sector=0050&off=owner");` |
| e2e/screening.spec.ts | 325 | （追加） | `// Sprint 10: 条件④をオフにして①〜③を確かめる（URL の書き換えは replace なので履歴は増えない。契約の C12-1 の種類1） ⏎ await toggle(page, "条件④ オーナー企業／社長が筆頭株主 を使う").click(); ⏎ await expect(page).toHaveURL(/off=owner/);` |
| e2e/screening.spec.ts | 348 | `await page.goto("/screening");` | `await page.goto("/screening?off=owner");` |
| e2e/screening.spec.ts | 351 | `await expect(page).toHaveURL("/screening?cagr=20&margin=10&years=5&off=margin&sort=cagr&order=desc");` | `await expect(page).toHaveURL("/screening?cagr=20&margin=10&years=5&owner=20&ownermode=any&off=margin,owner&sort=cagr&order=desc");` |
| e2e/screening.spec.ts | 362 | `await page.goto("/screening");` | `await page.goto("/screening?off=owner");` |
| e2e/screening.spec.ts | 392 | `await page.goto("/screening?cagr=500");` | `await page.goto("/screening?cagr=500&off=owner");` |
| e2e/screening.spec.ts | 397 | `await page.goto("/screening");` | `await page.goto("/screening?off=owner");` |
| e2e/screening.spec.ts | 409 | `await page.goto("/screening");` | `await page.goto("/screening?off=owner");` |
| e2e/screening.spec.ts | 421 | `await page.goto("/screening");` | `await page.goto("/screening?off=owner");` |
| e2e/screening.spec.ts | 441 | `await page.goto("/screening?page=99");` | `await page.goto("/screening?page=99&off=owner");` |
| e2e/screening.spec.ts | 451 | `const res = await page.request.get("/api/screening");` | `const res = await page.request.get("/api/screening?off=owner");` |
| e2e/screening.spec.ts | 459 | `const sorted = await (await page.request.get("/api/screening?off=cagr,margin,years&unavailable=include&sort=years&order=asc")).json();` | `const sorted = await (await page.request.get("/api/screening?off=cagr,margin,years,owner&unavailable=include&sort=years&order=asc")).json();` |
| e2e/screening.spec.ts | 462 | `const bad = await page.request.get("/api/screening?cagr=abc&market=0111,9999&foo=1");` | `const bad = await page.request.get("/api/screening?cagr=abc&market=0111,9999&foo=1&off=owner");` |
| e2e/screening.spec.ts | 485 | `await page.goto("/screening?off=cagr,margin,years&unavailable=include");` | `await page.goto("/screening?off=cagr,margin,years,owner&unavailable=include");` |
| e2e/stock-detail.spec.ts | 18 | `const DEFAULT_QUERY = "cagr=20&margin=10&years=5&sort=cagr&order=desc";` | `const DEFAULT_QUERY = "cagr=20&margin=10&years=5&owner=20&ownermode=any&off=owner&sort=cagr&order=desc";` |
| e2e/stock-detail.spec.ts | 48 | （追加） | `// Sprint 10: 条件④をオフにして①〜③を確かめる（契約の C12-1 の種類1） ⏎ await page.getByRole("switch", { name: "条件④ オーナー企業／社長が筆頭株主 を使う" }).click(); ⏎ await expect(page).toHaveURL(/off=owner/);` |
| e2e/stock-detail.spec.ts | 64 | `await expect(page).toHaveURL("/screening");` | `await expect(page).toHaveURL(`/screening?${DEFAULT_QUERY}`);` |
| e2e/stock-detail.spec.ts | 71 | `await page.goto("/screening");` | `await page.goto("/screening?off=owner");` |
| e2e/stock-detail.spec.ts | 75 | `await expect(page).toHaveURL("/screening");` | `await expect(page).toHaveURL("/screening?off=owner");` |
| e2e/stock-detail.spec.ts | 81 | `await expect(page).toHaveURL("/screening");` | `await expect(page).toHaveURL("/screening?off=owner");` |
| e2e/stock-detail.spec.ts | 92 | `await expect(page).toHaveURL("/screening");` | `await expect(page).toHaveURL("/screening?off=owner");` |
| e2e/stock-detail.spec.ts | 104 | `await other.goto("/stocks/99991?cagr=15"); ⏎ await expect(other).toHaveURL(`/login?next=${encodeURIComponent("/stocks/99991?cagr=15")}`);` | `await other.goto("/stocks/99991?cagr=15&off=owner"); ⏎ await expect(other).toHaveURL(`/login?next=${encodeURIComponent("/stocks/99991?cagr=15&off=owner")}`);` |
| e2e/stock-detail.spec.ts | 110 | `await expect(other).toHaveURL("/stocks/99991?cagr=15");` | `await expect(other).toHaveURL("/stocks/99991?cagr=15&off=owner");` |
| e2e/stock-detail.spec.ts | 366 | （追加） | `// Sprint 10: 既定の条件①〜③の判定を確かめるため、条件④はオフにする（有報の無い投入例の銘柄は判定不能のため。契約の C12-1 の種類1）。 ⏎ // クエリに条件のパラメータがあるので、判定の出どころの表示は「スクリーニングの条件」になる` |
| e2e/stock-detail.spec.ts | 369 | `await page.goto(`/stocks/${code}`); ⏎ await expect(page.getByTestId("evaluation-source")).toHaveText("既定の条件で判定しています");` | `await page.goto(`/stocks/${code}?off=owner`); ⏎ await expect(page.getByTestId("evaluation-source")).toHaveText("スクリーニングの条件で判定しています");` |
| e2e/stock-detail.spec.ts | 374 | `await page.goto("/stocks/99991");` | `await page.goto("/stocks/99991?off=owner");` |
| e2e/stock-detail.spec.ts | 380 | `await page.goto("/stocks/9Y002");` | `await page.goto("/stocks/9Y002?off=owner");` |
| e2e/stock-detail.spec.ts | 382 | `await page.goto("/stocks/99998");` | `await page.goto("/stocks/99998?off=owner");` |
| e2e/stock-detail.spec.ts | 395 | `await page.goto("/screening");` | `await page.goto("/screening?off=owner");` |
| e2e/stock-detail.spec.ts | 400 | `await expect(page).toHaveURL("/stocks/99992?cagr=15&margin=10&years=5&sort=cagr&order=desc");` | `await expect(page).toHaveURL("/stocks/99992?cagr=15&margin=10&years=5&owner=20&ownermode=any&off=owner&sort=cagr&order=desc");` |
| e2e/stock-detail.spec.ts | 405 | `await page.goto("/stocks/99992?cagr=15.1");` | `await page.goto("/stocks/99992?cagr=15.1&off=owner");` |
| e2e/stock-detail.spec.ts | 407 | `await page.goto("/stocks/99990?cagr=20&margin=10&years=5");` | `await page.goto("/stocks/99990?cagr=20&margin=10&years=5&off=owner");` |
| e2e/stock-detail.spec.ts | 409 | `await page.goto("/stocks/99990?years=4.9");` | `await page.goto("/stocks/99990?years=4.9&off=owner");` |
| e2e/stock-detail.spec.ts | 412 | `await page.goto("/stocks/99996?unavailable=include");` | `await page.goto("/stocks/99996?unavailable=include&off=owner");` |
| e2e/stock-detail.spec.ts | 414 | `await page.goto("/stocks/99996?off=cagr");` | `await page.goto("/stocks/99996?off=cagr,owner");` |
| e2e/stock-detail.spec.ts | 418 | `await page.goto("/stocks/99991?market=0111");` | `await page.goto("/stocks/99991?market=0111&off=owner");` |
| e2e/stock-detail.spec.ts | 429 | `let res = await page.goto("/stocks/99991?cagr=abc&years=0");` | `let res = await page.goto("/stocks/99991?cagr=abc&years=0&off=owner");` |
| e2e/stock-detail.spec.ts | 440 | `await page.goto("/stocks/99991?years=10");` | `await page.goto("/stocks/99991?years=10&off=owner");` |
| e2e/stock-detail.spec.ts | 449 | `["9Y004", "market=0113&sector=5250&off=margin", true], ⏎ ["99991", "market=0113&sector=3050", false], ⏎ ["99996", "cagr=15&unavailable=include", true], ⏎ ["9Y002", "off=years", false],` | `["9Y004", "market=0113&sector=5250&off=margin,owner", true], ⏎ ["99991", "market=0113&sector=3050&off=owner", false], ⏎ ["99996", "cagr=15&unavailable=include&off=owner", true], ⏎ ["9Y002", "off=years,owner", false],` |
| e2e/stock-detail.spec.ts | 498 | `await page.goto("/stocks/9999?cagr=15"); ⏎ await expect(page).toHaveURL("/stocks/99990?cagr=15");` | `await page.goto("/stocks/9999?cagr=15&off=owner"); ⏎ await expect(page).toHaveURL("/stocks/99990?cagr=15&off=owner");` |
| e2e/stock-detail.spec.ts | 502 | `await page.goto("/stocks/99989?cagr=15"); ⏎ await expect(page.getByTestId("not-found-back")).toHaveAttribute("href", "/screening?cagr=15&margin=10&years=5&sort=cagr&order=desc"); ⏎ await expect(page.getByTestId("breadcrumb-screening")).toHaveAttribute("href", "/screening?cagr=15&margin=10&years=5&so` | `await page.goto("/stocks/99989?cagr=15&off=owner"); ⏎ await expect(page.getByTestId("not-found-back")).toHaveAttribute("href", "/screening?cagr=15&margin=10&years=5&owner=20&ownermode=any&off=owner&sort=cagr&order=desc"); ⏎ await expect(page.getByTestId("breadcrumb-screening")).toHaveAttribute("href` |
| e2e/stock-detail.spec.ts | 538 | `await page.goto("/screening");` | `await page.goto("/screening?off=owner");` |
| e2e/stock-detail.spec.ts | 545 | `await page.goto("/stocks/99989?cagr=15");` | `await page.goto("/stocks/99989?cagr=15&off=owner");` |
| e2e/stock-detail.spec.ts | 547 | `await expect(page).toHaveURL("/screening?cagr=15&margin=10&years=5&sort=cagr&order=desc");` | `await expect(page).toHaveURL("/screening?cagr=15&margin=10&years=5&owner=20&ownermode=any&off=owner&sort=cagr&order=desc");` |
| e2e/stock-detail.spec.ts | 553 | `const CONDITIONED = "/screening?cagr=15&margin=10&years=5&off=margin&unavailable=include&sort=years&order=asc";` | `const CONDITIONED = "/screening?cagr=15&margin=10&years=5&owner=20&ownermode=any&off=margin,owner&unavailable=include&sort=years&order=asc";` |
| e2e/stock-detail.spec.ts | 568 | `await page.goto("/screening?cagr=15&off=margin&unavailable=include&sort=years&order=asc"); ⏎ await expect(page).toHaveURL("/screening?cagr=15&off=margin&unavailable=include&sort=years&order=asc");` | `await page.goto("/screening?cagr=15&off=margin,owner&unavailable=include&sort=years&order=asc"); ⏎ await expect(page).toHaveURL("/screening?cagr=15&off=margin,owner&unavailable=include&sort=years&order=asc");` |
| e2e/stock-detail.spec.ts | 606 | `["/stocks/99991?cagr=abc&foo=1", "/screening?cagr=20&margin=10&years=5&sort=cagr&order=desc"], ⏎ ["/stocks/99989?cagr=15", "/screening?cagr=15&margin=10&years=5&sort=cagr&order=desc"],` | `["/stocks/99991?cagr=abc&foo=1&off=owner", "/screening?cagr=20&margin=10&years=5&owner=20&ownermode=any&off=owner&sort=cagr&order=desc"], ⏎ ["/stocks/99989?cagr=15&off=owner", "/screening?cagr=15&margin=10&years=5&owner=20&ownermode=any&off=owner&sort=cagr&order=desc"],` |
| e2e/stock-detail.spec.ts | 637 | `await page.goto("/screening?page=2");` | `await page.goto("/screening?page=2&off=owner");` |
| e2e/stock-detail.spec.ts | 663 | `expect(body.evaluation).toMatchObject({ source: "default", status: { cagr: "met", margin: "met", years: "met" }, included: true, matchesFilters: true });` | `// Sprint 10: 既定の条件では条件④もオン。有報の無い 99991 は判定不能（④ unavailable）で、結果に含まれない（契約の C12-1。self-review に記載） ⏎ expect(body.evaluation).toMatchObject({ ⏎ source: "default", ⏎ status: { cagr: "met", margin: "met", years: "met", owner: "unavailable" }, ⏎ ownerResult: "undeterminable", ⏎ included: false, ⏎ matches` |
| e2e/stock-detail.spec.ts | 685 | `const c30 = (await (await page.request.get("/api/stocks/99991?cagr=30")).json()).data.evaluation;` | `const c30 = (await (await page.request.get("/api/stocks/99991?cagr=30&off=owner")).json()).data.evaluation;` |
| e2e/stock-detail.spec.ts | 694 | `const badParams = await page.request.get("/api/stocks/99991?cagr=abc");` | `const badParams = await page.request.get("/api/stocks/99991?cagr=abc&off=owner");` |
| e2e/stock-detail.spec.ts | 696 | `const badBoth = await page.request.get("/api/stocks/99991?cagr=abc&years=0");` | `const badBoth = await page.request.get("/api/stocks/99991?cagr=abc&years=0&off=owner");` |
| e2e/stock-detail.spec.ts | 756 | `await page.goto("/screening?cagr=15&off=margin&market=0113&unavailable=include&sort=years&order=asc");` | `await page.goto("/screening?cagr=15&off=margin,owner&market=0113&unavailable=include&sort=years&order=asc");` |
| e2e/stock-detail.spec.ts | 761 | `await expect(page).toHaveURL(`/screening?${DEFAULT_QUERY}`);` | `// Sprint 10: 既定の条件は条件④もオン（正規形に owner=20&ownermode=any が入る。契約の C12-1 の種類2） ⏎ await expect(page).toHaveURL("/screening?cagr=20&margin=10&years=5&owner=20&ownermode=any&sort=cagr&order=desc");` |
| e2e/stock-detail.spec.ts | 773 | `await page.goto("/screening");` | `await page.goto("/screening?off=owner");` |
| e2e/support.ts | 96 | （追加） | `await sql("delete from public.edinet_documents where doc_id like 'SDASH%'"); // 条件④の判定の投入（Sprint 10）` |
| src/app/api/stocks/[code]/route.test.ts | 38 | `evaluation: { status: { cagr: "met", margin: "met", years: "met" }, matchesFilters: true, included: true },` | `evaluation: { status: { cagr: "met", margin: "met", years: "met", owner: "met" }, ownerResult: "president_top", matchesFilters: true, included: true }, ⏎ ownership: { ⏎ status: "determined", ⏎ undeterminable_reason: null, ⏎ undeterminable_detail: null, ⏎ result: "president_top", ⏎ president_is_top_h` |
| src/app/api/stocks/[code]/route.test.ts | 161 | `conditions: { cagr: "20", margin: "10", years: "5", off: [], unavailable: "exclude", market: [], sector: [], sort: "cagr", order: "desc" },` | `conditions: { ⏎ cagr: "20", ⏎ margin: "10", ⏎ years: "5", ⏎ owner: "20", ⏎ ownermode: "any", ⏎ off: [], ⏎ unavailable: "exclude", ⏎ undeterminable: "exclude", ⏎ market: [], ⏎ sector: [], ⏎ sort: "cagr", ⏎ order: "desc", ⏎ },` |
| src/app/api/stocks/[code]/route.test.ts | 176 | `status: { cagr: "met", margin: "met", years: "met" },` | `status: { cagr: "met", margin: "met", years: "met", owner: "met" }, ⏎ ownerResult: "president_top",` |
| src/lib/navigation-href.test.ts | 8 | `"/screening?cagr=15&margin=10&years=5&off=margin&unavailable=include&sort=years&order=asc",` | `"/screening?cagr=15&margin=10&years=5&owner=20&ownermode=any&off=margin&unavailable=include&sort=years&order=asc",` |
| src/lib/navigation-href.test.ts | 15 | `expect(navItemHref("/screening", "/stocks/99991", "cagr=abc&foo=1")).toBe("/screening?cagr=20&margin=10&years=5&sort=cagr&order=desc");` | `expect(navItemHref("/screening", "/stocks/99991", "cagr=abc&foo=1")).toBe("/screening?cagr=20&margin=10&years=5&owner=20&ownermode=any&sort=cagr&order=desc");` |
| src/lib/screening/params.test.ts | 94 | （追加） | `owner: "20", ⏎ ownerMode: "any",` |
| src/lib/screening/params.test.ts | 98 | （追加） | `includeUndeterminable: false,` |
| src/lib/screening/params.test.ts | 171 | `expect(serializeScreeningParams(DEFAULT_CONDITIONS)).toBe("cagr=20&margin=10&years=5&sort=cagr&order=desc");` | `expect(serializeScreeningParams(DEFAULT_CONDITIONS)).toBe("cagr=20&margin=10&years=5&owner=20&ownermode=any&sort=cagr&order=desc");` |
| src/lib/screening/params.test.ts | 187 | `).toBe("cagr=15&margin=10&years=5&off=margin,years&unavailable=include&market=0111,0113&sector=3050,5250&sort=years&order=asc&page=2");` | `).toBe( ⏎ "cagr=15&margin=10&years=5&owner=20&ownermode=any&off=margin,years&unavailable=include&market=0111,0113&sector=3050,5250&sort=years&order=asc&page=2", ⏎ );` |
| src/lib/screening/params.test.ts | 193 | `const query = "cagr=-5&margin=0.5&years=0.1&off=cagr&market=0112&sector=0050&sort=sector&order=desc&page=3";` | `const query = "cagr=-5&margin=0.5&years=0.1&owner=20&ownermode=any&off=cagr&market=0112&sector=0050&sort=sector&order=desc&page=3";` |
| src/lib/screening/params.test.ts | 201 | `expect(serializeScreeningParams(conditions)).toBe("cagr=20&margin=10&years=5&market=0111&sort=cagr&order=desc");` | `expect(serializeScreeningParams(conditions)).toBe("cagr=20&margin=10&years=5&owner=20&ownermode=any&market=0111&sort=cagr&order=desc");` |
| src/lib/screening/screening.db.test.ts | 35 | `const { conditions, invalidFields } = parseScreeningParams(searchParamsToRecord(new URLSearchParams(query)));` | `// Sprint 10: 条件①〜③だけを確かめるので、条件④はオフにする（有報の無い投入例の銘柄が判定不能で除かれるため。契約の C12-1 の種類1） ⏎ const search = new URLSearchParams(query); ⏎ search.set("off", [search.get("off"), "owner"].filter(Boolean).join(",")); ⏎ const { conditions, invalidFields } = parseScreeningParams(searchParamsToRecord(search));` |
| src/lib/screening/screening.db.test.ts | 45 | `const statusOf = (result: ScreeningResult, code: string) => result.rows.find((row) => row.code === code)?.status;` | `/** 条件①〜③の状態（Sprint 10: 条件④はオフにして確かめるので、比べる対象から除く） */ ⏎ const statusOf = (result: ScreeningResult, code: string) => { ⏎ const status = result.rows.find((row) => row.code === code)?.status; ⏎ if (!status) return undefined; ⏎ const { owner, ...rest } = status; ⏎ expect(owner).toBe("off"); ⏎ return res` |
| src/lib/screening/screening.db.test.ts | 140 | `for (const row of allOff.rows) expect(row.status).toEqual({ cagr: "off", margin: "off", years: "off" });` | `for (const row of allOff.rows) expect(row.status).toEqual({ cagr: "off", margin: "off", years: "off", owner: "off" });` |
| src/lib/screening/screening.db.test.ts | 377 | `const allOff = { cagrOn: false, marginOn: false, yearsOn: false, includeUnavailable: true };` | `const allOff = { cagrOn: false, marginOn: false, yearsOn: false, ownerOn: false, includeUnavailable: true };` |
| src/lib/stocks/detail.test.ts | 41 | `expect(dc.screeningHref).toBe("/screening?cagr=15&margin=10&years=5&off=margin&sort=cagr&order=desc&page=2");` | `expect(dc.screeningHref).toBe("/screening?cagr=15&margin=10&years=5&owner=20&ownermode=any&off=margin&sort=cagr&order=desc&page=2");` |
| src/lib/stocks/detail.test.ts | 45 | `expect(bad.screeningHref).toBe("/screening?cagr=20&margin=10&years=5&sort=cagr&order=desc");` | `expect(bad.screeningHref).toBe("/screening?cagr=20&margin=10&years=5&owner=20&ownermode=any&sort=cagr&order=desc");` |
| src/lib/stocks/stock-detail.db.test.ts | 42 | （追加） | `/** Sprint 10: 条件①〜③だけを確かめるので、条件④はオフにする（有報の無い投入例の銘柄が判定不能で除かれるため。契約の C12-1 の種類1） */ ⏎ function withOwnerOff(query: string): URLSearchParams { ⏎ const search = new URLSearchParams(query); ⏎ search.set("off", [search.get("off"), "owner"].filter(Boolean).join(",")); ⏎ return search; ⏎ } ⏎ ` |
| src/lib/stocks/stock-detail.db.test.ts | 50 | `const { conditions, invalidFields } = parseScreeningParams(searchParamsToRecord(new URLSearchParams(query)));` | `const { conditions, invalidFields } = parseScreeningParams(searchParamsToRecord(withOwnerOff(query)));` |
| src/lib/stocks/stock-detail.db.test.ts | 83 | `if (off) return "off";` | `if (off \|\| key === "owner") return "off";` |
