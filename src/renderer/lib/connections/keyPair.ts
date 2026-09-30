import type { PrivateKeyCheck } from '../../../main/types';

export type PassphraseAction = 'store' | 'clear' | 'keep';

/**
 * What saving a profile does with the key passphrase. `check` is this
 * save's key check, or `null` when the profile doesn't use key-pair auth.
 * A typed passphrase is stored only for an encrypted key; a stored one is
 * dropped once the key is unencrypted or the profile leaves key-pair auth.
 * A failed check changes nothing (the save is refused anyway).
 */
export function passphraseAction(
  check: PrivateKeyCheck | null,
  typed: string,
  hasStored: boolean
): PassphraseAction {
  if (check !== null && !check.ok) return 'keep';
  if (check !== null && check.encrypted) return typed.length > 0 ? 'store' : 'keep';
  return hasStored ? 'clear' : 'keep';
}
