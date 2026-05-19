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
  import { splitSql } from '../editor/splitSql';
  import ResultsTabs from '../results/ResultsTabs.svelte';

  let { paneId }: { paneId: string } = $props();

  const paneState = untrack(() => getOrCreatePaneState(paneId));

  const getPaneStore = getContext<(() => PaneTreeStore) | undefined>('panes-store');
  const panes = $derived(getPaneStore ? getPaneStore() : panesSingleton);

  let isActive = $derived(panes.activePaneId === paneId);

  let activeQueryState = $derived(queries.get(paneState.currentQueryId));
  let isRunning = $derived(
    paneState.currentQueryIds.some((id) => queries.get(id)?.status === 'running')
  );
  let canCancel = $derived(activeQueryState?.status === 'running');

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
    const fullSql = paneState.body.trim();
    if (fullSql.length === 0) {
      toast.error('Editor is empty.');
      return;
    }
    const statements = splitSql(fullSql);
    if (statements.length === 0) {
      toast.error('No statements to run.');
      return;
    }

    paneState.currentQueryIds = [];
    paneState.currentStatements = statements;
    paneState.activeResultIndex = 0;

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i]!;
      try {
        const queryId = await snowboy.query.run(sessionId, stmt);
        queries.register(queryId);
        paneState.currentQueryIds = [...paneState.currentQueryIds, queryId];
        paneState.activeResultIndex = i;
        await queries.waitForCompletion(queryId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const label = statements.length > 1 ? `Statement ${i + 1} failed: ` : '';
        toast.error(`${label}${message}`);
        break;
      }
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

  let statusRowCount = $derived(activeQueryState?.rows.length ?? null);
  let statusDuration = $derived(formatDuration(activeQueryState?.durationMs ?? null));
  let statusWarehouse = $derived(activeQueryState?.warehouse ?? paneState.warehouse ?? null);
  let statusLabel = $derived(
    paneState.currentQueryIds.length > 1
      ? `Statement ${paneState.activeResultIndex + 1}/${paneState.currentQueryIds.length} · `
      : ''
  );
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
    <ResultsTabs
      queryIds={paneState.currentQueryIds}
      statements={paneState.currentStatements}
      activeIndex={paneState.activeResultIndex}
      onActiveChange={(i) => (paneState.activeResultIndex = i)}
    />
  </div>

  <div class="flex items-center gap-4 px-2 h-6 border-t border-border shrink-0 bg-muted/20">
    <span class="text-[10px] text-muted-foreground">
      {#if activeQueryState === null}
        Idle
      {:else if activeQueryState.status === 'running'}
        {statusLabel}Running… {statusRowCount ?? 0} rows
      {:else if activeQueryState.status === 'success'}
        {statusLabel}{statusRowCount ?? 0} rows · {statusDuration}
      {:else if activeQueryState.status === 'cancelled'}
        {statusLabel}Cancelled
      {:else}
        {statusLabel}Error
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
