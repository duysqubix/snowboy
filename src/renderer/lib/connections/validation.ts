import type { ConnectionProfile } from '../../../main/types';

export type ValidationError = { field: string; message: string };

/**
 * Strips the things users routinely paste into the Account URL field that
 * Snowflake's SDK rejects: protocol prefix, trailing slash/path, any
 * whitespace (including Unicode no-break / zero-width), and case.
 * Returns the host-only form used by the snowflake-sdk `account` option.
 */
export function normalizeAccountUrl(raw: string): string {
  return raw
    .replace(/[\s\u00A0\u200B-\u200D\uFEFF]+/g, '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
}

const ACCOUNT_URL_REGEX = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*\.snowflakecomputing\.com$/;

export function validateProfile(input: Partial<ConnectionProfile>): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!input.name || input.name.trim().length === 0) {
    errors.push({ field: 'name', message: 'Name is required' });
  } else if (input.name.length > 64) {
    errors.push({ field: 'name', message: 'Name must be 64 characters or less' });
  }

  if (!input.accountUrl || input.accountUrl.trim().length === 0) {
    errors.push({ field: 'accountUrl', message: 'Account URL is required' });
  } else {
    const normalized = normalizeAccountUrl(input.accountUrl);
    if (!ACCOUNT_URL_REGEX.test(normalized)) {
      errors.push({
        field: 'accountUrl',
        message:
          'Expected <account>.snowflakecomputing.com or <account>.<region>.<cloud>.snowflakecomputing.com'
      });
    }
  }

  if (!input.authMethod) {
    errors.push({ field: 'authMethod', message: 'Auth method is required' });
  } else if (!['externalbrowser', 'password_mfa', 'password', 'pat'].includes(input.authMethod)) {
    errors.push({ field: 'authMethod', message: 'Invalid auth method' });
  }

  if (!input.username || input.username.trim().length === 0) {
    errors.push({ field: 'username', message: 'Username is required' });
  } else if (input.username.length > 128) {
    errors.push({ field: 'username', message: 'Username must be 128 characters or less' });
  }

  return errors;
}
