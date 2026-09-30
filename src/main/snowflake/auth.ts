import { createHash, createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { PrivateKeyCheck } from '../types';
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
 * For `keypair` it is the optional private key passphrase, forwarded as
 * `privateKeyPass`.
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
        // Exact SDK option name (connection_config.js reads `clientRequestMFAToken`);
        // other casings are silently ignored and every connect re-prompts for MFA.
        clientRequestMFAToken: true,
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

    case 'keypair': {
      if (profile.username === undefined || profile.username === '') {
        throw new Error('keypair auth requires a username');
      }
      if (profile.privateKeyPath === undefined || profile.privateKeyPath === '') {
        throw new Error('keypair auth requires a private key file');
      }
      // Pass the path, not the key: the SDK reads and decrypts the file
      // itself, so key material never sits in these options.
      const keyOpts: Record<string, unknown> = {
        ...base,
        authenticator: 'SNOWFLAKE_JWT',
        username: profile.username,
        privateKeyPath: profile.privateKeyPath
      };
      if (password !== undefined && password !== '') {
        keyOpts['privateKeyPass'] = password;
      }
      return keyOpts;
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

/** An RSA-4096 PKCS#8 PEM is under 4 KB; a much larger file is the wrong file. */
const MAX_PRIVATE_KEY_BYTES = 64 * 1024;

/**
 * The SDK signs the JWT with jsonwebtoken 9, which refuses RS256 keys under
 * 2048 bits; Snowflake requires at least 2048 as well.
 */
const MIN_RSA_BITS = 2048;

const PEM_BEGIN = Buffer.from('-----BEGIN ');
const PEM_DASHES = Buffer.from('-----');
const PEM_LABEL = /^[A-Z0-9 ]{1,40}$/;

/**
 * Error codes for key encryption the crypto library can't decrypt, e.g.
 * BoringSSL's (Electron's) `ERR_OSSL_UNSUPPORTED_KEY_DERIVATION_FUNCTION`
 * for `openssl pkcs8 -scrypt` keys. A wrong passphrase gives `BAD_DECRYPT`
 * instead. OpenSSL's bare `ERR_OSSL_UNSUPPORTED` doesn't match.
 */
const UNSUPPORTED_ENCRYPTION = /UNSUPPORTED_[A-Z_]+|UNKNOWN_(?:ALGORITHM|CIPHER)/;

/**
 * Labels of the PEM blocks in `buf` (`PRIVATE KEY`, `PUBLIC KEY`, ...).
 * Only the BEGIN lines are decoded, so key bodies never become JS strings.
 */
function pemLabels(buf: Buffer): string[] {
  const labels: string[] = [];
  let from = 0;
  for (;;) {
    const start = buf.indexOf(PEM_BEGIN, from);
    if (start === -1) return labels;
    const labelStart = start + PEM_BEGIN.length;
    const end = buf.indexOf(PEM_DASHES, labelStart);
    if (end === -1) return labels;
    const label = buf.toString('latin1', labelStart, end);
    if (PEM_LABEL.test(label)) labels.push(label);
    from = end + PEM_DASHES.length;
  }
}

function fileProblem(err: unknown, filePath: string): PrivateKeyCheck {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return { ok: false, problem: 'not_found', message: `Private key file not found: ${filePath}` };
  }
  const reason =
    code === 'EACCES' || code === 'EPERM' ? 'permission denied' : (code ?? 'I/O error');
  return {
    ok: false,
    problem: 'unreadable',
    message: `Cannot read the private key file (${reason}): ${filePath}`
  };
}

function inspectPrivateKey(
  buf: Buffer,
  filePath: string,
  passphrase: string | undefined
): PrivateKeyCheck {
  const labels = pemLabels(buf);
  const label = labels.find((l) => l.endsWith('PRIVATE KEY'));
  if (label === undefined) {
    if (labels.some((l) => l.includes('PUBLIC KEY') || l.includes('CERTIFICATE'))) {
      return {
        ok: false,
        problem: 'not_private_key',
        message:
          `${filePath} holds a public key or certificate, not a private key. Choose the ` +
          'private key file (for example rsa_key.p8); its public key is what gets registered ' +
          'in Snowflake.'
      };
    }
    return {
      ok: false,
      problem: 'not_private_key',
      message:
        `${filePath} is not a PEM private key. Expected a PKCS#8 file that starts with ` +
        '-----BEGIN PRIVATE KEY----- or -----BEGIN ENCRYPTED PRIVATE KEY-----.'
    };
  }
  if (label === 'OPENSSH PRIVATE KEY') {
    return {
      ok: false,
      problem: 'unsupported_format',
      message:
        `${filePath} is an OpenSSH-format key, but Snowflake needs a PKCS#8 PEM key. ` +
        'Convert a copy with: ssh-keygen -p -m PKCS8 -f <copy>'
    };
  }

  // PKCS#8 marks encryption in the label, traditional PEM in a Proc-Type header.
  const encrypted = label === 'ENCRYPTED PRIVATE KEY' || buf.includes('Proc-Type: 4,ENCRYPTED');
  if (encrypted && (passphrase === undefined || passphrase === '')) {
    return {
      ok: false,
      problem: 'passphrase_required',
      message: 'This private key is encrypted. Enter its passphrase.'
    };
  }

  let key: KeyObject;
  try {
    key = createPrivateKey(
      encrypted ? { key: buf, format: 'pem', passphrase } : { key: buf, format: 'pem' }
    );
  } catch (err) {
    if (!encrypted) {
      return {
        ok: false,
        problem: 'unsupported_format',
        message: `${filePath} looks like a PEM private key but cannot be parsed. It may be truncated or corrupted.`
      };
    }
    if (UNSUPPORTED_ENCRYPTION.test(String((err as { code?: unknown } | null)?.code ?? ''))) {
      return {
        ok: false,
        problem: 'unsupported_format',
        message:
          `${filePath} is encrypted with a scheme Snowboy can't decrypt (such as scrypt). ` +
          'Re-encrypt a copy with: openssl pkcs8 -topk8 -v2 aes256 -in <key> -out <new.p8>'
      };
    }
    // Error codes can't separate a wrong passphrase from a damaged file: a
    // wrong passphrase sometimes decrypts to garbage that fails as a decode
    // error, and a truncated traditional PEM key fails as BAD_DECRYPT.
    return {
      ok: false,
      problem: 'wrong_passphrase',
      message: 'The passphrase does not unlock this private key (or the key file is damaged).'
    };
  }
  if (key.asymmetricKeyType !== 'rsa') {
    const kind = (key.asymmetricKeyType ?? 'unknown').toUpperCase();
    return {
      ok: false,
      problem: 'unsupported_format',
      message: `${filePath} is not an RSA key (type: ${kind}). Snowflake key-pair authentication needs RSA.`
    };
  }
  const bits = key.asymmetricKeyDetails?.modulusLength;
  if (bits !== undefined && bits < MIN_RSA_BITS) {
    return {
      ok: false,
      problem: 'unsupported_format',
      message: `${filePath} is a ${bits}-bit RSA key. Snowflake key-pair authentication needs at least ${MIN_RSA_BITS} bits.`
    };
  }
  const spki = createPublicKey(key).export({ type: 'spki', format: 'der' });
  const fingerprint = `SHA256:${createHash('sha256').update(spki).digest('base64')}`;
  return { ok: true, encrypted, fingerprint };
}

/**
 * Parses the private key at `filePath` as the SDK will at connect time
 * (`auth_keypair.js` reads the file as PEM and decrypts it with the
 * passphrase), so a bad file or passphrase gets a specific message before
 * any network round-trip. Classification reads the PEM structure, not
 * crypto error text: that text differs between OpenSSL (Node) and
 * BoringSSL (Electron). Never returns or logs key material, and zeroes the
 * read buffer.
 */
export async function checkPrivateKeyFile(
  filePath: string,
  passphrase?: string
): Promise<PrivateKeyCheck> {
  if (filePath === '') {
    return { ok: false, problem: 'not_found', message: 'No private key file selected.' };
  }
  // A relative path would resolve against the process cwd, which differs
  // between dev and packaged builds. The file picker returns absolute paths.
  if (!isAbsolute(filePath)) {
    return {
      ok: false,
      problem: 'not_found',
      message: `The private key path must be absolute: ${filePath}`
    };
  }
  let buf: Buffer;
  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      return { ok: false, problem: 'unreadable', message: `Not a file: ${filePath}` };
    }
    if (info.size > MAX_PRIVATE_KEY_BYTES) {
      return {
        ok: false,
        problem: 'not_private_key',
        message: `${filePath} is too large to be a private key.`
      };
    }
    buf = await readFile(filePath);
  } catch (err) {
    return fileProblem(err, filePath);
  }
  try {
    return inspectPrivateKey(buf, filePath, passphrase);
  } finally {
    buf.fill(0);
  }
}
