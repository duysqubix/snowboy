<script lang="ts">
  import { CheckCircle2, Loader2, XCircle, Ban } from 'lucide-svelte';
  import { previewStatement } from '$lib/editor/splitSql';
  import { queries, type QueryState } from '$lib/stores/queries.svelte';
  import { cn } from '$lib/utils';
  import type { QueryId } from '../../../main/types';
  import ResultsGrid from './ResultsGrid.svelte';

  let {
    queryIds,
    statements,
    activeIndex,
    onActiveChange
  }: {
    queryIds: QueryId[];
    statements: string[];
    activeIndex: number;
    onActiveChange: (index: number) => void;
  } = $props();

  let activeQueryId = $derived(queryIds[activeIndex] ?? null);
  let activeState = $derived<QueryState | null>(queries.get(activeQueryId));

  let activeColumns = $derived(
    activeState?.columns.map((c) => ({ name: c.name, dataType: c.dataType })) ?? []
  );
  let activeRows = $derived(activeState?.rows ?? []);
  let activeLoading = $derived(activeState?.status === 'running');
  let activeError = $derived(
    activeState?.status === 'error' || activeState?.status === 'cancelled'
      ? (activeState.error ?? undefined)
      : undefined
  );
</script>

{#if queryIds.length === 0}
  <ResultsGrid columns={[]} rows={[]} />
{:else}
  <div class="flex h-full w-full flex-col">
    {#if queryIds.length > 1}
      <div
        class="flex items-center gap-1 overflow-x-auto border-b border-border bg-muted/30 px-2 py-1"
      >
        {#each queryIds as qid, i (qid)}
          {@const state = queries.get(qid)}
          {@const status = state?.status ?? 'running'}
          {@const isActive = i === activeIndex}
          <button
            type="button"
            class={cn(
              'group flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors',
              isActive
                ? 'border border-border bg-background text-foreground'
                : 'border border-transparent text-muted-foreground hover:bg-muted'
            )}
            onclick={() => onActiveChange(i)}
            title={statements[i] ?? ''}
          >
            {#if status === 'running'}
              <Loader2 class="h-3 w-3 animate-spin text-primary" />
            {:else if status === 'success'}
              <CheckCircle2 class="h-3 w-3 text-green-500" />
            {:else if status === 'cancelled'}
              <Ban class="h-3 w-3 text-muted-foreground" />
            {:else}
              <XCircle class="h-3 w-3 text-destructive" />
            {/if}
            <span class="font-mono">{i + 1}</span>
            <span class="max-w-[180px] truncate">{previewStatement(statements[i] ?? '', 28)}</span>
          </button>
        {/each}
      </div>
    {/if}

    <div class="min-h-0 flex-1">
      <ResultsGrid
        columns={activeColumns}
        rows={activeRows}
        loading={activeLoading}
        error={activeError}
      />
    </div>
  </div>
{/if}
