/* eslint-disable @typescript-eslint/no-unused-vars */
import type { RowData, TableFeatures } from '@tanstack/table-core';
import type { SnowflakeColumnKind } from './columnTypes';

declare module '@tanstack/table-core' {
  interface ColumnMeta<TFeatures extends TableFeatures, TData extends RowData, TValue> {
    kind?: SnowflakeColumnKind;
    isNumeric?: boolean;
  }
}

export {};
