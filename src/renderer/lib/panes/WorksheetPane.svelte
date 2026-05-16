<script lang="ts">
  import { getContext } from 'svelte';
  import { createPaneState } from './paneStore.svelte';
  import { panes as panesSingleton, type PaneTreeStore } from '../stores/panes.svelte';
  import { cn } from '../utils';
  import * as Select from '../components/ui/select';
  import { Button } from '../components/ui/button';

  let { paneId }: { paneId: string } = $props();

  const state = createPaneState();

  // Per-tab pane tree support: read the active pane store from context.
  // Bucket D's App.svelte installs this via setContext('panes-store', getter).
  // Falls back to the singleton when no context is provided (standalone use).
  const getPaneStore = getContext<(() => PaneTreeStore) | undefined>('panes-store');
  const panes = $derived(getPaneStore ? getPaneStore() : panesSingleton);

  let isActive = $derived(panes.activePaneId === paneId);

  function handlePaneClick() {
    panes.setActive(paneId);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class={cn(
    "flex flex-col h-full w-full bg-background overflow-hidden",
    isActive ? "ring-1 ring-primary/40" : "border-r border-border last:border-r-0"
  )}
  onclick={handlePaneClick}
>
  <div class="flex items-center justify-between px-2 h-10 border-b border-border shrink-0">
    <div class="flex items-center gap-2">
      <Select.Root type="single" bind:value={state.role}>
        <Select.Trigger class="h-7 w-[120px] text-xs">
          {state.role || 'Role'}
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="ACCOUNTADMIN">ACCOUNTADMIN</Select.Item>
          <Select.Item value="SYSADMIN">SYSADMIN</Select.Item>
        </Select.Content>
      </Select.Root>

      <Select.Root type="single" bind:value={state.warehouse}>
        <Select.Trigger class="h-7 w-[120px] text-xs">
          {state.warehouse || 'Warehouse'}
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="COMPUTE_WH">COMPUTE_WH</Select.Item>
        </Select.Content>
      </Select.Root>

      <Select.Root type="single" bind:value={state.database}>
        <Select.Trigger class="h-7 w-[120px] text-xs">
          {state.database || 'Database'}
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="SNOWFLAKE">SNOWFLAKE</Select.Item>
        </Select.Content>
      </Select.Root>

      <Select.Root type="single" bind:value={state.schema}>
        <Select.Trigger class="h-7 w-[120px] text-xs">
          {state.schema || 'Schema'}
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="PUBLIC">PUBLIC</Select.Item>
        </Select.Content>
      </Select.Root>
    </div>

    <div class="flex items-center gap-2">
      <Button variant="outline" size="sm" class="h-7 text-xs" disabled onclick={() => {}}>
        Cancel
      </Button>
      <Button variant="default" size="sm" class="h-7 text-xs" disabled onclick={() => {}}>
        Run
      </Button>
    </div>
  </div>

  <div class="flex-1 flex items-center justify-center border-b border-border min-h-0">
    <span class="text-muted-foreground text-sm">SQL editor mounts here (T2.2)</span>
    <!-- TODO(T2.2): mount SqlEditor here -->
  </div>

  <div class="h-[30%] flex items-center justify-center shrink-0">
    <span class="text-muted-foreground text-sm">Results grid mounts here (T2.3)</span>
    <!-- TODO(T2.3): mount ResultsGrid here -->
  </div>

  <div class="flex items-center gap-4 px-2 h-6 border-t border-border shrink-0 bg-muted/20">
    <span class="text-[10px] text-muted-foreground">—</span>
    <span class="text-[10px] text-muted-foreground">—</span>
    <span class="text-[10px] text-muted-foreground">—</span>
  </div>
</div>
