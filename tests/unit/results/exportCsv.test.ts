import { expect, test } from 'bun:test';
import { exportCsv } from '../../../src/renderer/lib/results/exportCsv';

test('Basic CSV with header + 2 rows', () => {
  const columns = [{ name: 'id' }, { name: 'name' }];
  const rows = [
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' }
  ];
  const csv = exportCsv(columns, rows);
  expect(csv).toBe('id,name\n1,Alice\n2,Bob');
});

test('Field containing comma -> quoted', () => {
  const columns = [{ name: 'id' }, { name: 'name' }];
  const rows = [
    { id: 1, name: 'Alice, Smith' }
  ];
  const csv = exportCsv(columns, rows);
  expect(csv).toBe('id,name\n1,"Alice, Smith"');
});

test('Field containing double-quote -> escaped (doubled) and quoted', () => {
  const columns = [{ name: 'id' }, { name: 'name' }];
  const rows = [
    { id: 1, name: 'Alice "The Boss" Smith' }
  ];
  const csv = exportCsv(columns, rows);
  expect(csv).toBe('id,name\n1,"Alice ""The Boss"" Smith"');
});

test('Field containing newline -> quoted', () => {
  const columns = [{ name: 'id' }, { name: 'name' }];
  const rows = [
    { id: 1, name: 'Alice\nSmith' }
  ];
  const csv = exportCsv(columns, rows);
  expect(csv).toBe('id,name\n1,"Alice\nSmith"');
});

test('NULL -> empty string', () => {
  const columns = [{ name: 'id' }, { name: 'name' }];
  const rows = [
    { id: 1, name: null },
    { id: 2, name: undefined }
  ];
  const csv = exportCsv(columns, rows);
  expect(csv).toBe('id,name\n1,\n2,');
});

test('JSON value -> JSON.stringify\'d then escaped', () => {
  const columns = [{ name: 'id' }, { name: 'data' }];
  const rows = [
    { id: 1, data: { key: "value, with comma" } }
  ];
  const csv = exportCsv(columns, rows);
  expect(csv).toBe('id,data\n1,"{""key"":""value, with comma""}"');
});
