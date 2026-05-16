<script lang="ts">
  import type { HistoryEntry } from '../../../main/types';
  import { CheckCircle2, XCircle, Ban } from 'lucide-svelte';

  let {
    entry,
    onRestore
  }: {
    entry: HistoryEntry;
    onRestore?: (sql: string) => void;
  } = $props();

  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  function formatTime(timestamp: number): string {
    const now = Date.now();
    const diffMs = timestamp - now;
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (Math.abs(diffDays) < 7) {
      if (diffDays === 0) {
        const diffHours = Math.round(diffMs / (1000 * 60 * 60));
        if (diffHours === 0) {
          const diffMinutes = Math.round(diffMs / (1000 * 60));
          if (diffMinutes === 0) return 'just now';
          return rtf.format(diffMinutes, 'minute');
        }
        return rtf.format(diffHours, 'hour');
      }
      return rtf.format(diffDays, 'day');
    }

    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }).format(new Date(timestamp));
  }

  function formatDuration(start: number, end?: number): string {
    if (!end) return '-';
    const ms = end - start;
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (onRestore) {
        onRestore(entry.sql);
      } else {
        console.log(entry.sql);
      }
    }
  }
</script>

<div
  class="flex flex-col gap-1 p-3 border-b hover:bg-muted/50 cursor-pointer transition-colors"
  role="button"
  tabindex="0"
  onclick={() => onRestore ? onRestore(entry.sql) : console.log(entry.sql)}
  onkeydown={handleKeydown}
>
  <div class="flex items-center justify-between gap-2">
    <div class="flex items-center gap-2 min-w-0">
      {#if entry.status === 'success'}
        <CheckCircle2 class="w-4 h-4 text-green-500 shrink-0" />
      {:else if entry.status === 'error'}
        <XCircle class="w-4 h-4 text-red-500 shrink-0" />
      {:else}
        <Ban class="w-4 h-4 text-muted-foreground shrink-0" />
      {/if}
      <span class="text-xs text-muted-foreground whitespace-nowrap shrink-0">
        {formatTime(entry.startedAt)}
      </span>
      <span class="font-mono text-xs truncate text-foreground">
        {entry.sql}
      </span>
    </div>
    <span class="text-xs text-muted-foreground whitespace-nowrap shrink-0">
      {formatDuration(entry.startedAt, entry.endedAt)}
    </span>
  </div>
  <div class="flex items-center gap-2 pl-6">
    <span class="text-[10px] text-muted-foreground uppercase tracking-wider">
      {entry.role || 'NO ROLE'} &middot; {entry.warehouse || 'NO WAREHOUSE'}
    </span>
    {#if entry.status === 'error' && entry.errorMessage}
      <span class="text-[10px] text-red-500 truncate max-w-[300px]" title={entry.errorMessage}>
        {entry.errorMessage}
      </span>
    {/if}
  </div>
</div>
