/**
 * テスト専用のフィクスチャ: J-Quants API V2 GET /v2/fins/summary の応答の形
 * （https://jpx-jquants.com/ja/spec/fin-summary の項目名とサンプルの応答に合わせる。すべて文字列で、値の無い項目は ""）。
 * アプリ本体からは import しない（画面には出ない）。
 */

/** 公式のサンプルの応答の全項目（86970 の第3四半期。値は公式のサンプルのまま）。 */
export const OFFICIAL_SAMPLE_ITEM: Record<string, string> = {
  DiscDate: "2023-01-30",
  DiscTime: "12:00:00",
  Code: "86970",
  DiscNo: "20230127594871",
  DocType: "3QFinancialStatements_Consolidated_IFRS",
  CurPerType: "3Q",
  CurPerSt: "2022-04-01",
  CurPerEn: "2022-12-31",
  CurFYSt: "2022-04-01",
  CurFYEn: "2023-03-31",
  NxtFYSt: "",
  NxtFYEn: "",
  Sales: "100529000000",
  OP: "51765000000",
  OdP: "",
  NP: "35175000000",
  EPS: "66.76",
  DEPS: "",
  TA: "79205861000000",
  Eq: "320021000000",
  EqAR: "0.004",
  BPS: "",
  CFO: "",
  CFI: "",
  CFF: "",
  CashEq: "91135000000",
  Div1Q: "",
  Div2Q: "26.0",
  Div3Q: "",
  DivFY: "",
  DivAnn: "",
  DivUnit: "",
  DivTotalAnn: "",
  PayoutRatioAnn: "",
  FDiv1Q: "",
  FDiv2Q: "",
  FDiv3Q: "",
  FDivFY: "36.0",
  FDivAnn: "62.0",
  FDivUnit: "",
  FDivTotalAnn: "",
  FPayoutRatioAnn: "",
  NxFDiv1Q: "",
  NxFDiv2Q: "",
  NxFDiv3Q: "",
  NxFDivFY: "",
  NxFDivAnn: "",
  NxFDivUnit: "",
  NxFPayoutRatioAnn: "",
  FSales2Q: "",
  FOP2Q: "",
  FOdP2Q: "",
  FNP2Q: "",
  FEPS2Q: "",
  NxFSales2Q: "",
  NxFOP2Q: "",
  NxFOdP2Q: "",
  NxFNp2Q: "",
  NxFEPS2Q: "",
  FSales: "132500000000",
  FOP: "65500000000",
  FOdP: "",
  FNP: "45000000000",
  FEPS: "85.42",
  NxFSales: "",
  NxFOP: "",
  NxFOdP: "",
  NxFNp: "",
  NxFEPS: "",
  MatChgSub: "false",
  SigChgInC: "",
  ChgByASRev: "false",
  ChgNoASRev: "false",
  ChgAcEst: "true",
  RetroRst: "",
  ShOutFY: "528578441",
  TrShFY: "1861043",
  AvgSh: "526874759",
  NCSales: "",
  NCOP: "",
  NCOdP: "",
  NCNP: "",
  NCEPS: "",
  NCTA: "",
  NCEq: "",
  NCEqAR: "",
  NCBPS: "",
  FNCSales2Q: "",
  FNCOP2Q: "",
  FNCOdP2Q: "",
  FNCNP2Q: "",
  FNCEPS2Q: "",
  NxFNCSales2Q: "",
  NxFNCOP2Q: "",
  NxFNCOdP2Q: "",
  NxFNCNP2Q: "",
  NxFNCEPS2Q: "",
  FNCSales: "",
  FNCOP: "",
  FNCOdP: "",
  FNCNP: "",
  FNCEPS: "",
  NxFNCSales: "",
  NxFNCOP: "",
  NxFNCOdP: "",
  NxFNCNP: "",
  NxFNCEPS: "",
  ShEq: "318500000000",
  NCShEq: "",
  ROE: "0.112",
  NCROE: "",
};

/** 公式のサンプルの全項目を持つ行を作り、一部を上書きする。 */
export function finsItem(overrides: Record<string, string>): Record<string, string> {
  return { ...OFFICIAL_SAMPLE_ITEM, ...overrides };
}

/**
 * 通期の決算短信の行。売上高・営業利益は円の文字列。予想の項目（FSales、NxFSales など）には、実績と違う値を入れておく
 * （AC5.5: 予想の値が使われないことを確かめるため）。
 */
export function annualItem({
  code,
  discNo,
  discDate,
  discTime = "15:00:00",
  docType = "FYFinancialStatements_Consolidated_JP",
  fyStart,
  fyEnd,
  sales,
  op,
  extra = {},
}: {
  code: string;
  discNo: string;
  discDate: string;
  discTime?: string;
  docType?: string;
  fyStart: string;
  fyEnd: string;
  sales: string;
  op: string;
  extra?: Record<string, string>;
}): Record<string, string> {
  return finsItem({
    DiscDate: discDate,
    DiscTime: discTime,
    Code: code,
    DiscNo: discNo,
    DocType: docType,
    CurPerType: "FY",
    CurPerSt: fyStart,
    CurPerEn: fyEnd,
    CurFYSt: fyStart,
    CurFYEn: fyEnd,
    Sales: sales,
    OP: op,
    FSales: "999999000000",
    FOP: "888888000000",
    NxFSales: "777777000000",
    NxFOP: "666666000000",
    ...extra,
  });
}

/** 四半期決算短信の行（通期より大きい売上高）。 */
export function quarterItem(code: string, discDate: string, discNo: string): Record<string, string> {
  return finsItem({
    DiscDate: discDate,
    Code: code,
    DiscNo: discNo,
    DocType: "3QFinancialStatements_Consolidated_JP",
    CurPerType: "3Q",
    Sales: "555555000000",
    OP: "444444000000",
  });
}

/** 業績予想の修正の行。 */
export function forecastRevisionItem(code: string, discDate: string, discNo: string): Record<string, string> {
  return finsItem({
    DiscDate: discDate,
    Code: code,
    DiscNo: discNo,
    DocType: "EarnForecastRevision",
    CurPerType: "FY",
    Sales: "",
    OP: "",
    FSales: "333333000000",
    FOP: "222222000000",
  });
}

export function finsResponse(items: Record<string, string>[], paginationKey?: string) {
  return paginationKey ? { data: items, pagination_key: paginationKey } : { data: items };
}

/** 取引カレンダーの応答（Date と HolDiv）。 */
export function calendarResponse(days: { date: string; holDiv: string }[], paginationKey?: string) {
  const data = days.map((day) => ({ Date: day.date, HolDiv: day.holDiv }));
  return paginationKey ? { data, pagination_key: paginationKey } : { data };
}
