import type { SchemaObjectKind } from '../../../main/types';

export type BrowserNodeKind = SchemaObjectKind | 'profile' | 'group' | 'function';

export interface BrowserNode {
  id: string;
  name: string;
  kind: BrowserNodeKind;
  children?: BrowserNode[];
  hasChildren?: boolean;
  database?: string;
  schema?: string;
  dataType?: string;
  nullable?: boolean;
}
