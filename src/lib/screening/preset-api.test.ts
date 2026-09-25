import { describe, expect, it, vi } from "vitest";

import { parsePresetInput, presetDbErrorResponse, presetFunctionResponse } from "./preset-api";

describe("プリセットの API の本文（契約の第4章）", () => {
  it("作成: name・query は必須。名前は前後の空白を除き、クエリは正規形にする", () => {
    expect(parsePresetInput({ name: " P　", query: "page=3&market=0113&cagr=20" }, "create")).toEqual({
      ok: true,
      value: { name: "P", query: "cagr=20&margin=10&years=5&owner=20&ownermode=any&market=0113&sort=cagr&order=desc" },
    });
    expect(parsePresetInput({ name: "P" }, "create")).toMatchObject({ ok: false, fields: ["query"] });
    expect(parsePresetInput({ query: "cagr=20" }, "create")).toMatchObject({ ok: false, fields: ["name"] });
    expect(parsePresetInput({ name: "P", query: "cagr=abc&market=9999" }, "create")).toEqual({
      ok: false,
      fields: ["query"],
      queryFields: ["cagr", "market"],
    });
    expect(parsePresetInput({ name: "a\tb", query: "cagr=20" }, "create")).toMatchObject({ ok: false, fields: ["name"] });
    expect(parsePresetInput({ name: "P", query: "cagr=20", isDefault: "yes" }, "create")).toMatchObject({ ok: false, fields: ["isDefault"] });
    expect(parsePresetInput([], "create")).toMatchObject({ ok: false });
  });

  it("変更: 1つ以上。空の本文は invalid", () => {
    expect(parsePresetInput({}, "update")).toEqual({ ok: false, fields: [], queryFields: [] });
    expect(parsePresetInput({ isDefault: true }, "update")).toEqual({ ok: true, value: { isDefault: true } });
    expect(parsePresetInput({ name: "新しい名前", isDefault: false }, "update")).toEqual({ ok: true, value: { name: "新しい名前", isDefault: false } });
    expect(parsePresetInput({ query: "cagr=abc" }, "update")).toMatchObject({ ok: false, fields: ["query"], queryFields: ["cagr"] });
  });
});

describe("DB のエラーの分類（R1: 23505 は制約の名前で区別する）", () => {
  it("名前の一意の違反は 409 duplicate_name、既定の部分一意索引の違反は 500（duplicate_name にしない）", async () => {
    const dup = presetDbErrorResponse(
      { code: "23505", message: 'duplicate key value violates unique constraint "screening_presets_user_name_key"' },
      "作成",
    );
    expect(dup.status).toBe(409);
    expect(await dup.json()).toEqual({ error: "duplicate_name", fields: ["name"] });

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const def = presetDbErrorResponse(
      { code: "23505", message: 'duplicate key value violates unique constraint "screening_presets_one_default_idx"' },
      "変更",
    );
    expect(def.status).toBe(500);
    expect(await def.json()).toEqual({ error: "internal_error" });
    spy.mockRestore();
  });

  it("上限は 409 preset_limit、check 違反は 400", async () => {
    expect((await presetDbErrorResponse({ code: "QP050", message: "limit" }, "作成").json()).error).toBe("preset_limit");
    const check = presetDbErrorResponse({ code: "23514", message: 'violates check constraint "screening_presets_query_check"' }, "作成");
    expect(check.status).toBe(400);
    expect(await check.json()).toEqual({ error: "invalid_preset", fields: ["query"] });
  });

  it("関数の戻り値が null なら 404（存在しない・他人の行）", async () => {
    const res = presetFunctionResponse(null);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("関数の戻り値を API の形（日本時間）にする", async () => {
    const res = presetFunctionResponse(
      {
        id: "0b7c7f55-8a1b-4d5c-9e2f-0123456789ab",
        name: "グロースのみ",
        query: "cagr=20&margin=10&years=5&owner=20&ownermode=any&market=0113&sort=cagr&order=desc",
        is_default: true,
        created_at: "2026-09-25T01:00:00+00:00",
        updated_at: "2026-09-25T01:00:00+00:00",
      },
      201,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toMatchObject({ name: "グロースのみ", isDefault: true, invalidFields: [], createdAt: "2026-09-25T10:00:00+09:00" });
    expect(body.data.conditions.market).toEqual(["0113"]);
  });
});
