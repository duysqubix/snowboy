/**
 * T1.4 opt-in integration smoke. Skipped unless these env vars are set:
 *   SNOWBOY_TEST_ACCOUNT  e.g. https://ab12345.us-east-1.snowflakecomputing.com
 *   SNOWBOY_TEST_USER     login name
 *   SNOWBOY_TEST_PWD      password (plain auth path only)
 * Optional:
 *   SNOWBOY_TEST_ROLE, SNOWBOY_TEST_WAREHOUSE,
 *   SNOWBOY_TEST_DATABASE, SNOWBOY_TEST_SCHEMA
 *
 * CI never sets these, so this file is a no-op there. Locally it proves the
 * real driver can authenticate (password auth), run a trivial query, and
 * tear down without leaking handles.
 */
import { test, expect } from 'bun:test';
import { Session } from '../../src/main/snowflake/session';
import type { ConnectionProfileLite, RowBatch } from '../../src/main/snowflake/types';

const account = process.env['SNOWBOY_TEST_ACCOUNT'];
const user = process.env['SNOWBOY_TEST_USER'];
const password = process.env['SNOWBOY_TEST_PWD'];
const hasCredentials = Boolean(account && user && password);

test.skipIf(!hasCredentials)(
  'smoke: real password auth + SELECT CURRENT_ROLE() round-trip',
  async () => {
    const profile: ConnectionProfileLite = {
      id: 'smoke',
      accountUrl: account!,
      authMethod: 'password',
      username: user!,
      ...(process.env['SNOWBOY_TEST_ROLE'] ? { defaultRole: process.env['SNOWBOY_TEST_ROLE'] } : {}),
      ...(process.env['SNOWBOY_TEST_WAREHOUSE']
        ? { defaultWarehouse: process.env['SNOWBOY_TEST_WAREHOUSE'] }
        : {}),
      ...(process.env['SNOWBOY_TEST_DATABASE']
        ? { defaultDatabase: process.env['SNOWBOY_TEST_DATABASE'] }
        : {}),
      ...(process.env['SNOWBOY_TEST_SCHEMA']
        ? { defaultSchema: process.env['SNOWBOY_TEST_SCHEMA'] }
        : {}),
    };

    const session = await Session.open(profile, {}, { password });
    try {
      const batches: RowBatch[] = [];
      let completed = false;
      let lastError: Error | null = null;
      const handle = session.runStreaming(
        'SELECT CURRENT_ROLE() AS R',
        { timeoutMs: 30_000 },
        {
          onBatch: (b) => batches.push(b),
          onComplete: () => {
            completed = true;
          },
          onError: (e) => {
            lastError = e;
          },
          onCancel: () => {},
        },
      );

      const deadline = Date.now() + 30_000;
      while (!completed && lastError === null) {
        if (Date.now() > deadline) {
          throw new Error('smoke: query did not complete in 30s');
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      if (lastError) throw lastError;

      expect(handle.queryId.length).toBeGreaterThan(0);
      expect(batches.length).toBe(1);
      expect(batches[0]!.rows.length).toBe(1);
      expect(batches[0]!.columns[0]?.name.toUpperCase()).toBe('R');
    } finally {
      await session.close();
    }
  },
  60_000,
);
