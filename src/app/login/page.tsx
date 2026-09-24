import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/brand-mark";
import { getAuthState } from "@/lib/auth/session";
import { LOGIN_ERROR_MESSAGES, REVOKED_MESSAGE } from "@/lib/auth/login-errors";
import { sanitizeNextPath } from "@/lib/auth/next-path";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "ログイン" };

const CONDITIONS = [
  ["①", "売上CAGR", "直近5期・成長4年分"],
  ["②", "営業利益率", "直近通期"],
  ["③", "上場年数", "株価データの初出日から推定"],
  ["④", "オーナー企業／社長が筆頭株主", "有報から自動判定"],
] as const;

type Props = { searchParams: Promise<{ next?: string | string[]; reason?: string | string[] }> };

export default async function LoginPage({ searchParams }: Props) {
  const params = await searchParams;
  const next = sanitizeNextPath(typeof params.next === "string" ? params.next : undefined);

  let notice: string | undefined;
  if (params.reason === "revoked") {
    // 取り消し後は常にフォームを表示する（リダイレクトのループを防ぐ）。
    notice = REVOKED_MESSAGE;
  } else {
    const state = await getAuthState();
    if (state.status === "allowed") redirect(next);
    if (state.status === "forbidden") redirect("/auth/signout?reason=revoked");
    // ログイン画面からは /auth/signout へ送らない（無効な Cookie の後片付けは保護画面のガードが行う）。
    // ここで送ると、Cookie を削除できないクライアントとの間でリダイレクトがループするため。
    if (state.status === "unavailable") notice = LOGIN_ERROR_MESSAGES.unavailable;
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-xl border bg-card shadow-sm md:grid-cols-[1.1fr_1fr]">
        <section className="flex flex-col justify-between gap-8 border-b bg-surface p-6 sm:p-8 md:border-r md:border-b-0">
          <div className="space-y-4">
            <BrandMark className="text-lg" />
            <p className="text-sm leading-relaxed text-muted-foreground">
              毎朝取り込んだ保存済みデータから、若く、成長し、稼いでいて、経営者が自ら株を持つ日本企業を絞り込む、自分専用のスクリーナーです。
            </p>
          </div>
          <dl className="hidden divide-y rounded-lg border bg-card text-sm sm:block">
            {CONDITIONS.map(([mark, label, note]) => (
              <div key={mark} className="flex items-baseline gap-3 px-4 py-2.5">
                <dt className="font-mono text-signal">{mark}</dt>
                <dd className="flex flex-1 flex-wrap items-baseline justify-between gap-x-3">
                  <span>{label}</span>
                  <span className="text-xs text-muted-foreground">{note}</span>
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="p-6 sm:p-8">
          <h1 className="text-xl font-semibold tracking-tight">ログイン</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            利用できるのは、許可されたメールアドレスのアカウントだけです。
          </p>
          <LoginForm next={next} notice={notice} />
        </section>
      </div>
    </main>
  );
}
