export type Column = {
  name: string;
  dataType?: string;
  width?: number;
};

export type Row = Record<string, unknown>;

export function exportCsv(columns: Column[], rows: Row[]): string {
  const escapeField = (field: unknown): string => {
    if (field === null || field === undefined) return '';
    let str = '';
    if (typeof field === 'object') {
      str = JSON.stringify(field);
    } else {
      str = String(field);
    }
    
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const header = columns.map(c => escapeField(c.name)).join(',');
  const body = rows.map(row => {
    return columns.map(c => escapeField(row[c.name])).join(',');
  }).join('\n');

  return `${header}\n${body}`;
}
