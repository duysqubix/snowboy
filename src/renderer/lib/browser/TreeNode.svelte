<script lang="ts">
  import { ChevronRight, ChevronDown, Database, FolderOpen, Folder, Table2, Eye, FunctionSquare, Columns3 } from 'lucide-svelte';
  import type { BrowserNode } from './types';
  import TreeNode from './TreeNode.svelte';

  let {
    node,
    level = 0,
    onContextMenu
  } = $props<{
    node: BrowserNode;
    level?: number;
    onContextMenu: (e: MouseEvent, node: BrowserNode) => void;
  }>();

  let expanded = $state(false);
  let loading = $state(false);
  let loaded = $state(false);

  async function toggleExpand() {
    if (!node.hasChildren) return;
    
    if (!expanded && !loaded) {
      loading = true;
      await new Promise(resolve => setTimeout(resolve, 150));
      loading = false;
      loaded = true;
    }
    expanded = !expanded;
  }

  function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    onContextMenu(e, node);
  }

  function getIcon(kind: string) {
    switch (kind) {
      case 'database': return Database;
      case 'schema': return expanded ? FolderOpen : Folder;
      case 'group': return Folder;
      case 'table': return Table2;
      case 'view': return Eye;
      case 'function': return FunctionSquare;
      case 'column': return Columns3;
      default: return Folder;
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
          <div class="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
        {:else if expanded}
          <ChevronDown class="w-4 h-4" />
        {:else}
          <ChevronRight class="w-4 h-4" />
        {/if}
      {/if}
    </div>
    
    {#if node.kind !== 'profile'}
      <Icon class="w-4 h-4 mr-2 {isGroup ? 'text-muted-foreground' : 'text-foreground'}" />
    {/if}
    
    <span class="truncate {isGroup ? 'text-muted-foreground' : ''}">{node.name}</span>
    
    {#if node.kind === 'column' && node.dataType}
      <span class="ml-2 text-xs text-muted-foreground">{node.dataType}{node.nullable ? '' : ' NOT NULL'}</span>
    {/if}
  </div>

  {#if expanded && node.children}
    <div>
      {#each node.children as child (child.id)}
        <TreeNode node={child} level={level + 1} {onContextMenu} />
      {/each}
    </div>
  {/if}
</div>
