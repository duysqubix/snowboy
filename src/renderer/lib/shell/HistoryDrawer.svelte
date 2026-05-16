<script lang="ts">
  import { History, X } from 'lucide-svelte';
  import HistoryPanel from '$lib/history/HistoryPanel.svelte';

  let {
    open = false,
    onClose,
    onRestore = (sql: string) => console.log('[history] restore:', sql)
  }: {
    open: boolean;
    onClose: () => void;
    onRestore?: (sql: string) => void;
  } = $props();
</script>

{#if open}
  <div class="flex h-64 shrink-0 flex-col border-t border-border bg-background">
    <div class="flex h-8 shrink-0 items-center justify-between border-b border-border bg-muted/30 px-3 text-xs">
      <div class="flex items-center gap-2 font-medium text-muted-foreground">
        <History class="h-3.5 w-3.5" />
        Query history
      </div>
      <button
        type="button"
        class="rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        title="Close history"
        aria-label="Close history"
        onclick={onClose}
      >
        <X class="h-3.5 w-3.5" />
      </button>
    </div>
    <div class="flex-1 min-h-0 overflow-hidden">
      <HistoryPanel {onRestore} />
    </div>
  </div>
{/if}
