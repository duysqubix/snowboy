<script lang="ts">
  import { getContext } from 'svelte';
  import { Splitpanes, Pane } from 'svelte-splitpanes';
  import type { LayoutTree } from '../../../main/types';
  import type { PaneTreeStore } from '../stores/panes.svelte';
  import WorksheetPane from './WorksheetPane.svelte';
  import PaneTree from './PaneTree.svelte';

  let { tree }: { tree: LayoutTree } = $props();

  const paneStoreAccessor = getContext<(() => PaneTreeStore) | undefined>('panes-store');

  interface PaneSizingEvent {
    size: number;
  }

  function handleResized(detail: PaneSizingEvent[]): void {
    if (tree.kind !== 'split' || !paneStoreAccessor) return;
    const store = paneStoreAccessor();
    const sizes = detail.map((d) => d.size);
    store.setSizes(store.splitNodeId(tree), sizes);
  }

  function nodeKey(node: LayoutTree): string {
    if (node.kind === 'leaf') return node.paneId;
    return `split:${firstLeafId(node)}`;
  }

  function firstLeafId(node: LayoutTree): string {
    if (node.kind === 'leaf') return node.paneId;
    const first = node.children[0];
    return first ? firstLeafId(first) : 'empty';
  }
</script>

{#if tree.kind === 'leaf'}
  <!-- Keyed so a leaf-to-leaf swap (new tab, Ctrl+W on a lone pane) mounts a
       fresh WorksheetPane: it hydrates in onMount, and shows no editor until then. -->
  {#key tree.paneId}
    <WorksheetPane paneId={tree.paneId} worksheetId={tree.worksheetId} />
  {/key}
{:else}
  <Splitpanes
    horizontal={tree.direction === 'h'}
    on:resized={(e: CustomEvent<PaneSizingEvent[]>) => handleResized(e.detail)}
  >
    {#each tree.children as child, i (nodeKey(child))}
      <Pane size={tree.sizes[i]}>
        <PaneTree tree={child} />
      </Pane>
    {/each}
  </Splitpanes>
{/if}
