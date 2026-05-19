import type { ConnectionProfileLite } from './types';

const HOST_SUFFIX = '.snowflakecomputing.com';

function parseHost(accountUrl: string): string {
  const trimmed = accountUrl.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withProtocol).hostname;
  } catch {
    throw new Error(`accountUrl is not a valid URL: ${accountUrl}`);
  }
}

/**
 * Extracts the snowflake-sdk `account` identifier from a user URL.
 * Accepts either a bare host (`ab12345.us-east-1.snowflakecomputing.com`)
 * or a full URL (`https://ab12345.us-east-1.snowflakecomputing.com/console`).
 * Throws on wrong host suffix or empty result.
 */
export function parseAccountIdentifier(accountUrl: string): string {
  if (typeof accountUrl !== 'string' || accountUrl.trim() === '') {
    throw new Error('accountUrl is empty');
  }

  const host = parseHost(accountUrl);

  if (!host.toLowerCase().endsWith(HOST_SUFFIX)) {
    throw new Error(`accountUrl host must end with ${HOST_SUFFIX}: ${host}`);
  }

  const account = host.slice(0, host.length - HOST_SUFFIX.length);
  if (account === '') {
    throw new Error(`accountUrl is missing the account identifier: ${accountUrl}`);
  }
  return account;
}

/**
 * Builds `createConnection(...)` options for the three v0.1 auth methods.
 * `password` is unused for `externalbrowser` and required for the two
 * password-based methods. `passcode` is the time-based MFA token (TOTP);
 * snowflake-sdk only honors it for `USERNAME_PASSWORD_MFA` and the caller
 * must obtain it fresh per connect attempt (TOTP codes are single-use).
 */
export function buildConnectOptions(
  profile: ConnectionProfileLite,
  password?: string,
  passcode?: string,
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
      return {
        ...base,
        authenticator: 'EXTERNALBROWSER',
        clientStoreTemporaryCredential: true,
      };

    case 'password_mfa': {
      if (profile.username === undefined || profile.username === '') {
        throw new Error('password_mfa auth requires a username');
      }
      if (password === undefined || password === '') {
        throw new Error('password_mfa auth requires a password');
      }
      const mfaOpts: Record<string, unknown> = {
        ...base,
        authenticator: 'USERNAME_PASSWORD_MFA',
        username: profile.username,
        password,
        clientRequestMfaToken: true,
      };
      if (passcode !== undefined && passcode !== '') {
        mfaOpts['passcode'] = passcode;
      }
      return mfaOpts;
    }

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
  const host = parseHost(accountUrl);
  return `https://${host}`;
}
