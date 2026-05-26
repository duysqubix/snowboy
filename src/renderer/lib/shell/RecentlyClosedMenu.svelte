<script lang="ts">
  import * as Command from '$lib/components/ui/command';
  import { recentlyClosed, type RecentlyClosed } from '$lib/stores/recentlyClosed.svelte';
  import { Clock } from 'lucide-svelte';

  let {
    open = false,
    onOpenChange,
    onPick
  }: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    onPick: (entry: RecentlyClosed) => void;
  } = $props();

  function formatRelativeTime(ms: number): string {
    const diff = Date.now() - ms;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }
</script>

<Command.Dialog {open} {onOpenChange}>
  <Command.Input placeholder="Search recently closed panes..." />
  <Command.List>
    <Command.Empty>No recently closed panes.</Command.Empty>
    {#if recentlyClosed.items.length > 0}
      <Command.Group heading="Recently Closed">
        {#each recentlyClosed.items as item (item.worksheetId)}
          <Command.Item
            value={item.title}
            onSelect={() => {
              onPick(item);
              onOpenChange(false);
            }}
          >
            <Clock class="mr-2 h-4 w-4 text-muted-foreground" />
            <span class="flex-1 truncate">{item.title}</span>
            <span class="text-xs text-muted-foreground">{formatRelativeTime(item.closedAt)}</span>
          </Command.Item>
        {/each}
      </Command.Group>
    {/if}
  </Command.List>
</Command.Dialog>
