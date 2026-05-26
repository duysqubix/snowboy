<script lang="ts">
  import * as Select from '$lib/components/ui/select';
  import { Button } from '$lib/components/ui/button';
  import { HelpCircle, History, Plug, Settings } from 'lucide-svelte';
  import { profiles } from '$lib/stores/profiles.svelte';

  let {
    onOpenConnections,
    onToggleHistory,
    onOpenSettings,
    onOpenShortcuts
  }: {
    onOpenConnections: () => void;
    onToggleHistory: () => void;
    onOpenSettings: () => void;
    onOpenShortcuts: () => void;
  } = $props();

  let activeProfileId = $derived(profiles.activeProfileId ?? '');
</script>

<div class="flex h-12 items-center px-4 border-b border-border bg-background shrink-0">
  <h1 class="font-semibold text-lg mr-8">Snowboy</h1>

  <div class="flex min-w-0 flex-1 items-center gap-2">
    <Select.Root
      type="single"
      value={activeProfileId}
      onValueChange={(v) => profiles.setActive(v || null)}
    >
      <Select.Trigger class="h-8 w-[180px] shrink-0 text-xs">
        {profiles.list.find((p) => p.id === activeProfileId)?.name ?? 'Select profile...'}
      </Select.Trigger>
      <Select.Content>
        {#each profiles.list as p (p.id)}
          <Select.Item value={p.id}>{p.name}</Select.Item>
        {/each}
      </Select.Content>
    </Select.Root>
  </div>

  <div class="ml-2 flex shrink-0 items-center gap-2">
    <Button
      variant="ghost"
      size="sm"
      class="h-8"
      title="Settings (Ctrl+,)"
      onclick={onOpenSettings}
    >
      <Settings class="h-4 w-4" />
    </Button>
    <Button
      variant="ghost"
      size="sm"
      class="h-8"
      title="Keyboard shortcuts (Ctrl+/)"
      onclick={onOpenShortcuts}
    >
      <HelpCircle class="h-4 w-4" />
    </Button>
    <Button
      variant="ghost"
      size="sm"
      class="h-8"
      title="Query history (Ctrl+H)"
      onclick={onToggleHistory}
    >
      <History class="h-4 w-4" />
    </Button>
    <Button variant="outline" size="sm" class="h-8" onclick={onOpenConnections}>
      <Plug class="h-4 w-4" />
      Connect
    </Button>
  </div>
</div>
