export const MIN_PASSWORD_LENGTH = 8;

/** 前後の空白を除き、小文字にする。許可リストもこの形で保存する。 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(raw: string): boolean {
  return EMAIL_PATTERN.test(normalizeEmail(raw));
}
