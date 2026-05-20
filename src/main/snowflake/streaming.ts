import type { Readable } from 'node:stream';
import type { ColumnMeta, RowBatch } from './types';

interface SnowflakeColumn {
  getName(): string;
  getType(): string;
  isNullable(): boolean;
}

interface StreamRowsOptions {
  start?: number;
  end?: number;
}

interface SnowflakeStatementLike {
  getQueryId(): string;
  getNumRows(): number;
  getColumns(): SnowflakeColumn[] | undefined;
  getSessionState(): object | undefined;
  streamRows(options?: StreamRowsOptions): Readable;
  cancel?(callback?: (err: Error | undefined) => void): void;
}

export type { SnowflakeStatementLike };

export function mapColumns(raw: SnowflakeColumn[] | undefined): ColumnMeta[] {
  if (!raw) return [];
  return raw.map((c) => ({
    name: c.getName(),
    type: c.getType(),
    nullable: c.isNullable(),
  }));
}

export function getWarehouseFromState(state: object | undefined): string {
  if (!state || typeof state !== 'object') return '';
  const record = state as Record<string, unknown>;
  const value = record['current_warehouse'] ?? record['CURRENT_WAREHOUSE'];
  return typeof value === 'string' ? value : '';
}

/**
 * Drives snowflake-sdk's windowed `streamRows({start, end})` API one batch
 * at a time. We do NOT request the entire result up front; each window
 * resolves before the next is requested, which bounds driver memory per
 * plan §9 risk #6.
 *
 * `onAbort` returns `true` to stop iteration without emitting onComplete.
 * Resolves with the total row count after the last window emits.
 */
export async function streamWindows(
  statement: SnowflakeStatementLike,
  batchSize: number,
  columns: readonly ColumnMeta[],
  emit: (batch: RowBatch) => void,
  onAbort: () => boolean,
): Promise<number> {
  if (batchSize <= 0) {
    throw new Error(`batchSize must be > 0, got ${batchSize}`);
  }

  const total = statement.getNumRows();
  if (total <= 0) {
    if (!onAbort()) {
      emit({ rows: [], columns, offset: 0 });
    }
    return 0;
  }

  let offset = 0;
  while (offset < total) {
    if (onAbort()) {
      return offset;
    }
    const end = Math.min(offset + batchSize - 1, total - 1);
    const rows = await collectWindow(statement, offset, end);
    if (rows.length === 0) {
      break;
    }
    if (onAbort()) {
      return offset;
    }
    emit({ rows, columns, offset });
    offset += rows.length;
  }
  return offset;
}

function collectWindow(
  statement: SnowflakeStatementLike,
  start: number,
  end: number,
): Promise<unknown[][]> {
  return new Promise((resolve, reject) => {
    const buffer: unknown[][] = [];
    let readable: Readable;
    try {
      readable = statement.streamRows({ start, end });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    readable.on('data', (row: unknown) => {
      buffer.push(Array.isArray(row) ? (row as unknown[]) : [row]);
    });
    readable.once('end', () => resolve(buffer));
    readable.once('error', (err: Error) => reject(err));
  });
}
