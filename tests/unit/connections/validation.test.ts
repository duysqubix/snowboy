import { describe, it, expect } from 'vitest';
import { validateProfile } from '../../../src/renderer/lib/connections/validation';
import type { ConnectionProfile } from '../../../src/main/types';

describe('validateProfile', () => {
  it('Valid full profile -> []', () => {
    const profile: Partial<ConnectionProfile> = {
      name: 'My Profile',
      accountUrl: 'myaccount.us-east-1.snowflakecomputing.com',
      authMethod: 'externalbrowser',
      username: 'user@example.com',
      defaultRole: 'SYSADMIN',
      defaultWarehouse: 'COMPUTE_WH',
      defaultDatabase: 'SNOWFLAKE',
      defaultSchema: 'PUBLIC'
    };
    expect(validateProfile(profile)).toEqual([]);
  });

  it('Missing name -> 1 error', () => {
    const profile: Partial<ConnectionProfile> = {
      accountUrl: 'myaccount.snowflakecomputing.com',
      authMethod: 'password',
      username: 'user'
    };
    const errors = validateProfile(profile);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('name');
  });

  it('Empty name -> 1 error', () => {
    const profile: Partial<ConnectionProfile> = {
      name: '   ',
      accountUrl: 'myaccount.snowflakecomputing.com',
      authMethod: 'password',
      username: 'user'
    };
    const errors = validateProfile(profile);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('name');
  });

  it('Invalid account URL -> 1 error', () => {
    const profile: Partial<ConnectionProfile> = {
      name: 'Test',
      accountUrl: 'myaccount.snowflake.com',
      authMethod: 'password',
      username: 'user'
    };
    const errors = validateProfile(profile);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('accountUrl');
  });

  it('Missing username -> 1 error', () => {
    const profile: Partial<ConnectionProfile> = {
      name: 'Test',
      accountUrl: 'myaccount.snowflakecomputing.com',
      authMethod: 'password'
    };
    const errors = validateProfile(profile);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('username');
  });

  it('Bad authMethod -> 1 error', () => {
    const profile: Partial<ConnectionProfile> = {
      name: 'Test',
      accountUrl: 'myaccount.snowflakecomputing.com',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      authMethod: 'invalid' as any,
      username: 'user'
    };
    const errors = validateProfile(profile);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('authMethod');
  });

  it('Multiple missing fields -> multiple errors', () => {
    const profile: Partial<ConnectionProfile> = {};
    const errors = validateProfile(profile);
    expect(errors.length).toBeGreaterThan(1);
    expect(errors.map(e => e.field)).toContain('name');
    expect(errors.map(e => e.field)).toContain('accountUrl');
    expect(errors.map(e => e.field)).toContain('authMethod');
    expect(errors.map(e => e.field)).toContain('username');
  });

  it('Optional defaults missing -> still valid', () => {
    const profile: Partial<ConnectionProfile> = {
      name: 'Test',
      accountUrl: 'myaccount.snowflakecomputing.com',
      authMethod: 'password',
      username: 'user'
    };
    expect(validateProfile(profile)).toEqual([]);
  });
});
