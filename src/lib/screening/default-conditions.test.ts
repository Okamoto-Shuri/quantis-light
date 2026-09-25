import { describe, expect, it } from "vitest";

import { defaultConditionsFrom, defaultConditionsFromList, defaultPresetNote } from "./default-conditions";
import { toPreset } from "./presets";

const row = (name: string, query: string, isDefault = true) =>
  toPreset({ id: "00000000-0000-4000-8000-000000000001", name, query, is_default: isDefault, created_at: "2026-09-25T00:00:00Z", updated_at: "2026-09-25T00:00:00Z" });

describe("既定の条件の解決（第2章の7）", () => {
  it("既定のプリセットが無ければ標準の条件、読めなければ標準の条件と loadError", () => {
    expect(defaultConditionsFrom({ ok: true, value: null })).toMatchObject({ source: "standard", loadError: false, redirectQuery: null });
    expect(defaultConditionsFrom({ ok: false })).toMatchObject({ source: "standard", loadError: true });
    expect(defaultConditionsFrom({ ok: true, value: null }).query).toBe("cagr=20&margin=10&years=5&owner=20&ownermode=any&sort=cagr&order=desc");
  });

  it("既定のプリセットはその条件。リダイレクト先は保存したクエリそのまま", () => {
    const strict = "cagr=20&margin=10&years=5&owner=40&ownermode=any&sort=owner&order=desc";
    const dc = defaultConditionsFromList({ ok: true, value: [row("グロース", "cagr=20&margin=10&years=5&owner=20&ownermode=any&sort=cagr&order=desc", false), row("厳しめ", strict)] });
    expect(dc).toMatchObject({ source: "preset", presetName: "厳しめ", query: strict, redirectQuery: strict, presetStatus: "ok" });
    expect(defaultPresetNote(dc)).toBeNull();
  });

  it("無効な項目・正規形でない形の注記（Sprint 13 の m3）", () => {
    const invalid = defaultConditionsFrom({ ok: true, value: row("範囲外", "cagr=99999&margin=10&years=5&owner=20&ownermode=any&sort=cagr&order=desc") });
    expect(invalid.conditions.cagr).toBe("20");
    expect(defaultPresetNote(invalid)).toBe("既定のプリセット『範囲外』の条件の一部（cagr）が無効なため、既定値で判定しています");
    expect(defaultPresetNote(invalid, "比較")).toBe("既定のプリセット『範囲外』の条件の一部（cagr）が無効なため、既定値で比較しています");
    const noncanonical = defaultConditionsFrom({ ok: true, value: row("並び違い", "cagr=20&margin=10&years=5&owner=20&ownermode=any&market=0113,0111&sort=cagr&order=desc") });
    expect(noncanonical.query).toBe("cagr=20&margin=10&years=5&owner=20&ownermode=any&market=0111,0113&sort=cagr&order=desc");
    expect(defaultPresetNote(noncanonical)).toBe("既定のプリセット『並び違い』の条件を標準の形に直して判定しています");
  });
});
