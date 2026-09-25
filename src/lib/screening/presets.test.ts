import { describe, expect, it } from "vitest";

import { WHITESPACE_CLASS } from "@/lib/text/whitespace";

import { DEFAULT_CONDITIONS } from "./params";
import {
  canonicalPresetQuery,
  invalidInputNote,
  parsePresetQuery,
  presetQueryOf,
  presetSummary,
  selectorCurrent,
  STANDARD_QUERY,
  toPreset,
  trimPresetName,
  validatePresetName,
  type PresetRow,
} from "./presets";

const row = (patch: Partial<PresetRow>): PresetRow => ({
  id: "00000000-0000-4000-8000-000000000001",
  name: "P",
  query: STANDARD_QUERY,
  is_default: false,
  created_at: "2026-09-25T00:00:00Z",
  updated_at: "2026-09-25T00:00:00Z",
  ...patch,
});

describe("プリセットの名前（契約の第2章の5）", () => {
  it("前後の空白（全角・改行・タブ）を除き、途中の空白は保つ", () => {
    expect(trimPresetName("　 厳しめ　\n")).toBe("厳しめ");
    expect(trimPresetName(" グロース のみ ")).toBe("グロース のみ");
  });

  it("空・空白だけは必須の違反", () => {
    for (const name of ["", " ", "　　", "\n\n", "\t　\n"]) expect(validatePresetName(name)).toBe("name_required");
  });

  it("40 コードポイントまで（「𠮷」は1文字）", () => {
    expect(validatePresetName("あ".repeat(40))).toBeNull();
    expect(validatePresetName("あ".repeat(41))).toBe("name_too_long");
    expect(validatePresetName("𠮷".repeat(40))).toBeNull();
    expect(validatePresetName("𠮷".repeat(41))).toBe("name_too_long");
    expect(validatePresetName(` ${"あ".repeat(40)}　`)).toBeNull();
  });

  it("途中の制御文字（タブ・改行）と U+2028・U+2029 は使えない", () => {
    for (const name of ["a\tb", "a\nb", "a\rb", "a\u0000b", "a\u007fb", "a\u2028b", "a\u2029b"]) {
      expect(validatePresetName(name)).toBe("name_invalid_chars");
    }
  });

  it("空白の文字集合は JavaScript の \\s と同じ", () => {
    const ours = new RegExp(`^${WHITESPACE_CLASS}$`, "u");
    for (let cp = 0; cp <= 0xffff; cp++) {
      const ch = String.fromCharCode(cp);
      expect(ours.test(ch)).toBe(/^\s$/.test(ch));
    }
  });
});

describe("クエリと条件", () => {
  it("標準の条件のクエリは正規形（page を含まない）", () => {
    expect(STANDARD_QUERY).toBe("cagr=20&margin=10&years=5&owner=20&ownermode=any&sort=cagr&order=desc");
    expect(presetQueryOf({ ...DEFAULT_CONDITIONS, page: 3 })).toBe(STANDARD_QUERY);
  });

  it("API の query は厳しく検証し、正規形にする（page と未知のパラメータは無視）", () => {
    expect(canonicalPresetQuery("page=3&market=0113&cagr=20")).toEqual({
      ok: true,
      query: "cagr=20&margin=10&years=5&owner=20&ownermode=any&market=0113&sort=cagr&order=desc",
    });
    expect(canonicalPresetQuery("?utm=x&cagr=020")).toEqual({ ok: true, query: STANDARD_QUERY });
    expect(canonicalPresetQuery("page=abc")).toEqual({ ok: true, query: STANDARD_QUERY });
    expect(canonicalPresetQuery("cagr=abc&market=9999")).toEqual({ ok: false, queryFields: ["cagr", "market"] });
  });

  it("保存したクエリの解釈: 有効・無効・正規形でない", () => {
    expect(parsePresetQuery(STANDARD_QUERY)).toMatchObject({ status: "ok", invalidFields: [] });
    const invalid = parsePresetQuery("cagr=99999&margin=10&years=5&owner=20&ownermode=any&sort=cagr&order=desc");
    expect(invalid).toMatchObject({ status: "invalid", invalidFields: ["cagr"] });
    expect(invalid.conditions.cagr).toBe("20");
    const noncanonical = parsePresetQuery("cagr=20&margin=10&years=5&owner=20&ownermode=any&market=0113,0111&sort=cagr&order=desc");
    expect(noncanonical).toMatchObject({ status: "noncanonical", invalidFields: ["query"] });
    expect(presetQueryOf(noncanonical.conditions)).toBe("cagr=20&margin=10&years=5&owner=20&ownermode=any&market=0111,0113&sort=cagr&order=desc");
    expect(parsePresetQuery("cagr=020&margin=10&years=5&owner=20&ownermode=any&sort=cagr&order=desc").status).toBe("noncanonical");
  });
});

describe("セレクターの表示の優先順位（契約の第2章の3）", () => {
  const strict = "cagr=20&margin=10&years=5&owner=40&ownermode=any&sort=owner&order=desc";
  it("一致するプリセットのうち作成の最も古いもの → 標準の条件 → 保存されていない条件", () => {
    const presets = [
      toPreset(row({ id: "00000000-0000-4000-8000-000000000001", name: "厳しめ", query: strict })),
      toPreset(row({ id: "00000000-0000-4000-8000-000000000002", name: "標準コピー", query: STANDARD_QUERY })),
      toPreset(row({ id: "00000000-0000-4000-8000-000000000003", name: "厳しめ2", query: strict })),
    ];
    expect(selectorCurrent(presets, strict)).toMatchObject({ kind: "preset", preset: { name: "厳しめ" } });
    expect(selectorCurrent(presets, STANDARD_QUERY)).toMatchObject({ kind: "preset", preset: { name: "標準コピー" } });
    expect(selectorCurrent([], STANDARD_QUERY)).toEqual({ kind: "standard" });
    expect(selectorCurrent(presets, "cagr=15&margin=10&years=5&owner=20&ownermode=any&sort=cagr&order=desc")).toEqual({ kind: "none" });
    expect(selectorCurrent(null, strict)).toEqual({ kind: "none" });
    expect(selectorCurrent(null, STANDARD_QUERY)).toEqual({ kind: "standard" });
  });

  it("無効・正規形でないプリセットは一致とみなさない", () => {
    const presets = [toPreset(row({ query: "cagr=20&margin=10&years=5&owner=20&ownermode=any&market=0113,0111&sort=cagr&order=desc" }))];
    expect(selectorCurrent(presets, "cagr=20&margin=10&years=5&owner=20&ownermode=any&market=0111,0113&sort=cagr&order=desc")).toEqual({ kind: "none" });
  });
});

describe("要約と注記", () => {
  it("条件の要約に市場・業種・含める・並べ替えが入る", () => {
    expect(presetSummary({ ...DEFAULT_CONDITIONS, market: ["0113"] })).toBe(
      "CAGR ≥20% ・ 営業利益率 ≥10% ・ 上場5年以内 ・ ④ オーナー系 ≥20% または社長が筆頭株主 ・ 市場: グロース ・ 並べ替え: 売上CAGR 降順",
    );
    const text = presetSummary({
      ...DEFAULT_CONDITIONS,
      off: ["owner"],
      includeUnavailable: true,
      sector: ["0050", "1050", "2050", "3050"],
      sort: "code",
      order: "asc",
    });
    expect(text).toContain("④ オフ");
    expect(text).toContain("算出不可を含める");
    expect(text).toContain("業種 4 件");
    expect(text).toContain("並べ替え: コード 昇順");
    expect(presetSummary({ ...DEFAULT_CONDITIONS, sector: ["3050"] })).toContain("業種: 食料品");
  });

  it("入力中の無効な値の注記", () => {
    expect(invalidInputNote([], DEFAULT_CONDITIONS)).toBeNull();
    expect(invalidInputNote(["cagr"], DEFAULT_CONDITIONS)).toBe("入力中の無効な値は保存されません（売上CAGR は 20% で保存します）");
    expect(invalidInputNote(["years", "cagr"], DEFAULT_CONDITIONS)).toBe(
      "入力中の無効な値は保存されません（売上CAGR は 20%、上場年数 は 5年 で保存します）",
    );
  });
});
