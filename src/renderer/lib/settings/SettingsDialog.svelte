<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog';
  import GeneralSection from './sections/GeneralSection.svelte';
  import ConnectionsSection from './sections/ConnectionsSection.svelte';
  import EditorSection from './sections/EditorSection.svelte';
  import AdvancedSection from './sections/AdvancedSection.svelte';

  let {
    open = false,
    onOpenChange = () => {}
  } = $props<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }>();

  let activeTab = $state<'general' | 'connections' | 'editor' | 'advanced'>('general');

  const tabs = [
    { id: 'general', label: 'General' },
    { id: 'connections', label: 'Connections' },
    { id: 'editor', label: 'Editor' },
    { id: 'advanced', label: 'Advanced' }
  ] as const;

  $effect(() => {
    if (open) {
      activeTab = 'general';
    }
  });
</script>

<Dialog.Root {open} {onOpenChange}>
  <Dialog.Content class="sm:max-w-[800px] h-[80vh] max-h-[800px] flex flex-row p-0 gap-0 overflow-hidden">
    <div class="w-48 border-r bg-muted/30 flex flex-col py-4">
      <div class="px-4 pb-4 font-semibold text-lg">Settings</div>
      <nav class="flex flex-col gap-1 px-2">
        {#each tabs as tab (tab.id)}
          <button
            class="text-left px-3 py-2 rounded-md text-sm transition-colors {activeTab === tab.id ? 'bg-secondary text-secondary-foreground font-medium' : 'hover:bg-secondary/50 text-muted-foreground'}"
            onclick={() => activeTab = tab.id}
          >
            {tab.label}
          </button>
        {/each}
      </nav>
    </div>
    <div class="flex-1 flex flex-col overflow-hidden">
      <div class="flex-1 overflow-y-auto p-6">
        {#if activeTab === 'general'}
          <GeneralSection />
        {:else if activeTab === 'connections'}
          <ConnectionsSection />
        {:else if activeTab === 'editor'}
          <EditorSection />
        {:else if activeTab === 'advanced'}
          <AdvancedSection />
        {/if}
      </div>
    </div>
  </Dialog.Content>
</Dialog.Root>
