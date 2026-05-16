export type SnowflakeColumnKind = 'string' | 'number' | 'boolean' | 'date' | 'json' | 'binary' | 'unknown';

export function classifyType(dataType: string | undefined): SnowflakeColumnKind {
  if (!dataType) return 'unknown';
  const upper = dataType.toUpperCase();
  if (['VARCHAR', 'STRING', 'TEXT', 'CHAR'].includes(upper)) return 'string';
  if (['NUMBER', 'DECIMAL', 'INTEGER', 'INT', 'BIGINT', 'SMALLINT', 'TINYINT', 'FLOAT', 'DOUBLE', 'REAL'].includes(upper)) return 'number';
  if (upper === 'BOOLEAN') return 'boolean';
  if (['DATE', 'DATETIME', 'TIME', 'TIMESTAMP', 'TIMESTAMP_LTZ', 'TIMESTAMP_NTZ', 'TIMESTAMP_TZ'].includes(upper)) return 'date';
  if (['VARIANT', 'OBJECT', 'ARRAY'].includes(upper)) return 'json';
  if (['BINARY', 'VARBINARY'].includes(upper)) return 'binary';
  return 'unknown';
}

export function formatCell(value: unknown, kind: SnowflakeColumnKind): { display: string; isExpandable: boolean } {
  if (value === null || value === undefined) {
    return { display: 'NULL', isExpandable: false };
  }

  switch (kind) {
    case 'string':
      return { display: String(value), isExpandable: false };
    case 'number':
      if (typeof value === 'number') {
        return { display: new Intl.NumberFormat('en-US', { maximumFractionDigits: 20 }).format(value), isExpandable: false };
      }
      return { display: String(value), isExpandable: false };
    case 'boolean':
      return { display: value ? 'TRUE' : 'FALSE', isExpandable: false };
    case 'date':
      if (value instanceof Date) {
        const pad = (n: number) => String(n).padStart(2, '0');
        const yyyy = value.getFullYear();
        const mm = pad(value.getMonth() + 1);
        const dd = pad(value.getDate());
        const hh = pad(value.getHours());
        const min = pad(value.getMinutes());
        const ss = pad(value.getSeconds());
        return { display: `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`, isExpandable: false };
      }
      return { display: String(value), isExpandable: false };
    case 'json':
      try {
        const str = typeof value === 'string' ? value : JSON.stringify(value);
        const preview = str.length > 40 ? str.substring(0, 40) + '...' : str;
        return { display: preview, isExpandable: true };
      } catch {
        return { display: String(value), isExpandable: true };
      }
    case 'binary':
      return { display: String(value), isExpandable: false };
    default:
      return { display: String(value), isExpandable: false };
  }
}
