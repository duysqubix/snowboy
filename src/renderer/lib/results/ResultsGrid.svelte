<script lang="ts">
  import { LoaderCircle, Download } from 'lucide-svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { classifyType, formatCell, type SnowflakeColumnKind } from './columnTypes';
  import { exportCsv } from './exportCsv';
  import CellDetailPanel from './CellDetailPanel.svelte';

  type Column = {
    name: string;
    dataType?: string;
    width?: number;
  };
  type Row = Record<string, unknown>;

  let {
    columns = [],
    rows = [],
    loading = false,
    error = undefined
  }: {
    columns: Column[];
    rows: Row[];
    loading?: boolean;
    error?: string;
  } = $props();

  // eslint-disable-next-line svelte/no-unnecessary-state-wrap
  let selectedRowIndices = $state<SvelteSet<number>>(new SvelteSet());
  let lastSelectedRowIndex = $state<number | null>(null);

  let detailPanelOpen = $state(false);
  let detailColumnName = $state('');
  let detailValue = $state<unknown>(null);

  type ResolvedColumn = {
    name: string;
    dataType?: string;
    width: number;
    kind: SnowflakeColumnKind;
    isNumeric: boolean;
  };

  let resolved = $derived<ResolvedColumn[]>(
    columns.map((c) => {
      const kind = classifyType(c.dataType);
      return {
        name: c.name,
        dataType: c.dataType,
        width: c.width ?? 160,
        kind,
        isNumeric: kind === 'number'
      };
    })
  );

  function handleRowClick(e: MouseEvent, index: number) {
    if (e.shiftKey && lastSelectedRowIndex !== null) {
      const start = Math.min(lastSelectedRowIndex, index);
      const end = Math.max(lastSelectedRowIndex, index);
      const next = new SvelteSet<number>(selectedRowIndices);
      for (let i = start; i <= end; i++) next.add(i);
      selectedRowIndices = next;
    } else if (e.metaKey || e.ctrlKey) {
      const next = new SvelteSet<number>(selectedRowIndices);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      selectedRowIndices = next;
    } else {
      selectedRowIndices = new SvelteSet<number>([index]);
    }
    lastSelectedRowIndex = index;
  }

  function handleCellClick(
    e: MouseEvent,
    colName: string,
    value: unknown,
    isExpandable: boolean
  ) {
    if (isExpandable) {
      e.stopPropagation();
      detailColumnName = colName;
      detailValue = value;
      detailPanelOpen = true;
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
      if (selectedRowIndices.size === 0) return;
      e.preventDefault();
      const sortedIndices = Array.from(selectedRowIndices).sort((a, b) => a - b);
      const tsv = sortedIndices
        .map((idx) => {
          const row = rows[idx];
          if (!row) return '';
          return columns
            .map((c) => {
              const val = row[c.name];
              if (val === null || val === undefined) return '';
              const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
              return str.replace(/\t/g, ' ').replace(/\n/g, ' ');
            })
            .join('\t');
        })
        .join('\n');
      void navigator.clipboard.writeText(tsv);
    }
  }

  function handleExportCsv() {
    const csv = exportCsv(columns, rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'results.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

<div class="relative flex flex-col w-full h-full bg-background overflow-hidden border border-border rounded-md">
  <div class="flex items-center justify-between p-2 border-b border-border bg-muted/50">
    <div class="text-sm text-muted-foreground">
      {#if rows.length > 0}
        {rows.length} row{rows.length === 1 ? '' : 's'}
      {/if}
    </div>
    <button
      class="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
      onclick={handleExportCsv}
      disabled={rows.length === 0 || loading}
    >
      <Download class="w-4 h-4" />
      Download CSV
    </button>
  </div>

  <div class="relative flex-1 overflow-hidden">
    {#if error}
      <div class="absolute inset-0 flex items-center justify-center p-4 z-10 bg-background/80 backdrop-blur-sm">
        <div class="p-4 border border-destructive text-destructive rounded-md max-w-md text-center bg-destructive/10">
          <p class="font-semibold mb-1">Error</p>
          <p class="text-sm">{error}</p>
        </div>
      </div>
    {/if}

    {#if loading}
      <div class="absolute inset-0 flex items-center justify-center z-10 bg-background/50 backdrop-blur-sm">
        <LoaderCircle class="w-8 h-8 animate-spin text-primary" />
      </div>
    {/if}

    {#if !loading && !error && rows.length === 0 && columns.length === 0}
      <div class="absolute inset-0 flex items-center justify-center text-muted-foreground z-10">
        No rows
      </div>
    {/if}

    <div class="w-full h-full overflow-auto">
      <table class="w-full border-collapse table-fixed">
        <thead class="sticky top-0 z-20 bg-muted shadow-sm">
          <tr>
            {#each resolved as col (col.name)}
              <th
                class="p-2 border-b border-r border-border text-xs font-semibold text-muted-foreground select-none whitespace-nowrap overflow-hidden text-ellipsis"
                style="width: {col.width}px; text-align: {col.isNumeric ? 'right' : 'left'}"
              >
                {col.name}
              </th>
            {/each}
          </tr>
        </thead>

        <tbody>
          {#each rows as row, rowIndex (rowIndex)}
            {@const isSelected = selectedRowIndices.has(rowIndex)}
            <tr
              class="border-b border-border hover:bg-muted/50 cursor-pointer transition-colors {isSelected ? 'bg-accent hover:bg-accent/80' : ''}"
              onclick={(e) => handleRowClick(e, rowIndex)}
            >
              {#each resolved as col (col.name)}
                {@const val = row[col.name]}
                {@const cell = formatCell(val, col.kind)}
                {@const isNull = val === null || val === undefined}
                {@const isBoolean = col.kind === 'boolean'}
                <td
                  class="p-2 border-r border-border text-sm whitespace-nowrap overflow-hidden text-ellipsis"
                  style="width: {col.width}px; text-align: {col.isNumeric ? 'right' : 'left'}"
                  title={!cell.isExpandable ? cell.display : undefined}
                >
                  {#if cell.isExpandable}
                    <button
                      class="text-primary hover:underline text-left w-full truncate"
                      onclick={(e) => handleCellClick(e, col.name, val, true)}
                    >
                      {cell.display}
                    </button>
                  {:else}
                    <span class={isNull || isBoolean ? 'text-muted-foreground' : 'text-foreground'} class:italic={isNull}>
                      {cell.display}
                    </span>
                  {/if}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>

  {#if detailPanelOpen}
    <CellDetailPanel
      columnName={detailColumnName}
      value={detailValue}
      onClose={() => (detailPanelOpen = false)}
    />
  {/if}
</div>
