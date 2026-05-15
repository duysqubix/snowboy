import type { ConnectionProfileLite } from './types';

/**
 * Extracts the snowflake-sdk `account` identifier from a user URL.
 * `https://ab12345.us-east-1.snowflakecomputing.com` → `ab12345.us-east-1`.
 * Throws on missing protocol, wrong host suffix, or empty result.
 */
export function parseAccountIdentifier(accountUrl: string): string {
  if (typeof accountUrl !== 'string' || accountUrl.trim() === '') {
    throw new Error('accountUrl is empty');
  }

  let host: string;
  try {
    host = new URL(accountUrl.trim()).hostname;
  } catch {
    throw new Error(`accountUrl is not a valid URL: ${accountUrl}`);
  }

  const suffix = '.snowflakecomputing.com';
  if (!host.toLowerCase().endsWith(suffix)) {
    throw new Error(`accountUrl host must end with ${suffix}: ${host}`);
  }

  const account = host.slice(0, host.length - suffix.length);
  if (account === '') {
    throw new Error(`accountUrl is missing the account identifier: ${accountUrl}`);
  }
  return account;
}

/**
 * Builds `createConnection(...)` options for the three v0.1 auth methods.
 * `password` is unused for `externalbrowser` and required for the two
 * password-based methods.
 */
export function buildConnectOptions(
  profile: ConnectionProfileLite,
  password?: string,
): Record<string, unknown> {
  const account = parseAccountIdentifier(profile.accountUrl);

  const base: Record<string, unknown> = {
    account,
    accessUrl: normalizeAccessUrl(profile.accountUrl),
    clientSessionKeepAlive: true,
  };

  if (profile.username !== undefined) {
    base['username'] = profile.username;
  }
  if (profile.defaultRole !== undefined) {
    base['role'] = profile.defaultRole;
  }
  if (profile.defaultWarehouse !== undefined) {
    base['warehouse'] = profile.defaultWarehouse;
  }
  if (profile.defaultDatabase !== undefined) {
    base['database'] = profile.defaultDatabase;
  }
  if (profile.defaultSchema !== undefined) {
    base['schema'] = profile.defaultSchema;
  }

  switch (profile.authMethod) {
    case 'externalbrowser':
      return { ...base, authenticator: 'EXTERNALBROWSER' };

    case 'password_mfa':
      if (profile.username === undefined || profile.username === '') {
        throw new Error('password_mfa auth requires a username');
      }
      if (password === undefined || password === '') {
        throw new Error('password_mfa auth requires a password');
      }
      return {
        ...base,
        authenticator: 'USERNAME_PASSWORD_MFA',
        username: profile.username,
        password,
      };

    case 'password':
      if (profile.username === undefined || profile.username === '') {
        throw new Error('password auth requires a username');
      }
      if (password === undefined || password === '') {
        throw new Error('password auth requires a password');
      }
      return {
        ...base,
        authenticator: 'SNOWFLAKE',
        username: profile.username,
        password,
      };

    default: {
      const exhaustive: never = profile.authMethod;
      throw new Error(`unsupported authMethod: ${String(exhaustive)}`);
    }
  }
}

function normalizeAccessUrl(accountUrl: string): string {
  const parsed = new URL(accountUrl.trim());
  return `${parsed.protocol}//${parsed.host}`;
}
