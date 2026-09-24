const dateTimeFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const countFormatter = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 });

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 日時を日本時間の YYYY-MM-DD HH:mm で表示する。 */
export function formatDateTimeJst(value: string | Date | null | undefined): string | null {
  const date = toDate(value);
  return date ? dateTimeFormatter.format(date) : null;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * 基準時刻から見た相対表記（経過時間は切り捨て）。
 * 未来の時刻（時計のずれ）と 60 秒未満は「たった今」に丸める。
 */
export function formatRelativeTime(value: string | Date | null | undefined, now: Date): string | null {
  const date = toDate(value);
  if (!date) return null;
  const elapsed = now.getTime() - date.getTime();
  if (elapsed < MINUTE) return "たった今";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}分前`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}時間前`;
  return `${Math.floor(elapsed / DAY)}日前`;
}

/** 件数を3桁区切りで表示する（例: 1,234）。 */
export function formatCount(value: number): string {
  return countFormatter.format(value);
}

/** 分母に対する割合を、小数点以下1桁の % で表示する。分母が 0 のときは null。 */
export function formatShare(part: number, total: number): string | null {
  if (total <= 0) return null;
  return `${((part / total) * 100).toFixed(1)}%`;
}
