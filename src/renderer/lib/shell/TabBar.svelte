<script lang="ts">
  import { Plus, X } from 'lucide-svelte';
  import { tabs } from '$lib/stores/tabs.svelte';
  import { cn } from '$lib/utils';

  function handleMiddleClick(e: MouseEvent, id: string) {
    // Middle-click closes the tab. Browsers fire 'auxclick' with button=1; we
    // also accept mousedown for robustness.
    if (e.button === 1) {
      e.preventDefault();
      tabs.close(id);
    }
  }
</script>

<div
  class="flex h-9 items-center gap-1 border-b border-border bg-muted/40 px-2 shrink-0 overflow-x-auto"
>
  {#each tabs.list as tab (tab.id)}
    {@const isActive = tab.id === tabs.activeId}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class={cn(
        'group relative flex h-7 max-w-[180px] cursor-pointer items-center gap-2 rounded-t-md border-x border-t px-3 text-xs transition-colors',
        isActive
          ? 'border-border bg-background text-foreground -mb-px'
          : 'border-transparent bg-transparent text-muted-foreground hover:bg-muted/70'
      )}
      title={tab.title}
      onclick={() => tabs.setActive(tab.id)}
      onauxclick={(e: MouseEvent) => handleMiddleClick(e, tab.id)}
    >
      <span class="truncate">{tab.dirty ? '• ' : ''}{tab.title}</span>
      <button
        type="button"
        class="rounded-sm p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100 focus:opacity-100"
        title="Close tab"
        aria-label="Close tab"
        onclick={(e: MouseEvent) => {
          e.stopPropagation();
          tabs.close(tab.id);
        }}
      >
        <X class="h-3 w-3" />
      </button>
    </div>
  {/each}

  <button
    type="button"
    class="ml-1 inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
    title="New tab (Ctrl+T)"
    aria-label="New tab"
    onclick={() => tabs.add()}
  >
    <Plus class="h-4 w-4" />
  </button>
</div>
