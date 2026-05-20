<script lang="ts">
  import { AlertCircle, Loader2, Search } from 'lucide-svelte';
  import { toast } from 'svelte-sonner';

  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { ScrollArea } from '$lib/components/ui/scroll-area';

  import { profiles } from '../stores/profiles.svelte';
  import {
    installSessionsBridge,
    sessions
  } from '../stores/sessions.svelte';
  import { tabs } from '../stores/tabs.svelte';
  import { snowboy } from '../ipc/client';
  import type { ObjectRef, SchemaObject, SessionId } from '../../../main/types';

  import DdlDialog from './DdlDialog.svelte';
  import TreeNode from './TreeNode.svelte';
  import type { BrowserNode } from './types';

  let { onInsertSql } = $props<{
    onInsertSql?: (sql: string) => void;
  }>();

  installSessionsBridge();

  let searchQuery = $state('');

  let activeProfile = $derived(
    profiles.list.find((p) => p.id === profiles.activeProfileId) ?? null
  );
  let sessionId = $derived(sessions.activeSessionId);
  let sessionStatus = $derived(sessions.status);
  let sessionError = $derived(sessions.lastError);

  let rootNodes = $state<BrowserNode[]>([]);
  let rootLoading = $state(false);
  let rootError = $state<string | null>(null);

  let lastLoadedSessionId: SessionId | null = null;

  $effect(() => {
    const sid = sessionId;
    if (sid === null) {
      rootNodes = [];
      rootError = null;
      lastLoadedSessionId = null;
      return;
    }
    if (sid === lastLoadedSessionId) return;
    lastLoadedSessionId = sid;
    void loadDatabases(sid);
  });

  async function loadDatabases(sid: SessionId): Promise<void> {
    rootLoading = true;
    rootError = null;
    try {
      const dbs = await snowboy.schema.listDatabases(sid);
      rootNodes = dbs.map((name) => ({
        id: `db:${name}`,
        name,
        kind: 'database' as const,
        database: name,
        hasChildren: true
      }));
    } catch (err) {
      rootError = err instanceof Error ? err.message : String(err);
      rootNodes = [];
    } finally {
      rootLoading = false;
    }
  }

  async function loadChildren(node: BrowserNode): Promise<BrowserNode[]> {
    const sid = sessionId;
    if (sid === null) {
      throw new Error('No active session');
    }
    switch (node.kind) {
      case 'database': {
        const db = requireString(node.database, 'database');
        const names = await snowboy.schema.listSchemas(sid, db);
        return names.map((name) => ({
          id: `schema:${db}.${name}`,
          name,
          kind: 'schema' as const,
          database: db,
          schema: name,
          hasChildren: true
        }));
      }
      case 'schema': {
        const db = requireString(node.database, 'database');
        const schema = requireString(node.schema, 'schema');
        const objects = await snowboy.schema.listObjects(sid, db, schema);
        return buildSchemaChildren(db, schema, objects);
      }
      case 'group': {
        return node.children ?? [];
      }
      case 'table':
      case 'view': {
        const db = requireString(node.database, 'database');
        const schema = requireString(node.schema, 'schema');
        const cols = await snowboy.schema.getColumns(sid, {
          database: db,
          schema,
          name: node.name,
          kind: node.kind
        });
        return cols.map((c) => ({
          id: `col:${db}.${schema}.${node.name}.${c.name}`,
          name: c.name,
          kind: 'column' as const,
          dataType: c.dataType,
          nullable: c.nullable,
          ...(c.comment !== undefined ? { comment: c.comment } : {})
        }));
      }
      default:
        return [];
    }
  }

  function buildSchemaChildren(
    db: string,
    schema: string,
    objects: SchemaObject[]
  ): BrowserNode[] {
    const tables = objects.filter((o) => o.kind === 'table');
    const views = objects.filter((o) => o.kind === 'view');
    const groups: BrowserNode[] = [];
    if (tables.length > 0) {
      groups.push({
        id: `group:${db}.${schema}.tables`,
        name: 'Tables',
        kind: 'group',
        hasChildren: true,
        children: tables.map((t) => ({
          id: `table:${db}.${schema}.${t.name}`,
          name: t.name,
          kind: 'table' as const,
          database: db,
          schema,
          hasChildren: true,
          ...(t.comment !== undefined ? { comment: t.comment } : {})
        }))
      });
    }
    if (views.length > 0) {
      groups.push({
        id: `group:${db}.${schema}.views`,
        name: 'Views',
        kind: 'group',
        hasChildren: true,
        children: views.map((v) => ({
          id: `view:${db}.${schema}.${v.name}`,
          name: v.name,
          kind: 'view' as const,
          database: db,
          schema,
          hasChildren: true,
          ...(v.comment !== undefined ? { comment: v.comment } : {})
        }))
      });
    }
    return groups;
  }

  function requireString(value: string | undefined, label: string): string {
    if (value === undefined || value === '') {
      throw new Error(`Missing required field on node: ${label}`);
    }
    return value;
  }

  function filterTree(nodes: BrowserNode[], query: string): BrowserNode[] {
    if (query === '') return nodes;
    const lowerQuery = query.toLowerCase();

    function visit(node: BrowserNode): BrowserNode | null {
      const matches = node.name.toLowerCase().includes(lowerQuery);
      if (node.children !== undefined && node.children.length > 0) {
        const filteredChildren = node.children
          .map(visit)
          .filter((c): c is BrowserNode => c !== null);
        if (filteredChildren.length > 0) {
          return { ...node, children: filteredChildren, hasChildren: true };
        }
      }
      if (matches) {
        return { ...node };
      }
      return null;
    }

    return nodes
      .map(visit)
      .filter((n): n is BrowserNode => n !== null);
  }

  let filteredData = $derived(filterTree(rootNodes, searchQuery));

  let menuOpen = $state(false);
  let menuX = $state(0);
  let menuY = $state(0);
  let selectedNode = $state<BrowserNode | null>(null);

  let ddlOpen = $state(false);
  let ddlObjectName = $state('');
  let ddlObjectRef = $state<ObjectRef | null>(null);

  function handleContextMenu(e: MouseEvent, node: BrowserNode) {
    selectedNode = node;
    menuX = e.clientX;
    menuY = e.clientY;
    menuOpen = true;
  }

  function getFullyQualifiedName(node: BrowserNode): string {
    const parts: string[] = [];
    if (node.database !== undefined) parts.push(node.database);
    if (node.schema !== undefined) parts.push(node.schema);
    parts.push(node.name);
    return parts.join('.');
  }

  function getQuotedFqn(node: BrowserNode): string {
    const parts: string[] = [];
    if (node.database !== undefined) parts.push(`"${node.database.replace(/"/g, '""')}"`);
    if (node.schema !== undefined) parts.push(`"${node.schema.replace(/"/g, '""')}"`);
    parts.push(`"${node.name.replace(/"/g, '""')}"`);
    return parts.join('.');
  }

  function handleSelect100() {
    if (selectedNode === null) {
      menuOpen = false;
      return;
    }
    const sql = `SELECT * FROM ${getQuotedFqn(selectedNode)} LIMIT 100;`;
    const paneTree = tabs.active?.paneTree;
    const inserted = paneTree?.setActivePaneSql(sql) === true;
    if (!inserted) {
      onInsertSql?.(sql);
    }
    menuOpen = false;
  }

  function handleShowDdl() {
    if (selectedNode === null) {
      menuOpen = false;
      return;
    }
    if (
      selectedNode.kind !== 'table' &&
      selectedNode.kind !== 'view' &&
      selectedNode.kind !== 'schema' &&
      selectedNode.kind !== 'database'
    ) {
      toast.info('No DDL available for this object type');
      menuOpen = false;
      return;
    }
    const db = selectedNode.database ?? selectedNode.name;
    const schema =
      selectedNode.kind === 'database'
        ? ''
        : selectedNode.kind === 'schema'
          ? selectedNode.name
          : (selectedNode.schema ?? '');
    ddlObjectRef = {
      database: db,
      schema,
      name: selectedNode.name,
      kind: selectedNode.kind
    };
    ddlObjectName = getFullyQualifiedName(selectedNode);
    ddlOpen = true;
    menuOpen = false;
  }

  function handleCopyName() {
    if (selectedNode === null) {
      menuOpen = false;
      return;
    }
    const fqn = getFullyQualifiedName(selectedNode);
    navigator.clipboard
      .writeText(fqn)
      .then(() => {
        toast.success('Copied to clipboard');
      })
      .catch(() => {
        toast.error('Failed to copy');
      });
    menuOpen = false;
  }

  function handleRetryRoot() {
    const sid = sessionId;
    if (sid === null) return;
    lastLoadedSessionId = null;
    void loadDatabases(sid);
  }
</script>

<div class="flex flex-col h-full w-full bg-background">
  <div class="p-2 border-b">
    <div class="relative">
      <Search class="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        placeholder="Search objects..."
        class="pl-8 h-9"
        bind:value={searchQuery}
      />
    </div>
    {#if activeProfile !== null}
      <div class="mt-2 text-xs text-muted-foreground truncate" title={activeProfile.name}>
        {activeProfile.name}
      </div>
    {/if}
  </div>

  <ScrollArea class="flex-1">
    <div class="p-2">
      {#if activeProfile === null}
        <div class="px-2 py-4 text-sm text-muted-foreground">
          Select a profile to browse objects.
        </div>
      {:else if sessionStatus === 'opening'}
        <div class="px-2 py-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 class="w-4 h-4 animate-spin" />
          Connecting to {activeProfile.name}…
        </div>
      {:else if sessionStatus === 'error'}
        <div class="px-2 py-4 flex flex-col gap-2 text-sm">
          <div class="flex items-center gap-2 text-destructive">
            <AlertCircle class="w-4 h-4" />
            <span class="truncate" title={sessionError ?? ''}>Connection failed</span>
          </div>
          {#if sessionError !== null}
            <div class="text-xs text-muted-foreground break-words">{sessionError}</div>
          {/if}
        </div>
      {:else if rootLoading}
        <div class="px-2 py-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 class="w-4 h-4 animate-spin" />
          Loading databases…
        </div>
      {:else if rootError !== null}
        <div class="px-2 py-4 flex flex-col gap-2 text-sm">
          <div class="flex items-center gap-2 text-destructive">
            <AlertCircle class="w-4 h-4" />
            <span>Failed to load databases</span>
          </div>
          <div class="text-xs text-muted-foreground break-words">{rootError}</div>
          <Button size="sm" variant="outline" onclick={handleRetryRoot}>Retry</Button>
        </div>
      {:else if filteredData.length === 0}
        {#if searchQuery !== ''}
          <div class="px-2 py-4 text-sm text-muted-foreground">No matches.</div>
        {:else}
          <div class="px-2 py-4 text-sm text-muted-foreground">No databases found.</div>
        {/if}
      {:else}
        {#each filteredData as node (node.id)}
          <TreeNode {node} {loadChildren} onContextMenu={handleContextMenu} />
        {/each}
      {/if}
    </div>
  </ScrollArea>
</div>

{#if menuOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50"
    onclick={() => (menuOpen = false)}
    oncontextmenu={(e) => {
      e.preventDefault();
      menuOpen = false;
    }}
  ></div>
  <div
    class="fixed z-50 min-w-[10rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-80 zoom-in-95"
    style="left: {menuX}px; top: {menuY}px;"
  >
    {#if selectedNode?.kind === 'table' || selectedNode?.kind === 'view'}
      <button
        type="button"
        class="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
        onclick={handleSelect100}
      >
        Select 100 rows
      </button>
    {/if}
    {#if selectedNode?.kind === 'table' || selectedNode?.kind === 'view' || selectedNode?.kind === 'schema' || selectedNode?.kind === 'database'}
      <button
        type="button"
        class="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
        onclick={handleShowDdl}
      >
        Show DDL
      </button>
    {/if}
    <button
      type="button"
      class="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
      onclick={handleCopyName}
    >
      Copy fully qualified name
    </button>
  </div>
{/if}

<DdlDialog
  bind:open={ddlOpen}
  objectName={ddlObjectName}
  objectRef={ddlObjectRef}
  {sessionId}
/>
