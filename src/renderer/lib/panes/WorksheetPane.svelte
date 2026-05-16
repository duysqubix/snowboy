<script lang="ts">
  import { getContext, onMount, untrack } from 'svelte';
  import { toast } from 'svelte-sonner';
  import { getOrCreatePaneState } from './paneStore.svelte';
  import { panes as panesSingleton, type PaneTreeStore } from '../stores/panes.svelte';
  import { sessions } from '../stores/sessions.svelte';
  import { queries } from '../stores/queries.svelte';
  import { snowboy } from '../ipc/client';
  import { cn } from '../utils';
  import * as Select from '../components/ui/select';
  import { Button } from '../components/ui/button';
  import SqlEditor from '../editor/SqlEditor.svelte';
  import ResultsGrid from '../results/ResultsGrid.svelte';

  let { paneId }: { paneId: string } = $props();

  const paneState = untrack(() => getOrCreatePaneState(paneId));

  const getPaneStore = getContext<(() => PaneTreeStore) | undefined>('panes-store');
  const panes = $derived(getPaneStore ? getPaneStore() : panesSingleton);

  let isActive = $derived(panes.activePaneId === paneId);

  let queryState = $derived(queries.get(paneState.currentQueryId));
  let isRunning = $derived(queryState !== null && queryState.status === 'running');
  let canCancel = $derived(paneState.currentQueryId !== null && isRunning);

  let resultColumns = $derived(
    queryState?.columns.map((c) => ({ name: c.name, dataType: c.dataType })) ?? []
  );
  let resultRows = $derived(queryState?.rows ?? []);
  let resultLoading = $derived(isRunning);
  let resultError = $derived(
    queryState?.status === 'error' || queryState?.status === 'cancelled'
      ? (queryState.error ?? undefined)
      : undefined
  );

  let editorTheme = $state<'light' | 'dark'>('dark');
  onMount(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      editorTheme = mq.matches ? 'dark' : 'light';
    }
  });

  function handlePaneClick(): void {
    panes.setActive(paneId);
  }

  async function handleRun(): Promise<void> {
    const sessionId = sessions.activeSessionId;
    if (sessionId === null) {
      toast.error('No active session — open a connection first.');
      return;
    }
    const sql = paneState.body.trim();
    if (sql.length === 0) {
      toast.error('Editor is empty.');
      return;
    }
    try {
      const queryId = await snowboy.query.run(sessionId, sql);
      paneState.currentQueryId = queryId;
      queries.register(queryId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Query failed: ${message}`);
    }
  }

  async function handleCancel(): Promise<void> {
    const qid = paneState.currentQueryId;
    if (qid === null) return;
    try {
      await snowboy.query.cancel(qid);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Cancel failed: ${message}`);
    }
  }

  function formatDuration(ms: number | null): string {
    if (ms === null) return '—';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }

  let statusRowCount = $derived(queryState?.rows.length ?? null);
  let statusDuration = $derived(formatDuration(queryState?.durationMs ?? null));
  let statusWarehouse = $derived(queryState?.warehouse ?? paneState.warehouse ?? null);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class={cn(
    'flex flex-col h-full w-full bg-background overflow-hidden',
    isActive ? 'ring-1 ring-primary/40' : 'border-r border-border last:border-r-0'
  )}
  onclick={handlePaneClick}
>
  <div class="flex items-center justify-between px-2 h-10 border-b border-border shrink-0">
    <div class="flex items-center gap-2">
      <Select.Root type="single" bind:value={paneState.role as string}>
        <Select.Trigger class="h-7 w-[120px] text-xs">
          {paneState.role || 'Role'}
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="ACCOUNTADMIN">ACCOUNTADMIN</Select.Item>
          <Select.Item value="SYSADMIN">SYSADMIN</Select.Item>
        </Select.Content>
      </Select.Root>

      <Select.Root type="single" bind:value={paneState.warehouse as string}>
        <Select.Trigger class="h-7 w-[120px] text-xs">
          {paneState.warehouse || 'Warehouse'}
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="COMPUTE_WH">COMPUTE_WH</Select.Item>
        </Select.Content>
      </Select.Root>

      <Select.Root type="single" bind:value={paneState.database as string}>
        <Select.Trigger class="h-7 w-[120px] text-xs">
          {paneState.database || 'Database'}
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="SNOWFLAKE">SNOWFLAKE</Select.Item>
        </Select.Content>
      </Select.Root>

      <Select.Root type="single" bind:value={paneState.schema as string}>
        <Select.Trigger class="h-7 w-[120px] text-xs">
          {paneState.schema || 'Schema'}
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="PUBLIC">PUBLIC</Select.Item>
        </Select.Content>
      </Select.Root>
    </div>

    <div class="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        class="h-7 text-xs"
        disabled={!canCancel}
        onclick={handleCancel}
      >
        Cancel
      </Button>
      <Button
        variant="default"
        size="sm"
        class="h-7 text-xs"
        disabled={isRunning}
        onclick={handleRun}
      >
        Run
      </Button>
    </div>
  </div>

  <div class="flex-1 border-b border-border min-h-0">
    <SqlEditor bind:value={paneState.body} theme={editorTheme} />
  </div>

  <div class="h-[35%] shrink-0 min-h-0">
    <ResultsGrid
      columns={resultColumns}
      rows={resultRows as Record<string, unknown>[]}
      loading={resultLoading}
      error={resultError}
    />
  </div>

  <div class="flex items-center gap-4 px-2 h-6 border-t border-border shrink-0 bg-muted/20">
    <span class="text-[10px] text-muted-foreground">
      {#if queryState === null}
        Idle
      {:else if isRunning}
        Running… {statusRowCount ?? 0} rows
      {:else if queryState.status === 'success'}
        {statusRowCount ?? 0} rows · {statusDuration}
      {:else if queryState.status === 'cancelled'}
        Cancelled
      {:else}
        Error
      {/if}
    </span>
    <span class="text-[10px] text-muted-foreground">
      {statusWarehouse ?? '—'}
    </span>
    <span class="text-[10px] text-muted-foreground">
      Session: {sessions.activeSessionId ? sessions.activeSessionId.slice(0, 8) : '—'}
    </span>
  </div>
</div>
