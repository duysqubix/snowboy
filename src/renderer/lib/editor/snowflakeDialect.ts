import { SQLDialect, PostgreSQL } from '@codemirror/lang-sql';
import { snowflakeKeywords, snowflakeBuiltins, snowflakeTypes } from './snowflakeKeywords';

const baseKeywords = PostgreSQL.spec.keywords || '';
const baseBuiltins = '';
const baseTypes = '';

export const snowflakeDialect = SQLDialect.define({
  keywords: baseKeywords + ' ' + snowflakeKeywords.join(' ').toLowerCase(),
  builtin: baseBuiltins + ' ' + snowflakeBuiltins.join(' ').toLowerCase(),
  types: baseTypes + ' ' + snowflakeTypes.join(' ').toLowerCase(),
  // '...' strings honour backslash escapes, as in splitSql; quoted identifiers never do.
  // https://docs.snowflake.com/en/sql-reference/data-types-text#escape-sequences-in-single-quoted-string-constants
  backslashEscapes: true,
  slashComments: true,
  doubleDollarQuotedStrings: true,
  caseInsensitiveIdentifiers: false,
});
