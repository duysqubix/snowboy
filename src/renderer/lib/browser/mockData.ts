import { nanoid } from 'nanoid';
import type { BrowserNode } from './types';

export const mockTreeData: BrowserNode[] = [
  {
    id: nanoid(),
    name: 'Local Profile',
    kind: 'profile',
    hasChildren: true,
    children: [
      {
        id: nanoid(),
        name: 'SNOWBOY_DB',
        kind: 'database',
        database: 'SNOWBOY_DB',
        hasChildren: true,
        children: [
          {
            id: nanoid(),
            name: 'PUBLIC',
            kind: 'schema',
            database: 'SNOWBOY_DB',
            schema: 'PUBLIC',
            hasChildren: true,
            children: [
              {
                id: nanoid(),
                name: 'Tables',
                kind: 'group',
                hasChildren: true,
                children: [
                  {
                    id: nanoid(),
                    name: 'CUSTOMERS',
                    kind: 'table',
                    database: 'SNOWBOY_DB',
                    schema: 'PUBLIC',
                    hasChildren: true,
                    children: [
                      { id: nanoid(), name: 'id', kind: 'column', dataType: 'NUMBER', nullable: false },
                      { id: nanoid(), name: 'name', kind: 'column', dataType: 'VARCHAR', nullable: true },
                      { id: nanoid(), name: 'email', kind: 'column', dataType: 'VARCHAR', nullable: true },
                      { id: nanoid(), name: 'created_at', kind: 'column', dataType: 'TIMESTAMP', nullable: false },
                      { id: nanoid(), name: 'is_active', kind: 'column', dataType: 'BOOLEAN', nullable: true },
                    ]
                  },
                  {
                    id: nanoid(),
                    name: 'ORDERS',
                    kind: 'table',
                    database: 'SNOWBOY_DB',
                    schema: 'PUBLIC',
                    hasChildren: true,
                    children: [
                      { id: nanoid(), name: 'id', kind: 'column', dataType: 'NUMBER', nullable: false },
                      { id: nanoid(), name: 'customer_id', kind: 'column', dataType: 'NUMBER', nullable: false },
                      { id: nanoid(), name: 'total_amount', kind: 'column', dataType: 'NUMBER', nullable: true },
                    ]
                  }
                ]
              },
              {
                id: nanoid(),
                name: 'Views',
                kind: 'group',
                hasChildren: true,
                children: [
                  {
                    id: nanoid(),
                    name: 'V_RECENT_ORDERS',
                    kind: 'view',
                    database: 'SNOWBOY_DB',
                    schema: 'PUBLIC',
                    hasChildren: true,
                    children: [
                      { id: nanoid(), name: 'order_id', kind: 'column', dataType: 'NUMBER', nullable: false },
                      { id: nanoid(), name: 'customer_name', kind: 'column', dataType: 'VARCHAR', nullable: true },
                    ]
                  }
                ]
              },
              {
                id: nanoid(),
                name: 'Functions',
                kind: 'group',
                hasChildren: true,
                children: [
                  {
                    id: nanoid(),
                    name: 'GET_TOTAL_REVENUE',
                    kind: 'function',
                    database: 'SNOWBOY_DB',
                    schema: 'PUBLIC',
                    hasChildren: false
                  }
                ]
              }
            ]
          },
          {
            id: nanoid(),
            name: 'INFORMATION_SCHEMA',
            kind: 'schema',
            database: 'SNOWBOY_DB',
            schema: 'INFORMATION_SCHEMA',
            hasChildren: true,
            children: [
              {
                id: nanoid(),
                name: 'Tables',
                kind: 'group',
                hasChildren: true,
                children: [
                  {
                    id: nanoid(),
                    name: 'TABLES',
                    kind: 'table',
                    database: 'SNOWBOY_DB',
                    schema: 'INFORMATION_SCHEMA',
                    hasChildren: false
                  },
                  {
                    id: nanoid(),
                    name: 'COLUMNS',
                    kind: 'table',
                    database: 'SNOWBOY_DB',
                    schema: 'INFORMATION_SCHEMA',
                    hasChildren: false
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: nanoid(),
        name: 'ANALYTICS_DB',
        kind: 'database',
        database: 'ANALYTICS_DB',
        hasChildren: true,
        children: [
          {
            id: nanoid(),
            name: 'MART',
            kind: 'schema',
            database: 'ANALYTICS_DB',
            schema: 'MART',
            hasChildren: true,
            children: [
              {
                id: nanoid(),
                name: 'Tables',
                kind: 'group',
                hasChildren: true,
                children: [
                  {
                    id: nanoid(),
                    name: 'DAILY_METRICS',
                    kind: 'table',
                    database: 'ANALYTICS_DB',
                    schema: 'MART',
                    hasChildren: false
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
];
