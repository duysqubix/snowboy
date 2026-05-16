import { SQLDialect, PostgreSQL } from '@codemirror/lang-sql';
import { snowflakeKeywords, snowflakeBuiltins, snowflakeTypes } from './snowflakeKeywords';

const baseKeywords = PostgreSQL.spec.keywords || '';
const baseBuiltins = '';
const baseTypes = '';

export const snowflakeDialect = SQLDialect.define({
  keywords: baseKeywords + ' ' + snowflakeKeywords.join(' ').toLowerCase(),
  builtin: baseBuiltins + ' ' + snowflakeBuiltins.join(' ').toLowerCase(),
  types: baseTypes + ' ' + snowflakeTypes.join(' ').toLowerCase(),
  slashComments: true,
  doubleDollarQuotedStrings: true,
  caseInsensitiveIdentifiers: false,
});
