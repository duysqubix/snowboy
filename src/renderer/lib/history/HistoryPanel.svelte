<script lang="ts">
  import { Input } from '$lib/components/ui/input';
  import { Separator } from '$lib/components/ui/separator';
  import { toast } from 'svelte-sonner';
  import HistoryRow from './HistoryRow.svelte';
  import { snowboy } from '$lib/ipc/client';
  import { tabs } from '$lib/stores/tabs.svelte';
  import { profiles } from '$lib/stores/profiles.svelte';
  import type { HistoryEntry } from '../../../main/types';

  let { onRestore }: { onRestore?: (sql: string) => void } = $props();

  const ROW_HEIGHT = 64;
  const OVERSCAN = 5;
  const FETCH_LIMIT = 1000;

  let allEntries = $state<HistoryEntry[]>([]);
  let totalLoaded = $state(0);
  let loading = $state(false);
  let loadError = $state<string | null>(null);

  let searchQuery = $state('');

  async function refresh(): Promise<void> {
    loading = true;
    loadError = null;
    const activeProfileId = profiles.activeProfileId;
    const filter: { limit: number; profileId?: string } = { limit: FETCH_LIMIT };
    if (activeProfileId !== null) {
      filter.profileId = activeProfileId;
    }
    try {
      const rows = await snowboy.history.list(filter);
      allEntries = rows;
      totalLoaded = rows.length;
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
      allEntries = [];
      totalLoaded = 0;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void profiles.activeProfileId;
    void refresh();
  });

  $effect(() => {
    const unsubscribe = snowboy.queryEvents.onComplete(() => {
      void refresh();
    });
    return () => unsubscribe();
  });

  $effect(() => {
    const unsubscribe = snowboy.queryEvents.onError(() => {
      void refresh();
    });
    return () => unsubscribe();
  });

  function handleRestore(sql: string): void {
    const tree = tabs.active?.paneTree;
    if (tree && typeof tree.setActivePaneSql === 'function') {
      const wrote = tree.setActivePaneSql(sql);
      if (wrote) {
        toast.success('SQL restored to active pane');
      } else {
        toast.error('No active pane to restore SQL into');
      }
    } else {
      toast.error('Active pane unavailable');
    }
    onRestore?.(sql);
  }

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

  function handleScroll(e: Event): void {
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
      {#if loading}
        Loading…
      {:else if loadError}
        <span class="text-red-500">Load failed: {loadError}</span>
      {:else}
        {filteredEntries.length} of {totalLoaded} entries
      {/if}
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
          <HistoryRow {entry} onRestore={handleRestore} />
        </div>
      {/each}
    </div>

    {#if !loading && filteredEntries.length === 0}
      <div class="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
        {searchQuery.trim() === '' ? 'No queries yet — run one to see history.' : 'No matching queries found.'}
      </div>
    {/if}
  </div>
</div>
