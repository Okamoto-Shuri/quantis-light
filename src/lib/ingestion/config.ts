import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

/**
 * 取り込みに使う認証情報（サーバーの環境変数）。値そのものは画面にも API にも出さない。
 * 設定状態は「空白を除いて空でない値があるか」だけで判定する（外部 API には問い合わせない）。
 */
type Env = Record<string, string | undefined>;

/** CRON_SECRET の最小の長さ。これより短い値は未設定として扱う。 */
export const CRON_SECRET_MIN_LENGTH = 16;

function readSecret(env: Env, name: string): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

export function getJQuantsApiKey(env: Env = process.env): string | null {
  return readSecret(env, "JQUANTS_API_KEY");
}

export function getEdinetApiKey(env: Env = process.env): string | null {
  return readSecret(env, "EDINET_API_KEY");
}

let warnedShortCronSecret = false;

/**
 * 定期実行用エンドポイントのシークレット。16 文字未満は未設定として扱う（推測されやすいため）。
 * 取り込み状況の画面の表示と、Route Handler の認証の両方がこの関数を使う。
 */
export function getCronSecret(env: Env = process.env): string | null {
  const value = readSecret(env, "CRON_SECRET");
  if (!value) return null;
  if (value.length < CRON_SECRET_MIN_LENGTH) {
    if (!warnedShortCronSecret) {
      warnedShortCronSecret = true;
      console.warn(
        `[cron] CRON_SECRET が ${CRON_SECRET_MIN_LENGTH} 文字未満のため、未設定として扱います（定期実行は拒否されます）。`,
      );
    }
    return null;
  }
  return value;
}

export type DataSourceId = "jquants" | "edinet";

export type IngestionConfigStatus = {
  sources: { id: DataSourceId; configured: boolean }[];
  cron: { configured: boolean };
};

/** データソースと定期実行の認証の設定状態（真偽値だけ。値や長さは含めない）。 */
export function getIngestionConfigStatus(env: Env = process.env): IngestionConfigStatus {
  return {
    sources: [
      { id: "jquants", configured: getJQuantsApiKey(env) !== null },
      { id: "edinet", configured: getEdinetApiKey(env) !== null },
    ],
    cron: { configured: getCronSecret(env) !== null },
  };
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Authorization ヘッダーが `Bearer <CRON_SECRET>` と一致するか。
 * 長さに依存しないよう、両方をハッシュにしてから定数時間で比較する。シークレットが未設定なら常に false。
 */
export function isAuthorizedCronRequest(authorization: string | null, secret: string | null): boolean {
  if (!secret) return false;
  const expected = digest(`Bearer ${secret}`);
  const actual = digest(authorization ?? "");
  return timingSafeEqual(expected, actual);
}
