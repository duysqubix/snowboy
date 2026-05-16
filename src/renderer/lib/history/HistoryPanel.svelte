<script lang="ts">
  import { Input } from '$lib/components/ui/input';
  import { Separator } from '$lib/components/ui/separator';
  import HistoryRow from './HistoryRow.svelte';
  import { generateMockHistory } from './mockHistory';

  let {
    onRestore
  }: {
    onRestore?: (sql: string) => void;
  } = $props();

  const allEntries = generateMockHistory(1000);
  const ROW_HEIGHT = 64;
  const OVERSCAN = 5;

  let searchQuery = $state('');

  let filteredEntries = $derived(
    searchQuery.trim() === ''
      ? allEntries
      : allEntries.filter((entry) =>
          entry.sql.toLowerCase().includes(searchQuery.toLowerCase())
        )
  );

  let scrollContainer = $state<HTMLDivElement | null>(null);
  let scrollTop = $state(0);
  let containerHeight = $state(0);

  $effect(() => {
    if (!scrollContainer) return;
    containerHeight = scrollContainer.clientHeight;
    const ro = new ResizeObserver(() => {
      if (scrollContainer) containerHeight = scrollContainer.clientHeight;
    });
    ro.observe(scrollContainer);
    return () => ro.disconnect();
  });

  function handleScroll(e: Event) {
    scrollTop = (e.currentTarget as HTMLDivElement).scrollTop;
  }

  let visibleStart = $derived(
    Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  );
  let visibleEnd = $derived(
    Math.min(
      filteredEntries.length,
      Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN
    )
  );
  let visibleEntries = $derived(filteredEntries.slice(visibleStart, visibleEnd));
  let totalHeight = $derived(filteredEntries.length * ROW_HEIGHT);
</script>

<div class="flex h-full w-full flex-col bg-background">
  <div class="flex flex-col gap-2 bg-muted/20 p-3">
    <Input
      type="text"
      placeholder="Search SQL..."
      bind:value={searchQuery}
      class="w-full bg-background"
    />
    <div class="px-1 text-xs text-muted-foreground">
      {filteredEntries.length} of {allEntries.length} entries
    </div>
  </div>

  <Separator />

  <div
    bind:this={scrollContainer}
    onscroll={handleScroll}
    class="relative flex-1 overflow-auto"
  >
    <div style="height: {totalHeight}px; position: relative;">
      {#each visibleEntries as entry, i (entry.id)}
        <div
          style="position: absolute; top: {(visibleStart + i) *
            ROW_HEIGHT}px; left: 0; right: 0; height: {ROW_HEIGHT}px;"
        >
          <HistoryRow {entry} {onRestore} />
        </div>
      {/each}
    </div>

    {#if filteredEntries.length === 0}
      <div class="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
        No matching queries found.
      </div>
    {/if}
  </div>
</div>
