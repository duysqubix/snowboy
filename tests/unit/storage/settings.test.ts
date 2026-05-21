import {
  afterEach,
  beforeEach,
  describe,
  expect,
  spyOn,
  test
} from 'bun:test';
import * as fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  __setDataDirForTesting,
  __setStoragePathForTesting,
  readSettings,
  writeSettings
} from '../../../src/main/storage/settings';

let workDir: string;
let settingsFile: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'snowboy-settings-'));
  settingsFile = join(workDir, 'settings.json');
  __setStoragePathForTesting(settingsFile);
  __setDataDirForTesting(workDir);
});

afterEach(() => {
  __setStoragePathForTesting(null);
  __setDataDirForTesting(null);
  rmSync(workDir, { recursive: true, force: true });
});

describe('readSettings()', () => {
  test('returns defaults when the JSON file is missing', () => {
    const result = readSettings();
    expect(result).toEqual({
      theme: 'system',
      fontSize: 14,
      tabWidth: 2,
      wordWrap: true,
      telemetryEnabled: false,
      dataDir: workDir
    });
    expect(fs.existsSync(settingsFile)).toBe(false);
  });

  test('falls back to defaults + emits warn on malformed JSON', () => {
    fs.writeFileSync(settingsFile, '{not-valid-json', 'utf8');
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const result = readSettings();
      expect(result.theme).toBe('system');
      expect(result.fontSize).toBe(14);
      expect(result.tabWidth).toBe(2);
      const messages = warn.mock.calls.map((c) => String(c[0]));
      expect(messages.some((m) => m.includes('malformed JSON'))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  test('clamps per-field corruption to safe defaults on read', () => {
    fs.writeFileSync(
      settingsFile,
      JSON.stringify({
        theme: 42,
        fontSize: -10,
        tabWidth: 3,
        wordWrap: 'yes',
        telemetryEnabled: true,
        dataDir: ''
      }),
      'utf8'
    );
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const result = readSettings();
      expect(result.theme).toBe('system');
      expect(result.fontSize).toBe(10);
      expect(result.tabWidth).toBe(2);
      expect(result.wordWrap).toBe(true);
      expect(result.telemetryEnabled).toBe(true);
      expect(result.dataDir).toBe(workDir);

      const above = JSON.stringify({ ...result, fontSize: 999 });
      fs.writeFileSync(settingsFile, above, 'utf8');
      expect(readSettings().fontSize).toBe(24);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('writeSettings()', () => {
  test('write + read round-trips a partial update', () => {
    expect(readSettings().theme).toBe('system');
    writeSettings({ theme: 'dark' });
    const after = readSettings();
    expect(after.theme).toBe('dark');
    expect(after.fontSize).toBe(14);
    expect(after.tabWidth).toBe(2);
    expect(fs.existsSync(settingsFile)).toBe(true);
    expect(fs.existsSync(`${settingsFile}.tmp`)).toBe(false);
  });

  test('second write supersedes the first; no .tmp left behind', () => {
    writeSettings({ theme: 'dark', fontSize: 16 });
    writeSettings({ fontSize: 18 });
    const after = readSettings();
    expect(after.theme).toBe('dark');
    expect(after.fontSize).toBe(18);
    expect(after.tabWidth).toBe(2);

    const parsed = JSON.parse(fs.readFileSync(settingsFile, 'utf8')) as {
      theme: string;
      fontSize: number;
    };
    expect(parsed.theme).toBe('dark');
    expect(parsed.fontSize).toBe(18);
    expect(fs.existsSync(`${settingsFile}.tmp`)).toBe(false);
  });

  test('partial writes do not erase unrelated fields', () => {
    writeSettings({
      theme: 'light',
      fontSize: 20,
      tabWidth: 4,
      wordWrap: false,
      telemetryEnabled: true
    });
    writeSettings({ tabWidth: 8 });
    const after = readSettings();
    expect(after.theme).toBe('light');
    expect(after.fontSize).toBe(20);
    expect(after.tabWidth).toBe(8);
    expect(after.wordWrap).toBe(false);
    expect(after.telemetryEnabled).toBe(true);
  });
});
