<script lang="ts">
  import { profiles } from '$lib/stores/profiles.svelte';

  let active = $derived(profiles.list.find((p) => p.id === profiles.activeProfileId) ?? null);
  let connectionLabel = $derived(active ? active.name : 'Not connected');
</script>

<div class="flex h-6 items-center justify-between px-4 border-t border-border bg-muted/50 text-xs text-muted-foreground shrink-0">
  <div>{connectionLabel}</div>
  <div>Ready</div>
</div>
