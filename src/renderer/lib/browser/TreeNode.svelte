<script lang="ts">
  import {
    AlertCircle,
    ChevronDown,
    ChevronRight,
    Columns3,
    Database,
    Eye,
    Folder,
    FolderOpen,
    FunctionSquare,
    Table2
  } from 'lucide-svelte';
  import type { BrowserNode, LoadChildren } from './types';
  import TreeNode from './TreeNode.svelte';

  let {
    node,
    level = 0,
    loadChildren,
    onContextMenu
  } = $props<{
    node: BrowserNode;
    level?: number;
    loadChildren: LoadChildren;
    onContextMenu: (e: MouseEvent, node: BrowserNode) => void;
  }>();

  let expanded = $state(false);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let children = $state<BrowserNode[] | undefined>(undefined);

  async function toggleExpand() {
    if (!node.hasChildren) return;

    if (!expanded) {
      if (children === undefined) {
        loading = true;
        error = null;
        try {
          children = await loadChildren(node);
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
          loading = false;
          return;
        }
        loading = false;
      }
      expanded = true;
    } else {
      expanded = false;
    }
  }

  async function retry() {
    error = null;
    children = undefined;
    await toggleExpand();
  }

  function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    onContextMenu(e, node);
  }

  function getIcon(kind: string) {
    switch (kind) {
      case 'database':
        return Database;
      case 'schema':
        return expanded ? FolderOpen : Folder;
      case 'group':
        return expanded ? FolderOpen : Folder;
      case 'table':
        return Table2;
      case 'view':
        return Eye;
      case 'function':
        return FunctionSquare;
      case 'column':
        return Columns3;
      default:
        return Folder;
    }
  }

  let Icon = $derived(getIcon(node.kind));
  let isGroup = $derived(node.kind === 'group');
</script>

<div class="flex flex-col">
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="flex items-center py-1 px-2 hover:bg-accent hover:text-accent-foreground cursor-pointer select-none text-sm"
    style="padding-left: {level * 12 + 8}px"
    onclick={toggleExpand}
    oncontextmenu={handleContextMenu}
  >
    <div class="w-4 h-4 mr-1 flex items-center justify-center">
      {#if node.hasChildren}
        {#if loading}
          <div
            class="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin"
          ></div>
        {:else if error !== null}
          <button
            type="button"
            class="p-0 m-0 bg-transparent border-none cursor-pointer"
            title={`Error: ${error}. Click to retry.`}
            onclick={(e) => {
              e.stopPropagation();
              void retry();
            }}
          >
            <AlertCircle class="w-4 h-4 text-destructive" />
          </button>
        {:else if expanded}
          <ChevronDown class="w-4 h-4" />
        {:else}
          <ChevronRight class="w-4 h-4" />
        {/if}
      {/if}
    </div>

    {#if node.kind !== 'profile'}
      <Icon
        class="w-4 h-4 mr-2 {isGroup ? 'text-muted-foreground' : 'text-foreground'}"
      />
    {/if}

    <span class="truncate {isGroup ? 'text-muted-foreground' : ''}" title={node.comment ?? node.name}
      >{node.name}</span
    >

    {#if node.kind === 'column' && node.dataType}
      <span class="ml-2 text-xs text-muted-foreground"
        >{node.dataType}{node.nullable ? '' : ' NOT NULL'}</span
      >
    {/if}
  </div>

  {#if expanded && children}
    <div>
      {#each children as child (child.id)}
        <TreeNode
          node={child}
          level={level + 1}
          {loadChildren}
          {onContextMenu}
        />
      {/each}
      {#if children.length === 0}
        <div
          class="px-2 py-1 text-xs text-muted-foreground italic"
          style="padding-left: {(level + 1) * 12 + 8}px"
        >
          (empty)
        </div>
      {/if}
    </div>
  {/if}
</div>
