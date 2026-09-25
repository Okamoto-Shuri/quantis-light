import { z } from "zod";

import { sectionReason, type SectionStatus } from "@/lib/stocks/annual-report";

/**
 * 条件④（オーナー企業／社長が筆頭株主）の値の形と表示の文言（Sprint 10）。スクリーニング・銘柄詳細・API が共有する。
 * 分類・合計・判定は DB（ownership_judgment_from_sections・screening_evaluate）が行い、ここでは表示の文言だけを組み立てる。
 * 比率は十進の文字列のまま扱う（浮動小数点を経由しない）。
 */

export const OWNER_CATEGORIES = ["president", "officer", "family", "asset_company", "other"] as const;
export type OwnerCategory = (typeof OWNER_CATEGORIES)[number];
/** オーナー系（区分1〜4） */
export const OWNER_SIDE_CATEGORIES = ["president", "officer", "family", "asset_company"] as const;

export const OWNER_RESULTS = ["president_top", "owner_company", "not_matched", "undeterminable"] as const;
export type OwnerResult = (typeof OWNER_RESULTS)[number];

export const UNDETERMINABLE_REASONS = [
  "no_annual_report",
  "annual_report_pending",
  "shareholders_not_extracted",
  "officers_not_extracted",
  "president_not_found",
] as const;
export type UndeterminableReason = (typeof UNDETERMINABLE_REASONS)[number];

export const PRESIDENT_BASES = ["title", "representative", "title_without_representative"] as const;
export type PresidentBasis = (typeof PRESIDENT_BASES)[number];

export const REASON_CODES = [
  "president_name",
  "officer_name",
  "president_surname",
  "president_full_name",
  "surname_reading",
  "surname_romaji",
  "financial_or_association",
  "unrelated_corporation",
  "unrelated_individual",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

const decimal = z.string().regex(/^-?\d+(\.\d+)?$/);

export const topHolderSchema = z.object({
  rank: z.number().int(),
  name: z.string(),
  ratio_pct: decimal,
  ratio_decimals: z.number().int(),
  category: z.enum(OWNER_CATEGORIES),
});
export type TopHolder = z.infer<typeof topHolderSchema>;

export const presidentSchema = z.object({
  seq: z.number().int(),
  name: z.string(),
  title: z.string(),
  basis: z.enum(PRESIDENT_BASES),
  surname: z.string().nullable(),
  surname_key: z.string().nullable(),
  surname_source: z.enum(["officer", "shareholder"]).nullable(),
});
export type President = z.infer<typeof presidentSchema>;

const categoryPct = z.object({
  president: decimal,
  officer: decimal,
  family: decimal,
  asset_company: decimal,
  other: decimal,
});
export type CategoryPct = z.infer<typeof categoryPct>;

/** Sprint 11: 手動補正の選択肢（自動判定の結果と同じ名前。判定不能は選べない） */
export const OWNER_VERDICTS = ["president_top", "owner_company", "not_matched"] as const;
export type OwnerVerdict = (typeof OWNER_VERDICTS)[number];

/** 自動判定の記録・現在の自動判定（「補正後に自動判定が更新されました」の比較の項目） */
export const autoSnapshotSchema = z.object({
  status: z.enum(["determined", "undeterminable"]),
  undeterminable_reason: z.enum(UNDETERMINABLE_REASONS).nullable(),
  president_is_top_holder: z.boolean().nullable(),
  owner_total_pct: decimal.nullable(),
  shareholders_doc_id: z.string().nullable(),
  officers_doc_id: z.string().nullable(),
  /** 記録の値に現在のモード・閾値を当てた結果 */
  result: z.enum(OWNER_RESULTS),
});
export type AutoSnapshot = z.infer<typeof autoSnapshotSchema>;

/** Sprint 11: 呼び出したユーザーの手動補正（DB の owner_override_summary） */
export const ownerOverrideSchema = z.object({
  verdict: z.enum(OWNER_VERDICTS),
  memo: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  auto_changed: z.boolean(),
  auto_at_override: autoSnapshotSchema,
  auto_current: autoSnapshotSchema,
});
export type OwnerOverride = z.infer<typeof ownerOverrideSchema>;

export const ownershipSummarySchema = z.object({
  status: z.enum(["determined", "undeterminable"]),
  undeterminable_reason: z.enum(UNDETERMINABLE_REASONS).nullable(),
  undeterminable_detail: z
    .object({ status: z.string().optional(), detail: z.string().nullable().optional(), doc_id: z.string().nullable().optional() })
    .nullable(),
  /** 実際に使う結果（補正があれば補正、無ければ自動判定。Sprint 11） */
  result: z.enum(OWNER_RESULTS),
  /** 自動判定の結果（現在のモード・閾値。Sprint 11） */
  auto_result: z.enum(OWNER_RESULTS),
  /** 呼び出したユーザーの手動補正（無ければ null。Sprint 11） */
  override: ownerOverrideSchema.nullable(),
  president_is_top_holder: z.boolean().nullable(),
  owner_total_pct: decimal.nullable(),
  owner_total_display_pct: decimal.nullable(),
  category_pct: categoryPct.nullable(),
  top_holders: z.array(topHolderSchema),
  presidents: z.array(presidentSchema),
  pending_doc_id: z.string().nullable(),
});
export type OwnershipSummary = z.infer<typeof ownershipSummarySchema>;

export const holderSchema = z.object({
  rank: z.number().int(),
  name: z.string(),
  ratio_pct: decimal,
  ratio_decimals: z.number().int(),
  category: z.enum(OWNER_CATEGORIES),
  reason_code: z.enum(REASON_CODES),
  reason: z.object({
    president_name: z.string().optional(),
    president_title: z.string().optional(),
    officer_name: z.string().optional(),
    officer_title: z.string().optional(),
    surname: z.string().optional(),
    reading: z.string().optional(),
  }),
});
export type Holder = z.infer<typeof holderSchema>;

export const ownershipDocumentSchema = z.object({
  role: z.enum(["shareholders", "officers", "shareholders_pending", "officers_pending"]),
  doc_id: z.string(),
  doc_type_code: z.string(),
  submitted_at: z.string(),
});
export type OwnershipDocument = z.infer<typeof ownershipDocumentSchema>;

export const ownershipDetailSchema = ownershipSummarySchema.extend({
  holders: z.array(holderSchema),
  documents: z.array(ownershipDocumentSchema),
});
export type OwnershipDetail = z.infer<typeof ownershipDetailSchema>;

// ---------------------------------------------------------------------------
// 表示の文言
// ---------------------------------------------------------------------------

export const OWNER_RESULT_LABELS: Record<OwnerResult, string> = {
  president_top: "該当（社長が筆頭株主）",
  owner_company: "該当（オーナー企業）",
  not_matched: "非該当",
  undeterminable: "判定不能",
};

export const CATEGORY_LABELS: Record<OwnerCategory, string> = {
  president: "社長本人",
  officer: "その他の役員本人",
  family: "同姓の親族（推定）",
  asset_company: "資産管理会社（推定）",
  other: "オーナー系以外",
};

/** 区分名から「（推定）」を除いた短い名前（推定のラベルを別に付けるとき） */
export const CATEGORY_SHORT_LABELS: Record<OwnerCategory, string> = {
  president: "社長本人",
  officer: "その他の役員本人",
  family: "同姓の親族",
  asset_company: "資産管理会社",
  other: "オーナー系以外",
};

/** 「推定」のラベルを付ける区分（AC9.15） */
export function isEstimatedCategory(category: OwnerCategory): boolean {
  return category === "family" || category === "asset_company";
}

export const ESTIMATION_NOTE =
  "『同姓の親族（推定）』『資産管理会社（推定）』は、社長の姓（または読み）と株主の氏名・名称の一致による推定です。実際の親族関係・資本関係は確認していません。姓の読みは主な姓の辞書によるもので、辞書に無い姓はカタカナ・ローマ字の名称と照合しません。";

export const AUTO_JUDGMENT_NOTE = "大株主と役員の氏名の照合による自動判定です。誤判定がありえます。";

/**
 * 百分率の小数点以下1桁への切り捨て（十進の文字列のまま。例 "35.00" → "35.0%"、"19.98" → "19.9%"、"0" → "0.0%"）。
 * 一覧の要約・ポップオーバー・詳細の区分別の合計で使う（DB の trunc(x, 1) と同じ。比率は 0 以上）。
 */
export function formatTruncPct(value: string): string {
  const negative = value.startsWith("-");
  const [int, frac = ""] = value.replace(/^-/, "").split(".");
  const digit = (frac[0] ?? "0");
  const zero = /^0*$/.test(int) && digit === "0";
  return `${negative && !zero ? "-" : ""}${Number(int)}.${digit}%`;
}

/** 空白を除いた氏名（理由の文の引用。例「山田　太郎」→「山田太郎」） */
export function compactName(name: string): string {
  return name.replace(/\s+/g, "");
}

/** 役職名の改行を空白にする（理由の文の引用） */
export function inlineTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim();
}

/** 株主ごとの分類理由（AC9.13 の例の形） */
export function holderReasonText(holder: Pick<Holder, "category" | "reason_code" | "reason">): string {
  const { reason } = holder;
  const president = compactName(reason.president_name ?? "");
  const surname = compactName(reason.surname ?? "");
  switch (holder.reason_code) {
    case "president_name":
      return `社長『${president}』と氏名が一致`;
    case "officer_name":
      return `役員『${compactName(reason.officer_name ?? "")}（${inlineTitle(reason.officer_title ?? "")}）』と氏名が一致`;
    case "president_surname":
      return holder.category === "family"
        ? `社長と同姓『${surname}』の個人（親族と推定）`
        : `社長の姓『${surname}』を名称に含む法人（資産管理会社と推定）`;
    case "president_full_name":
      return `社長の氏名『${president}』を名称に含む法人（資産管理会社と推定）`;
    case "surname_reading":
    case "surname_romaji":
      return `社長の姓『${surname}』の読み『${reason.reading ?? ""}』を名称に含む法人（資産管理会社と推定）`;
    case "financial_or_association":
      return "信託口・金融機関・持株会など（オーナー系と推定しない株主）";
    case "unrelated_corporation":
      return "社長の氏名・姓を名称に含まない法人";
    case "unrelated_individual":
      return "社長・役員と氏名が一致せず、社長と同姓でない個人";
  }
}

/** 社長の特定の根拠の注記（代表者による補いなど）。役職名で特定したときは null */
export function presidentBasisNote(basis: PresidentBasis): string | null {
  if (basis === "representative") return "役職名に『社長』等が無いため、代表取締役を社長として扱っています";
  if (basis === "title_without_representative") return "役職名に『代表』が無いため、『社長』等の役職の役員を社長として扱っています";
  return null;
}

/** 判定不能の理由の文 */
export function undeterminableReasonText(summary: Pick<OwnershipSummary, "undeterminable_reason" | "undeterminable_detail">): string {
  const detail = summary.undeterminable_detail;
  switch (summary.undeterminable_reason) {
    case "annual_report_pending":
      return `有報の本文が取り込み待ちで、処理済みの有報も無いため判定できません${detail?.doc_id ? `（書類 ${detail.doc_id}）` : ""}`;
    case "shareholders_not_extracted": {
      const cause =
        detail?.detail === "no_rows" ? "大株主の行がありません" : sectionReason("shareholders", (detail?.status ?? "invalid_values") as SectionStatus, detail?.detail ?? null);
      return `有報から大株主を抽出できなかったため判定できません${cause ? `（${cause}）` : ""}`;
    }
    case "officers_not_extracted": {
      const cause = sectionReason("officers", (detail?.status ?? "invalid_values") as SectionStatus, detail?.detail ?? null);
      return `有報から役員を抽出できなかったため判定できません${cause ? `（${cause}）` : ""}`;
    }
    case "president_not_found":
      return "役員の状況に社長（代表者）が見つからないため判定できません";
    case "no_annual_report":
    default:
      return "有報が未取得のため判定できません";
  }
}

/** 筆頭株主の表示名（同率なら「ほか N 名（同率）」を添える） */
export function topHolderName(topHolders: readonly TopHolder[]): string | null {
  const first = topHolders[0];
  if (!first) return null;
  return topHolders.length > 1 ? `${first.name} ほか ${topHolders.length - 1} 名（同率）` : first.name;
}

/** 条件④の条件の文（例「オーナー系 ≥20% または社長が筆頭株主」「社長が筆頭株主のみ」） */
export function ownerConditionText(mode: "any" | "president", threshold: string): string {
  return mode === "president" ? "社長が筆頭株主のみ" : `オーナー系 ≥${threshold}% または社長が筆頭株主`;
}

/** 補正が条件を満たすか（DB の owner_status_of と同じ規則の表示用の説明。判定そのものは DB の s_owner を使う） */
export const OVERRIDE_PRESIDENT_MODE_NOTE = "『社長が筆頭株主のみ』では、この補正は条件を満たしません";

/** 条件④のパネルの注記の1文（Sprint 11） */
export const OVERRIDE_FILTER_NOTE = "手動補正した銘柄は、補正後の判定で絞り込みます（閾値は補正に当てません）。";

/** 日時の日本時間の表示（YYYY-MM-DD HH:mm） */
export function formatJstDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString();
  return `${jst.slice(0, 10)} ${jst.slice(11, 16)}`;
}

/** 区分別の合計の6行（詳細の区分別の合計と一覧のポップオーバーで同じ値を出す） */
export function categoryTotals(summary: Pick<OwnershipSummary, "category_pct" | "owner_total_pct">) {
  const pct = summary.category_pct;
  if (!pct || summary.owner_total_pct === null) return null;
  return [
    ...OWNER_SIDE_CATEGORIES.map((category) => ({ key: category as OwnerCategory | "owner_total", label: CATEGORY_LABELS[category], value: pct[category] })),
    { key: "owner_total" as const, label: "オーナー系合計", value: summary.owner_total_pct },
    { key: "other" as const, label: CATEGORY_LABELS.other, value: pct.other },
  ];
}
