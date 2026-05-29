<script lang="ts">
  import { getContext, onDestroy, onMount } from 'svelte';
  import { toast } from 'svelte-sonner';
  import { getOrCreatePaneState } from './paneStore.svelte';
  import { panes as panesSingleton, type PaneTreeStore } from '../stores/panes.svelte';
  import { profiles } from '../stores/profiles.svelte';
  import { sessions } from '../stores/sessions.svelte';
  import { queries } from '../stores/queries.svelte';
  import { snowboy } from '../ipc/client';
  import { cn } from '../utils';
  import * as Select from '../components/ui/select';
  import { Button } from '../components/ui/button';
  import SqlEditor, { type SqlEditorApi } from '../editor/SqlEditor.svelte';
  import type { RunAtCursorPayload } from '../editor/runCommands';
  import { splitSql } from '../editor/splitSql';
  import ResultsTabs from '../results/ResultsTabs.svelte';
  import type { Worksheet } from '../../../main/types';

  let { paneId, worksheetId }: { paneId: string; worksheetId: string } = $props();

  const paneState = $derived(getOrCreatePaneState(paneId, worksheetId));

  const SAVE_DEBOUNCE_MS = 500;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingSave = false;
  // Counts post-hydration mutations to the worksheet snapshot. Stays 0 for
  // a freshly-minted pane with no user interaction, so we never create a
  // ghost SQLite row for an untouched empty editor.
  let interactionCount = $state(0);

  function buildSnapshot(): Worksheet {
    const w: Worksheet = {
      id: paneState.worksheetId,
      title: paneState.title,
      body: paneState.body,
      createdAt: 0,
      updatedAt: 0
    };
    if (paneState.cursorLine !== null) w.cursorLine = paneState.cursorLine;
    if (paneState.cursorCol !== null) w.cursorCol = paneState.cursorCol;
    if (paneState.scrollTop !== null) w.scrollTop = paneState.scrollTop;
    return w;
  }

  async function flushNow(): Promise<void> {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (!pendingSave) return;
    if (!paneState.hydrated) return;
    pendingSave = false;
    try {
      await snowboy.workspace.saveWorksheet(buildSnapshot());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[WorksheetPane] save failed: ${message}`);
    }
  }

  function scheduleSave(): void {
    if (!paneState.hydrated) return;
    pendingSave = true;
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void flushNow();
    }, SAVE_DEBOUNCE_MS);
  }

  onMount(() => {
    let cancelled = false;
    const requestedId = paneState.worksheetId;

    void (async () => {
      try {
        const stored = await snowboy.workspace.getWorksheet(requestedId);
        if (cancelled) return;
        // Stale-load guard: if the pane's worksheetId changed while the
        // fetch was in flight, drop the response (reactivity-critic #7).
        if (paneState.worksheetId !== requestedId) return;
        if (stored !== null) {
          paneState.body = stored.body;
          paneState.title = stored.title;
          paneState.cursorLine = stored.cursorLine ?? null;
          paneState.cursorCol = stored.cursorCol ?? null;
          paneState.scrollTop = stored.scrollTop ?? null;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[WorksheetPane] hydrate failed: ${message}`);
      } finally {
        if (!cancelled && paneState.worksheetId === requestedId) {
          paneState.hydrated = true;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  });

  onDestroy(() => {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (pendingSave && paneState.hydrated) {
      pendingSave = false;
      // Pane-close flush: fire-and-forget the IPC. Closing a single pane
      // does not race with main-process shutdown (that's T4.1's
      // `before-quit` problem). On error we log; there is no UI to toast
      // against once unmount has started.
      const snapshot = buildSnapshot();
      void snowboy.workspace.saveWorksheet(snapshot).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[WorksheetPane] flush-on-destroy failed: ${message}`);
      });
    }
  });

  $effect(() => {
    // Reactivity tracking: read every field whose change should re-arm
    // the debounced save. `interactionCount` is the gate so an
    // unchanged-hydrated pane does not create a SQLite row on its own.
    void paneState.body;
    void paneState.title;
    void paneState.cursorLine;
    void paneState.cursorCol;
    void paneState.scrollTop;
    const count = interactionCount;

    if (!paneState.hydrated) return;
    if (count === 0) return;
    scheduleSave();
  });

  $effect(() => {
    const profile = profiles.list.find((p) => p.id === profiles.activeProfileId);
    if (profile === undefined) return;
    if (paneState.role === undefined && profile.defaultRole) {
      paneState.role = profile.defaultRole;
    }
    if (paneState.warehouse === undefined && profile.defaultWarehouse) {
      paneState.warehouse = profile.defaultWarehouse;
    }
    if (paneState.database === undefined && profile.defaultDatabase) {
      paneState.database = profile.defaultDatabase;
    }
    if (paneState.schema === undefined && profile.defaultSchema) {
      paneState.schema = profile.defaultSchema;
    }
  });

  $effect(() => {
    const effective = sessions.effectiveContextFor(sessions.activeSessionId);
    if (effective === null) return;
    if ((paneState.role === undefined || paneState.role === '') && effective.role) {
      paneState.role = effective.role;
    }
    if ((paneState.warehouse === undefined || paneState.warehouse === '') && effective.warehouse) {
      paneState.warehouse = effective.warehouse;
    }
    if ((paneState.database === undefined || paneState.database === '') && effective.database) {
      paneState.database = effective.database;
    }
    if ((paneState.schema === undefined || paneState.schema === '') && effective.schema) {
      paneState.schema = effective.schema;
    }
  });

  function handleEditorChange(v: string): void {
    paneState.body = v;
    paneState.dirty = true;
    interactionCount++;
  }

  function handleCursorChange(line: number, col: number): void {
    paneState.cursorLine = line;
    paneState.cursorCol = col;
    interactionCount++;
  }

  function handleScrollChange(top: number): void {
    paneState.scrollTop = top;
    interactionCount++;
  }

  const getPaneStore = getContext<(() => PaneTreeStore) | undefined>('panes-store');
  const panes = $derived(getPaneStore ? getPaneStore() : panesSingleton);

  let isActive = $derived(panes.activePaneId === paneId);

  let activeQueryState = $derived(queries.get(paneState.currentQueryId));
  let isRunning = $derived(
    paneState.currentQueryIds.some((id) => queries.get(id)?.status === 'running')
  );
  let canCancel = $derived(activeQueryState?.status === 'running');

  function handlePaneClick(): void {
    panes.setActive(paneId);
  }

  let editorApi: SqlEditorApi | null = $state(null);

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

  async function handleRunAtCursor(payload: RunAtCursorPayload): Promise<void> {
    const sessionId = sessions.activeSessionId;
    if (sessionId === null) {
      toast.error('No active session — open a connection first.');
      return;
    }

    const trimmedStatements = payload.statements
      .map((s) => s.text.replace(/;\s*$/, '').trim())
      .filter((s) => s.length > 0);
    if (trimmedStatements.length === 0) {
      toast.error('Empty statement(s) selected.');
      return;
    }

    const first = payload.statements[0]!;
    const last = payload.statements[payload.statements.length - 1]!;
    editorApi?.flashStatement(first.segmentStart, last.segmentEnd);

    paneState.currentQueryIds = [];
    paneState.currentStatements = trimmedStatements;
    paneState.activeResultIndex = 0;

    for (let i = 0; i < trimmedStatements.length; i++) {
      const stmt = trimmedStatements[i]!;
      try {
        const queryId = await snowboy.query.run(sessionId, stmt);
        queries.register(queryId);
        paneState.currentQueryIds = [...paneState.currentQueryIds, queryId];
        paneState.activeResultIndex = i;
        await queries.waitForCompletion(queryId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const label = trimmedStatements.length > 1 ? `Statement ${i + 1} failed: ` : '';
        toast.error(`${label}${message}`);
        break;
      }
    }
  }

  function handleNoStatementAtCursor(): void {
    toast.info('No statement at cursor — position cursor inside a SQL statement and try again.');
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

  let availableRoles = $state<string[]>([]);
  let availableWarehouses = $state<string[]>([]);
  let availableDatabases = $state<string[]>([]);
  let availableSchemas = $state<string[]>([]);
  let lastFetchedSessionId: string | null = null;
  let lastFetchedDatabaseForSchemas: string | null = null;

  $effect(() => {
    const sid = sessions.activeSessionId;
    if (sid === null) {
      availableRoles = [];
      availableWarehouses = [];
      availableDatabases = [];
      availableSchemas = [];
      lastFetchedSessionId = null;
      lastFetchedDatabaseForSchemas = null;
      return;
    }
    if (sid === lastFetchedSessionId) return;
    lastFetchedSessionId = sid;
    void (async () => {
      try {
        const [roles, warehouses, databases] = await Promise.all([
          snowboy.schema.listRoles(sid),
          snowboy.schema.listWarehouses(sid),
          snowboy.schema.listDatabases(sid)
        ]);
        if (sessions.activeSessionId !== sid) return;
        availableRoles = roles;
        availableWarehouses = warehouses;
        availableDatabases = databases;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[WorksheetPane] context-list fetch failed: ${message}`);
      }
    })();
  });

  $effect(() => {
    const sid = sessions.activeSessionId;
    const db = paneState.database;
    if (sid === null || !db) {
      availableSchemas = [];
      lastFetchedDatabaseForSchemas = null;
      return;
    }
    const key = `${sid}|${db}`;
    if (key === lastFetchedDatabaseForSchemas) return;
    lastFetchedDatabaseForSchemas = key;
    void (async () => {
      try {
        const list = await snowboy.schema.listSchemas(sid, db);
        if (sessions.activeSessionId !== sid || paneState.database !== db) return;
        availableSchemas = list;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[WorksheetPane] listSchemas failed: ${message}`);
      }
    })();
  });

  async function applyContext(patch: { role?: string; warehouse?: string; database?: string; schema?: string }): Promise<void> {
    const sid = sessions.activeSessionId;
    if (sid === null) return;
    try {
      await snowboy.sessions.setContext(sid, patch);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Context switch failed: ${message}`);
    }
  }

  function handleRoleChange(value: string): void {
    if (!value || value === paneState.role) return;
    paneState.role = value;
    void applyContext({ role: value });
  }

  function handleWarehouseChange(value: string): void {
    if (!value || value === paneState.warehouse) return;
    paneState.warehouse = value;
    void applyContext({ warehouse: value });
  }

  function handleDatabaseChange(value: string): void {
    if (!value || value === paneState.database) return;
    paneState.database = value;
    paneState.schema = undefined;
    void applyContext({ database: value });
  }

  function handleSchemaChange(value: string): void {
    if (!value || value === paneState.schema) return;
    paneState.schema = value;
    void applyContext({ schema: value });
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
      <Select.Root
        type="single"
        value={paneState.role ?? ''}
        onValueChange={(v) => v && handleRoleChange(v)}
      >
        <Select.Trigger class="h-7 w-[140px] text-xs">
          {paneState.role || 'Role'}
        </Select.Trigger>
        <Select.Content>
          {#each availableRoles as roleName (roleName)}
            <Select.Item value={roleName}>{roleName}</Select.Item>
          {/each}
          {#if availableRoles.length === 0 && paneState.role}
            <Select.Item value={paneState.role}>{paneState.role}</Select.Item>
          {/if}
        </Select.Content>
      </Select.Root>

      <Select.Root
        type="single"
        value={paneState.warehouse ?? ''}
        onValueChange={(v) => v && handleWarehouseChange(v)}
      >
        <Select.Trigger class="h-7 w-[140px] text-xs">
          {paneState.warehouse || 'Warehouse'}
        </Select.Trigger>
        <Select.Content>
          {#each availableWarehouses as whName (whName)}
            <Select.Item value={whName}>{whName}</Select.Item>
          {/each}
          {#if availableWarehouses.length === 0 && paneState.warehouse}
            <Select.Item value={paneState.warehouse}>{paneState.warehouse}</Select.Item>
          {/if}
        </Select.Content>
      </Select.Root>

      <Select.Root
        type="single"
        value={paneState.database ?? ''}
        onValueChange={(v) => v && handleDatabaseChange(v)}
      >
        <Select.Trigger class="h-7 w-[140px] text-xs">
          {paneState.database || 'Database'}
        </Select.Trigger>
        <Select.Content>
          {#each availableDatabases as dbName (dbName)}
            <Select.Item value={dbName}>{dbName}</Select.Item>
          {/each}
          {#if availableDatabases.length === 0 && paneState.database}
            <Select.Item value={paneState.database}>{paneState.database}</Select.Item>
          {/if}
        </Select.Content>
      </Select.Root>

      <Select.Root
        type="single"
        value={paneState.schema ?? ''}
        onValueChange={(v) => v && handleSchemaChange(v)}
      >
        <Select.Trigger class="h-7 w-[140px] text-xs">
          {paneState.schema || 'Schema'}
        </Select.Trigger>
        <Select.Content>
          {#each availableSchemas as schemaName (schemaName)}
            <Select.Item value={schemaName}>{schemaName}</Select.Item>
          {/each}
          {#if availableSchemas.length === 0 && paneState.schema}
            <Select.Item value={paneState.schema}>{paneState.schema}</Select.Item>
          {/if}
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
    {#if paneState.hydrated}
      <SqlEditor
        bind:api={editorApi}
        value={paneState.body}
        initialCursorLine={paneState.cursorLine}
        initialCursorCol={paneState.cursorCol}
        initialScrollTop={paneState.scrollTop}
        onChange={handleEditorChange}
        onCursorChange={handleCursorChange}
        onScrollChange={handleScrollChange}
        onRunAtCursor={handleRunAtCursor}
        onNoStatementAtCursor={handleNoStatementAtCursor}
        onRunAll={handleRun}
      />
    {/if}
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
