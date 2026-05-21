<script lang="ts">
  import { Splitpanes, Pane } from 'svelte-splitpanes';
  import type { LayoutTree } from '../../../main/types';
  import WorksheetPane from './WorksheetPane.svelte';
  import PaneTree from './PaneTree.svelte';

  let { tree }: { tree: LayoutTree } = $props();
</script>

{#if tree.kind === 'leaf'}
  <WorksheetPane paneId={tree.paneId} worksheetId={tree.worksheetId} />
{:else}
  <Splitpanes horizontal={tree.direction === 'h'}>
    {#each tree.children as child, i (i)}
      <Pane size={tree.sizes[i]}>
        <PaneTree tree={child} />
      </Pane>
    {/each}
  </Splitpanes>
{/if}
