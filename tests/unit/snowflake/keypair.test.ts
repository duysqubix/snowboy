/**
 * M2.1b — key-pair (SNOWFLAKE_JWT) auth: connect-option building and
 * private-key file validation. Every key here is generated at test time
 * and written to a temp dir; no real key is ever read.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildConnectOptions, checkPrivateKeyFile } from '../../../src/main/snowflake/auth';
import type { ConnectionProfileLite } from '../../../src/main/snowflake/types';

const PASSPHRASE = 'correct horse battery staple';

function keyPairProfile(overrides: Partial<ConnectionProfileLite> = {}): ConnectionProfileLite {
  return {
    id: 'kp1',
    accountUrl: 'https://myorg-myaccount.snowflakecomputing.com',
    authMethod: 'keypair',
    username: 'svc_loader',
    privateKeyPath: '/home/me/.snowflake/rsa_key.p8',
    ...overrides
  };
}

/** SHA-256 of the DER SPKI public key: Snowflake's RSA_PUBLIC_KEY_FP format. */
function fingerprintOf(publicKey: KeyObject): string {
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return `SHA256:${createHash('sha256').update(der).digest('base64')}`;
}

describe('buildConnectOptions (keypair)', () => {
  test('uses SNOWFLAKE_JWT and hands the SDK the key file path, never key contents', () => {
    const opts = buildConnectOptions(keyPairProfile());
    expect(opts['authenticator']).toBe('SNOWFLAKE_JWT');
    expect(opts['username']).toBe('svc_loader');
    expect(opts['privateKeyPath']).toBe('/home/me/.snowflake/rsa_key.p8');
    expect(opts['privateKey']).toBeUndefined();
    expect(opts['privateKeyPass']).toBeUndefined();
    expect(opts['password']).toBeUndefined();
  });

  test('forwards a passphrase as privateKeyPass, not as password', () => {
    const opts = buildConnectOptions(keyPairProfile(), 'key-passphrase');
    expect(opts['privateKeyPass']).toBe('key-passphrase');
    expect(opts['password']).toBeUndefined();
  });

  test('omits privateKeyPass for an empty passphrase', () => {
    const opts = buildConnectOptions(keyPairProfile(), '');
    expect('privateKeyPass' in opts).toBe(false);
  });

  test('requires a username', () => {
    expect(() => buildConnectOptions(keyPairProfile({ username: '' }))).toThrow(/username/);
  });

  test('requires a private key file path', () => {
    expect(() => buildConnectOptions(keyPairProfile({ privateKeyPath: '' }))).toThrow(
      /private key file/
    );
    expect(() =>
      buildConnectOptions({
        id: 'kp1',
        accountUrl: 'https://myorg-myaccount.snowflakecomputing.com',
        authMethod: 'keypair',
        username: 'svc_loader'
      })
    ).toThrow(/private key file/);
  });

  test('keeps the default role (unlike a PAT, key-pair sign-in is not role-bound)', () => {
    const opts = buildConnectOptions(keyPairProfile({ defaultRole: 'LOADER' }));
    expect(opts['role']).toBe('LOADER');
  });
});

describe('checkPrivateKeyFile', () => {
  let dir: string;
  let expectedFingerprint: string;
  const files: Record<string, string> = {};

  async function put(name: string, contents: string | Buffer): Promise<string> {
    const p = path.join(dir, name);
    await writeFile(p, contents);
    files[name] = p;
    return p;
  }

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'snowboy-keypair-'));
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expectedFingerprint = fingerprintOf(publicKey);

    await put('plain.p8', privateKey.export({ type: 'pkcs8', format: 'pem' }));
    await put(
      'encrypted.p8',
      privateKey.export({
        type: 'pkcs8',
        format: 'pem',
        cipher: 'aes-256-cbc',
        passphrase: PASSPHRASE
      })
    );
    await put('traditional.pem', privateKey.export({ type: 'pkcs1', format: 'pem' }));
    await put(
      'traditional-encrypted.pem',
      privateKey.export({
        type: 'pkcs1',
        format: 'pem',
        cipher: 'aes-256-cbc',
        passphrase: PASSPHRASE
      })
    );
    await put('rsa_key.pub', publicKey.export({ type: 'spki', format: 'pem' }));
    await put('key.der', privateKey.export({ type: 'pkcs8', format: 'der' }));
    await put('notes.txt', 'these are not the keys you are looking for\n');
    await put('huge.pem', 'A'.repeat(70 * 1024));
    await put(
      'openssh.key',
      '-----BEGIN OPENSSH PRIVATE KEY-----\n' +
        'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\n' +
        '-----END OPENSSH PRIVATE KEY-----\n'
    );
    await put(
      'corrupt.p8',
      '-----BEGIN PRIVATE KEY-----\n' +
        'bm90IGEgREVSIGVuY29kZWQgcHJpdmF0ZSBrZXkgYXQgYWxs\n' +
        '-----END PRIVATE KEY-----\n'
    );
    const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    await put('ec.p8', ec.privateKey.export({ type: 'pkcs8', format: 'pem' }));
    const weak = generateKeyPairSync('rsa', { modulusLength: 1024 });
    await put('rsa1024.p8', weak.privateKey.export({ type: 'pkcs8', format: 'pem' }));

    // A bad paste: the last two base64 lines of an encrypted key are missing.
    const encryptedLines = (await readFile(files['encrypted.p8']!, 'utf8')).trimEnd().split('\n');
    await put(
      'truncated.p8',
      [...encryptedLines.slice(0, -3), encryptedLines[encryptedLines.length - 1]].join('\n') + '\n'
    );

    // `openssl pkcs8 -scrypt` keys can't be decrypted by BoringSSL (Electron,
    // Bun). node:crypto can't write one, so relabel the PBKDF2 OID of a PBES2
    // key as scrypt; both OIDs encode to 9 bytes.
    const der = privateKey.export({
      type: 'pkcs8',
      format: 'der',
      cipher: 'aes-256-cbc',
      passphrase: PASSPHRASE
    });
    const pbkdf2Oid = Buffer.from('06092a864886f70d01050c', 'hex');
    const scryptOid = Buffer.from('06092b06010401da47040b', 'hex');
    scryptOid.copy(der, der.indexOf(pbkdf2Oid));
    await put(
      'scrypt.p8',
      '-----BEGIN ENCRYPTED PRIVATE KEY-----\n' +
        der
          .toString('base64')
          .match(/.{1,64}/g)!
          .join('\n') +
        '\n-----END ENCRYPTED PRIVATE KEY-----\n'
    );
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('accepts an unencrypted PKCS#8 key and reports the public key fingerprint', async () => {
    const result = await checkPrivateKeyFile(files['plain.p8']!);
    expect(result).toEqual({ ok: true, encrypted: false, fingerprint: expectedFingerprint });
  });

  test('accepts an encrypted PKCS#8 key with the right passphrase', async () => {
    const result = await checkPrivateKeyFile(files['encrypted.p8']!, PASSPHRASE);
    expect(result).toEqual({ ok: true, encrypted: true, fingerprint: expectedFingerprint });
  });

  test('ignores a passphrase given for an unencrypted key', async () => {
    const result = await checkPrivateKeyFile(files['plain.p8']!, 'not needed');
    expect(result).toEqual({ ok: true, encrypted: false, fingerprint: expectedFingerprint });
  });

  test('accepts a traditional RSA PEM key, which the SDK also reads', async () => {
    const result = await checkPrivateKeyFile(files['traditional.pem']!);
    expect(result).toEqual({ ok: true, encrypted: false, fingerprint: expectedFingerprint });
  });

  test('encrypted key without a passphrase -> passphrase_required', async () => {
    const result = await checkPrivateKeyFile(files['encrypted.p8']!);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toBe('passphrase_required');
    expect(result.message).toMatch(/encrypted/i);
    expect(result.message).toMatch(/passphrase/i);
  });

  test('an empty passphrase counts as missing', async () => {
    const result = await checkPrivateKeyFile(files['encrypted.p8']!, '');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toBe('passphrase_required');
  });

  test('accepts an encrypted traditional RSA PEM key with the right passphrase', async () => {
    const result = await checkPrivateKeyFile(files['traditional-encrypted.pem']!, PASSPHRASE);
    expect(result).toEqual({ ok: true, encrypted: true, fingerprint: expectedFingerprint });
  });

  test('encrypted traditional RSA PEM with a wrong passphrase -> wrong_passphrase', async () => {
    const result = await checkPrivateKeyFile(files['traditional-encrypted.pem']!, 'nope');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toBe('wrong_passphrase');
  });

  test('encrypted traditional RSA PEM without a passphrase -> passphrase_required', async () => {
    const result = await checkPrivateKeyFile(files['traditional-encrypted.pem']!);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toBe('passphrase_required');
  });

  test('wrong passphrase -> wrong_passphrase, without echoing key material', async () => {
    const result = await checkPrivateKeyFile(files['encrypted.p8']!, 'wrong passphrase');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toBe('wrong_passphrase');
    expect(result.message).toMatch(/passphrase/i);
    // A damaged traditional PEM key also fails this way, so the message allows for it.
    expect(result.message).toMatch(/damaged/i);

    const pem = await readFile(files['encrypted.p8']!, 'utf8');
    for (const line of pem.split('\n').filter((l) => /^[A-Za-z0-9+/=]{16,}$/.test(l))) {
      expect(result.message).not.toContain(line);
    }
  });

  test('an encryption scheme the runtime cannot decrypt -> unsupported_format, not a passphrase error', async () => {
    const result = await checkPrivateKeyFile(files['scrypt.p8']!, PASSPHRASE);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toBe('unsupported_format');
    expect(result.message).toMatch(/encrypt/i);
    expect(result.message).not.toMatch(/passphrase does not/i);
  });

  test('a truncated encrypted key with the right passphrase -> the message allows for a damaged file', async () => {
    const result = await checkPrivateKeyFile(files['truncated.p8']!, PASSPHRASE);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toBe('wrong_passphrase');
    expect(result.message).toMatch(/damaged/i);
  });

  test('an RSA key under 2048 bits -> unsupported_format (Snowflake would reject it)', async () => {
    const result = await checkPrivateKeyFile(files['rsa1024.p8']!);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toBe('unsupported_format');
    expect(result.message).toMatch(/1024/);
    expect(result.message).toMatch(/2048/);
  });

  test('a relative path -> not_found, asking for an absolute path', async () => {
    const result = await checkPrivateKeyFile('keys/rsa_key.p8');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toBe('not_found');
    expect(result.message).toMatch(/absolute/i);
  });

  test('missing file -> not_found, naming the path', async () => {
    const missing = path.join(dir, 'nope.p8');
    const result = await checkPrivateKeyFile(missing);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toBe('not_found');
    expect(result.message).toContain(missing);
  });

  test('empty path -> not_found', async () => {
    const result = await checkPrivateKeyFile('');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toBe('not_found');
  });

  test('a directory -> unreadable', async () => {
    const result = await checkPrivateKeyFile(dir);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toBe('unreadable');
    expect(result.message).toContain(dir);
  });

  test('a public key -> not_private_key, pointing at the private key file', async () => {
    const result = await checkPrivateKeyFile(files['rsa_key.pub']!);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toBe('not_private_key');
    expect(result.message).toMatch(/public key/i);
  });

  test('a file with no PEM block -> not_private_key', async () => {
    const result = await checkPrivateKeyFile(files['notes.txt']!);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toBe('not_private_key');
    expect(result.message).toContain('-----BEGIN PRIVATE KEY-----');
  });

  test('a DER-encoded key (no PEM armor) -> not_private_key', async () => {
    const result = await checkPrivateKeyFile(files['key.der']!);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toBe('not_private_key');
  });

  test('a file far larger than any key -> not_private_key, without parsing it', async () => {
    const result = await checkPrivateKeyFile(files['huge.pem']!);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toBe('not_private_key');
    expect(result.message).toMatch(/too large/i);
  });

  test('an OpenSSH-format key -> unsupported_format with a conversion hint', async () => {
    const result = await checkPrivateKeyFile(files['openssh.key']!);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toBe('unsupported_format');
    expect(result.message).toMatch(/OpenSSH/);
    expect(result.message).toMatch(/PKCS#8/);
  });

  test('a PEM block that does not parse -> unsupported_format', async () => {
    const result = await checkPrivateKeyFile(files['corrupt.p8']!);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toBe('unsupported_format');
    expect(result.message).toMatch(/corrupt|truncated/i);
  });

  test('a non-RSA key -> unsupported_format (Snowflake needs RSA)', async () => {
    const result = await checkPrivateKeyFile(files['ec.p8']!);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toBe('unsupported_format');
    expect(result.message).toMatch(/RSA/);
  });
});
