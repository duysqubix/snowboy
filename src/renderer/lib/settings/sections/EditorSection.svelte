<script lang="ts">
  import { Label } from '$lib/components/ui/label';
  import * as Select from '$lib/components/ui/select';
  import { settings } from '../../stores/settings.svelte';

  let tabWidth = $derived(settings.current.tabWidth);
  let wordWrap = $derived(settings.current.wordWrap);

  const tabWidthOptions = [
    { value: '2', label: '2 spaces' },
    { value: '4', label: '4 spaces' },
    { value: '8', label: '8 spaces' }
  ];

  let selectedTabWidth = $derived(tabWidthOptions.find(o => o.value === String(tabWidth)) || tabWidthOptions[0]);
</script>

<div class="space-y-6">
  <div>
    <h3 class="text-lg font-medium">Editor</h3>
    <p class="text-sm text-muted-foreground">Code editor preferences.</p>
  </div>

  <div class="space-y-4">
    <div class="space-y-2">
      <Label>Tab Width</Label>
      <Select.Root
        type="single"
        value={String(tabWidth)}
        onValueChange={(v) => {
          if (v) void settings.set({ tabWidth: parseInt(v, 10) as 2 | 4 | 8 });
        }}
      >
        <Select.Trigger class="w-[200px]">
          {selectedTabWidth?.label ?? '2 spaces'}
        </Select.Trigger>
        <Select.Content>
          {#each tabWidthOptions as option (option.value)}
            <Select.Item value={option.value}>{option.label}</Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    </div>

    <div class="flex items-center justify-between rounded-lg border p-4 w-[400px]">
      <div class="space-y-0.5">
        <Label>Word Wrap</Label>
        <p class="text-sm text-muted-foreground">Wrap long lines in the editor.</p>
      </div>
      <input
        type="checkbox"
        checked={wordWrap}
        onchange={(e) => {
          void settings.set({ wordWrap: e.currentTarget.checked });
        }}
        class="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
      />
    </div>
  </div>
</div>
