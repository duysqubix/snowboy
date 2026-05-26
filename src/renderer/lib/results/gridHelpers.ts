const DEFAULT_FONT_SIZE = 14;
const LINE_HEIGHT_MULTIPLIER = 1.4;

/**
 * Pixel row height for a virtualized result row.
 *
 * The 1.4 multiplier matches Tailwind's `leading-normal`. The ceiling
 * is required: TanStack Virtual jitters on sub-pixel `estimateSize`.
 * Non-finite or non-positive input falls back to the seed font size
 * so a corrupt `settings.fontSize` cannot collapse rows to 0px.
 */
export function getRowHeight(fontSize: number): number {
  if (!Number.isFinite(fontSize) || fontSize <= 0) {
    return Math.ceil(DEFAULT_FONT_SIZE * LINE_HEIGHT_MULTIPLIER);
  }
  return Math.ceil(fontSize * LINE_HEIGHT_MULTIPLIER);
}

export type MultilineCell = {
  isMultiline: boolean;
  firstLine: string;
  extraLines: number;
};

const SINGLE_LINE: MultilineCell = Object.freeze({
  isMultiline: false,
  firstLine: '',
  extraLines: 0
});

/**
 * Detect multi-line VARCHAR cells and project them onto a single-line
 * preview + extra-line count.
 *
 * Snowflake VARCHAR / STRING columns frequently carry embedded `\n`
 * (audit logs, multi-paragraph notes, stringified JSON pretty-printed
 * upstream). The result grid has exactly one line of vertical space
 * per row so we render the first line + a clickable badge that opens
 * the existing detail panel where the full text wraps.
 *
 * Behavior:
 *
 *   | Input             | isMultiline | firstLine | extraLines |
 *   |-------------------|-------------|-----------|------------|
 *   | not a string      | false       | ''        | 0          |
 *   | "abc"             | false       | 'abc'     | 0          |
 *   | "a\nb"            | true        | 'a'       | 1          |
 *   | "a\nb\nc"         | true        | 'a'       | 2          |
 *   | "a\n"             | true        | 'a'       | 1          |
 *   | "a\n\nb"          | true        | 'a'       | 2          |
 *   | "\nb"             | true        | ''        | 1          |
 *
 * Non-string values (numbers, dates, JSON variants) return the
 * `SINGLE_LINE` shape so callers can treat the result uniformly
 * without re-checking `typeof value`.
 */
export function parseMultilineCell(value: unknown): MultilineCell {
  if (typeof value !== 'string') return SINGLE_LINE;
  const firstNewline = value.indexOf('\n');
  if (firstNewline === -1) {
    return { isMultiline: false, firstLine: value, extraLines: 0 };
  }
  let extraLines = 0;
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) === 10) extraLines++;
  }
  return {
    isMultiline: true,
    firstLine: value.slice(0, firstNewline),
    extraLines
  };
}
