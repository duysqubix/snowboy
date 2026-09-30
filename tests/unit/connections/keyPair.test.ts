import { describe, expect, test } from 'bun:test';

import { passphraseAction } from '../../../src/renderer/lib/connections/keyPair';
import type { PrivateKeyCheck } from '../../../src/main/types';

const ENCRYPTED: PrivateKeyCheck = { ok: true, encrypted: true, fingerprint: 'SHA256:enc' };
const UNENCRYPTED: PrivateKeyCheck = { ok: true, encrypted: false, fingerprint: 'SHA256:plain' };
const FAILED: PrivateKeyCheck = {
  ok: false,
  problem: 'not_found',
  message: 'Private key file not found: /gone.p8'
};

describe('passphraseAction', () => {
  test('encrypted key + typed passphrase -> store (replacing any stored one)', () => {
    expect(passphraseAction(ENCRYPTED, 'secret', false)).toBe('store');
    expect(passphraseAction(ENCRYPTED, 'secret', true)).toBe('store');
  });

  test('encrypted key + nothing typed -> keep the stored passphrase', () => {
    expect(passphraseAction(ENCRYPTED, '', true)).toBe('keep');
    expect(passphraseAction(ENCRYPTED, '', false)).toBe('keep');
  });

  test('unencrypted key -> clear a stored passphrase it does not need', () => {
    expect(passphraseAction(UNENCRYPTED, '', true)).toBe('clear');
    expect(passphraseAction(UNENCRYPTED, 'typed anyway', true)).toBe('clear');
  });

  test('unencrypted key + nothing stored -> keep; a typed passphrase is not stored', () => {
    expect(passphraseAction(UNENCRYPTED, '', false)).toBe('keep');
    expect(passphraseAction(UNENCRYPTED, 'typed anyway', false)).toBe('keep');
  });

  test('profile no longer uses key-pair auth -> clear a stored passphrase', () => {
    expect(passphraseAction(null, '', true)).toBe('clear');
    expect(passphraseAction(null, 'typed before switching', true)).toBe('clear');
    expect(passphraseAction(null, '', false)).toBe('keep');
  });

  test('a failed key check never stores or clears', () => {
    expect(passphraseAction(FAILED, 'secret', true)).toBe('keep');
    expect(passphraseAction(FAILED, '', true)).toBe('keep');
  });
});
