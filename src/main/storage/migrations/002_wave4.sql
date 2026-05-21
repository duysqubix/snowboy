-- Wave 4 schema additions.
--
-- Adds `scroll_top` to worksheets so T4.2 can persist editor scroll offset
-- alongside the cursor row/column that already have dedicated columns. The
-- LayoutTree `version` envelope is handled in code (workspace.ts wraps
-- payloads in { version: 2, tree: ... } before round-trip), not as a column
-- on `pane_layout` -- the table stores opaque JSON.

ALTER TABLE worksheets ADD COLUMN scroll_top INTEGER;
