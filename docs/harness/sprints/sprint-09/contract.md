# Sprint 09 契約: F15 EDINET による上場前の期の補完（条件①）

> **改訂1（rev 1）の変更点**（contract-review.md の1回目の R1〜R4 と改善提案の反映。詳細は第9章）
> - R1: 導入時に `edinet_filers` を作る処理を加えた。既存の書類から作り、450 日分の書類一覧を1回だけ取り直す（第2章の6、C6-4b）。
> - R2: 表示名の変更が及ぶ画面を列挙した（第2章の2）。「取り込み待ち」を処理ごとに定義し直した（第4章）。Sprint 8 のテストで変えてよいアサーションを3種類に限った（C12-2）。
> - R3: `edinet_documents` の削除（連鎖）での再計算を、設計（第2章の8）とテスト（C4-8）に加えた。
> - R4: 金融業の「経常収益」を売上高として読み、「経常利益」を読まないことを、要素の一覧（第2章の5）とテスト（C7-1）に加えた。
> - 改善提案: 1 は既知の制限にした（売上高と営業収益の定義のずれ）。2 は第4章に入れた（営業利益率の理由の文言）。3 は CLAUDE.md の記載に入れた（届出書の件数の見積もり）。4 は印の文字を「補完」に変えた。

## 1. 対象機能

F15。EDINET の有価証券報告書（有報）・有価証券届出書（届出書）の「主要な経営指標等の推移」から、各期の通期の売上高と営業利益を読み取って保存する。決算短信（J-Quants）に無い期（主に上場前の期）をそれで補い、上場から約4年未満の銘柄でも、条件①（売上CAGR）を同じ定義で算出できるようにする。定義は「連続した5期、(FY0/FY-4)^(1/4) − 1」のまま。

- 各期の値がどの書類から来たかを、銘柄詳細の5期の表とスクリーニングの一覧で確かめられるようにする。
- AC6.12 の暫定の注記を、AC15.12 の注記に差し替える。

土台は Sprint 8 の EDINET の取り込み（`edinet/http.ts`・`documents-list.ts`・`document-archive.ts`・`xbrl.ts`・`decimal.ts`、`runEdinetPipeline`、届出書 030／040 のメタデータ）をそのまま使う。算出は Sprint 5 の3層（出典ごとの保存 → `financial_periods` → `financial_metrics_from_periods`）に、EDINET の出典を加える形で行う。

### 仕様書の受け入れ基準（引用）

- AC15.1 （出典の優先順位）次の銘柄を投入すると、売上CAGR は 41.4% と表示される。銘柄詳細画面の5期の表には、FY-4 100（有価証券届出書）、FY-3 150（有価証券報告書）、FY-2 200（有価証券報告書）、FY-1 300（決算短信）、FY0 400（決算短信）が表示される。有報の FY-1 の 310 と、届出書の FY-3 の 140 は、表にも算出にも使われない。
  - 決算短信: FY-1 300、FY0 400
  - 有価証券報告書: FY-3 150、FY-2 200、FY-1 310
  - 有価証券届出書: FY-4 100、FY-3 140
- AC15.2 （出典の表示）銘柄詳細画面の5期の表で、各期の売上高・営業利益に出典（「決算短信」「有価証券報告書」「有価証券届出書」）が表示される。EDINET から補った期には、書類ID、提出日、EDINET の書類閲覧ページへのリンクがある。決算短信だけの銘柄では、すべての期が「決算短信」と表示される。
- AC15.3 （一覧での表示）スクリーニング結果で、CAGR の算出に EDINET から補った期を含む銘柄の売上CAGR には「補完あり」の印が付く。印にマウスを乗せるかクリックすると、どの期をどの書類から補ったかが表示される。決算短信だけで算出した銘柄には印が付かない。
- AC15.4 （絞り込みは同じ扱い）AC15.1 の銘柄は、CAGR の閾値 40% では結果に表示され、45% では表示されない。補完した銘柄が、決算短信だけの銘柄と同じ規則で絞り込まれる。
- AC15.5 （補完しても5期そろわない）決算短信 2期と有価証券届出書 2期（重なりなし）の計4期しか無い銘柄は、従来どおり「算出不可（通期実績が5期未満）」と表示される。詳細画面では、どの期が足りないかが「データなし」で示される。
- AC15.6 （連続・変則決算の規則も同じ）補った期のうちに、12か月でない期（例: 決算期変更で9か月の期）を含む銘柄は「算出不可（変則決算を含む）」になる。補った期と決算短信の期の間に欠けている期がある銘柄は、5期連続の要件を満たさない理由付きで算出不可になる。
- AC15.7 （算出の定義は変わらない）決算短信だけで3期（FY-2〜FY0）を投入した銘柄は「算出不可（通期実績が5期未満）」と表示される。そこに有価証券届出書の2期（FY-4、FY-3）を追加で投入し、画面をリロードすると、ほかの操作をしなくても CAGR が表示される。その値は、同じ5つの値をすべて決算短信として投入した銘柄の CAGR と一致する。
- AC15.8 （連結と単体）同じ期に連結と提出会社（単体）の両方の値がある書類では、連結の値が表示・算出に使われ、その期に「連結」と示される。連結の値が無い期だけ単体の値が使われ、「単体」と示される。5期の中に連結と単体が混ざる銘柄は、算出不可にはならず、CAGR の横（詳細画面と、一覧の印の説明）に「連結・単体が混在」と注記される。
- AC15.9 （同じ種類の書類が複数）同じ期の値を持つ有価証券届出書が2通（元の届出書と訂正届出書）ある銘柄では、新しく提出された方の値が使われ、詳細画面にはその書類ID が表示される。
- AC15.10 （キー未設定）EDINET のキーが未設定の環境で補完の取り込みを実行すると、実行履歴に「EDINET の API キーが設定されていません」として失敗が記録される。決算短信から算出済みの指標は変わらない。
- AC15.11 （キーあり環境）取り込み後、取り込み状況画面に、上場前の期を補った銘柄数が表示される。ダッシュボードの「財務指標を算出できた銘柄数」に、補完で算出できるようになった銘柄が含まれる。毎日の取り込みでは、処理済みの書類を取り直さない（実行履歴の処理件数で確認できる）。
- AC15.12 （暫定の注記の更新）AC6.12 の「上場前の期のデータがまだ無い」旨の注記は表示されなくなる。代わりに、条件①の説明に「上場前の期は EDINET の有価証券届出書・有価証券報告書から補っています。書類から値を取れない銘柄は算出不可になることがあります」という趣旨の注記が表示される。
- AC15.13 （自動テスト）書類の解析と期の選び方には、実際の書類の形をしたフィクスチャを使った自動テストがあり、通る。フィクスチャには次を含める。
  - 連結と提出会社の両方がある届出書
  - 金額の単位が千円の書類と百万円の書類（決算短信と同じ単位にそろうこと）
  - IFRS の書類（「売上収益」などの表記）
  - 営業利益の行が無い書類
  - 訂正届出書
  - 決算短信・有報・届出書で同じ期が重なる場合の優先順位

関連する仕様の記述（「用語と算出ルール」）:
- 定義は出典に依存しない。出典が加わって変わるのは「そろう期の数」だけ。
- 出典の優先順位: 1 決算短信 → 2 有報の「主要な経営指標等の推移」→ 3 届出書の「主要な経営指標等の推移」。同じ種類の EDINET 書類が複数ある場合（訂正を含む）は、最も新しく提出された書類の値を使う。EDINET の書類は、決算短信に無い期を補うためだけに使い、決算短信にある期の値を置き換えない。
- 連結と単体: 両方の値がある期は連結、連結の値が無い期だけ単体。混在しても算出不可にせず「連結・単体が混在」と注記する。金額の単位は決算短信と同じ単位（円）にそろえる。
- 直近通期の営業利益率も、直近通期の値の出典は上の優先順位に従う。
- コンプライアンス: EDINET から補った財務値も、J-Quants 由来の値と同じ扱い（ログインした許可ユーザーだけ）。
- デザイン: 出典は詳細の表では期ごとの小さなラベル、一覧では「補完あり」程度の控えめな印。

### 持ち越し事項とユーザーの決定の扱い

- **S1（Sprint 8 からの持ち越し。EDINET の期の開始日）**: 書類一覧の `periodStart` は欠けることが多い（訂正・届出書では出力されない）。このスプリントでは、期の開始日を**書類一覧から取らない**。「主要な経営指標等の推移」の各期の値が属する XBRL のコンテキストの**期間（`startDate`〜`endDate`）**から取る。開始日を決められない期は保存しない。したがって、`financial_periods` の EDINET の期の開始日は常に決まっている。12か月を仮定して開始日を補うことはしない（変則決算を見落とすため）。詳細は第2章の4。
- **金融業は特別扱いしない（ユーザーの決定）**: 取り込み・抽出・算出・表示で業種による分岐をしない。銀行・保険の書類も同じ規則で読む。売上高の項目名の違い（経常収益など）は、第2章の5の「売上高として読む要素」で扱う。業種では分けない。
- **Sprint 8 評価の改善提案 m1〜m6**: m2・m3 を取り込む（第2章の11、C10。完了条件に含める）。m1・m4・m5・m6 はこのスプリントでは行わない（理由は第2章の11）。
- **未追跡の `docs/harness/sprints/sprint-08/evaluation-1.md`**: Sprint 9 のコミットに含める（C12-8）。

## 2. 仕様上の論点と、このスプリントでの解釈

評価者は、この解釈が妥当かも判断してほしい。

### 1. 実 API で確かめられない部分の扱い（Sprint 8 と同じ方針）

`EDINET_API_KEY` は未設定である。したがって、書類取得 API の実際の ZIP を取得して確かめることはできない。

- **形の根拠は公開の資料と、キー無しで見られる実在の書類に限る。**
  1. 金融庁「EDINET タクソノミ」（2025年版以降）の `jpcrp_cor` の要素リストで確かめる。確かめる対象は「主要な経営指標等の推移」の要素（`…SummaryOfBusinessResults`）と、連結・個別の軸（`ConsolidatedOrNonConsolidatedAxis`・`NonConsolidatedMember`）。報告書インスタンス作成ガイドラインでは、コンテキスト ID の付け方（`CurrentYearDuration`・`Prior1YearDuration`〜`Prior4YearDuration`、`_NonConsolidatedMember`）を確かめる。
  2. **EDINET の閲覧サイト（`https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx?<書類ID>,,`）から、キー無しで実在の書類のインライン XBRL を取得することを必ず試みる。** Sprint 8 と同じく、headless ブラウザで表示の iframe から取る。少なくとも次の形を探す。
     - 新規公開時の届出書（連結と提出会社の両方の表があるもの）
     - 訂正届出書
     - IFRS の有報（「売上収益」）
     - 金額を千円で記載した書類と、百万円で記載した書類
     - 営業利益の行が無い書類（日本基準の多くの書類）
     - 決算期の変更で12か月でない期を含む書類（見つかれば）
  3. 取得できたら、**フィクスチャはその実データの抜粋から作る**。「主要な経営指標等の推移」の表のテキストブロックと、参照するコンテキスト・単位だけを残し、元の書類IDを先頭のコメントに書く。取得できなかった形は、資料に沿って組み立てたことをフィクスチャのコメントと self-review に書く（`__fixtures__/synthetic.ts` の組み立ての関数を使ってよい）。
- **テストは外部 API だけを差し替える**（Sprint 3〜8 と同じ）。書類取得 API の応答は、テストの中でフィクスチャから ZIP を作って返す。
- **キーが無い環境の振る舞いは明示的なエラー**（AC15.10）。外部 API を呼ばずに「EDINET の API キーが設定されていません」で `failed`。
- **スタブ・ダミーの禁止**: アプリの本体に、サンプルの書類・期の値を置かない。画面に出るのは DB の行だけ（取り込んだもの、または評価者が投入したもの）。
- self-review の「実 API・実データで未確認の点」に、確かめた資料（名前・版）、取得できた書類ID、推定のまま実装した点を一覧で書く。キーありの確認（AC15.11 の実データでの件数）は、このスプリントの合否の条件にしない（Sprint 3〜8 のキーありの AC と同じ扱い）。

### 2. 取り込みの形（target は分けず、Sprint 8 の EDINET の取り込みに処理を足す）

- **target は既存の `edinet_reports` のまま**にし、1回の実行で書類ごとに2つの処理を行う。
  - 大株主・役員の抽出（Sprint 8）
  - 主要な経営指標等の推移の抽出（このスプリント）
- 理由: 補完に使う有報は、Sprint 8 が大株主・役員のために取得する有報と同じ書類である。target を分けると、同じ ZIP（1〜数 MB）を2回取得することになり、初回の取り込みにかかる回数が約2倍になる。書類一覧の取得も2つの target で重なる。同じ ZIP から両方を抽出すれば、要求は1回で済む。
- 処理済みの記録は処理の種類ごとに持つ（Sprint 8 の設計どおり）。大株主・役員は `annual_report_extractions`、主要な経営指標等は新しい `business_results_extractions`。本文を取得するのは、**どちらかの処理が未処理の書類だけ**。取得したら、未処理の処理だけを行って保存する。
  - Sprint 8 で大株主・役員を処理済みの有報も、主要な経営指標等が未処理なら1回だけ取得し直す。これは導入時の1回だけで、その後は取り直さない。
- **表示名を変える**: target の表示は「有報」から「EDINET」にする。手動の対象は「有報（EDINET）」から「EDINET（有報・届出書）」にし、説明を「有報の大株主・役員と、有報・届出書の主要な経営指標等（上場前の期の補完）」にする。定期実行の表示も「EDINET（有報・届出書）」にする。
  - 表示名の変更が及ぶところ（R2）。すべて、target の表示名の定数1か所から出す。
    1. 取り込み状況の実行履歴の対象の列（「有報」→「EDINET」）
    2. 取り込み状況の「今すぐ取り込み」の選択肢と説明（「有報（EDINET）」→「EDINET（有報・届出書）」）
    3. 取り込み状況の定期実行の表示（`schedule.ts` の `targetsLabel`）
    4. ダッシュボードの最近の実行・最後に完了した取り込みの表示（`e2e/dashboard.spec.ts` の「有報」の確認）
    5. 実行中の表示（「実行中: 有報」→「実行中: EDINET」）と、二重実行のときの文言
    6. 実行結果の文言（`result-message.ts`）
  - これは Sprint 8 の C1-1 などの文言（対象「有報」）の意図的な変更である。Sprint 8 のテストで変えてよいものは、C12-2 の3種類だけ。
  - AC15.10 の「補完の取り込み」は、この「EDINET（有報・届出書）」の実行を指す。
- 定期実行は既存の `/api/cron/edinet`（毎日 0:00 JST）のまま。新しいルート・`vercel.json` の変更は無い。

### 3. 主要な経営指標等を読む書類（本文の取得の対象）

主要な経営指標等を読む書類は、次の和集合とする。取り下げ（`withdrawn`）・不開示（`withheld`）の書類は除く。

| 書類 | 条件 |
|---|---|
| 有報（120）・訂正有報（130） | Sprint 8 の「候補の列」（`annual_report_candidates`。銘柄ごとの対象の事業年度の書類）の**すべて**。訂正に表が無い場合に元の有報の値を使えるよう、元の有報も対象にする |
| 届出書（030）・訂正届出書（040） | 銘柄マスタの銘柄に**結び付く**もの（第2章の6）。すべて対象にする |

- 読む書類を直近の事業年度の有報に限る理由: 直近の有報1通の「主要な経営指標等の推移」には、その事業年度を含む過去5期の値がある。そこには上場前の期も含まれる。したがって、上場から1年以上たった銘柄は、直近の有報だけで5期がそろう。届出書が要るのは、上場後まだ有報を提出していない銘柄（上場から約1年以内）と、有報の表に無い期がある銘柄だけ。
- **書類一覧の期間は Sprint 8 の 450 日のまま**にする（延ばさない）。
  - 上場した会社は、届出書の提出から概ね 13 か月以内に最初の有報を提出する（上場前に終わった事業年度の有報も提出する）。有報を提出する前の銘柄の届出書は、450 日の中にある。
  - 450 日より前に提出された届出書は読まない。そのため、最初の有報の表に足りない期がある銘柄は補えないことがある。この既知の制限を CLAUDE.md に書く。
- **本文の取得の順番**（1回の実行の上限 210 秒の中で、補完が効く書類を先にする）:
  1. 条件①が算出できていない銘柄（`financial_metrics` が無い、または理由が `insufficient_periods`・`non_consecutive_periods`）の書類。その中は届出書 → 有報、それぞれ提出日時の新しい順。
  2. そのほかの書類。提出日時の新しい順（Sprint 8 と同じ）。
- XBRL の無い書類（`xbrl_available = false`）は要求せず、`no_xbrl` として処理済みにする（Sprint 8 と同じ）。
- 届出書は、大株主・役員の抽出を行わない（`annual_report_extractions` に行を作らない）。

### 4. 何を抽出するか（主要な経営指標等の推移）

読むのはインライン XBRL（`*_ixbrl.htm`）の事実である。汎用の読み取りは `edinet/xbrl.ts`（Sprint 8）を使い回し、抽出は新しい `edinet/business-results.ts` で行う。

**(a) 読む事実を限定する（要素・コンテキスト・単位）**
- 要素: `jpcrp_cor` の「主要な経営指標等の推移」の売上高・営業利益の要素（第2章の5）。ほかの要素（経常利益・純資産など）は読まない。
- コンテキスト: 次のすべてを満たすもの。
  - 期間が duration（`startDate` と `endDate` がある）。
  - ID が `CurrentYearDuration` または `Prior{1〜4}YearDuration` で始まる（中間期・四半期の列（`InterimDuration` など）を読まない）。
  - 軸が無い、または連結・個別の軸のメンバー `NonConsolidatedMember` だけを持つ。ほかの軸・メンバーを持つコンテキスト（セグメントなど）は読まない。
- 単位: 日本円（`JPY`）。円以外の単位は `invalid_values`（`non_jpy_unit`）。
- 読まなかった事実の数を `details.businessResults.discardedFacts` に残す（黙って混ぜない）。

**(b) 期（S1 の決定）**
- 期の開始日・終了日は、**事実のコンテキストの `startDate`・`endDate`** とする。書類一覧の `periodStart`・`periodEnd` は使わない。
- XBRL の duration の `endDate` は「期間の翌日 0 時」を表す慣習もある（XBRL 2.1）。EDINET の書類が末日を書くか翌日を書くかを、実データで確かめる。そのうえで、`fiscal_year_end` が決算短信の `CurPerEn`（末日。例 2025-03-31）と同じ表し方になるようにそろえる。確かめた結果を self-review と CLAUDE.md に書き、テストで固定する。
- 開始日が終了日より後、または期間が1日未満のコンテキストの事実は `invalid_values`（`invalid_period`）。
- 期間の長さによる判定（変則決算）は抽出では行わない。保存した期間から、`financial_periods` の既存の規則（358〜371 日の外 = 変則決算）で判定する（出典を問わず同じ規則。AC15.6）。

**(c) 連結と単体**
- 軸の無いコンテキストの事実は「連結」、`NonConsolidatedMember` のコンテキストの事実は「単体（提出会社）」として保存する（`consolidated` の列）。
- ただし、DEI の「連結財務諸表の有無」（`WhetherConsolidatedFinancialStatementsArePreparedDEI`）が false の書類で、軸の無いコンテキストに値がある場合は、その値を「単体」とする。軸の付け方は実データで確かめ、違えば実データに合わせ、そう書く。
- 1つの書類の同じ期に連結と単体の両方があるとき、使うのは次の規則で1つだけ（期の中で連結と単体の値を混ぜない）。
  - 連結の売上高があれば連結の行。
  - 無ければ単体の行（売上高があれば）。
  - どちらの売上高も無ければ、連結の行（あれば）。無ければ単体の行。
- 両方の行を保存し、選ぶのは DB のビュー（第2章の7）で行う。AC15.8 の「連結」「単体」の表示と「連結・単体が混在」の注記は、選んだ行の `consolidated` による。

**(d) 金額の単位（AC15.13）**
- インライン XBRL の `scale`（千円 = 3、百万円 = 6）と `sign` を、Sprint 8 の読み取り（`xbrl.ts` の `value`）で**十進の文字列のまま**円にする。浮動小数点を使わない。円の numeric で保存する（決算短信の `financial_statements` と同じ単位）。
- 表示の単位（千円・百万円）の違いで値が変わらないことを、千円の書類と百万円の書類のフィクスチャで確かめる（`1,234,567` 千円 → `1234567000` 円、`1,234` 百万円 → `1234000000` 円）。

**(e) 値が無い・記載が「－」**
- `xsi:nil`、または事実が無い項目は NULL（「記載なし」）。営業利益の行が無い書類（日本基準の多くの書類）は、営業利益が NULL になる。これは正常で、`ok` のまま保存する。
- 同じ要素・同じコンテキストの事実が2つ以上あるとき（インライン XBRL では同じ事実が別の場所に繰り返されることがある）、値が等しければ1つにまとめる。違えば `invalid_values`（`conflicting_facts`）とする。

**(f) 抽出の結果（書類ごと）**

| 結果 | 条件 | 保存するもの |
|---|---|---|
| `ok` | 売上高か営業利益の事実のある期が1つ以上ある | 期の行（連結・単体ごと） |
| `no_xbrl` | XBRL が無い（`xbrlFlag` = 0、ZIP にインライン XBRL が無い） | 結果だけ |
| `section_not_found` | 読む要素の事実が1つも無い（訂正届出書で経営指標の記載が無い、参照方式の届出書など） | 結果だけ |
| `invalid_values` | 事実はあるが、数値として読めない・円でない・期間が不正・同じ事実の値の食い違いがある | 結果と原因（`detail`）だけ。**一部の期だけを保存しない** |

- 抽出の失敗（`section_not_found`・`invalid_values`）は理由付きで処理済みにし、毎日取り直さない。取得の失敗（404・500・ZIP でない・接続できない）は処理済みにせず、次の実行で再試行する（Sprint 8 と同じ）。
- **抽出の規則を直して取り直すときは、その書類の `business_results_extractions` の行を消す**（期の行も連鎖して消え、再計算される）。CLAUDE.md に書く。

### 5. 売上高・営業利益として読む要素

- 売上高は、書類の記載の名前（売上高・営業収益・売上収益・経常収益など）が会社や会計基準で違う。次の順に、最初に事実のある要素を「売上高」とする。**実際の要素名は、実装時にタクソノミの要素リストで確かめて定数1つに置き、CLAUDE.md に一覧で書く。**
  | 会計基準 | 売上高として読む要素（候補。優先の順） | 営業利益として読む要素（候補） |
  |---|---|---|
  | 日本基準 | `NetSalesSummaryOfBusinessResults`（売上高）→ `OperatingRevenue1SummaryOfBusinessResults`・`OperatingRevenue2SummaryOfBusinessResults`（営業収益）→ `GrossOperatingRevenueSummaryOfBusinessResults`（営業総収入）→ 銀行・保険などの経常収益の要素 | 営業利益の要素（タクソノミにあれば） |
  | IFRS | `RevenueIFRSSummaryOfBusinessResults`（売上収益）ほか | IFRS の営業利益の要素（あれば） |
  | 米国基準 | `RevenuesUSGAAPSummaryOfBusinessResults` ほか | 米国基準の営業利益の要素（あれば） |
- **金融業の経常収益と、読まない要素（R4）**: `jpcrp_cor` には「経常収益」と「経常利益」がある。経常収益は銀行・保険などの売上高に当たり、経常利益は一般の会社・金融業の利益である。英語名はどちらも `OrdinaryIncome…` 系で紛らわしい。
  - 売上高として読むのは「経常収益」の要素だけ。要素名は、タクソノミの**日本語の標準ラベル**（「経常収益」）で確かめて定数に置く。
  - 「経常利益」の要素は、**売上高として読まない**。`OrdinaryIncomeLossSummaryOfBusinessResults` など、標準ラベルが「経常利益」「経常利益又は経常損失（△）」のものがこれに当たる。
  - 要素の定数の一覧（コードと CLAUDE.md）には、読む要素ごとに標準ラベルを書く。「読まない要素」（経常利益・当期純利益・包括利益・純資産など、とくに経常利益）も注記として並べる。
  - 業種では分けない。銀行の書類でも、一般の会社と同じ優先の順（売上高 → 営業収益 → 営業総収入 → 経常収益）で、最初に事実のある要素を読む。
- **既知の制限（改善提案1）**: 「売上高」と「営業収益」の両方を記載する会社（小売業など）では、EDINET の期は売上高を先に読む。決算短信（J-Quants の `Sales`）が営業収益を採っている会社では、補った期と決算短信の期で売上高の定義がずれることがある。これを CLAUDE.md の既知の制限に書く。上場から日の浅い会社では少ないと考える。
- どの要素を読んだかを期の行に保存する（`revenue_element`）。詳細の表では、売上高の名前が「売上高」でないとき、その名前を小さく示す（例「売上収益」「営業収益」）。
- 会計基準（`accounting_standard`）は、読んだ要素の種類で決める（IFRS の要素 = `IFRS`、米国基準の要素 = `US`、それ以外 = `JP`）。IFRS に移行した会社の届出書では、古い期が日本基準で記載されることがあるため、書類単位では決めない。
- 提出者の独自の要素（拡張タクソノミ）だけで記載した売上高は読まない。`section_not_found`（`detail = revenue_element_unknown`。`…SummaryOfBusinessResults` の独自の要素がある場合）として処理済みにする。

### 6. 書類と銘柄の結び付け（届出書は証券コードが無いことがある）

- 有報は Sprint 8 と同じく書類の `sec_code`。
- 届出書は、次の順に銘柄コードを決める。
  1. 書類の `sec_code`。
  2. 無ければ、**同じ `edinet_code` の提出者の証券コード**。これは新しいテーブル `edinet_filers` に記録する。
- `edinet_filers` は、書類一覧を保存するときに、**一覧のすべての行**（書類の種類を問わない）のうち `edinetCode` と `secCode` の両方がある行から更新する。上場後の半期報告書・臨時報告書・有報などには証券コードがある。そのため、上場前に証券コードの無い届出書を出した会社も、上場後の書類で結び付く。
  - 同じ `edinet_code` の証券コードが変わった場合は、提出日時の新しい行の値を使う。
- **導入時の作成（R1）**: Sprint 8 の実行で書類一覧を取得済みの環境では、取得済みの日（直近7日より前）を取り直さない。そのため、過去の半期報告書などの行が二度と読まれず、`edinet_filers` が欠ける。そこで次の両方を行う。
  1. マイグレーションで、既存の `edinet_documents` の `(edinet_code, sec_code)` から `edinet_filers` を作る。使うのは `sec_code` のある行で、同じ `edinet_code` は提出日時の新しい行にする。これだけでは、Sprint 8 が保存していない種類の書類（半期報告書など）の対応は入らない。
  2. マイグレーションで、`edinet_list_fetched_dates` の**全行を消す**。次の実行から、450 日分の書類一覧を1回だけ取り直す（初回と同じ約3回分の実行）。
     - 取り直しで書類のメタデータ・処理済みの記録は壊れない。一覧の保存は upsert で、値が変わらない書類の行は更新しない（Sprint 8）。取り下げは false に戻さない。
     - 取り直しの間も、本文の処理は Sprint 8 の規則どおり（一覧を取り終えるまで本文に進まない）。
  - 1 と 2 の処理は、service_role だけが実行できる関数 `prepare_edinet_filers_backfill()` にまとめる。マイグレーションはそれを1回呼ぶ。`pnpm test:db` はこの関数を呼んで確かめる（C6-4b）。
  - 初回の所要（CLAUDE.md）に次を書く。Sprint 9 の導入後、書類一覧の取り直しに約3回かかる。主要な経営指標等のための有報の取り直しに約 26〜39 回かかる（大株主・役員を処理済みの有報も1回ずつ取得するため）。
- 社名による突き合わせはしない（誤った結び付けを避ける）。結び付かない届出書は、どの銘柄にも使わない。取り込み状況に「銘柄に結び付かない届出書」の件数を出す。
- 結び付けは DB のビュー1か所（`edinet_document_codes`）で行い、読む書類の選択（第2章の3）と期の選択（第2章の7）が同じものを使う。

### 7. 期の選び方（`financial_periods` に EDINET の期を加える）

`financial_periods`（Sprint 5 のビュー）の候補に、EDINET の期を union all で加える。**算出の関数 `financial_metrics_from_periods` の定義（連続・変則決算・5期・理由の順）は変えない。**

- **候補**: 主要な経営指標等の抽出が `ok` の書類の期の行のうち、次を満たすもの。
  - 取り下げ・不開示でない書類。
  - 銘柄マスタの銘柄に結び付く（第2章の6）。
  - 同じ書類・同じ期の連結と単体の行は、第2章の4 (c) の規則で1つに絞る。
- **出典と優先順位**（`source`・`source_priority`）:
  | source | 表示 | source_priority | 書類 |
  |---|---|---|---|
  | `tdnet_summary` | 決算短信 | 1 | 既存 |
  | `edinet_annual_report` | 有価証券報告書 | 2 | 120・130 |
  | `edinet_registration_statement` | 有価証券届出書 | 3 | 030・040 |
- **期ごとの選択**: 銘柄・事業年度の終了日ごとに、次の順で1つの行を選ぶ。
  1. `source_priority` の小さい方。決算短信にある期は、EDINET の値で置き換えない。
  2. 同じ出典の中では、提出日時の新しい方。訂正は同じ種類として扱う（訂正届出書は届出書の中で比べる）。
  3. 同じ提出日時なら書類IDの大きい方。
  - AC15.1 の例: 2024/03期は決算短信の 300 が、2022/03期は有報の 150 が選ばれる。有報の 310 と届出書の 140 は使われない。
- **項目ごとの補い（Sprint 5 の決算短信の規則）は EDINET の出典には適用しない。** EDINET の期は、選んだ1通の書類の売上高と営業利益をそのまま使う。
  - 理由: 仕様は「最も新しく提出された書類の値を使う」としている。また、期ごとに示す書類IDと、値の出どころを一致させるため。
  - 決算短信の期は、Sprint 5 のとおり（同じ期の開示の中で、項目ごとに値のある最新のもの）。
- **期の同一性**: 事業年度の終了日で同じ期とみなす（Sprint 5 のビューと同じ）。決算短信と EDINET で開始日が違っても、終了日が同じなら同じ期で、優先順位の高い方だけが残る。
- 決算短信の期と EDINET の期の**連続・重なり・変則決算の判定は、選んだ後の期に対して、既存の関数が出典を問わず同じ規則で行う**（AC15.6）。
- **未処理の書類は無いものとして扱う**: 新しい書類（訂正など）がまだ取り込み待ちのとき、その書類の値は使われない。処理済みの書類の値で算出し、新しい書類を処理した時点で再計算される。
  - 大株主・役員（Sprint 8）の「未処理の新しい書類より古い書類の値を先に表示しない」とは扱いを変える。理由: 補完の値は算出の入力で、止めると条件①が算出不可になる。算出の結果は、どの書類を使ったかと一緒に常に表示される。
- **ビューの列の追加**（既存の列は変えない）:
  - `source_document_type_code`（120／130／030／040。決算短信は NULL）
  - `source_submitted_at`（EDINET の提出日時。決算短信は NULL）
  - `revenue_element`（EDINET の売上高の要素。決算短信は NULL）
  - EDINET の期の `source_document_id` は書類ID、`source_document_date` は提出日（JST）、`document_type` は `EDINET_<書類種別コード>`、`disclosure_count` はその出典の中でその期を持つ書類の数。

### 8. 再計算（Sprint 5 のトリガーの経路を広げる）

`financial_metrics` は直接書き換えない。`financial_periods` の結果が変わりうる変更のすべてで、**同じトランザクションの中で**、影響する銘柄の `recalculate_financial_metrics` を呼ぶ（文単位のトリガー）。

| 変更 | 再計算する銘柄 |
|---|---|
| `financial_statements` の insert・update・delete（既存） | 変更された銘柄 |
| `business_results_periods`・`business_results_extractions` の insert・update・delete | その書類に結び付く銘柄 |
| `edinet_documents` の update（`withdrawn`・`withheld`・`sec_code`・`edinet_code`・`submitted_at`・`doc_type_code`）・delete | 変更の前後の書類に結び付く銘柄 |
| `edinet_filers` の insert・update・delete | その `edinet_code` の書類に結び付く銘柄（変更の前後） |
| `stocks` の insert | 追加された銘柄（EDINET の期は銘柄マスタへの外部キーを持たないため。上場前に保存した届出書の期を、上場後に銘柄マスタに入った時点で使う） |

- **書類の行の削除（R3）**: `edinet_documents` の行を消すと、外部キーの連鎖で `business_results_extractions`・`business_results_periods` も消える。期の行のトリガーからは、消えた書類の銘柄を引けない。
  - そのため、書類の削除の再計算は、`edinet_documents` の文単位の delete のトリガーが行う。対象は、OLD の `sec_code` の銘柄と、OLD の `edinet_code` から `edinet_filers` で引いた銘柄。
  - 外部キーの連鎖の削除は、元の文の after トリガーより先に実行されると想定している。そうであれば、再計算は期が無くなった後の値になる。この順番を前提にせず、テストで確かめる（C4-8）。違えば、トリガーの形を変えてそうなるようにする。
  - 期の行・抽出の行のトリガーは、書類の行がもう無ければ何もしない（書類の削除のトリガーに任せる）。
- `stocks` への upsert（銘柄マスタの取り込み、約 4,000 行）で、既存の銘柄の再計算が走らないようにする（insert の遷移テーブルには、新しく入った行だけが入ることを確かめる）。
- EDINET の期だけを持つ銘柄（決算短信がまだ無い銘柄）も、Sprint 5 の関数でそのまま算出する。

### 9. 「補完あり」と混在の注記（算出の定義の外で求める）

- **`financial_metrics_from_periods` は出典を読まない**（Sprint 5 のとおり）。変える点は次の1つだけ。
  - 既存の `revenue_cagr_mixed_basis`（連結・単体または会計基準の混在）に加え、`revenue_cagr_mixed_consolidation`（連結・単体の混在）と `revenue_cagr_mixed_standard`（会計基準の混在）を返す。
  - どちらも期の `consolidated`・`accounting_standard` だけから求めるので、出典には依存しない。
- **補完の情報**は `recalculate_financial_metrics` が、関数の結果（算出に使った期の範囲）と `financial_periods` から求めて `financial_metrics` に保存する。
  - `revenue_cagr_supplemented boolean`: CAGR が算出され、算出に使った5期に決算短信以外の出典の期がある。
  - `revenue_cagr_period_sources jsonb`: 算出に使った5期の、終了日・出典・書類ID・書類種別コード・提出日・連結か単体か。CAGR が算出不可なら NULL。
- 「補完あり」の印を出すのは、**CAGR が算出された銘柄だけ**。算出不可の銘柄には、補った期があっても一覧の印を出さない。詳細の表では出典が分かる。
- 画面の注記は次の2つに分ける（AC15.8）。
  - `mixed_consolidation` → 「連結・単体が混在」
  - `mixed_standard` → 「会計基準が混在」
  - Sprint 5〜7 の「連結と単体、または会計基準が異なる期を含みます」は、この2つに置き換える。

### 10. 注記の差し替え（AC15.12）

- `status-mark.tsx` の `PROVISIONAL_CAGR_NOTE`・`ProvisionalCagrNote` を、新しい注記 `CAGR_SUPPLEMENT_NOTE`・`CagrSupplementNote`（`data-testid="cagr-supplement-note"`）に置き換える。文言は「上場前の期は EDINET の有価証券届出書・有価証券報告書から補っています。書類から値を取れない銘柄は算出不可になることがあります。」
- 置く場所は Sprint 6・7 の注記と同じにする。
  - スクリーニングの条件①の近く（1280×800 で、開いた直後にスクロールなしで条件①と一緒に見える）。
  - 銘柄詳細の売上CAGR のカードで、理由が `insufficient_periods` のとき。
- 見た目は「注意」ではなく「情報」の控えめな表示にする。補完は通常の動作であり、警告ではないため。
- 旧い文言（「上場前の期のデータがまだ無いため」）は、アプリのどこにも出ない（`data-testid="cagr-provisional-note"` も無くなる）。Sprint 6・7 の E2E の注記の確認は、新しい注記に合わせて直す。

### 11. Sprint 8 評価の改善提案

- **m2（取り込む）**: 区画のどれかがフォールバックで決まった銘柄（9W007）では、出典の欄の文言を「最新の提出分: 訂正有価証券報告書 S8TEST62（2025-08-05 提出）。区画によっては元の有報の記載を表示しています」にする。「最新の提出分を使っています」とは書かない。
- **m3（取り込む）**: 区画だけが取り込み待ちのときの文言に、待っている書類の書類IDと提出日を入れる（例「記載を確かめる書類（有価証券報告書 S8TEST61、2025-06-26 提出）が取り込み待ちです」）。
- 行わないもの（self-review に明記する）:
  - m1（375px の大株主の表の列の配分）。表示の配置の見直しで、Sprint 10 で保有状態の内訳を加えるときにまとめて行う。
  - m4（遷移を待つ間の表示）。
  - m5（区画のビューの銘柄での絞り込み）。Sprint 10 で条件④をスクリーニングに組み込むときに行う。
  - m6（比率の桁の注記）。

## 3. 起動方法

ポート 3000 は別のプロジェクトが使っているので、すべて **3100 番**で行う。3000 番のプロセスには触れない。3100 番のサーバーを止めるときは、`lsof -ti tcp:3100` で得た PID だけを止める。`pkill -f next-server` のような広い停止はしない。

```bash
cd /Users/shuriokamoto/dev/quantis-light
pnpm install
pnpm db:start          # Docker が必要
pnpm db:reset          # Sprint 9 のマイグレーションを含めて適用
pnpm env:local
pnpm seed:users        # owner@quantis.local / Quantis-Owner-2026!
# キーなし（リポジトリ直下の .env にキーがあっても、空の値で上書きする）
JQUANTS_API_KEY= EDINET_API_KEY= CRON_SECRET=local-cron-secret-0123456789 pnpm dev -p 3100
# 本番相当: pnpm build && JQUANTS_API_KEY= EDINET_API_KEY= CRON_SECRET=local-cron-secret-0123456789 pnpm start -p 3100
```

- アプリ:
  - http://localhost:3100/stocks/9V001（詳細）
  - http://localhost:3100/screening?cagr=40&margin=10&years=5（スクリーニング）
  - http://localhost:3100/imports（取り込み状況）
- Postgres: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
- 評価用ユーザー: `owner@quantis.local` / `Quantis-Owner-2026!`
- E2E: `E2E_PORT=3100 E2E_CRON_SECRET=local-cron-secret-0123456789 pnpm test:e2e`、DB 込みのテスト: `pnpm test:db`
- 追加する環境変数は無い。**`.env` のキーの値を、ログ・レポート・self-review に書かない。**

## 4. 画面とエンドポイント

### 銘柄詳細画面 `/stocks/[code]`

**業績推移の5期の表**（既存の `period-tables.tsx`。AC15.2・AC15.5・AC15.8・AC15.9）
- 出典の列（`data-testid="cell-source"`、`data-source="tdnet_summary|edinet_annual_report|edinet_registration_statement"`）に、小さなラベルで「決算短信」「有価証券報告書」「有価証券届出書」を出す。
  - 1つの行の売上高と営業利益は、同じ出典・同じ書類から来る（第2章の7）。したがって、出典の列はその行の両方の値の出典である。
  - 列の見出しを「出典（売上高・営業利益）」にして、そのことを示す。
- EDINET の期の書類の列（`data-testid="cell-document"`、`data-doc-id`）:
  - 書類ID（等幅）
  - 訂正の書類なら「訂正」の小さなラベル
  - 提出日（`YYYY-MM-DD`）
  - 「EDINET で開く」のリンク（Sprint 8 の `edinetViewerUrl`。新しいタブ、`rel="noopener noreferrer"`、外部リンクのアイコン）
  - 同じ出典の中でその期を持つ書類が2通以上あるときは「書類2件（訂正あり）」のバッジ（Sprint 7 の「開示N件」のバッジの書類版）
  - 決算短信の期は従来どおり開示日。
- 基準の列（既存）: 「連結・日本基準」「単体・日本基準」「連結・IFRS」など。EDINET の期は、選んだ行（第2章の4 (c)）の連結・単体と会計基準。
- EDINET の期で売上高の名前が「売上高」でないとき、売上高のセルに小さく名前を出す（例「売上収益」）。
- EDINET の期の営業利益が NULL のときは「記載なし」と表示し、`title` を「書類の『主要な経営指標等の推移』に営業利益の記載がありません」にする（`data-kind="not-stated"`）。決算短信の NULL は従来どおり「開示なし」。
- 足りない期は従来どおり「データなし」（AC15.5）。
- グラフのツールチップ（Sprint 7）に出典（「出典: 有価証券届出書 S9TEST12」など）を加える。
- 「保存済みの通期実績をすべて表示」にも、同じ出典・書類の列を出す。
- 幅 375px では、表は枠の中だけで横スクロールし、ページ全体は横スクロールしない（既存の方針）。

**売上CAGR のカード**（`data-testid="metric-cagr"`）
- 算出に使った期（既存）の下に、補完がある場合は次を出す（`data-testid="metric-cagr-supplement"`）。
  - 「EDINET から補った期: 2021/03期（有価証券届出書）、2022/03期・2023/03期（有価証券報告書）」
- 混在の注記（`data-testid="metric-mixed-consolidation"`・`metric-mixed-standard`）: 「連結・単体が混在」「会計基準が混在」（第2章の9）。
- 理由が `insufficient_periods` のときは、新しい注記（第2章の10）。

**営業利益率のカード**: 直近通期の出典が決算短信以外のとき、「出典: 有価証券報告書 S…」を補足に出す（仕様の「直近通期の値の出典も優先順位に従う」の表示）。
- 直近通期の出典が EDINET で、理由が `operating_profit_not_disclosed` のときの表示（改善提案2）:
  - 理由は「算出不可（営業利益の記載なし）」と表示する。
  - 補足に「書類の『主要な経営指標等の推移』に営業利益の行がありません」を出す。
  - 理由のコードは変えない（算出は出典に依存しない）。表示の文言だけを、期の出典で選ぶ。スクリーニングの一覧の理由の表示も、同じ関数を使う。

**取り込み状況の画面の「銘柄コードで確認」の財務のカード**（`financial-card.tsx`）: 出典のラベルが「有価証券報告書」「有価証券届出書」になり、書類IDが出る（未知の出典の文字列 `edinet_…` をそのまま出さない）。

### スクリーニング画面 `/screening`

- **「補完あり」の印**（AC15.3）: 売上CAGR のセル（`data-testid="cell-cagr"`）で、`revenue_cagr_supplemented` の行の値の横に小さな印「補完」を出す（`data-testid="cagr-supplement-mark"`）。1文字の「補」では意味が伝わりにくいため、2文字にする（改善提案4）。
  - 印は `button`（`aria-label="補完あり: EDINET から補った期を表示"`）。
  - **マウスを乗せる、またはクリック（Enter・Space）で、ポップオーバー**（`data-testid="cagr-supplement-detail"`）を開く。中身は次のとおり。
    - 見出し「補完あり（EDINET から補った期）」
    - 補った期ごとに1行（例「2021/03期 有価証券届出書 S9TEST12（2023-02-20 提出）」）。決算短信の期は並べない。
    - 混在があれば「連結・単体が混在」「会計基準が混在」。
  - 印を押しても**銘柄詳細へ移らない**（行のクリック・Sprint 8 の `openDetail` に伝わらない）。Esc・外側のクリックで閉じる。
  - 印とポップオーバーの内容は、表示中の結果の行（サーバーの応答）から作る。
- 決算短信だけで算出した行、CAGR が算出不可の行には印が無い。
- 注記の差し替え（第2章の10）。
- 絞り込み・並べ替えは変えない（`revenue_cagr` で行う。AC15.4）。
- 幅 375px でも印がセルの中に収まり、ポップオーバーが画面の外に切れない。

### 取り込み状況の画面 `/imports`

- 「今すぐ取り込み」の対象を「EDINET（有報・届出書）」にする（第2章の2）。
- 新しい区画「上場前の期の補完（EDINET）」（`data-testid="business-results-panel"`。有報の区画の下）。値は DB 関数 `business_results_summary()` を1回呼んで出す（ユーザーのセッション。security invoker）。
  - **EDINET から期を補った銘柄**（AC15.11。`data-testid="supplemented-stock-count"`）: 銘柄マスタの銘柄のうち、`financial_periods` に決算短信以外の出典の期が1つ以上ある銘柄の数 / 銘柄マスタの銘柄数。説明「決算短信に無い期（主に上場前の期）を、有価証券報告書・届出書から補った銘柄」。
  - **うち売上CAGR の算出に補った期を使った銘柄**（`data-testid="supplemented-cagr-count"`）: `revenue_cagr_supplemented` の銘柄数。
  - 主要な経営指標等を処理した書類: 有報・届出書それぞれの数と、結果ごとの数（読み取れた・記載なし・読み取れず・XBRL なし）。
  - **取り込み待ちの書類**（R2）: 第2章の3の対象のうち、**主要な経営指標等（`business_results_extractions`）が未処理の書類だけ**の数。大株主・役員が未処理かどうかは数えない。あわせて、直前の EDINET の実行で処理した書類数を出す。
  - **Sprint 8 の区画の「取り込み待ちの書類」は意味を変えない**: 大株主・役員（`annual_report_extractions`）が未処理の有報だけを数える（`annual_reports_summary()` は変えない）。本文を取得する書類（`edinet_ingestion_state`）は「どちらかが未処理」の書類になるが、各区画の数はそれぞれの処理だけで数える。
  - 銘柄に結び付かない届出書の数（第2章の6）。
  - データが0件なら「まだ上場前の期の補完は行われていません」。キーが未設定なら、有報の区画と同じキーの注記を出す。
- 実行履歴の結果の文言（`result-message.ts`）に、主要な経営指標等の要約を加える。例「書類 12 件を処理（大株主・役員の抽出 9 件、抽出できず 1 件／主要な経営指標等 10 件、記載なし 2 件）」。

### ダッシュボード

変更しない。「財務指標を算出できた銘柄数」とその内訳（売上CAGR・営業利益率）は `financial_metrics` の集計である。補完で算出できた銘柄は、再計算で自動的に含まれる（AC15.11）。

### エンドポイント

| メソッドとパス | 認証 | 内容 |
|---|---|---|
| `GET /api/stocks/[code]` | 既存 | **変更**。財務の期（`periods`）に、第2章の7の追加の列と `edinet_url` を加える。`metrics` に `revenue_cagr_supplemented`・`revenue_cagr_period_sources`・`revenue_cagr_mixed_consolidation`・`revenue_cagr_mixed_standard` を加える |
| `GET /api/financials?code=` | 既存 | 同上（`metrics`・`periods` の形を `/api/stocks/[code]` とそろえる） |
| `GET /api/screening` | 既存 | 行に `revenue_cagr_supplemented`・`revenue_cagr_supplement`（補った期の配列。終了日・出典・書類ID・書類種別コード・提出日）・`revenue_cagr_mixed_consolidation`・`revenue_cagr_mixed_standard` を加える。ほかは変えない |
| `POST /api/ingestion/runs` | 既存 | `target: "edinet_reports"` のまま（表示だけが変わる） |
| `GET /api/cron/edinet` | 既存 | 変更なし（同じ実行で主要な経営指標等も処理する） |

- 未ログイン 401、許可リスト外 403、`Cache-Control: no-store`（既存のまま）。
- 補完した値だけを返す新しいエンドポイント・エクスポートは作らない。

## 5. データの保存形式と追加する DB オブジェクト

マイグレーション `supabase/migrations/20261002000000_edinet_business_results.sql`（名前は目安）。

- テーブルはすべて RLS 有効・anon の権限なし・`authenticated` は許可リスト登録済みのときだけ select・書き込みは service_role だけ（`public.stocks` と同じ方針）。
- `e2e/db-privileges.spec.ts` の許可リストを更新する。

| オブジェクト | 内容 |
|---|---|
| `public.edinet_filers` | 提出者と証券コードの対応。主キー `edinet_code`。列: `sec_code text not null`（5文字）、`filer_name text`、`seen_submitted_at timestamptz`（その対応を最後に見た書類の提出日時）、`updated_at` |
| `public.business_results_extractions` | 書類ごとの主要な経営指標等の抽出の結果（＝この処理の処理済みの記録）。主キー `doc_id`（`edinet_documents` への外部キー。on delete cascade）。列: `processed_at`、`status text`（`ok`／`no_xbrl`／`section_not_found`／`invalid_values`）、`detail text null`（例 `non_jpy_unit`・`invalid_period`・`conflicting_facts`・`not_numeric`・`revenue_element_unknown`・`no_inline_xbrl`）、`period_count integer` |
| `public.business_results_periods` | 書類の期の値。主キー (`doc_id`, `fiscal_year_end`, `consolidated`)。`doc_id` は `business_results_extractions` への外部キー（on delete cascade）。列: `fiscal_year_start date not null`、`fiscal_year_end date not null`（check `fiscal_year_end > fiscal_year_start`）、`consolidated boolean not null`、`accounting_standard text not null`（`JP`／`IFRS`／`US`／`JMIS`）、`net_sales numeric null`（円）、`operating_profit numeric null`（円）、`revenue_element text null`、`operating_profit_element text null` |
| ビュー `public.edinet_document_codes`（security_invoker） | 書類ごとの銘柄コード（第2章の6。書類の `sec_code`、無ければ `edinet_filers`）。銘柄マスタにある銘柄だけ |
| ビュー `public.financial_periods`（再作成） | 第2章の7。EDINET の期を union all で加え、列を追加する（既存の列・意味は変えない） |
| `public.financial_metrics_from_periods(jsonb)`（置き換え） | 第2章の9。`revenue_cagr_mixed_consolidation`・`revenue_cagr_mixed_standard` を返す。ほかは変えない |
| `public.financial_metrics` の列の追加 | `revenue_cagr_mixed_consolidation boolean`、`revenue_cagr_mixed_standard boolean`、`revenue_cagr_supplemented boolean not null default false`、`revenue_cagr_period_sources jsonb` |
| `public.recalculate_financial_metrics(text[])`（置き換え） | 上の列も保存する |
| トリガー | 第2章の8の表のとおり（文単位） |
| `public.edinet_ingestion_state(p_from, p_to)`（置き換え） | 本文を取得する書類に、必要な処理（`annualReport`・`businessResults`）を付けて返す。取得の順番は第2章の3 |
| `public.save_edinet_document_list(...)`（置き換え） | 一覧の行から `edinet_filers` も更新する（同じトランザクション） |
| `public.save_business_results_extraction(p_run_id bigint, p_doc_id text, p_result jsonb)` | service_role。1書類の結果と期の行の保存（1トランザクション）。実行が `running` でなければ何もしない。同じ書類で大株主・役員も保存する場合も、処理件数は書類ごとに1だけ足す（足し方はジェネレーターが決める。第2章の2・C6） |
| `public.prepare_edinet_filers_backfill()` | service_role。導入時に `edinet_filers` を作り、取得済みの一覧の日の記録を消す（第2章の6。R1）。マイグレーションが1回呼ぶ |
| `public.business_results_summary()` | authenticated、service_role（security invoker）。取り込み状況の区画の集計 |
| `public.screen_stocks(jsonb)`・`public.stock_detail(text, jsonb)` | 行の出力に第4章のエンドポイントの項目を加える。判定（`screening_evaluate`）は変えない |

- 列名・関数名は目安。変える場合は self-review と CLAUDE.md に実際の名前を書き、第5章の投入例（`e2e/fixtures/business-results-example.sql`）を実際の列に合わせる。**評価者は `e2e/fixtures/business-results-example.sql` を正として投入する。**

### 投入例（`postgres` ユーザーで実行。RLS を迂回する）

`e2e/fixtures/business-results-example.sql`（新規。E2E と `pnpm test:db` が共有する）。

- 銘柄コードは `9V001`〜`9V010`、書類IDは `S9TEST` で始める。
- 金額は億円で書いて円にする（Sprint 7 の投入例と同じ。表示は百万円なので 100 → `10,000`）。
- すべて3月決算（9V003 を除く）。

```sql
-- 契約（docs/harness/sprints/sprint-09/contract.md）の第5章の投入例
insert into public.ingestion_runs (target, trigger, status, started_at, finished_at, processed_count)
values ('daily_quotes', 'manual', 'succeeded', '2026-09-24 20:00:00+09', '2026-09-24 20:03:00+09', 0);  -- 基準日 2026-09-24

insert into public.stocks (code, company_name, market_code, market_name, sector33_code, sector33_name, product_category)
values ('9V001', '検証用補完優先株式会社',   '0113', 'グロース', '5250', '情報・通信業', '011'),
       ('9V002', '検証用補完四期株式会社',   '0113', 'グロース', '5250', '情報・通信業', '011'),
       ('9V003', '検証用補完変則株式会社',   '0113', 'グロース', '9050', 'サービス業',   '011'),
       ('9V004', '検証用補完欠落株式会社',   '0113', 'グロース', '9050', 'サービス業',   '011'),
       ('9V005', '検証用後から補完株式会社', '0113', 'グロース', '5250', '情報・通信業', '011'),
       ('9V006', '検証用短信五期株式会社',   '0113', 'グロース', '5250', '情報・通信業', '011'),
       ('9V007', '検証用連結単体株式会社',   '0113', 'グロース', '3050', '食料品',       '011'),
       ('9V008', '検証用訂正届出株式会社',   '0113', 'グロース', '5250', '情報・通信業', '011'),
       ('9V009', '検証用IFRS補完株式会社',   '0111', 'プライム', '5250', '情報・通信業', '011'),
       ('9V010', '検証用未結合株式会社',     '0113', 'グロース', '5250', '情報・通信業', '011');

insert into public.stock_listing_dates (code, first_price_date, data_start_date)
select c, '2024-03-15', '2016-09-26' from unnest(array['9V001','9V002','9V003','9V004','9V005','9V006','9V007','9V008','9V009','9V010']) c;
-- 推定上場年数 2.6年（条件③の既定 5年以内を満たす）

-- 決算短信
insert into public.financial_statements
  (code, disclosure_no, disclosed_date, disclosed_time, document_type, fiscal_year_start, fiscal_year_end, net_sales, operating_profit)
select v.code, v.no, v.disclosed::date, '15:00:00', v.doc, v.fy_start::date, v.fy_end::date, v.sales * 100000000, v.op * 100000000
from (values
  ('9V001', 'S9A1', '2024-05-14', 'FYFinancialStatements_Consolidated_JP', '2023-04-01', '2024-03-31', 300::numeric, 30::numeric),
  ('9V001', 'S9A2', '2025-05-14', 'FYFinancialStatements_Consolidated_JP', '2024-04-01', '2025-03-31', 400, 48),
  ('9V002', 'S9B1', '2024-05-14', 'FYFinancialStatements_Consolidated_JP', '2023-04-01', '2024-03-31', 300, 30),
  ('9V002', 'S9B2', '2025-05-14', 'FYFinancialStatements_Consolidated_JP', '2024-04-01', '2025-03-31', 400, 48),
  ('9V003', 'S9C1', '2025-02-14', 'FYFinancialStatements_Consolidated_JP', '2024-01-01', '2024-12-31', 300, 30),
  ('9V003', 'S9C2', '2026-02-14', 'FYFinancialStatements_Consolidated_JP', '2025-01-01', '2025-12-31', 400, 48),
  ('9V004', 'S9D1', '2024-05-14', 'FYFinancialStatements_Consolidated_JP', '2023-04-01', '2024-03-31', 300, 30),
  ('9V004', 'S9D2', '2025-05-14', 'FYFinancialStatements_Consolidated_JP', '2024-04-01', '2025-03-31', 400, 48),
  ('9V005', 'S9E1', '2023-05-12', 'FYFinancialStatements_Consolidated_JP', '2022-04-01', '2023-03-31', 180, 18),
  ('9V005', 'S9E2', '2024-05-14', 'FYFinancialStatements_Consolidated_JP', '2023-04-01', '2024-03-31', 240, 24),
  ('9V005', 'S9E3', '2025-05-14', 'FYFinancialStatements_Consolidated_JP', '2024-04-01', '2025-03-31', 300, 36),
  ('9V006', 'S9F1', '2021-05-14', 'FYFinancialStatements_Consolidated_JP', '2020-04-01', '2021-03-31', 120, 12),
  ('9V006', 'S9F2', '2022-05-13', 'FYFinancialStatements_Consolidated_JP', '2021-04-01', '2022-03-31', 150, 15),
  ('9V006', 'S9F3', '2023-05-12', 'FYFinancialStatements_Consolidated_JP', '2022-04-01', '2023-03-31', 180, 18),
  ('9V006', 'S9F4', '2024-05-14', 'FYFinancialStatements_Consolidated_JP', '2023-04-01', '2024-03-31', 240, 24),
  ('9V006', 'S9F5', '2025-05-14', 'FYFinancialStatements_Consolidated_JP', '2024-04-01', '2025-03-31', 300, 36),
  ('9V007', 'S9G1', '2025-05-14', 'FYFinancialStatements_Consolidated_JP', '2024-04-01', '2025-03-31', 400, 60),
  ('9V008', 'S9H1', '2025-05-14', 'FYFinancialStatements_Consolidated_JP', '2024-04-01', '2025-03-31', 300, 36),
  ('9V009', 'S9I1', '2024-05-14', 'FYFinancialStatements_Consolidated_IFRS', '2023-04-01', '2024-03-31', 500, 60),
  ('9V009', 'S9I2', '2025-05-14', 'FYFinancialStatements_Consolidated_IFRS', '2024-04-01', '2025-03-31', 600, 75),
  ('9V010', 'S9J1', '2023-05-12', 'FYFinancialStatements_Consolidated_JP', '2022-04-01', '2023-03-31', 180, 18),
  ('9V010', 'S9J2', '2024-05-14', 'FYFinancialStatements_Consolidated_JP', '2023-04-01', '2024-03-31', 240, 24),
  ('9V010', 'S9J3', '2025-05-14', 'FYFinancialStatements_Consolidated_JP', '2024-04-01', '2025-03-31', 300, 36)
) as v(code, no, disclosed, doc, fy_start, fy_end, sales, op);

-- 提出者と証券コードの対応（9V008 の届出書は証券コードが無く、上場後の書類で結び付く）
insert into public.edinet_filers (edinet_code, sec_code, filer_name, seen_submitted_at)
values ('E99V08', '9V008', '検証用訂正届出株式会社', '2025-11-14 15:00+09');

-- EDINET の書類のメタデータ（Sprint 8 のテーブル）
insert into public.edinet_documents
  (doc_id, sec_code, edinet_code, filer_name, doc_type_code, ordinance_code, form_code,
   period_start, period_end, submitted_at, parent_doc_id, doc_description, withdrawn, withheld, xbrl_available, list_date)
values
  ('S9TEST11', '9V001', 'E99V01', '検証用補完優先株式会社', '120', '010', '030000', '2023-04-01', '2024-03-31', '2024-06-26 15:00+09', null, '有価証券報告書－第10期', false, false, true, '2024-06-26'),
  ('S9TEST12', '9V001', 'E99V01', '検証用補完優先株式会社', '030', '010', '020000', null, null, '2023-02-20 15:00+09', null, '有価証券届出書（新規公開時）', false, false, true, '2023-02-20'),
  ('S9TEST13', '9V001', 'E99V01', '検証用補完優先株式会社', '040', '010', '020001', null, null, '2023-03-01 15:00+09', 'S9TEST12', '訂正有価証券届出書（新規公開時）', true, false, true, '2023-03-01'),  -- 取り下げ（使わない）
  ('S9TEST21', '9V002', 'E99V02', '検証用補完四期株式会社', '030', '010', '020000', null, null, '2024-02-20 15:00+09', null, '有価証券届出書（新規公開時）', false, false, true, '2024-02-20'),
  ('S9TEST22', '9V002', 'E99V02', '検証用補完四期株式会社', '120', '010', '030000', '2024-04-01', '2025-03-31', '2025-06-25 15:00+09', null, '有価証券報告書－第5期', false, false, true, '2025-06-25'),
  ('S9TEST31', '9V003', 'E99V03', '検証用補完変則株式会社', '120', '010', '030000', '2023-01-01', '2023-12-31', '2024-03-28 15:00+09', null, '有価証券報告書－第8期', false, false, true, '2024-03-28'),
  ('S9TEST41', '9V004', 'E99V04', '検証用補完欠落株式会社', '030', '010', '020000', null, null, '2023-02-20 15:00+09', null, '有価証券届出書（新規公開時）', false, false, true, '2023-02-20'),
  ('S9TEST42', '9V004', 'E99V04', '検証用補完欠落株式会社', '120', '010', '030000', '2024-04-01', '2025-03-31', '2025-06-26 15:00+09', null, '有価証券報告書－第6期', false, false, true, '2025-06-26'),  -- 取り込み待ち
  ('S9TEST71', '9V007', 'E99V07', '検証用連結単体株式会社', '030', '010', '020000', null, null, '2024-12-10 15:00+09', null, '有価証券届出書（新規公開時）', false, false, true, '2024-12-10'),
  ('S9TEST81', null,    'E99V08', '検証用訂正届出株式会社', '030', '010', '020000', null, null, '2025-02-10 15:00+09', null, '有価証券届出書（新規公開時）', false, false, true, '2025-02-10'),
  ('S9TEST82', null,    'E99V08', '検証用訂正届出株式会社', '040', '010', '020001', null, null, '2025-02-25 15:00+09', 'S9TEST81', '訂正有価証券届出書（新規公開時）', false, false, true, '2025-02-25'),
  ('S9TEST91', '9V009', 'E99V09', '検証用IFRS補完株式会社', '120', '010', '030000', '2023-04-01', '2024-03-31', '2024-06-20 15:00+09', null, '有価証券報告書－第30期', false, false, true, '2024-06-20'),
  ('S9TEST99', null,    'E99V10', '検証用未結合株式会社',   '030', '010', '020000', null, null, '2023-02-20 15:00+09', null, '有価証券届出書（新規公開時）', false, false, true, '2023-02-20');  -- 結び付かない

insert into public.business_results_extractions (doc_id, processed_at, status, detail, period_count)
values ('S9TEST11', now(), 'ok', null, 3), ('S9TEST12', now(), 'ok', null, 2), ('S9TEST13', now(), 'ok', null, 1),
       ('S9TEST21', now(), 'ok', null, 2), ('S9TEST22', now(), 'section_not_found', null, 0),
       ('S9TEST31', now(), 'ok', null, 4), ('S9TEST41', now(), 'ok', null, 3), ('S9TEST71', now(), 'ok', null, 6),
       ('S9TEST81', now(), 'ok', null, 4), ('S9TEST82', now(), 'ok', null, 4), ('S9TEST91', now(), 'ok', null, 4),
       ('S9TEST99', now(), 'ok', null, 2);

insert into public.business_results_periods
  (doc_id, fiscal_year_start, fiscal_year_end, consolidated, accounting_standard, net_sales, operating_profit, revenue_element, operating_profit_element)
select v.doc, v.fy_start::date, v.fy_end::date, v.cons, v.std, v.sales * 100000000, v.op * 100000000, v.rev_el, case when v.op is null then null else v.op_el end
from (values
  -- 9V001（AC15.1）: 有報 FY-3 150・FY-2 200・FY-1 310（営業利益の記載なし）、届出書 FY-4 100・FY-3 140、取り下げの訂正届出書 FY-4 999
  ('S9TEST11', '2021-04-01', '2022-03-31', true, 'JP', 150::numeric, null::numeric, 'NetSalesSummaryOfBusinessResults', null::text),
  ('S9TEST11', '2022-04-01', '2023-03-31', true, 'JP', 200, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST11', '2023-04-01', '2024-03-31', true, 'JP', 310, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST12', '2020-04-01', '2021-03-31', true, 'JP', 100,    8, 'NetSalesSummaryOfBusinessResults', 'OperatingIncome'),
  ('S9TEST12', '2021-04-01', '2022-03-31', true, 'JP', 140,   11, 'NetSalesSummaryOfBusinessResults', 'OperatingIncome'),
  ('S9TEST13', '2020-04-01', '2021-03-31', true, 'JP', 999,   99, 'NetSalesSummaryOfBusinessResults', 'OperatingIncome'),
  -- 9V002（AC15.5）: 届出書 2022/03・2023/03（決算短信 2024/03・2025/03 と重ならない。計4期）
  ('S9TEST21', '2021-04-01', '2022-03-31', true, 'JP', 150, 15, 'NetSalesSummaryOfBusinessResults', 'OperatingIncome'),
  ('S9TEST21', '2022-04-01', '2023-03-31', true, 'JP', 200, 20, 'NetSalesSummaryOfBusinessResults', 'OperatingIncome'),
  -- 9V003（AC15.6 変則）: 3月決算 → 12月決算。2022/12期は9か月
  ('S9TEST31', '2020-04-01', '2021-03-31', true, 'JP', 100, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST31', '2021-04-01', '2022-03-31', true, 'JP', 150, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST31', '2022-04-01', '2022-12-31', true, 'JP', 160, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST31', '2023-01-01', '2023-12-31', true, 'JP', 250, null, 'NetSalesSummaryOfBusinessResults', null),
  -- 9V004（AC15.6 欠落）: 届出書 2020/03〜2022/03。2023/03期が無い
  ('S9TEST41', '2019-04-01', '2020-03-31', true, 'JP',  80, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST41', '2020-04-01', '2021-03-31', true, 'JP', 100, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST41', '2021-04-01', '2022-03-31', true, 'JP', 150, null, 'NetSalesSummaryOfBusinessResults', null),
  -- 9V007（AC15.8）: 連結は 2023/03・2024/03 だけ、単体は4期
  ('S9TEST71', '2022-04-01', '2023-03-31', true,  'JP', 250, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST71', '2023-04-01', '2024-03-31', true,  'JP', 300, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST71', '2020-04-01', '2021-03-31', false, 'JP', 100, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST71', '2021-04-01', '2022-03-31', false, 'JP', 150, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST71', '2022-04-01', '2023-03-31', false, 'JP', 200, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST71', '2023-04-01', '2024-03-31', false, 'JP', 240, null, 'NetSalesSummaryOfBusinessResults', null),
  -- 9V008（AC15.9）: 元の届出書と訂正届出書（訂正が新しい）
  ('S9TEST81', '2020-04-01', '2021-03-31', true, 'JP',  90, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST81', '2021-04-01', '2022-03-31', true, 'JP', 110, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST81', '2022-04-01', '2023-03-31', true, 'JP', 150, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST81', '2023-04-01', '2024-03-31', true, 'JP', 200, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST82', '2020-04-01', '2021-03-31', true, 'JP', 100, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST82', '2021-04-01', '2022-03-31', true, 'JP', 120, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST82', '2022-04-01', '2023-03-31', true, 'JP', 150, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST82', '2023-04-01', '2024-03-31', true, 'JP', 200, null, 'NetSalesSummaryOfBusinessResults', null),
  -- 9V009（IFRS。売上収益。営業利益の行なし）: 有報 2021/03〜2024/03。2024/03期は決算短信が優先
  ('S9TEST91', '2020-04-01', '2021-03-31', true, 'IFRS', 250, null, 'RevenueIFRSSummaryOfBusinessResults', null),
  ('S9TEST91', '2021-04-01', '2022-03-31', true, 'IFRS', 300, null, 'RevenueIFRSSummaryOfBusinessResults', null),
  ('S9TEST91', '2022-04-01', '2023-03-31', true, 'IFRS', 400, null, 'RevenueIFRSSummaryOfBusinessResults', null),
  ('S9TEST91', '2023-04-01', '2024-03-31', true, 'IFRS', 510, null, 'RevenueIFRSSummaryOfBusinessResults', null),
  -- 9V010 に結び付かない届出書（提出者の証券コードが不明。社名では結び付けない）
  ('S9TEST99', '2020-04-01', '2021-03-31', true, 'JP', 120, null, 'NetSalesSummaryOfBusinessResults', null),
  ('S9TEST99', '2021-04-01', '2022-03-31', true, 'JP', 150, null, 'NetSalesSummaryOfBusinessResults', null)
) as v(doc, fy_start, fy_end, cons, std, sales, op, rev_el, op_el);
```

- 営業利益の要素名 `OperatingIncome` は投入例のための仮の値である。実装で確かめた要素名に合わせて投入例を直してよい。表示には使わない。
- 9V001 の有報 `S9TEST11` には、AC15.1 に合わせて 2022/03〜2024/03 の3期だけを入れる（実際の有報なら5期あるが、2021/03期を入れると有報が届出書より優先されるため）。有報と届出書が同じ期で重なる場合の優先順位は、C4-6 で評価者が行を足して確かめる。

追加の投入（AC15.7。`e2e/fixtures/business-results-add.sql`）:

```sql
insert into public.edinet_documents
  (doc_id, sec_code, edinet_code, filer_name, doc_type_code, ordinance_code, form_code,
   period_start, period_end, submitted_at, parent_doc_id, doc_description, withdrawn, withheld, xbrl_available, list_date)
values ('S9TEST51', '9V005', 'E99V05', '検証用後から補完株式会社', '030', '010', '020000', null, null, '2023-02-20 15:00+09', null, '有価証券届出書（新規公開時）', false, false, true, '2023-02-20');
insert into public.business_results_extractions (doc_id, processed_at, status, detail, period_count)
values ('S9TEST51', now(), 'ok', null, 2);
insert into public.business_results_periods
  (doc_id, fiscal_year_start, fiscal_year_end, consolidated, accounting_standard, net_sales, operating_profit, revenue_element, operating_profit_element)
values ('S9TEST51', '2020-04-01', '2021-03-31', true, 'JP', 12000000000, null, 'NetSalesSummaryOfBusinessResults', null),
       ('S9TEST51', '2021-04-01', '2022-03-31', true, 'JP', 15000000000, null, 'NetSalesSummaryOfBusinessResults', null);
```

後片付け（`e2e/fixtures/business-results-cleanup.sql`）:

```sql
delete from public.edinet_documents where doc_id like 'S9TEST%';   -- 抽出の結果・期の行も連鎖して消える
delete from public.edinet_filers where edinet_code like 'E99V%';
delete from public.stocks where code like '9V%';                   -- 決算短信・指標・初出日も連鎖して消える
delete from public.ingestion_runs;
```

### 期待される表示と値

（第5章の実際のファイルの投入例。すべて金額は百万円。「届」= 有価証券届出書、「報」= 有価証券報告書、「短」= 決算短信。）

| コード | 5期の表（FY-4 → FY0） | 売上CAGR | 一覧の印 | そのほか |
|---|---|---|---|---|
| 9V001 | 2021/03 10,000 届 `S9TEST12` → 2022/03 15,000 報 `S9TEST11` → 2023/03 20,000 報 → 2024/03 30,000 短 → 2025/03 40,000 短 | 41.4% | あり。3期（2021/03 届 S9TEST12、2022/03・2023/03 報 S9TEST11） | 31,000（有報の 2024/03）・14,000（届出書の 2022/03）・99,900（取り下げ）はどこにも出ない。2022/03・2023/03 の営業利益は「記載なし」、2021/03 の営業利益は 800。営業利益率 12.0% |
| 9V002 | 2021/03 データなし → 2022/03 15,000 届 → 2023/03 20,000 届 → 2024/03 30,000 短 → 2025/03 40,000 短 | 算出不可（通期実績が5期未満） | なし | CAGR のカードに新しい注記 |
| 9V003 | 2021/03 報 → 2022/03 報 → 2022/12 16,000 報（変則決算・9か月） → 2023/12 報 → 2024/12 短 → 2025/12 短（5期の枠は FY0 2025/12 から） | 算出不可（直近5期に変則決算を含む） | なし | 期の連続は 2021/03 まで。5期の枠は 2025/12・2024/12・2023/12・2022/12・2022/03 |
| 9V004 | 2021/03 届 → 2022/03 届 → 2023/03 データなし → 2024/03 短 → 2025/03 短 | 算出不可（直近5期の通期実績が連続していない） | なし | |
| 9V005 | 追加前: 2021/03・2022/03 データなし、2023/03〜2025/03 短 | 追加前: 算出不可（通期実績が5期未満）。追加後: 25.7% | 追加後: あり（2021/03・2022/03 届 S9TEST51） | 追加後の CAGR は 9V006 と一致 |
| 9V006 | すべて短 | 25.7% | なし | 出典はすべて「決算短信」 |
| 9V007 | 2021/03 10,000 届（単体）→ 2022/03 15,000 届（単体）→ 2023/03 25,000 届（連結）→ 2024/03 30,000 届（連結）→ 2025/03 40,000 短（連結） | 41.4% | あり。印の説明に「連結・単体が混在」 | CAGR のカードに「連結・単体が混在」。2023/03・2024/03 の単体の値（20,000・24,000）は出ない |
| 9V008 | 2021/03 10,000 → 2022/03 12,000 → 2023/03 15,000 → 2024/03 20,000（いずれも届、書類 `S9TEST82`・「訂正」ラベル・「書類2件（訂正あり）」）→ 2025/03 30,000 短 | 31.6% | あり（4期、S9TEST82） | 元の届出書の 9,000・11,000 は出ない。証券コードの無い届出書が `edinet_filers` で結び付く |
| 9V009 | 2021/03 25,000 報（連結・IFRS、「売上収益」）→ 2022/03 30,000 報 → 2023/03 40,000 報 → 2024/03 50,000 短 → 2025/03 60,000 短 | 24.4% | あり（3期） | 有報の 2024/03 の 51,000 は出ない。営業利益率 12.5%（決算短信）。EDINET の期の営業利益は「記載なし」 |
| 9V010 | 2023/03〜2025/03 短（3期）、2021/03・2022/03 データなし | 算出不可（通期実績が5期未満） | なし | `S9TEST99` は結び付かないので使われない |

- CAGR の値: 9V001・9V007 は (400/100)^(1/4) − 1 = 41.42…% → 41.4%。9V005・9V006 は (300/120)^(1/4) − 1 = 25.74…% → 25.7%。9V008 は (300/100)^(1/4) − 1 = 31.60…% → 31.6%。9V009 は (600/250)^(1/4) − 1 = 24.46…% → 24.4%。
- 取り込み状況の区画（銘柄マスタがこの10銘柄だけのとき。9V005 の追加前）:
  - EDINET から期を補った銘柄 7 / 10（9V001・9V002・9V003・9V004・9V007・9V008・9V009）
  - うち売上CAGR の算出に補った期を使った銘柄 4（9V001・9V007・9V008・9V009）
  - 処理した書類: 有報 4（`S9TEST11`・`22`・`31`・`91`）、届出書 8（`S9TEST12`・`13`・`21`・`41`・`71`・`81`・`82`・`99`）。読み取れた 11、記載なし 1（`S9TEST22`）。取り下げの書類の結果も数える
  - 取り込み待ちの書類 1（`S9TEST42`）
  - 銘柄に結び付かない届出書 1（`S9TEST99`）
  - 9V005 の追加後: 補った銘柄 8、CAGR に使った銘柄 5

## 6. テスト可能な完了条件

前提:
- 第3章の手順で 3100 番に起動し（キーなし）、`owner@quantis.local` でログイン済み。画面の幅は特記の無い限り 1280×800。
- DB は `pnpm db:reset && pnpm seed:users` 直後から始める。データを使う条件では、第5章の投入例（`business-results-example.sql`）を入れる。
- 特記の無い限り、`pnpm dev -p 3100` と `pnpm build && pnpm start -p 3100` の両方で満たすこと。

### C1. 出典の優先順位と5期の表（AC15.1・AC15.2）
1. `/stocks/9V001` の5期の表が第5章の表のとおりになる。
   - 各行の売上高のセルの `data-yen` は、`financial_periods` の値（円）と一致する。
   - 出典の列の `data-source` は、2021/03 `edinet_registration_statement`、2022/03・2023/03 `edinet_annual_report`、2024/03・2025/03 `tdnet_summary`。
   - ラベルは「有価証券届出書」「有価証券報告書」「決算短信」。
2. 表・グラフ・「保存済みの通期実績をすべて表示」のどこにも、`31,000`（有報の 2024/03）、`14,000`（届出書の 2022/03）、`99,900`（取り下げた訂正届出書）が出ない。
3. EDINET の期の書類の列に、書類ID（`S9TEST12`・`S9TEST11`）、提出日（`2023-02-20`・`2024-06-26`）、EDINET へのリンクがある。
   - リンクの `href` は `https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx?S9TEST12,,` の形。`target="_blank"`、`rel` に `noopener`。
   - 決算短信の期には、EDINET へのリンクが無い。
4. 2022/03・2023/03 の営業利益は「記載なし」（`data-kind="not-stated"`、`title` あり）。2021/03 の営業利益は `800`。
5. 売上CAGR は `41.4%`。算出に使った期は「2021/03期 → 2025/03期（4年）」。`metric-cagr-supplement` に 2021/03期（有価証券届出書）と 2022/03期・2023/03期（有価証券報告書）が出る。営業利益率は `12.0%`。
6. `/stocks/9V006` は、5期すべての出典が「決算短信」で、EDINET のリンク・`metric-cagr-supplement` が無い。
7. グラフの 2021/03期の棒のツールチップに「有価証券届出書」が出る（ホバーまたはフォーカス）。
8. `GET /api/stocks/9V001` の `periods` の5期の `source`・`source_document_id`・`source_document_type_code`・`edinet_url` が画面と一致する。`metrics.revenue_cagr_supplemented` は `true`、`revenue_cagr_period_sources` は5件。`GET /api/stocks/9V006` は `false`・5件すべて `tdnet_summary`。
9. `/imports?code=9V001`（銘柄コードで確認）の財務のカードの出典が「有価証券届出書」「有価証券報告書」「決算短信」で出る（`edinet_…` の文字列が出ない）。

### C2. スクリーニングの印と絞り込み（AC15.3・AC15.4）
1. `/screening?cagr=40&margin=10&years=5` に 9V001・9V007 が出て、`9V001` の行の売上CAGR のセルに `cagr-supplement-mark` がある。
2. 印にマウスを乗せると `cagr-supplement-detail` が開き、「2021/03期 有価証券届出書 S9TEST12（2023-02-20 提出）」「2022/03期 有価証券報告書 S9TEST11（2024-06-26 提出）」「2023/03期 有価証券報告書 S9TEST11（2024-06-26 提出）」の3行が出る。決算短信の期は並ばない。
3. 印をクリック・Enter でも開く。**URL は `/screening…` のまま**で、銘柄詳細へ移らない（1,500ms 後も）。Esc で閉じる。
4. `9V007` の印の説明に「連結・単体が混在」がある。
5. `/screening?cagr=45&margin=10&years=5` には 9V001 が出ない（AC15.4）。`cagr=40` と `cagr=45` の件数の差に 9V001 が含まれる。
6. `/screening?cagr=20&margin=10&years=5` で、`9V006`（決算短信だけ）の行には印が無い。`9V005`（追加前）は結果に出ない。`unavailable=include` を付けると `9V005` は「算出不可（通期実績が5期未満）」で出て、印が無い。
7. `GET /api/screening?cagr=40&margin=10&years=5` の `9V001` の行の `revenue_cagr_supplemented` が `true`、`revenue_cagr_supplement` が3件（画面と同じ）。`9V006` の行は `false`・空。
8. 幅 375px で、印がセルに収まり、ポップオーバーの `getBoundingClientRect()` が `left >= 0`・`right <= 375`。ページ全体の横スクロールが無い。

### C3. 補完しても算出不可（AC15.5・AC15.6）
1. `/stocks/9V002` の売上CAGR は「算出不可（通期実績が5期未満）」。5期の表の 2021/03期（FY-4）が「データなし」、2022/03・2023/03 は「有価証券届出書」。新しい注記（第2章の10）がカードにある。
2. `/stocks/9V003` の売上CAGR は「算出不可（直近5期に変則決算を含む）」。2022/12期に変則決算のバッジ（9か月）があり、出典は「有価証券報告書」。
3. `/stocks/9V004` の売上CAGR は「算出不可（直近5期の通期実績が連続していない）」。2023/03期（FY-2）が「データなし」。
4. `financial_metrics` の `revenue_cagr_unavailable_reason` が、9V002 `insufficient_periods`、9V003 `irregular_period`、9V004 `non_consecutive_periods`（評価者は psql で確かめる）。

### C4. 算出の定義は変わらない・期の選び方（AC15.7・AC15.9・AC15.13 の優先順位）
1. `/stocks/9V005` の売上CAGR は「算出不可（通期実績が5期未満）」。`business-results-add.sql` を入れ、**画面をリロードするだけで** `25.7%` になり、5期の表の 2021/03・2022/03 が「有価証券届出書」になる。
2. 追加後の `financial_metrics` の 9V005 の `revenue_cagr` は、9V006 の `revenue_cagr` と numeric で等しい（小数点以下10桁まで）。`revenue_cagr_display_pct` も等しい。
3. ダッシュボードの「財務指標を算出できた銘柄数」の内訳「売上CAGR」が、追加の前後で1増える。値は `dashboard_summary()` と一致する。
4. `/stocks/9V008` の 2021/03〜2024/03期は、訂正届出書 `S9TEST82` の値（10,000・12,000・15,000・20,000）で、書類の列に `S9TEST82`、「訂正」のラベル、「書類2件（訂正あり）」がある。元の届出書の 9,000・11,000 は出ない。CAGR は `31.6%`。
5. `S9TEST82` を `withdrawn = true` にしてリロードすると、同じ期が `S9TEST81` の値（9,000・11,000・…）になり、CAGR が (300/90)^(1/4) − 1 = 35.1% に変わる（トリガーの再計算。ほかの操作なし）。確かめたら元に戻し、`31.6%` に戻ることも確かめる。
6. 優先順位の重なり: `S9TEST11`（有報）に 2021/03期の行（売上 95 億円）を足してリロードすると、9V001 の 2021/03期は有報の `9,500` になり、出典が「有価証券報告書」に変わる（有報 > 届出書）。CAGR は (400/95)^(1/4) − 1 = 43.2% になる。確かめたら行を消し、元の表示に戻ることを確かめる。
7. `S9TEST12` の 2021/03期と同じ終了日の決算短信の行（売上 105 億円）を 9V001 に足すと、2021/03期は決算短信の `10,500` になる（決算短信 > EDINET）。確かめたら行を消す。
8. `pnpm test:db`（`business-results.db.test.ts`）で選び方を網羅する。
   - 出典の優先順位（短信 > 有報 > 届出書）。同じ出典の中は提出日時の新しい順（訂正を含む）。
   - 取り下げ・不開示の除外。
   - 連結と単体の選択（第2章の4 (c) の3つの場合）。
   - `edinet_filers` による結び付けと、結び付かない届出書。
   - EDINET の期だけの銘柄。
   - 第2章の8の表のすべての変更で、同じトランザクションの中で再計算されること（`edinet_documents` の取り下げ・不開示、`edinet_filers` の追加・変更・削除、`stocks` の追加、抽出の行の削除）。
   - **書類の行の削除（R3）**: `edinet_documents` の行を削除すると、同じ文の中で、その書類の期を使っていた銘柄の指標が再計算され、期が無くなった後の値になる。例: 9V001 の `S9TEST12` を消すと、2021/03期が「データなし」になり、CAGR が「算出不可（通期実績が5期未満）」になる。
   - 証券コードの無い届出書を削除したときも、`edinet_filers` 経由で結び付いた銘柄が再計算される。例: 9V008 の `S9TEST81`・`S9TEST82` を消すと、9V008 の CAGR が算出不可になる。
   - 後片付け（`business-results-cleanup.sql`）の後に、`financial_metrics` に `9V…` の行が残らない。
   - 銘柄マスタの upsert（既存の銘柄だけ）で、既存の銘柄の `calculated_at` が変わらないこと。
9. `financial_metrics_from_periods` に、同じ期の配列を出典の項目だけ変えて渡すと、結果が等しい（出典に依存しない）。混在の2つの旗の判定も確かめる。

### C5. 連結と単体（AC15.8）
1. `/stocks/9V007` の基準の列が、2021/03・2022/03「単体・日本基準」、2023/03・2024/03「連結・日本基準」（有価証券届出書）、2025/03「連結・日本基準」（決算短信）。2023/03・2024/03 の売上高は連結の 25,000・30,000（単体の 20,000・24,000 は出ない）。
2. 売上CAGR は `41.4%`（算出不可ではない）。カードに「連結・単体が混在」（`metric-mixed-consolidation`）がある。「会計基準が混在」は無い。
3. `/stocks/9V009` の EDINET の期は「連結・IFRS」で、売上高のセルに「売上収益」の名前が出る。2024/03期は決算短信の 50,000（有報の 51,000 ではない）。CAGR は `24.4%`。「会計基準が混在」は無い（すべて IFRS）。
4. 既存の Sprint 5〜7 の銘柄で、連結・単体の混在が無く会計基準だけが混在する場合は「会計基準が混在」になる（`pnpm test:db` または評価者の投入で確かめる）。旧い文言「連結と単体、または会計基準が異なる期を含みます」はどこにも出ない。

### C6. 取り込み（AC15.10・AC15.11 の処理件数）— `pnpm test:db`（外部 API だけを差し替え、実際の DB に対して動かす）
1. **キーなし（AC15.10）**: `/imports` で「今すぐ取り込み」の「EDINET（有報・届出書）」を押すと、実行履歴に対象「EDINET」、結果「失敗」、処理件数 0、「EDINET の API キーが設定されていません」の行が1件増える（E2E）。
   - 第5章の投入例を入れた状態で行い、`financial_metrics` の全行（値・理由・`calculated_at`）が前後で変わらない。
   - `/api/cron/edinet` でも同じ（200、`runs` に `edinet_reports`・`failed`）。
2. **1回目**: 差し替えた一覧と書類（フィクスチャの ZIP）で実行する。一覧には次を含める。
   - 有報（主要な経営指標等あり）・訂正有報（主要な経営指標等なし）
   - 新規公開の届出書（証券コードなし）と訂正届出書
   - 同じ提出者の上場後の半期報告書の行（証券コードあり。`edinet_filers` を作る。この書類自体は保存しない）
   - 参照方式の届出書（主要な経営指標等なし）
   - 期待値:
     - `succeeded`。
     - `processed_count` = 本文を取得して保存した書類の数。1通で大株主・役員と主要な経営指標等の両方を保存しても1と数える。
     - 有報は両方の処理の結果が、届出書は主要な経営指標等の結果だけが保存される（届出書の `annual_report_extractions` は無い）。
     - 証券コードの無い届出書が `edinet_filers` で銘柄に結び付き、その銘柄（テスト用に決算短信3期を入れた銘柄）の CAGR が算出される（同じ実行の中の保存で再計算される）。
     - 千円・百万円の書類の値が円で保存される。
3. **2回目**（新しい書類なし）: 書類取得 API への要求が0回、`processed_count = 0`、`succeeded`（AC15.11 の「処理済みを取り直さない」）。
4. **導入時の1回だけの取り直し**: 大株主・役員だけ処理済み（`annual_report_extractions` があり、`business_results_extractions` が無い）の有報は、1回だけ取得され、主要な経営指標等だけが保存される。大株主・役員の行は書き換わらない。次の実行では取得されない。
4b. **導入時の `edinet_filers`（R1）**: Sprint 8 の状態を作り、`prepare_edinet_filers_backfill()` を呼ぶ。Sprint 8 の状態は、一覧の日を取得済み・`edinet_filers` が空・証券コードの無い届出書と、証券コードのある有報が保存済み、のこと。
   - 既存の書類から `edinet_filers` ができる（有報の `sec_code` で届出書が結び付く）。
   - `edinet_list_fetched_dates` が空になる。次の実行で期間の日の一覧が取り直される。一覧にある半期報告書の行（証券コードあり）から、有報の無い提出者の `edinet_filers` ができる。その提出者の証券コードの無い届出書が銘柄に結び付き、その銘柄が再計算される。
   - 取り直した一覧で、既存の書類の `withdrawn = true` は false に戻らない。処理済みの記録（`annual_report_extractions`・`business_results_extractions`）は消えない。
5. **取得の順番**: CAGR が算出できていない銘柄の書類が先に取得される（第2章の3）。差し替えた時計の期限で途中で止めると、先に取得されたのがそれらの書類で、`partial` と残りの件数が記録される。
6. **抽出の失敗と取得の失敗**: `invalid_values`・`section_not_found` は理由付きで処理済みになり、次の実行で取り直さない。500・ZIP でない本文は処理済みにせず、次の実行で再試行する（Sprint 8 の既存の確認がすべて通る）。
7. Sprint 8 の取り込みの結合テスト（`edinet-reports.db.test.ts`）がすべて通る。キーの文字列が行・`console` に無いこと、`redirect: "manual"`、間隔 ≥1,000ms を含む。
8. `details` に主要な経営指標等の数（書類の結果ごと、保存した期の数、`discardedFacts`、`documentsTargeted` の内訳）がある。取り込み状況の区画の「直前の EDINET の実行で処理した書類数」と実行履歴の結果の文言に反映される（E2E では評価者の投入した `details` でもよい）。

### C7. 抽出ロジックの自動テスト（AC15.13）— `pnpm test`
1. `edinet/business-results.ts` のフィクスチャ（実データの抜粋、または資料に沿った形。第2章の1）に、次を含める。
   - 連結と提出会社の両方がある届出書: 両方の行が返り、`consolidated` が正しい。
   - 千円の書類と百万円の書類: 値が円の十進の文字列になる（`number` を経由しないことを文字列で比べる）。
   - IFRS の書類（「売上収益」）: 売上高が IFRS の要素から読まれ、`accounting_standard = IFRS`、`revenue_element` が記録される。
   - 営業利益の行が無い書類: `ok` で、営業利益が NULL。
   - 訂正届出書（経営指標の記載あり・なしの両方）: なしは `section_not_found`。
   - 変則決算の期（9か月）を含む書類: 期間がそのまま保存される（抽出では除かない）。
   - 中間期・セグメントのコンテキストの事実を読まない（`discardedFacts` に数える）。
   - **銀行の形（R4）**: 経常収益と経常利益の両方が記載された書類では、売上高が経常収益の要素から読まれ、`revenue_element` にその要素名が入る。経常利益の値は売上高に入らない。実データが取れなければ、資料に沿って組み立て、そう書く。
   - 経常利益の要素だけの書類（売上高・営業収益・経常収益の要素が無い）は、売上高として読まれない。売上高は NULL で、営業利益の要素も無ければ `section_not_found`。
   - 売上高と営業収益の両方がある書類では、売上高が読まれる（第2章の5の優先の順）。
   - 失敗: 円以外の単位、同じ事実の値の食い違い、数値として読めない値 → `invalid_values`（一部の期だけを返さない）。独自の要素だけの売上高 → `section_not_found`（`revenue_element_unknown`）。
   - `endDate` の表し方（第2章の4 (b)）を固定するテスト。
   - 実データの抜粋から作ったフィクスチャは、元の書類IDをテストの名前かコメントに示す。
2. 出典の優先順位（短信・有報・届出書で同じ期が重なる場合）は C4-8 の `pnpm test:db` で確かめる（AC15.13 の最後の項目）。
3. `documents-list.ts`: 一覧の行から `edinet_filers` の対応（`edinetCode`・`secCode` のある行、書類の種類を問わない）を作る。証券コードの無い行・`edinetCode` の無い行は使わない。
4. `runner.test.ts`・`schedule.test.ts`: 表示「EDINET（有報・届出書）」。`edinet_reports` が定期実行にちょうど1回入る。
5. `lib/financials/display.ts`: 出典のラベル（3種）、「記載なし」と「開示なし」の区別、補完の期の文言、混在の注記の2種。

### C8. 取り込み状況とキー（AC15.10・AC15.11 の表示の経路）
1. 第5章の投入例（銘柄マスタが10銘柄だけ）で、区画「上場前の期の補完（EDINET）」に次が出る。
   - 補った銘柄 7 / 10、CAGR に使った銘柄 4
   - 処理した書類（有報 4、届出書 8、読み取れた 11、記載なし 1）
   - 取り込み待ち 1: 主要な経営指標等が未処理の `S9TEST42` だけ。`S9TEST11` など、大株主・役員だけが未処理の有報は数えない。
   - 結び付かない届出書 1
   - 値は `business_results_summary()` と一致する（評価者は psql で照合する）。
2. 9V005 の追加後にリロードすると、補った銘柄 8、CAGR に使った銘柄 5 になる。
3. データが0件のとき「まだ上場前の期の補完は行われていません」とキーの注記。
4. 手動の対象が「EDINET（有報・届出書）」、実行履歴の対象の表示が「EDINET」、定期実行の表示が「毎日 0:00（日本時間）」「EDINET（有報・届出書）」。

### C9. 注記の差し替え（AC15.12）
1. `/screening` を開いた直後（1280×800、スクロールなし）に、新しい注記（`cagr-supplement-note`）が条件①と一緒に見える（`toBeInViewport`）。文言は第2章の10のとおり。
2. 旧い文言「上場前の期のデータがまだ無い」と `data-testid="cagr-provisional-note"` が、`/screening`・`/stocks/9V002`・`/stocks/99996`（Sprint 6 の投入例 `screening-example.sql` の3期の銘柄。入れた場合）のどこにも無い。
3. `/stocks/9V002`（`insufficient_periods`）の CAGR のカードに新しい注記がある。`/stocks/9V001` のカードには無い。
4. AC6.13: `/screening?unavailable=include` で、3期の銘柄の売上CAGR が「算出不可（通期実績が5期未満）」と表示され、新しい注記と矛盾しない。
5. 幅 375px で、条件パネルを開くと注記が条件①の近くにある（Sprint 6 の既存の確認を新しい注記で行う）。

### C10. Sprint 8 評価の改善提案（m2・m3）
1. m2: `/stocks/9W007`（Sprint 8 の投入例）の出典の欄に「区画によっては元の有報の記載を表示しています」がある。「最新の提出分を使っています」の文言が無い。フォールバックの無い `/stocks/9W002` は従来どおり。
2. m3: `S8TEST61` の `annual_report_extractions` の行を消して `/stocks/9W007` を開くと、大株主の区画の取り込み待ちの文言に「S8TEST61」と「2025-06-26」がある。確かめたら行を戻す。

### C11. 画面のそのほか・権限
1. ライト・ダークの両方で、出典のラベル・「記載なし」・「補完」の印・ポップオーバー・注記の文字が WCAG AA（4.5:1）。
2. 幅 375px の `/stocks/9V001`: ページ全体の横スクロールが無い（`document.documentElement.scrollWidth <= 375`）。表は枠の中だけで横スクロール。
3. dev で `simulateServerClockBehind()` の状態で `/stocks/9V001`・`/stocks/9V008`・`/stocks/9V002`・見つからない `/stocks/99989`・`/screening?cagr=40&margin=10&years=5` を開き、コンソールのエラーと `pageerror` が0件。
4. 詳細・スクリーニング・取り込み状況の画面を開く前後で、`ingestion_runs` の行数が変わらない。`src/app/(app)/stocks/`・`src/lib/stocks/`・`src/lib/screening/` は `src/lib/ingestion/` を import しない。
5. 公開キーだけで、追加したテーブル・ビュー（`edinet_filers`・`business_results_extractions`・`business_results_periods`・`edinet_document_codes`）を PostgREST で読むと0行または権限エラー。`business_results_summary`・`save_business_results_extraction` を呼ぶと権限エラー。
6. 許可リスト外（intruder）のセッションでは、追加したテーブル・ビューの行と、`financial_periods` の EDINET の期が0件（`pnpm test:db`）。
7. `e2e/db-privileges.spec.ts` が、追加したテーブル（RLS 有効、anon の権限なし、authenticated は select のみ）と関数を含めて成功する。`business_results_summary` は authenticated と service_role、保存・トリガーの関数は service_role のみ（トリガーの関数は authenticated に実行権限が無い）。
8. `GET /api/stocks/9V001`・`GET /api/screening`・`GET /api/financials?code=9V001` は未ログインで 401、許可の取り消し後に 403。`Cache-Control: no-store`。

### C12. 性能・リグレッション・品質
1. **性能**（`business-results.db.test.ts`。4,000 銘柄、決算短信 2期と EDINET の期 3期を各銘柄に持つ合成データ。コードの接頭辞 `R0000`〜`R3999`、書類ID `S9PERF…`）:
   - authenticated として 1銘柄の `financial_periods` の読み出しが 20ms 以内。
   - `screen_stocks` の既存の性能テストの基準（100ms 以内）を満たす。
   - 全銘柄の `recalculate_financial_metrics` が 10 秒以内。
   - 1通の書類の取り下げ（`edinet_documents` の update）の再計算が 100ms 以内。
2. Sprint 1〜8 の完了条件が引き続き満たされる（評価者の判断で抜き取り確認）。
   - **Sprint 8 のテストの変更の範囲（R2）**: 既存のテスト（`e2e/edinet.spec.ts`・`e2e/dashboard.spec.ts`・`e2e/ingestion.spec.ts`・`src/lib/ingestion/edinet-reports.db.test.ts`・`src/lib/stocks/annual-reports.db.test.ts` など）で変えてよいアサーションは、次の3種類だけ。
     1. target の表示名（第2章の2の列挙）
     2. 届出書の本文・主要な経営指標等を取得するようになったことによる、要求回数・`processed_count`・`details` の値
     3. 実行結果の文言（`result-message.ts`）
   - ほかの期待値は変えない。例:
     - 「有報を取得できた銘柄 6 / 8、抽出できた 5、抽出できなかった 1、取り込み待ち 1」
     - 区画のフォールバック、取り下げ、不開示
     - 要求の間隔、キーの漏えいの確認
     - Sprint 8 の文言（C10 の m2・m3 のもの以外）
   - self-review に、変えたアサーションを、ファイル・行と前後の値つきで一覧にする（評価者は git の差分で照合する）。
   - 特に次の点。
   - Sprint 5〜7 の財務の算出・表示。Sprint 7 の投入例の 9Y001〜9Y004 の CAGR・表・グラフが変わらない（出典はすべて「決算短信」）。
   - スクリーニング（B1 の修正を含む）。
   - Sprint 8 の大株主・役員の表示と取り込み（文言の変更は第2章の2と C10 のものだけ）。
   - 手動取り込み、`/api/cron/*` の認証、ログアウト後の「戻る」、許可の取り消し、375px、404。
3. `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm test:db`、`pnpm build` がすべて成功する。
4. `E2E_PORT=3100 pnpm test:e2e` がすべて成功する（キーなしのサーバー）。
   - Sprint 9 で追加する E2E: C1-1〜C1-9、C2-1〜C2-8、C3-1〜C3-3、C4-1・C4-3〜C4-7、C5-1〜C5-3、C6-1、C8-1〜C8-4、C9-1〜C9-5、C10-1・C10-2、C11-2・C11-3・C11-7・C11-8。
   - E2E の後、DB の市場データ・EDINET のテーブル・実行履歴は開始前（0件）に戻る。
5. `pnpm test:db` の後片付けは自分の接頭辞だけを消す。
   - コード `9V…`・`R0000`〜`R3999`、書類ID `S9TEST…`・`S9SEL…`・`S9DB…`・`S9PERF…`、提出者 `E99V…`・`E9DB…`。
   - 取り込みの結合テストは時計を 2004 年にし、`list_date` が 2003-01-01〜2004-12-31 の行を消す（Sprint 8 の 2002 年より前と重ならない）。
6. どの画面を開いても、ブラウザのコンソールにエラーが出ない（dev と prod）。
7. アプリの本体（`src/`）に、書類・期の値のサンプルやダミーデータが無い。フィクスチャは `__fixtures__/` だけで、テストからだけ import する。投入例は `e2e/fixtures/` だけ。
8. `sprint-09: 上場前の期の補完（EDINET）` でコミットされている。未追跡の `docs/harness/sprints/sprint-08/evaluation-1.md` も同じコミットに含める。
9. `CLAUDE.md` に次が追記され、「現状」が Sprint 9 までになっている。
   - 初回の所要:
     - 書類一覧の取り直し（約3回。R1）
     - 有報の取り直し（約 26〜39 回）
     - 届出書（1年に数百通。新株予約権・公募増資などの参照方式の届出書も含むので、上場会社の数に比べて多めに見積もる。改善提案3）
   - Sprint 9 のアーキテクチャ: 1つの target で2つの処理、読む書類、要素とコンテキストの限定、期の開始日の決め方（S1）、`endDate` の表し方、連結と単体、結び付け（`edinet_filers`）、`financial_periods` の出典と優先順位、再計算のトリガーの一覧、補完の情報と混在の旗、抽出の取り直しの方法、既知の制限（450 日より前の届出書、独自の要素、売上高と営業収益の定義のずれ）、要素の一覧（標準ラベルと、読まない要素の注記）。
   - 実 API で未確認の点、テストの接頭辞。
10. self-review に「実 API・実データで未確認の点」（第2章の1）と、閲覧サイトからの取得を試みた結果（取得できた書類ID、フィクスチャに使った形、取得できなかった形）がある。

## 7. 評価者への補足

- すべての完了条件は、キーなしの環境で確かめられる。EDINET の実データでの確認（AC15.11 のキーありの件数）は合否の条件にしない。キーありの環境で確かめる場合は、`.env` のキーの値をレポートに書かないこと。
- 詳細・スクリーニング・取り込み状況は、評価者の投入（第5章）でも、取り込み（`pnpm test:db` の差し替えた取り込み）でも、同じテーブルから同じ経路（ユーザーのセッション、`financial_periods`・`financial_metrics`）で読み出す。
- 期の選び方は DB のビュー `financial_periods` の1か所、算出は `financial_metrics_from_periods` の1か所。画面・API はどちらも DB の値を表示するだけで、アプリ側で出典の優先や CAGR を計算しない。
- 評価者が期の行を投入するときは、`business_results_extractions`（`status = 'ok'`）を先に入れ、金額は円で入れる。

## 8. 今回やらないこと（後続スプリント）

- 大株主の区分、条件④の判定と根拠、保有状態の内訳、スクリーニングへの条件④の追加（Sprint 10）。Sprint 8 の m1・m5 もそこで扱う。
- 判定の手動補正（Sprint 11）。
- 取り込みの失敗した書類の一覧の画面、データの鮮度の警告、上場廃止の扱い（Sprint 12）。
- 書類一覧の期間（450 日）の延長と、それより前の届出書による補完。
- 「主要な経営指標等の推移」の売上高・営業利益以外の項目（経常利益・純利益・純資産など）の保存・表示。
- 提出者の独自の要素（拡張タクソノミ）や、表のテキストブロック（HTML の表）からの読み取り。
- 目論見書の PDF、会社の IR 資料、手入力による補完（仕様のスコープ外）。
- データのエクスポート（仕様のスコープ外）。

## 9. 改訂履歴
- 初版: 契約作成
- 改訂1（rev 1）: contract-review.md（1回目）の R1〜R4 と改善提案1〜4を反映した。完了条件の削除・緩和は無い。
  - R1: 導入時の `edinet_filers` の作成を加えた（`prepare_edinet_filers_backfill()`。第2章の6）。既存の書類から作り、取得済みの一覧の日の記録を消して、450 日分の一覧を1回だけ取り直す。C6-4b を加えた。CLAUDE.md の初回の所要に書く。
  - R2: 次の3点を変えた。
    - 表示名の変更が及ぶ画面を第2章の2に列挙した（実行履歴・手動の選択肢・定期実行・ダッシュボード・実行中の表示・結果の文言）。
    - 「取り込み待ち」を処理ごとに定義した（第4章、C8-1）。新しい区画は主要な経営指標等が未処理の書類だけ、Sprint 8 の区画は大株主・役員が未処理の有報だけを数える。
    - C12-2 に、Sprint 8 のテストで変えてよいアサーションを3種類に限ることを加えた。self-review には、変えたアサーションを前後の値つきで一覧にする。
  - R3: 書類の行の削除（連鎖）の再計算は、`edinet_documents` の delete のトリガーが、OLD の `sec_code`・`edinet_code` から行う（第2章の8）。C4-8 に、書類の削除と、証券コードの無い届出書の削除のケースを加えた。
  - R4: 経常収益を売上高として読み、経常利益を読まないことを第2章の5に書いた。要素は標準ラベルで確かめ、「読まない要素」の注記を付ける。C7-1 に、銀行の形と、経常利益だけの書類のケースを加えた。
  - 改善提案:
    1. 売上高と営業収益の定義のずれを、既知の制限にした。
    2. 直近通期が EDINET で営業利益の行が無いときの理由の表示を「営業利益の記載なし」にした（第4章）。
    3. 届出書の件数を、初回の所要の見積もりに入れた。
    4. 一覧の印を「補完」にした。
