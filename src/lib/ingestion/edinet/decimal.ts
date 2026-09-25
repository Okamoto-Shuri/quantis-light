/**
 * 十進の数の文字列の操作（浮動小数点を経由しない）。
 * EDINET の持株比率（例 0.0057 → 0.57%）を number で 100 倍すると 0.5700000000000001 になるため、文字列のまま桁をずらす。
 */

const DECIMAL = /^(-)?(\d+)(?:\.(\d+))?$/;

/** 十進の数の文字列を正規化する（先頭の 0 を除く。小数部の末尾の 0 は残す）。数でなければ null。 */
export function parseDecimal(value: string): { negative: boolean; int: string; frac: string } | null {
  const match = DECIMAL.exec(value.trim());
  if (!match) return null;
  const int = match[2].replace(/^0+(?=\d)/, "");
  return { negative: match[1] === "-", int, frac: match[3] ?? "" };
}

function format(negative: boolean, int: string, frac: string): string {
  const cleanedInt = int.replace(/^0+(?=\d)/, "") || "0";
  const isZero = /^0*$/.test(cleanedInt) && /^0*$/.test(frac);
  const sign = negative && !isZero ? "-" : "";
  return frac.length > 0 ? `${sign}${cleanedInt}.${frac}` : `${sign}${cleanedInt}`;
}

/**
 * 小数点を places 桁ずらす（正なら右へ＝10^places 倍、負なら左へ）。小数部の桁数は、ずらした分だけ変わる
 * （例 shiftDecimal("0.3210", 2) = "32.10"、shiftDecimal("7,554" を除いた "7554", 3) = "7554000"、shiftDecimal("9.6", -2) = "0.096"）。
 */
export function shiftDecimal(value: string, places: number): string | null {
  const parsed = parseDecimal(value);
  if (!parsed || !Number.isInteger(places)) return null;
  const digits = parsed.int + parsed.frac;
  let point = parsed.int.length + places;
  let all = digits;
  if (point < 0) {
    all = "0".repeat(-point) + all;
    point = 0;
  }
  if (point > all.length) all = all + "0".repeat(point - all.length);
  return format(parsed.negative, all.slice(0, point) || "0", all.slice(point));
}

/** 小数部の桁数。 */
export function fractionDigits(value: string): number {
  return parseDecimal(value)?.frac.length ?? 0;
}

/**
 * 小数部を digits 桁にそろえる。短ければ末尾に 0 を足し、長ければ末尾の 0 だけを除く（0 以外の桁は落とさない。丸めない）。
 * 例 padFraction("32.1", 2) = "32.10"、padFraction("12.3450", 3) = "12.345"。
 */
export function padFraction(value: string, digits: number): string | null {
  const parsed = parseDecimal(value);
  if (!parsed) return null;
  let frac = parsed.frac;
  while (frac.length > digits && frac.endsWith("0")) frac = frac.slice(0, -1);
  if (frac.length < digits) frac = frac + "0".repeat(digits - frac.length);
  return format(parsed.negative, parsed.int, frac);
}
