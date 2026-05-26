<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog';
  import { listShortcuts, formatCombo, type Shortcut } from '$lib/utils/keymap';

  let {
    open = false,
    onOpenChange = () => {}
  } = $props<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }>();

  let shortcuts = $derived(open ? listShortcuts() : []);

  let groupedShortcuts = $derived.by(() => {
    const groups: Record<string, Shortcut[]> = {};
    for (const s of shortcuts) {
      const prefix = s.id.split('.')[0] || 'other';
      const groupName = prefix.charAt(0).toUpperCase() + prefix.slice(1);
      if (!groups[groupName]) {
        groups[groupName] = [];
      }
      groups[groupName].push(s);
    }
    return groups;
  });
</script>

<Dialog.Root {open} {onOpenChange}>
  <Dialog.Content class="sm:max-w-[600px] max-h-[80vh] flex flex-col overflow-hidden">
    <Dialog.Header>
      <Dialog.Title>Keyboard Shortcuts</Dialog.Title>
    </Dialog.Header>
    <div class="flex-1 overflow-y-auto py-4 px-1">
      {#if shortcuts.length === 0}
        <div class="text-center text-muted-foreground py-8">No shortcuts registered</div>
      {:else}
        <div class="flex flex-col gap-6">
          {#each Object.entries(groupedShortcuts) as [group, items] (group)}
            <div>
              <h3 class="font-semibold text-sm text-muted-foreground mb-3 uppercase tracking-wider">{group}</h3>
              <div class="grid grid-cols-[1fr_2fr] gap-y-3 gap-x-4">
                {#each items as shortcut (shortcut.id)}
                  <div class="text-right font-mono text-sm text-muted-foreground bg-muted/50 rounded px-2 py-0.5 justify-self-end">
                    {formatCombo(shortcut.combo)}
                  </div>
                  <div class="text-sm flex items-center">
                    {shortcut.description}
                    {#if shortcut.scope === 'editor-only'}
                      <span class="text-muted-foreground text-xs ml-2">(in editor)</span>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>
