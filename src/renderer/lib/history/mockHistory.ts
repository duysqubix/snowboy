import type { HistoryEntry } from '../../../main/types';

const SQL_BANK = [
  'SELECT * FROM raw_events LIMIT 100;',
  'SELECT user_id, COUNT(*) as event_count FROM raw_events GROUP BY 1 ORDER BY 2 DESC;',
  'INSERT INTO processed_events SELECT * FROM raw_events WHERE event_date = CURRENT_DATE();',
  'SELECT * FROM users QUALIFY ROW_NUMBER() OVER (PARTITION BY email ORDER BY created_at DESC) = 1;',
  'SELECT u.name, e.event_type FROM users u JOIN raw_events e ON u.id = e.user_id LIMIT 50;',
  'CREATE OR REPLACE TABLE temp_summary AS SELECT date_trunc(\'day\', event_time) as dt, count(*) as cnt FROM events GROUP BY 1;',
  'DROP TABLE IF EXISTS old_backup_table;',
  'SHOW TABLES IN SCHEMA public;',
  'DESCRIBE TABLE users;',
  'SELECT current_role(), current_warehouse(), current_database(), current_schema();',
  'SELECT * FROM sales WHERE amount > 1000 AND region = \'NA\';',
  'UPDATE users SET status = \'active\' WHERE last_login > dateadd(day, -30, current_date());',
  'DELETE FROM sessions WHERE expires_at < current_timestamp();',
  'SELECT date_trunc(\'month\', created_at) as month, sum(revenue) as total_revenue FROM orders GROUP BY 1 ORDER BY 1;',
  'WITH active_users AS (SELECT id FROM users WHERE status = \'active\') SELECT count(*) FROM active_users;',
  'SELECT * FROM products WHERE category IN (\'Electronics\', \'Books\') ORDER BY price DESC LIMIT 10;',
  'GRANT SELECT ON ALL TABLES IN SCHEMA public TO ROLE analyst_ro;',
  'REVOKE ALL PRIVILEGES ON DATABASE dev FROM ROLE etl_user;',
  'ALTER WAREHOUSE compute_wh SET WAREHOUSE_SIZE = \'LARGE\';',
  'SELECT query_id, query_text, execution_time FROM table(information_schema.query_history()) ORDER BY start_time DESC LIMIT 10;',
  'SELECT * FROM customer_data PIVOT(SUM(amount) FOR category IN (\'A\', \'B\', \'C\')) AS p;',
  'SELECT * FROM employee_hierarchy START WITH manager_id IS NULL CONNECT BY PRIOR id = manager_id;',
  'MERGE INTO target_table t USING source_table s ON t.id = s.id WHEN MATCHED THEN UPDATE SET t.val = s.val WHEN NOT MATCHED THEN INSERT (id, val) VALUES (s.id, s.val);',
  'SELECT parse_json(raw_data):user.name::string as user_name FROM json_table;',
  'SELECT * FROM table(flatten(input => parse_json(\'[1, 2, 3]\')));',
  'COPY INTO my_table FROM @my_stage/data.csv.gz FILE_FORMAT = (TYPE = CSV);',
  'PUT file:///tmp/data.csv @my_stage AUTO_COMPRESS=TRUE;',
  'GET @my_stage/data.csv.gz file:///tmp/;',
  'LIST @my_stage;',
  'REMOVE @my_stage/data.csv.gz;'
];

const ROLES = ['SYSADMIN', 'ANALYST_RO', 'ETL_USER', 'ACCOUNTADMIN', 'PUBLIC'];
const WAREHOUSES = ['COMPUTE_WH', 'ANALYTICS_WH', 'ETL_WH', 'REPORTING_WH', 'LOAD_WH'];
const DATABASES = ['PROD_DB', 'DEV_DB', 'ANALYTICS_DB', 'RAW_DB'];
const SCHEMAS = ['PUBLIC', 'STAGING', 'MART', 'REPORTS'];

const ERROR_MESSAGES = [
  'SQL compilation error: Object does not exist or operation cannot be performed.',
  'SQL execution error: Division by zero.',
  'SQL compilation error: syntax error line 1 at position 15 unexpected \'FROM\'.',
  'Warehouse COMPUTE_WH is suspended.',
  'Numeric value \'abc\' is not recognized.',
  'Timestamp \'2023-13-01\' is not recognized.',
  'SQL compilation error: invalid identifier \'USER_ID\'.',
  'Query timeout after 300 seconds.',
  'Insufficient privileges to operate on table \'USERS\'.'
];

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomItem<T>(arr: T[]): T {
  return arr[randomInt(0, arr.length - 1)] as T;
}

export function generateMockHistory(count: number = 1000): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  const now = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  for (let i = 0; i < count; i++) {
    const rand = Math.random();
    let status: 'success' | 'error' | 'cancelled';
    if (rand < 0.85) status = 'success';
    else if (rand < 0.95) status = 'error';
    else status = 'cancelled';

    const startedAt = now - randomInt(0, thirtyDaysMs);
    const durationMs = randomInt(10, 15000);
    const endedAt = startedAt + durationMs;

    const entry: HistoryEntry = {
      id: `hist_${i}_${Date.now()}`,
      profileId: `prof_${randomInt(1, 5)}`,
      role: randomItem(ROLES),
      warehouse: randomItem(WAREHOUSES),
      databaseName: randomItem(DATABASES),
      schemaName: randomItem(SCHEMAS),
      sql: randomItem(SQL_BANK),
      startedAt,
      endedAt,
      status,
      queryId: `01a${randomInt(1000, 9999)}-0000-0000-0000-000000000000`
    };

    if (status === 'success') {
      entry.rowCount = randomInt(0, 50000);
      entry.bytesScanned = randomInt(1024, 1024 * 1024 * 100);
    } else if (status === 'error') {
      entry.errorMessage = randomItem(ERROR_MESSAGES);
    }

    entries.push(entry);
  }

  // Sort by startedAt descending (newest first)
  return entries.sort((a, b) => b.startedAt - a.startedAt);
}
