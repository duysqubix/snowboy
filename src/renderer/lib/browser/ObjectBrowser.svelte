<script lang="ts">
  import { Input } from '$lib/components/ui/input';
  import { ScrollArea } from '$lib/components/ui/scroll-area';
  import { toast } from 'svelte-sonner';
  import { Search } from 'lucide-svelte';
  
  import TreeNode from './TreeNode.svelte';
  import DdlDialog from './DdlDialog.svelte';
  import { mockTreeData } from './mockData';
  import type { BrowserNode } from './types';

  let {
    onInsertSql = (sql: string) => console.log('Insert SQL:', sql)
  } = $props<{
    onInsertSql?: (sql: string) => void;
  }>();

  let searchQuery = $state('');
  
  function filterTree(nodes: BrowserNode[], query: string): BrowserNode[] {
    if (!query) return nodes;
    
    const lowerQuery = query.toLowerCase();
    
    return nodes.map(node => {
      const matches = node.name.toLowerCase().includes(lowerQuery);
      
      if (node.children) {
        const filteredChildren = filterTree(node.children, query);
        if (filteredChildren.length > 0) {
          return { ...node, children: filteredChildren, hasChildren: true };
        }
      }
      
      if (matches) {
        return { ...node, children: node.children ? [] : undefined, hasChildren: false };
      }
      
      return null;
    }).filter(Boolean) as BrowserNode[];
  }

  let filteredData = $derived(filterTree(mockTreeData, searchQuery));

  // Context Menu State
  let menuOpen = $state(false);
  let menuX = $state(0);
  let menuY = $state(0);
  let selectedNode = $state<BrowserNode | null>(null);

  // DDL Dialog State
  let ddlOpen = $state(false);
  let ddlObjectName = $state('');
  let ddlText = $state('');

  function handleContextMenu(e: MouseEvent, node: BrowserNode) {
    selectedNode = node;
    menuX = e.clientX;
    menuY = e.clientY;
    menuOpen = true;
  }

  function getFullyQualifiedName(node: BrowserNode): string {
    const parts = [];
    if (node.database) parts.push(node.database);
    if (node.schema) parts.push(node.schema);
    parts.push(node.name);
    return parts.join('.');
  }

  function handleSelect100() {
    if (!selectedNode) return;
    const fqn = getFullyQualifiedName(selectedNode);
    onInsertSql(`SELECT TOP 100 * FROM ${fqn};`);
    menuOpen = false;
  }

  function handleShowDdl() {
    if (!selectedNode) return;
    ddlObjectName = getFullyQualifiedName(selectedNode);
    ddlText = `-- DDL for ${ddlObjectName}\nCREATE OR REPLACE ${selectedNode.kind.toUpperCase()} ${selectedNode.name} ...`;
    ddlOpen = true;
    menuOpen = false;
  }

  function handleCopyName() {
    if (!selectedNode) return;
    const fqn = getFullyQualifiedName(selectedNode);
    navigator.clipboard.writeText(fqn).then(() => {
      toast.success('Copied to clipboard');
    }).catch(() => {
      toast.error('Failed to copy');
    });
    menuOpen = false;
  }
</script>

<div class="flex flex-col h-full w-full border-r bg-background">
  <div class="p-2 border-b">
    <div class="relative">
      <Search class="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input 
        placeholder="Search objects..." 
        class="pl-8 h-9"
        bind:value={searchQuery}
      />
    </div>
  </div>
  
  <ScrollArea class="flex-1">
    <div class="p-2">
      {#each filteredData as node (node.id)}
        <TreeNode {node} onContextMenu={handleContextMenu} />
      {/each}
    </div>
  </ScrollArea>
</div>

{#if menuOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div 
    class="fixed inset-0 z-50" 
    onclick={() => menuOpen = false}
    oncontextmenu={(e) => { e.preventDefault(); menuOpen = false; }}
  ></div>
  <div 
    class="fixed z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-80 zoom-in-95"
    style="left: {menuX}px; top: {menuY}px;"
  >
    {#if selectedNode?.kind === 'table' || selectedNode?.kind === 'view'}
      <button 
        class="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
        onclick={handleSelect100}
      >
        Select 100 rows
      </button>
    {/if}
    <button 
      class="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
      onclick={handleShowDdl}
    >
      Show DDL
    </button>
    <button 
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
  {ddlText} 
/>
