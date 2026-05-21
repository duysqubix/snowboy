import { describe, expect, test } from 'bun:test';
import { exportCsv } from '../../../src/renderer/lib/results/exportCsv';

describe('exportCsv — RFC 4180 baseline', () => {
  test('header + 2 rows uses CRLF between records and no trailing terminator', () => {
    const columns = [{ name: 'id' }, { name: 'name' }];
    const rows = [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' }
    ];
    expect(exportCsv(columns, rows)).toBe('id,name\r\n1,Alice\r\n2,Bob');
  });

  test('zero rows emits header only with no trailing terminator', () => {
    const columns = [{ name: 'id' }, { name: 'name' }];
    expect(exportCsv(columns, [])).toBe('id,name');
  });

  test('trailingNewline option appends CRLF after final record', () => {
    const columns = [{ name: 'id' }];
    expect(exportCsv(columns, [{ id: 1 }], { trailingNewline: true })).toBe(
      'id\r\n1\r\n'
    );
  });

  test('column name containing comma is quote-escaped in the header', () => {
    const columns = [{ name: 'id, primary' }, { name: 'name' }];
    expect(exportCsv(columns, [{ 'id, primary': 1, name: 'Alice' }])).toBe(
      '"id, primary",name\r\n1,Alice'
    );
  });
});

describe('exportCsv — string-escape rules', () => {
  test('field containing comma is wrapped in quotes', () => {
    const csv = exportCsv(
      [{ name: 'id' }, { name: 'name' }],
      [{ id: 1, name: 'Alice, Smith' }]
    );
    expect(csv).toBe('id,name\r\n1,"Alice, Smith"');
  });

  test('field containing double-quote is doubled and wrapped', () => {
    const csv = exportCsv(
      [{ name: 'id' }, { name: 'name' }],
      [{ id: 1, name: 'Alice "The Boss" Smith' }]
    );
    expect(csv).toBe('id,name\r\n1,"Alice ""The Boss"" Smith"');
  });

  test('multi-line VARCHAR is quoted with literal LF inside, CRLF between records', () => {
    const csv = exportCsv(
      [{ name: 'id' }, { name: 'note' }],
      [
        { id: 1, note: 'line1\nline2' },
        { id: 2, note: 'ok' }
      ]
    );
    expect(csv).toBe('id,note\r\n1,"line1\nline2"\r\n2,ok');
    expect(csv.indexOf('"line1\nline2"')).toBeGreaterThan(-1);
    expect(csv.split('\r\n').length).toBe(3);
  });

  test('field containing CR is quoted (Excel-on-Windows safety)', () => {
    const csv = exportCsv(
      [{ name: 'note' }],
      [{ note: 'a\rb' }]
    );
    expect(csv).toBe('note\r\n"a\rb"');
  });
});

describe('exportCsv — null and undefined', () => {
  test('null and undefined both render as empty unquoted cells', () => {
    const csv = exportCsv(
      [{ name: 'id' }, { name: 'name' }],
      [
        { id: 1, name: null },
        { id: 2, name: undefined }
      ]
    );
    expect(csv).toBe('id,name\r\n1,\r\n2,');
  });

  test('missing key in row object renders as empty cell', () => {
    const csv = exportCsv(
      [{ name: 'id' }, { name: 'missing' }],
      [{ id: 1 }]
    );
    expect(csv).toBe('id,missing\r\n1,');
  });
});

describe('exportCsv — numeric types', () => {
  test('finite numbers serialize via String(n)', () => {
    const csv = exportCsv(
      [{ name: 'n' }],
      [{ n: 0 }, { n: -1.5 }, { n: 42 }, { n: 3.14 }]
    );
    expect(csv).toBe('n\r\n0\r\n-1.5\r\n42\r\n3.14');
  });

  test('NaN renders as empty (Excel convention)', () => {
    const csv = exportCsv([{ name: 'n' }], [{ n: Number.NaN }]);
    expect(csv).toBe('n\r\n');
  });

  test('positive Infinity renders as empty', () => {
    const csv = exportCsv([{ name: 'n' }], [{ n: Number.POSITIVE_INFINITY }]);
    expect(csv).toBe('n\r\n');
  });

  test('negative Infinity renders as empty', () => {
    const csv = exportCsv([{ name: 'n' }], [{ n: Number.NEGATIVE_INFINITY }]);
    expect(csv).toBe('n\r\n');
  });

  test('BigInt round-trips losslessly above the JS safe-integer ceiling', () => {
    const beyondSafe = 9007199254740993n;
    expect(Number(beyondSafe)).toBe(9007199254740992);
    const csv = exportCsv([{ name: 'big' }], [{ big: beyondSafe }]);
    expect(csv).toBe('big\r\n9007199254740993');
  });

  test('BigInt zero and negative values render without marker suffix', () => {
    const csv = exportCsv(
      [{ name: 'big' }],
      [{ big: 0n }, { big: -42n }]
    );
    expect(csv).toBe('big\r\n0\r\n-42');
  });
});

describe('exportCsv — boolean', () => {
  test('boolean renders as "true" / "false" (lowercase, unquoted)', () => {
    const csv = exportCsv(
      [{ name: 'b' }],
      [{ b: true }, { b: false }]
    );
    expect(csv).toBe('b\r\ntrue\r\nfalse');
  });
});

describe('exportCsv — Date / TIMESTAMP_TZ', () => {
  test('Date renders as ISO 8601 UTC', () => {
    const csv = exportCsv(
      [{ name: 'ts' }],
      [{ ts: new Date('2024-06-15T14:30:45.678Z') }]
    );
    expect(csv).toBe('ts\r\n2024-06-15T14:30:45.678Z');
  });

  test('Date output is locale-independent (no GMT, no day-of-week, no offset)', () => {
    const csv = exportCsv(
      [{ name: 'ts' }],
      [{ ts: new Date('2024-01-01T00:00:00Z') }]
    );
    expect(csv).toBe('ts\r\n2024-01-01T00:00:00.000Z');
    expect(csv).not.toContain('GMT');
    expect(csv).not.toContain('Mon');
    expect(csv).not.toContain('Tue');
    expect(csv).not.toContain('Wed');
    expect(csv).not.toMatch(/[+-]\d{2}:?\d{2}\b/);
  });

  test('two clients constructing the same instant produce byte-identical CSVs', () => {
    const utcEpochMs = Date.UTC(2024, 5, 15, 14, 30, 45, 678);
    const sfClient = new Date(utcEpochMs);
    const nyClient = new Date(utcEpochMs);
    const sfCsv = exportCsv([{ name: 'ts' }], [{ ts: sfClient }]);
    const nyCsv = exportCsv([{ name: 'ts' }], [{ ts: nyClient }]);
    expect(sfCsv).toBe(nyCsv);
    expect(sfCsv).toBe('ts\r\n2024-06-15T14:30:45.678Z');
  });

  test('invalid Date renders as empty', () => {
    const csv = exportCsv([{ name: 'ts' }], [{ ts: new Date('not a date') }]);
    expect(csv).toBe('ts\r\n');
  });
});

describe('exportCsv — VARIANT / OBJECT / ARRAY', () => {
  test('object value is JSON-stringified then CSV-escaped (single escape layer)', () => {
    const csv = exportCsv(
      [{ name: 'id' }, { name: 'data' }],
      [{ id: 1, data: { key: 'value, with comma' } }]
    );
    expect(csv).toBe('id,data\r\n1,"{""key"":""value, with comma""}"');
  });

  test('array value is JSON-stringified then CSV-escaped', () => {
    const csv = exportCsv(
      [{ name: 'tags' }],
      [{ tags: ['a', 'b'] }]
    );
    expect(csv).toBe('tags\r\n"[""a"",""b""]"');
  });

  test('VARIANT containing embedded newlines is quoted exactly once and stays parseable', () => {
    const csv = exportCsv(
      [{ name: 'doc' }],
      [{ doc: { note: 'line1\nline2', tag: 'x' } }]
    );
    const expectedJson = '{"note":"line1\\nline2","tag":"x"}';
    const expectedCell = `"${expectedJson.replace(/"/g, '""')}"`;
    expect(csv).toBe(`doc\r\n${expectedCell}`);

    const cellBody = csv.slice('doc\r\n'.length);
    expect(cellBody.startsWith('"')).toBe(true);
    expect(cellBody.endsWith('"')).toBe(true);
    const unquoted = cellBody.slice(1, -1).replace(/""/g, '"');
    expect(JSON.parse(unquoted)).toEqual({ note: 'line1\nline2', tag: 'x' });
  });

  test('empty object and empty array stringify to {} and []', () => {
    const csv = exportCsv(
      [{ name: 'o' }, { name: 'a' }],
      [{ o: {}, a: [] }]
    );
    expect(csv).toBe('o,a\r\n{},[]');
  });
});
