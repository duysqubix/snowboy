<script lang="ts">
  import { Label } from '$lib/components/ui/label';
  import * as Select from '$lib/components/ui/select';
  import { settings } from '../../stores/settings.svelte';

  let theme = $derived(settings.current.theme);
  let fontSize = $derived(settings.current.fontSize);

  const themeOptions = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'system', label: 'System' }
  ];

  let selectedTheme = $derived(themeOptions.find(o => o.value === theme) || themeOptions[2]);
</script>

<div class="space-y-6">
  <div>
    <h3 class="text-lg font-medium">General</h3>
    <p class="text-sm text-muted-foreground">Appearance and basic behavior.</p>
  </div>

  <div class="space-y-4">
    <div class="space-y-2">
      <Label>Theme</Label>
      <Select.Root
        type="single"
        value={theme}
        onValueChange={(v) => {
          if (v) void settings.set({ theme: v as 'light' | 'dark' | 'system' });
        }}
      >
        <Select.Trigger class="w-[200px]">
          {selectedTheme?.label ?? 'System'}
        </Select.Trigger>
        <Select.Content>
          {#each themeOptions as option (option.value)}
            <Select.Item value={option.value}>{option.label}</Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    </div>

    <div class="space-y-2">
      <div class="flex justify-between w-[300px]">
        <Label>Font Size</Label>
        <span class="text-sm text-muted-foreground">{fontSize}px</span>
      </div>
      <div class="w-[300px]">
        <input
          type="range"
          min="10"
          max="24"
          step="2"
          value={fontSize}
          oninput={(e) => {
            const val = parseInt(e.currentTarget.value, 10);
            void settings.set({ fontSize: val });
          }}
          class="w-full accent-primary"
        />
      </div>
    </div>
  </div>
</div>
