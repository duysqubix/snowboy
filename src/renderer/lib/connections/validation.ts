import type { ConnectionProfile } from '../../../main/types';

export type ValidationError = { field: string; message: string };

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
    const accountUrlRegex = /^[a-z0-9-]+(\.[a-z0-9-]+)?\.snowflakecomputing\.com$/i;
    if (!accountUrlRegex.test(input.accountUrl)) {
      errors.push({ field: 'accountUrl', message: 'Invalid Account URL format' });
    }
  }

  if (!input.authMethod) {
    errors.push({ field: 'authMethod', message: 'Auth method is required' });
  } else if (!['externalbrowser', 'password_mfa', 'password'].includes(input.authMethod)) {
    errors.push({ field: 'authMethod', message: 'Invalid auth method' });
  }

  if (!input.username || input.username.trim().length === 0) {
    errors.push({ field: 'username', message: 'Username is required' });
  } else if (input.username.length > 128) {
    errors.push({ field: 'username', message: 'Username must be 128 characters or less' });
  }

  return errors;
}
