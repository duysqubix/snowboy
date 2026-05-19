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
 * `password` carries the secret for `password`/`password_mfa`/`pat`
 * (for `pat` it is the Programmatic Access Token, forwarded as `token`).
 * `passcode` is the single-use TOTP, honored only for `password_mfa`.
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

    case 'pat': {
      if (profile.username === undefined || profile.username === '') {
        throw new Error('pat auth requires a username');
      }
      if (password === undefined || password === '') {
        throw new Error('pat auth requires a Personal Access Token');
      }
      // PATs are bound to a role at creation; passing a conflicting
      // `role` hint produces a "role not granted" error. Strip it.
      const patOpts: Record<string, unknown> = {
        ...base,
        authenticator: 'PROGRAMMATIC_ACCESS_TOKEN',
        username: profile.username,
        token: password,
      };
      delete patOpts['role'];
      return patOpts;
    }

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
