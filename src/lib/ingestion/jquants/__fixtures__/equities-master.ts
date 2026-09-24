/**
 * テスト専用のフィクスチャ: J-Quants API V2 GET /v2/equities/master の応答の形
 * （https://jpx-jquants.com/ja/spec/eq-master の項目名と例に合わせる）。
 * アプリ本体からは import しない（画面には出ない）。
 */
export type MasterItem = {
  Date: string;
  Code: string;
  CoName: string;
  CoNameEn: string;
  S17: string;
  S17Nm: string;
  S33: string;
  S33Nm: string;
  ScaleCat: string;
  Mkt: string;
  MktNm: string;
  Mrgn: string;
  MrgnNm: string;
  ProdCat: string;
};

export function masterItem(overrides: Partial<MasterItem> & Pick<MasterItem, "Code" | "CoName">): MasterItem {
  return {
    Date: "2026-09-24",
    CoNameEn: "",
    S17: "10",
    S17Nm: "情報通信・サービスその他",
    S33: "5250",
    S33Nm: "情報・通信業",
    ScaleCat: "TOPIX Small 1",
    Mkt: "0111",
    MktNm: "プライム",
    Mrgn: "1",
    MrgnNm: "信用",
    ProdCat: "011",
    ...overrides,
  };
}

/** 公式ドキュメントの例（日本取引所グループ）と、取り込み対象・対象外のさまざまな行。 */
export const EQUITIES_MASTER_RESPONSE = {
  data: [
    // --- 保存される行（内国株券・プライム／スタンダード／グロース・33業種が 9999 以外） ---
    {
      Date: "2026-09-24",
      Code: "86970",
      CoName: "日本取引所グループ",
      CoNameEn: "Japan Exchange Group,Inc.",
      S17: "16",
      S17Nm: "金融（除く銀行）",
      S33: "7200",
      S33Nm: "その他金融業",
      ScaleCat: "TOPIX Large70",
      Mkt: "0111",
      MktNm: "プライム",
      Mrgn: "1",
      MrgnNm: "信用",
      ProdCat: "011",
    },
    masterItem({
      Code: "72030",
      CoName: "トヨタ自動車",
      CoNameEn: "TOYOTA MOTOR CORPORATION",
      S17: "6",
      S17Nm: "自動車・輸送機",
      S33: "3700",
      S33Nm: "輸送用機器",
      ScaleCat: "TOPIX Core30",
    }),
    masterItem({
      Code: "30000",
      CoName: "スタンダード検証株式会社",
      CoNameEn: "",
      Mkt: "0112",
      MktNm: "スタンダード",
      ScaleCat: "-",
      Mrgn: "2",
      MrgnNm: "貸借",
    }),
    masterItem({ Code: "130A0", CoName: "グロース英字コード株式会社", Mkt: "0113", MktNm: "グロース", ScaleCat: "-" }),
    // --- 除外される行 ---
    // ETF（商品区分 014、33業種 9999）
    masterItem({ Code: "13060", CoName: "ＮＥＸＴ ＦＵＮＤＳ ＴＯＰＩＸ連動型上場投信", S17: "99", S17Nm: "その他", S33: "9999", S33Nm: "その他", ScaleCat: "-", Mkt: "0109", MktNm: "その他", ProdCat: "014" }),
    // REIT（013）
    masterItem({ Code: "89510", CoName: "日本ビルファンド投資法人", S17: "99", S17Nm: "その他", S33: "9999", S33Nm: "その他", ScaleCat: "-", Mkt: "0109", MktNm: "その他", ProdCat: "013" }),
    // 優先出資証券（012。プライムに上場）
    masterItem({ Code: "84210", CoName: "信金中央金庫（優先出資）", S17: "15", S17Nm: "銀行", S33: "7050", S33Nm: "銀行業", Mkt: "0111", MktNm: "プライム", ProdCat: "012" }),
    // 外国株券（021。グロースに上場）
    masterItem({ Code: "91890", CoName: "外国株グロース上場株式会社", Mkt: "0113", MktNm: "グロース", ProdCat: "021" }),
    // TOKYO PRO MARKET の内国株券
    masterItem({ Code: "92000", CoName: "プロマーケット上場株式会社", Mkt: "0105", MktNm: "TOKYO PRO MARKET", ScaleCat: "-" }),
    // 内国株券だが 33業種が 9999
    masterItem({ Code: "93000", CoName: "業種その他株式会社", S17: "99", S17Nm: "その他", S33: "9999", S33Nm: "その他" }),
  ],
};
