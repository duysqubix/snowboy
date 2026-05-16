# Snowflake Wave 3 Desktop IDE — Authoritative Reference

**Last Updated**: May 15, 2026  
**Source**: Official Snowflake Documentation (https://docs.snowflake.com)

---

## 1. GET_DDL Function

**Purpose**: Fetch DDL statements to recreate database objects.

### Syntax
```sql
GET_DDL( '<object_type>' , '[<namespace>.]<object_name>' [ , <use_fully_qualified_names_for_recreated_objects> ] )
```

### Supported Object Types
- `TABLE` (includes external tables, hybrid tables, Iceberg tables)
- `VIEW` (includes materialized views)
- `FUNCTION` (UDFs, external functions, data metric functions)
- `PROCEDURE` (stored procedures)
- `SCHEMA`
- `DATABASE`
- `STREAM`
- `SEQUENCE`
- `FILE_FORMAT`
- `PIPE`
- `POLICY` (masking, row access, aggregation, authentication, join, password, projection, session, storage lifecycle)
- `TAG`
- `TASK`
- `TYPE` (user-defined types)
- `DYNAMIC_TABLE`
- `EVENT_TABLE`
- `ICEBERG_TABLE`
- `SEMANTIC_VIEW`
- `WAREHOUSE`
- `INTEGRATION` (storage)
- `FAILOVER_GROUP`
- `REPLICATION_GROUP`
- `CORTEX_AGENT`
- `CONTACT`
- `ALERT`
- `DBT_PROJECT`
- `NOTEBOOK`
- `ONLINE_FEATURE_TABLE`

### Examples

**Table DDL**:
```sql
SELECT GET_DDL('TABLE', 'mydb.public.mytable');
```

**View DDL**:
```sql
SELECT GET_DDL('VIEW', 'mydb.public.myview');
```

**Function DDL** (with argument types):
```sql
SELECT GET_DDL('FUNCTION', 'mydb.public.myfunc(VARCHAR, NUMBER)');
```

**Schema DDL** (recursive — includes all objects):
```sql
SELECT GET_DDL('SCHEMA', 'mydb.myschema');
```

**Database DDL** (recursive — includes all schemas and objects):
```sql
SELECT GET_DDL('DATABASE', 'mydb');
```

**With fully-qualified names**:
```sql
SELECT GET_DDL('TABLE', 'mydb.public.mytable', TRUE);
```

### Edge Cases & Gotchas

| Issue | Behavior |
|-------|----------|
| **Masking Policies** | GET_DDL output includes masking policy definitions if applied to table/view columns. Role executing query must have `APPLY MASKING POLICY` privilege. |
| **Materialized Views** | Treated as `VIEW` type; returns full CREATE MATERIALIZED VIEW statement. |
| **Policies on Objects** | If row access, aggregation, or join policies are applied, GET_DDL includes them. Role must have corresponding `APPLY *_POLICY` privilege. |
| **Tags on Objects** | If tags are set on table/view/column, GET_DDL includes `ALTER TABLE ... SET TAG` statements. Tags are sorted alphabetically. |
| **Data Type Aliases** | By default, aliases (e.g., `INT` → `INTEGER`) are replaced with standard names. Set `ENABLE_GET_DDL_USE_DATA_TYPE_ALIAS = TRUE` to preserve aliases. |
| **UDF/Procedure Output** | May differ slightly from original DDL (e.g., default `EXECUTE AS OWNER` is always included even if not in original). |
| **APPLICATION PACKAGE** | GET_DDL is not supported; returns error: "This operation is not supported on APPLICATION PACKAGE". |

**Reference**: https://docs.snowflake.com/en/sql-reference/functions/get_ddl

---

## 2. INFORMATION_SCHEMA Browsing

### List Databases (Account-level)

**Option A: SHOW command** (faster, no warehouse needed)
```sql
SHOW DATABASES;
```
**Pros**: Fast, no warehouse required, includes dropped databases with `HISTORY` flag.  
**Cons**: Limited columns (name, owner, created_on, kind, etc.).

**Option B: INFORMATION_SCHEMA view** (slower, requires warehouse)
```sql
SELECT * FROM SNOWFLAKE.INFORMATION_SCHEMA.DATABASES;
```
**Pros**: More columns (DATABASE_NAME, DATABASE_OWNER, IS_TRANSIENT, TYPE, RETENTION_TIME, etc.).  
**Cons**: Requires active warehouse, slower for large accounts.

**Recommendation**: Use `SHOW DATABASES` for UI enumeration; use `INFORMATION_SCHEMA.DATABASES` for detailed metadata.

---

### List Schemas in a Database

**Option A: SHOW command** (faster)
```sql
USE DATABASE mydb;
SHOW SCHEMAS;
```

**Option B: INFORMATION_SCHEMA view**
```sql
SELECT SCHEMA_NAME, SCHEMA_OWNER, CREATED, COMMENT
FROM mydb.INFORMATION_SCHEMA.SCHEMATA
WHERE SCHEMA_NAME != 'INFORMATION_SCHEMA'
ORDER BY SCHEMA_NAME;
```

---

### List Tables & Views in a Schema

**Option A: SHOW command** (faster)
```sql
SHOW TABLES IN SCHEMA mydb.myschema;
SHOW VIEWS IN SCHEMA mydb.myschema;
```

**Option B: INFORMATION_SCHEMA view**
```sql
SELECT TABLE_NAME, TABLE_TYPE, TABLE_OWNER, CREATED, BYTES, ROW_COUNT
FROM mydb.INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = 'MYSCHEMA'
  AND TABLE_TYPE IN ('BASE TABLE', 'VIEW', 'MATERIALIZED VIEW', 'EXTERNAL TABLE', 'DYNAMIC TABLE')
ORDER BY TABLE_NAME;
```

**Note**: `TABLE_TYPE` values:
- `BASE TABLE` — regular table
- `TEMPORARY TABLE` — temporary table
- `EXTERNAL TABLE` — external table
- `EVENT TABLE` — event table
- `VIEW` — view
- `MATERIALIZED VIEW` — materialized view
- `ICEBERG TABLE` — Iceberg table
- `DYNAMIC TABLE` — dynamic table
- `HYBRID TABLE` — hybrid table

---

### List Functions in a Schema

```sql
SELECT FUNCTION_NAME, FUNCTION_TYPE, ARGUMENT_SIGNATURE, CREATED
FROM mydb.INFORMATION_SCHEMA.FUNCTIONS
WHERE FUNCTION_SCHEMA = 'MYSCHEMA'
ORDER BY FUNCTION_NAME;
```

---

### List Columns of a Table

```sql
SELECT COLUMN_NAME, ORDINAL_POSITION, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COMMENT
FROM mydb.INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'MYSCHEMA'
  AND TABLE_NAME = 'MYTABLE'
ORDER BY ORDINAL_POSITION;
```

**Reference**: https://docs.snowflake.com/en/sql-reference/info-schema

---

## 3. SHOW WAREHOUSES / SHOW ROLES

### Enumerate Warehouses

```sql
SHOW WAREHOUSES;
```

**Output columns**:
- `name` — warehouse name
- `state` — `STARTED`, `SUSPENDED`, or `RESIZING`
- `type` — `STANDARD` or `SNOWPARK-OPTIMIZED`
- `size` — X-Small, Small, Medium, Large, X-Large, etc.
- `is_default` — whether default for current user
- `is_current` — whether active in current session
- `running` — number of queries currently executing
- `queued` — number of queries waiting

**Filter by privilege**:
```sql
SHOW WAREHOUSES WITH PRIVILEGES USAGE, OPERATE;
```

**Reference**: https://docs.snowflake.com/en/sql-reference/sql/show-warehouses

---

### Enumerate Roles

```sql
SHOW ROLES;
```

**Output columns**:
- `name` — role name
- `is_default` — whether default for current user
- `is_current` — whether active in current session
- `is_inherited` — whether inherited from parent role
- `assigned_to_users` — count of users with this role
- `granted_to_roles` — count of roles granted this role
- `granted_roles` — count of roles this role grants

**Filter by pattern**:
```sql
SHOW ROLES LIKE 'ANALYST%';
```

**Reference**: https://docs.snowflake.com/en/sql-reference/sql/show-roles

---

## 4. USE WAREHOUSE / USE ROLE / USE DATABASE / USE SCHEMA

### Order of Operations

**Execution order** (independent; no cascading resets):
```sql
USE ROLE myrole;           -- Sets primary role
USE WAREHOUSE mywarehouse; -- Sets warehouse (independent of role)
USE DATABASE mydb;         -- Sets database (auto-sets schema to PUBLIC)
USE SCHEMA myschema;       -- Sets schema within current database
```

### Key Behaviors

| Command | Effect | Notes |
|---------|--------|-------|
| `USE ROLE <name>` | Sets primary role for session | Only one primary role active at a time. Secondary roles can be set with `USE SECONDARY ROLES`. |
| `USE WAREHOUSE <name>` | Sets active warehouse | **Does NOT reset when role changes.** Warehouse persists across role switches. |
| `USE DATABASE <name>` | Sets active database | Automatically sets schema to `PUBLIC` (unless PUBLIC doesn't exist). |
| `USE SCHEMA <name>` | Sets active schema | Can be fully qualified: `USE SCHEMA mydb.myschema` or `USE mydb.myschema`. |

### Gotchas

⚠️ **Warehouse does NOT reset on role change**: If you switch roles mid-session, the warehouse remains active. This can cause permission errors if the new role lacks `USAGE` on the current warehouse.

**Workaround**: Explicitly set warehouse after role change:
```sql
USE ROLE new_role;
USE WAREHOUSE appropriate_warehouse;
```

### Context Functions

Check current context:
```sql
SELECT CURRENT_ROLE(),
       CURRENT_WAREHOUSE(),
       CURRENT_DATABASE(),
       CURRENT_SCHEMA();
```

**Reference**: 
- https://docs.snowflake.com/en/sql-reference/sql/use-role
- https://docs.snowflake.com/en/sql-reference/sql/use-warehouse
- https://docs.snowflake.com/en/sql-reference/sql/use-database
- https://docs.snowflake.com/en/sql-reference/sql/use-schema

---

## 5. Query Cancellation

### SYSTEM$CANCEL_QUERY Function

```sql
SELECT SYSTEM$CANCEL_QUERY('<query_id>');
```

**Arguments**:
- `query_id` — UUID string (e.g., `'d5493e36-5e38-48c9-a47c-c476f2111ce5'`)

**Return value**:
- `1` (success) or `0` (failure)
- Message: `"query [<id>] terminated."` or error

### Query ID Source

**From snowflake-sdk**:
```javascript
const statement = connection.execute({
  sqlText: 'SELECT * FROM huge_table',
  complete: (err, stmt, rows) => {
    if (err) console.error(err);
    else console.log(stmt.getStatementId()); // Returns query ID
  }
});
```

**From Snowflake Web UI**:
- Account → History → click query → copy ID from URL or details panel

**From QUERY_HISTORY view**:
```sql
SELECT QUERY_ID, QUERY_TEXT, STATUS
FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY
WHERE USER_NAME = 'myuser'
ORDER BY START_TIME DESC
LIMIT 10;
```

### Cancellation Timing

⚠️ **Can cancel while queueing**: Yes, `SYSTEM$CANCEL_QUERY` works on queries in `QUEUED` state (waiting for warehouse resources) as well as `RUNNING` state.

**Status progression**: `QUEUED` → `RUNNING` → `COMPLETED` / `CANCELLED`

### Permission Requirements

- **Own queries**: No special privilege needed
- **Other users' queries**: Requires one of:
  - `OWNERSHIP` on the user
  - `OPERATE` or `OWNERSHIP` on the warehouse
  - `ACCOUNTADMIN` role
- **Task queries**: Requires `OPERATE` or `OWNERSHIP` on the task, or `ACCOUNTADMIN`

### Gotchas

⚠️ **UUID format**: Query IDs are UUID strings with hyphens (special characters). Must be enclosed in **single quotes**:
```sql
-- CORRECT
SELECT SYSTEM$CANCEL_QUERY('d5493e36-5e38-48c9-a47c-c476f2111ce5');

-- WRONG (will fail)
SELECT SYSTEM$CANCEL_QUERY(d5493e36-5e38-48c9-a47c-c476f2111ce5);
```

**Reference**: https://docs.snowflake.com/en/sql-reference/functions/system_cancel_query

---

## 6. SELECT TOP n vs LIMIT

### Syntax Comparison

**TOP n** (Snowflake-specific):
```sql
SELECT TOP 100 * FROM mytable ORDER BY created_at DESC;
```

**LIMIT** (ANSI SQL, portable):
```sql
SELECT * FROM mytable ORDER BY created_at DESC LIMIT 100;
```

**FETCH** (ANSI SQL, verbose):
```sql
SELECT * FROM mytable ORDER BY created_at DESC FETCH FIRST 100 ROWS ONLY;
```

### Equivalence

✅ **`TOP n` and `LIMIT n` are functionally equivalent** in Snowflake.

| Feature | TOP | LIMIT | FETCH |
|---------|-----|-------|-------|
| **Syntax** | `SELECT TOP n ...` | `... LIMIT n` | `... FETCH FIRST n ROWS ONLY` |
| **Portability** | Snowflake-specific | PostgreSQL, MySQL, SQLite | ANSI SQL standard |
| **OFFSET support** | No | Yes: `LIMIT n OFFSET m` | Yes: `OFFSET m ROWS FETCH NEXT n ROWS` |
| **Performance** | Identical | Identical | Identical |

### Recommendation for Wave 3

**Use `LIMIT`** for portability and consistency with standard SQL. If Snowflake-specific syntax is preferred, `TOP` is equally valid.

**With ORDER BY** (recommended):
```sql
SELECT * FROM mytable ORDER BY created_at DESC LIMIT 100;
```

**With OFFSET** (pagination):
```sql
SELECT * FROM mytable ORDER BY created_at DESC LIMIT 100 OFFSET 200;
```

### Top-K Pruning Optimization

Snowflake optimizes `LIMIT` + `ORDER BY` queries via **top-K pruning**: stops scanning when it determines remaining rows cannot be in top-K results.

**Conditions for top-K pruning**:
- Query contains both `ORDER BY` and `LIMIT`
- First `ORDER BY` column is integer, date, timestamp, or string type
- No complex expressions in `ORDER BY`

**Reference**: https://docs.snowflake.com/en/sql-reference/constructs/limit

---

## 7. Browser-Based SSO with snowflake-sdk (externalbrowser)

### User-Facing Flow

1. **Application initiates connection** with `authenticator: 'EXTERNALBROWSER'`
2. **SDK starts local HTTP listener** on random unused port (e.g., `localhost:12345`)
3. **Default browser opens** with Snowflake SSO login URL
4. **User authenticates** with IdP (e.g., Okta, Azure AD)
5. **IdP redirects** to `localhost:12345` with SAML token
6. **SDK captures token** from localhost callback
7. **Connection established** — browser closes (or user closes manually)
8. **Application resumes** with authenticated session

### Node.js Implementation

```javascript
const snowflake = require('snowflake-sdk');

const connection = snowflake.createConnection({
  account: 'xy12345.us-east-1',
  username: 'user@company.com',
  authenticator: 'EXTERNALBROWSER',
  clientStoreTemporaryCredential: true  // Optional: cache SSO token
});

connection.connect((err, conn) => {
  if (err) {
    console.error('Auth failed:', err.message);
  } else {
    console.log('Connected!');
    // Execute queries
  }
});
```

### Electron-Specific Gotchas

⚠️ **BrowserWindow Callback Issues**:
- **Problem**: Electron's `BrowserWindow` may not properly handle localhost redirects
- **Solution**: Use `externalBrowserCallback` (Node.js SDK v3.15.0+) to delegate browser opening to OS default browser:

```javascript
const { shell } = require('electron');

const connection = snowflake.createConnection({
  account: 'xy12345.us-east-1',
  username: 'user@company.com',
  authenticator: 'EXTERNALBROWSER',
  externalBrowserCallback: (url) => {
    shell.openExternal(url);  // Use Electron's shell API
  }
});
```

⚠️ **Port Collision on Windows**:
- **Problem**: Multiple Electron instances may compete for the same random port
- **Behavior**: SDK automatically retries with different port if collision detected
- **Mitigation**: Ensure only one auth flow per session; queue concurrent auth requests

⚠️ **Localhost Binding**:
- **Problem**: Some Windows firewall configs block `localhost:*` callbacks
- **Workaround**: Use `127.0.0.1` instead of `localhost` (SDK handles this automatically)

### Token Caching

**Enable on account** (admin only):
```sql
ALTER ACCOUNT SET ALLOW_ID_TOKEN = TRUE;
```

**Enable in SDK**:
```javascript
const connection = snowflake.createConnection({
  account: 'xy12345.us-east-1',
  username: 'user@company.com',
  authenticator: 'EXTERNALBROWSER',
  clientStoreTemporaryCredential: true
});
```

**Token storage**: `~/.cache/snowflake/credential_cache_v1.json` (Linux/macOS) or Windows credential manager

**Benefit**: Subsequent connections within token lifetime (typically 1 hour) skip browser flow.

### Known Issues (as of May 2026)

| Issue | Status | Workaround |
|-------|--------|-----------|
| **Embedded browser in DBeaver** | Fixed (v24.1+) | Disable "open auth in embedded browser" setting |
| **Remote SSH sessions** | Supported (v3.15.0+) | SDK prints URL; user copies to local browser, pastes redirect URL back |
| **Server-side SSO errors** | Fixed (v2.3.5+) | SDK now surfaces Snowflake error messages instead of crashing |

**Reference**: 
- https://docs.snowflake.com/en/developer-guide/node-js/nodejs-driver-authenticate
- https://docs.snowflake.com/en/user-guide/admin-security-fed-auth-use

---

## 8. Statement Tagging (QUERY_TAG)

### Purpose

Attach metadata labels to queries for:
- **Monitoring**: Track queries by application, user, pipeline, team
- **Cost allocation**: Attribute warehouse credits to business units
- **Auditing**: Identify queries for compliance/security review
- **Performance analysis**: Correlate slow queries with workload type

### Syntax

```sql
ALTER SESSION SET QUERY_TAG = 'my_tag_value';
```

### Setting Query Tags

**Simple string tag**:
```sql
ALTER SESSION SET QUERY_TAG = 'ETL_LOADS';
```

**JSON tag** (for structured metadata):
```sql
ALTER SESSION SET QUERY_TAG = '{"app": "Wave3", "user": "analyst1", "pipeline": "daily_refresh"}';
```

**Append to existing tag** (Snowpark Python):
```python
session.query_tag = "tag1"
session.append_query_tag("tag2", separator=",")
# Result: "tag1,tag2"
```

**Update JSON tag** (Snowpark Python):
```python
session.query_tag = '{"key1": "value1"}'
session.update_query_tag({"key2": "value2"})
# Result: '{"key1": "value1", "key2": "value2"}'
```

### Attaching Tag Before Query Execution

**Pattern for Wave 3 sub-agents**:

```javascript
// Before executing query
connection.execute({
  sqlText: "ALTER SESSION SET QUERY_TAG = 'Wave3_DDL_Fetch'",
  complete: (err, stmt) => {
    if (err) throw err;
    
    // Now execute actual query with tag active
    connection.execute({
      sqlText: "SELECT GET_DDL('TABLE', 'mydb.public.mytable')",
      complete: (err, stmt, rows) => {
        // Query is tagged
      }
    });
  }
});
```

**Or in single batch**:
```sql
ALTER SESSION SET QUERY_TAG = 'Wave3_DDL_Fetch';
SELECT GET_DDL('TABLE', 'mydb.public.mytable');
```

### Querying Tagged Queries

```sql
SELECT QUERY_ID, QUERY_TEXT, QUERY_TAG, EXECUTION_TIME, WAREHOUSE_NAME
FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY
WHERE QUERY_TAG LIKE '%Wave3%'
  AND START_TIME >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY START_TIME DESC;
```

### Gotchas

⚠️ **Tag persists for session**: Once set, `QUERY_TAG` applies to all subsequent queries until explicitly changed or unset:
```sql
ALTER SESSION UNSET QUERY_TAG;  -- Clear tag
```

⚠️ **Owner's rights procedures**: Setting `QUERY_TAG` may be restricted in owner's rights stored procedures. Check procedure privileges.

⚠️ **JSON parsing**: If using JSON tags, ensure valid JSON syntax. Invalid JSON will be stored as string literal.

⚠️ **Tag visibility**: Tags appear in `QUERY_HISTORY` and `QUERY_HISTORY_BY_*` views (Account Usage schema), not in real-time query monitoring.

### Recommended Tag Format for Wave 3

```json
{
  "app": "Snowboy_Wave3",
  "operation": "get_ddl|list_tables|list_schemas|browse_columns",
  "object_type": "TABLE|VIEW|FUNCTION|SCHEMA|DATABASE",
  "user_action": "schema_browser|ddl_export|metadata_fetch",
  "timestamp": "2026-05-15T14:30:00Z"
}
```

**Reference**: 
- https://docs.snowflake.com/en/sql-reference/sql/alter-session
- https://docs.snowflake.com/en/sql-reference/functions/query_history

---

## Summary Table: Quick Reference

| Feature | Command | Notes |
|---------|---------|-------|
| **Get DDL** | `SELECT GET_DDL('TABLE', 'db.schema.table')` | Supports 30+ object types; recursive for DB/schema |
| **List DBs** | `SHOW DATABASES` | Fast; no warehouse needed |
| **List Schemas** | `SHOW SCHEMAS IN DATABASE mydb` | Fast; no warehouse needed |
| **List Tables** | `SHOW TABLES IN SCHEMA mydb.myschema` | Fast; no warehouse needed |
| **List Columns** | `SELECT * FROM mydb.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'X'` | Requires warehouse |
| **List Warehouses** | `SHOW WAREHOUSES` | Shows state, size, running/queued queries |
| **List Roles** | `SHOW ROLES` | Shows role hierarchy and assignments |
| **Set Warehouse** | `USE WAREHOUSE mywarehouse` | Persists across role changes |
| **Set Role** | `USE ROLE myrole` | Does NOT reset warehouse |
| **Set Database** | `USE DATABASE mydb` | Auto-sets schema to PUBLIC |
| **Set Schema** | `USE SCHEMA myschema` | Can be fully qualified |
| **Cancel Query** | `SELECT SYSTEM$CANCEL_QUERY('uuid')` | Works on QUEUED and RUNNING states |
| **Limit Results** | `SELECT * FROM table LIMIT 100` | Equivalent to `TOP 100` |
| **SSO Auth** | `authenticator: 'EXTERNALBROWSER'` | Opens default browser; use `externalBrowserCallback` in Electron |
| **Set Query Tag** | `ALTER SESSION SET QUERY_TAG = 'tag'` | Persists for session; visible in QUERY_HISTORY |

---

## Electron-Specific Footguns

| Footgun | Impact | Mitigation |
|---------|--------|-----------|
| **BrowserWindow localhost redirect** | Auth flow hangs if embedded browser can't reach localhost callback | Use `externalBrowserCallback` + `shell.openExternal()` |
| **Port collision** | Multiple auth flows compete for same port | SDK auto-retries; queue auth requests |
| **Firewall blocking localhost** | Windows firewall may block `localhost:*` | SDK uses `127.0.0.1` fallback |
| **Warehouse reset on role change** | Switching roles doesn't reset warehouse; can cause permission errors | Explicitly `USE WAREHOUSE` after role change |
| **Query tag persistence** | Tag applies to all subsequent queries | Explicitly `UNSET QUERY_TAG` or set new value |
| **INFORMATION_SCHEMA requires warehouse** | Metadata queries fail if no warehouse active | Always `USE WAREHOUSE` before INFORMATION_SCHEMA queries |

---

## Document Metadata

- **Compiled**: May 15, 2026
- **Snowflake Version**: 2026.1+
- **SDK Versions Tested**: snowflake-sdk-nodejs v3.15.0+
- **Applicable to**: Wave 3 Snowboy Desktop IDE
- **Audience**: Sub-agent prompt engineers, Wave 3 implementation team

