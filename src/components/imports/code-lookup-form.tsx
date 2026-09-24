"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeStockCode } from "@/lib/listing/ages";

/**
 * 銘柄コードの入力。送信すると、正規化したコードの URL（/imports?code=99991）に移る（Sprint 4 評価の m2）。
 * JavaScript が無い場合は通常の GET フォームとして送られ、サーバーが正規化して表示する。
 */
export function CodeLookupForm({ defaultValue, invalid }: { defaultValue: string; invalid: boolean }) {
  const router = useRouter();
  return (
    <form
      action="/imports"
      method="get"
      className="flex flex-col gap-2 sm:flex-row sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        const raw = String(new FormData(event.currentTarget).get("code") ?? "");
        const code = normalizeStockCode(raw) ?? raw.trim();
        router.push(`/imports?code=${encodeURIComponent(code)}`);
      }}
    >
      <div className="min-w-0 space-y-1.5 sm:w-56">
        <label htmlFor="lookup-code" className="text-xs text-muted-foreground">
          銘柄コード
        </label>
        <Input
          id="lookup-code"
          name="code"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          maxLength={16}
          placeholder="例: 86970"
          defaultValue={defaultValue}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? "lookup-code-error" : "lookup-code-hint"}
          className="tabular h-9 font-mono"
        />
      </div>
      <Button type="submit" variant="outline" className="h-9 sm:w-auto">
        <Search aria-hidden="true" />
        確認
      </Button>
    </form>
  );
}
