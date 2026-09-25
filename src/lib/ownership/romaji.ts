/**
 * 姓の読み（カタカナ）からヘボン式のローマ字を作る（Sprint 10。条件④の資産管理会社（推定）の照合に使う辞書の生成用）。
 * 長音の表し方が会社名によって違うため、次の3つの形を返す（重複は除く）。
 *   そのまま（オオノ → OONO、サイトウ → SAITOU）
 *   長音を省く（ONO、SAITO。OU・OO → O、UU → U）
 *   長音を H で表す（OHNO、SAITOH。OU・OO → OH）
 * 生成は scripts/generate-surname-readings.ts だけが使う（アプリの実行時には使わない。DB の辞書に書き出した値を使う）。
 */

const DIGRAPHS: Record<string, string> = {
  キャ: "KYA", キュ: "KYU", キョ: "KYO",
  シャ: "SHA", シュ: "SHU", ショ: "SHO", シェ: "SHE",
  チャ: "CHA", チュ: "CHU", チョ: "CHO", チェ: "CHE",
  ニャ: "NYA", ニュ: "NYU", ニョ: "NYO",
  ヒャ: "HYA", ヒュ: "HYU", ヒョ: "HYO",
  ミャ: "MYA", ミュ: "MYU", ミョ: "MYO",
  リャ: "RYA", リュ: "RYU", リョ: "RYO",
  ギャ: "GYA", ギュ: "GYU", ギョ: "GYO",
  ジャ: "JA", ジュ: "JU", ジョ: "JO", ジェ: "JE",
  ヂャ: "JA", ヂュ: "JU", ヂョ: "JO",
  ビャ: "BYA", ビュ: "BYU", ビョ: "BYO",
  ピャ: "PYA", ピュ: "PYU", ピョ: "PYO",
  ファ: "FA", フィ: "FI", フェ: "FE", フォ: "FO",
  ティ: "TI", ディ: "DI", ウィ: "WI", ウェ: "WE", ウォ: "WO",
};

const SINGLES: Record<string, string> = {
  ア: "A", イ: "I", ウ: "U", エ: "E", オ: "O",
  カ: "KA", キ: "KI", ク: "KU", ケ: "KE", コ: "KO",
  サ: "SA", シ: "SHI", ス: "SU", セ: "SE", ソ: "SO",
  タ: "TA", チ: "CHI", ツ: "TSU", テ: "TE", ト: "TO",
  ナ: "NA", ニ: "NI", ヌ: "NU", ネ: "NE", ノ: "NO",
  ハ: "HA", ヒ: "HI", フ: "FU", ヘ: "HE", ホ: "HO",
  マ: "MA", ミ: "MI", ム: "MU", メ: "ME", モ: "MO",
  ヤ: "YA", ユ: "YU", ヨ: "YO",
  ラ: "RA", リ: "RI", ル: "RU", レ: "RE", ロ: "RO",
  ワ: "WA", ヰ: "I", ヱ: "E", ヲ: "O", ン: "N",
  ガ: "GA", ギ: "GI", グ: "GU", ゲ: "GE", ゴ: "GO",
  ザ: "ZA", ジ: "JI", ズ: "ZU", ゼ: "ZE", ゾ: "ZO",
  ダ: "DA", ヂ: "JI", ヅ: "ZU", デ: "DE", ド: "DO",
  バ: "BA", ビ: "BI", ブ: "BU", ベ: "BE", ボ: "BO",
  パ: "PA", ピ: "PI", プ: "PU", ペ: "PE", ポ: "PO",
  ヴ: "VU", ァ: "A", ィ: "I", ゥ: "U", ェ: "E", ォ: "O", ャ: "YA", ュ: "YU", ョ: "YO",
};

/** カタカナをヘボン式のローマ字（大文字。長音はそのまま）にする。変換できない文字があれば null。 */
export function kanaToRomaji(kana: string): string | null {
  let out = "";
  let geminate = false;
  const chars = [...kana];
  for (let i = 0; i < chars.length; i++) {
    const pair = chars[i] + (chars[i + 1] ?? "");
    let syllable: string | undefined;
    if (DIGRAPHS[pair]) {
      syllable = DIGRAPHS[pair];
      i++;
    } else if (chars[i] === "ッ") {
      geminate = true;
      continue;
    } else if (chars[i] === "ー") {
      continue;
    } else {
      syllable = SINGLES[chars[i]];
    }
    if (syllable === undefined) return null;
    if (geminate) {
      out += syllable.startsWith("CH") ? "T" : syllable[0];
      geminate = false;
    }
    out += syllable;
  }
  return out;
}

/** 読みのローマ字の形（そのまま・長音を省く・長音を H で表す。重複を除き、長い順ではなく生成順）。 */
export function romajiVariants(kana: string): string[] {
  const raw = kanaToRomaji(kana);
  if (raw === null) return [];
  const omitted = raw.replace(/O[OU]/g, "O").replace(/UU/g, "U");
  const withH = raw.replace(/O[OU]/g, "OH").replace(/UU/g, "U");
  return [...new Set([raw, omitted, withH])];
}
