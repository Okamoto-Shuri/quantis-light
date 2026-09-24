import { CircleAlert, CircleCheck } from "lucide-react";

import { cn } from "@/lib/utils";

/** 認証情報の設定状態。色だけに頼らず、文字とアイコンで示す（値そのものは扱わない）。 */
export function ConfigStatusBadge({ configured, className }: { configured: boolean; className?: string }) {
  const Icon = configured ? CircleCheck : CircleAlert;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        configured
          ? "border-signal/30 bg-signal-muted text-signal-strong"
          : "border-caution/35 bg-caution-muted text-caution-strong",
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {configured ? "設定済み" : "未設定"}
    </span>
  );
}

/** 設定する環境変数の名前（未設定のときは、設定を促す文にする）。 */
export function EnvVarHint({
  name,
  configured,
  requirement,
}: {
  name: string;
  configured: boolean;
  /** 未設定のときに添える条件（例: 16 文字以上） */
  requirement?: string;
}) {
  const code = <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.8em] text-foreground">{name}</code>;
  return (
    <p className="text-xs leading-relaxed text-muted-foreground">
      {configured ? (
        <>環境変数 {code} で設定されています</>
      ) : (
        <>
          環境変数 {code} {requirement ? `に${requirement}の値を` : "を"}設定してください
        </>
      )}
    </p>
  );
}
