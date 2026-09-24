import { CalendarClock, Database, FileText } from "lucide-react";

import { formatDateTimeJst } from "@/lib/format";
import { CRON_SECRET_MIN_LENGTH, type IngestionConfigStatus } from "@/lib/ingestion/config";
import type { LastCompletedBySource } from "@/lib/ingestion/history";
import { CRON_SCHEDULE_LABEL, CRON_TARGETS_LABEL } from "@/lib/ingestion/schedule";

import { ConfigStatusBadge, EnvVarHint } from "./config-status";

const SOURCES = {
  jquants: {
    name: "J-Quants",
    usage: "銘柄マスタ・株価・財務",
    auth: "API キー（V2）",
    envVar: "JQUANTS_API_KEY",
    Icon: Database,
  },
  edinet: {
    name: "EDINET",
    usage: "有価証券報告書（大株主・役員）",
    auth: "Subscription-Key",
    envVar: "EDINET_API_KEY",
    Icon: FileText,
  },
} as const;

function DetailList({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1 text-sm">
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PanelCard({
  icon: Icon,
  title,
  subtitle,
  configured,
  testId,
  children,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  subtitle: string;
  configured: boolean;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-lg border bg-card px-4 py-4" data-testid={testId}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Icon aria-hidden={true} className="size-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-medium">{title}</h3>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <ConfigStatusBadge configured={configured} />
      </div>
      <div className="flex flex-1 flex-col gap-2 border-t pt-3">{children}</div>
    </article>
  );
}

/** データソースの認証情報と、定期実行の設定（どちらも設定の有無だけを表示する）。 */
export function ConnectionPanel({
  config,
  lastCompleted,
}: {
  config: IngestionConfigStatus;
  lastCompleted: LastCompletedBySource | null;
}) {
  return (
    <section aria-labelledby="connection-heading" className="space-y-3">
      <h2 id="connection-heading" className="text-sm font-medium">
        データソースと定期実行
      </h2>
      <div className="grid gap-3 md:grid-cols-3">
        {config.sources.map((source) => {
          const meta = SOURCES[source.id];
          return (
            <PanelCard
              key={source.id}
              icon={meta.Icon}
              title={meta.name}
              subtitle={meta.usage}
              configured={source.configured}
              testId={`source-${source.id}`}
            >
              <DetailList
                items={[
                  { label: "認証方式", value: meta.auth },
                  {
                    label: "最終成功",
                    value: lastCompleted?.[source.id] ? (
                      <span className="tabular font-mono">{formatDateTimeJst(lastCompleted[source.id])}</span>
                    ) : (
                      <span className="text-muted-foreground">{lastCompleted ? "記録なし" : "取得できませんでした"}</span>
                    ),
                  },
                ]}
              />
              <div className="mt-auto">
                <EnvVarHint name={meta.envVar} configured={source.configured} />
              </div>
            </PanelCard>
          );
        })}
        <PanelCard
          icon={CalendarClock}
          title="定期実行"
          subtitle="Vercel Cron の認証"
          configured={config.cron.configured}
          testId="cron-settings"
        >
          <DetailList
            items={[
              { label: "実行時刻", value: CRON_SCHEDULE_LABEL },
              { label: "対象", value: CRON_TARGETS_LABEL },
            ]}
          />
          <div className="mt-auto">
            <EnvVarHint name="CRON_SECRET" configured={config.cron.configured} requirement={`${CRON_SECRET_MIN_LENGTH} 文字以上`} />
          </div>
        </PanelCard>
      </div>
    </section>
  );
}
