<script lang="ts">
  import { LoaderCircle, Download } from 'lucide-svelte';
  import { untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { createVirtualizer } from '@tanstack/svelte-virtual';
  import { toast } from 'svelte-sonner';
  import { classifyType, formatCell, type SnowflakeColumnKind } from './columnTypes';
  import { exportCsv } from './exportCsv';
  import { getRowHeight, parseMultilineCell } from './gridHelpers';
  import { settings } from '$lib/stores/settings.svelte';
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

  let rowHeight = $derived(getRowHeight(settings.current.fontSize));

  let scrollEl: HTMLDivElement | undefined = $state();

  const virtualizerStore = createVirtualizer<HTMLDivElement, HTMLTableRowElement>({
    count: untrack(() => rows.length),
    getScrollElement: () => scrollEl ?? null,
    estimateSize: () => rowHeight,
    overscan: 8
  });

  $effect(() => {
    $virtualizerStore.setOptions({
      count: rows.length,
      getScrollElement: () => scrollEl ?? null,
      estimateSize: () => rowHeight,
      overscan: 8
    });
  });

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

  function openDetail(colName: string, value: unknown) {
    detailColumnName = colName;
    detailValue = value;
    detailPanelOpen = true;
  }

  function handleCellClick(
    e: MouseEvent,
    colName: string,
    value: unknown,
    isExpandable: boolean
  ) {
    if (isExpandable) {
      e.stopPropagation();
      openDetail(colName, value);
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
    if (loading) {
      toast.warning('Export available after query completes');
      return;
    }
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
    URL.revokeObjectURL(url);
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
      class="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      onclick={handleExportCsv}
      disabled={rows.length === 0 || loading}
      title={loading ? 'Export available after query completes' : 'Download all rows as CSV'}
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

    {#if loading && rows.length === 0}
      <div class="absolute inset-0 flex items-center justify-center z-10 bg-background/50 backdrop-blur-sm">
        <LoaderCircle class="w-8 h-8 animate-spin text-primary" />
      </div>
    {/if}

    {#if !loading && !error && rows.length === 0 && columns.length === 0}
      <div class="absolute inset-0 flex items-center justify-center text-muted-foreground z-10">
        No rows
      </div>
    {/if}

    <div bind:this={scrollEl} class="w-full h-full overflow-auto">
      <table class="border-collapse" style:display="grid">
        <thead class="sticky top-0 z-20 bg-muted shadow-sm" style:display="grid">
          <tr style:display="flex" style:width="100%">
            {#each resolved as col (col.name)}
              <th
                class="p-2 border-b border-r border-border text-xs font-semibold text-muted-foreground select-none whitespace-nowrap overflow-hidden text-ellipsis"
                style:display="flex"
                style:flex-shrink="0"
                style:width="{col.width}px"
                style:justify-content={col.isNumeric ? 'flex-end' : 'flex-start'}
              >
                {col.name}
              </th>
            {/each}
          </tr>
        </thead>

        <tbody
          style:display="grid"
          style:position="relative"
          style:height="{$virtualizerStore.getTotalSize()}px"
        >
          {#each $virtualizerStore.getVirtualItems() as v (v.key)}
            {@const rowIndex = v.index}
            {@const row = rows[rowIndex]}
            {#if row !== undefined}
              {@const isSelected = selectedRowIndices.has(rowIndex)}
              <tr
                data-index={rowIndex}
                class="border-b border-border hover:bg-muted/50 cursor-pointer transition-colors {isSelected ? 'bg-accent hover:bg-accent/80' : ''}"
                style:display="flex"
                style:position="absolute"
                style:top="0"
                style:left="0"
                style:width="100%"
                style:transform="translateY({v.start}px)"
                style:height="{rowHeight}px"
                onclick={(e) => handleRowClick(e, rowIndex)}
              >
                {#each resolved as col (col.name)}
                  {@const val = row[col.name]}
                  {@const cell = formatCell(val, col.kind)}
                  {@const ml = parseMultilineCell(val)}
                  {@const isNull = val === null || val === undefined}
                  {@const isBoolean = col.kind === 'boolean'}
                  {@const isExpandable = cell.isExpandable || ml.isMultiline}
                  <td
                    class="px-2 border-r border-border text-sm whitespace-nowrap overflow-hidden text-ellipsis"
                    style:display="flex"
                    style:flex-shrink="0"
                    style:align-items="center"
                    style:width="{col.width}px"
                    style:height="{rowHeight}px"
                    style:justify-content={col.isNumeric ? 'flex-end' : 'flex-start'}
                    title={!isExpandable ? cell.display : undefined}
                  >
                    {#if ml.isMultiline}
                      <button
                        type="button"
                        class="text-left w-full truncate flex items-center gap-2"
                        onclick={(e) => handleCellClick(e, col.name, val, true)}
                      >
                        <span class="truncate text-foreground">{ml.firstLine}</span>
                        <span
                          class="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                        >
                          +{ml.extraLines} more {ml.extraLines === 1 ? 'line' : 'lines'}
                        </span>
                      </button>
                    {:else if cell.isExpandable}
                      <button
                        type="button"
                        class="text-primary hover:underline text-left w-full truncate"
                        onclick={(e) => handleCellClick(e, col.name, val, true)}
                      >
                        {cell.display}
                      </button>
                    {:else}
                      <span
                        class="truncate {isNull || isBoolean ? 'text-muted-foreground' : 'text-foreground'}"
                        class:italic={isNull}
                      >
                        {cell.display}
                      </span>
                    {/if}
                  </td>
                {/each}
              </tr>
            {/if}
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
