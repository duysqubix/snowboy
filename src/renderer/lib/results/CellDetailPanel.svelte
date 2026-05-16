<script lang="ts">
  import { X } from 'lucide-svelte';

  let {
    columnName,
    value,
    onClose
  }: {
    columnName: string;
    value: unknown;
    onClose: () => void;
  } = $props();

  let formattedValue = $derived.by(() => {
    try {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      return JSON.stringify(parsed, null, 2);
    } catch {
      return String(value);
    }
  });
</script>

<div class="absolute top-0 right-0 bottom-0 w-[360px] bg-background border-l border-border shadow-xl flex flex-col transition-transform duration-200 ease-in-out z-50">
  <div class="flex items-center justify-between p-4 border-b border-border">
    <h3 class="font-semibold text-sm truncate" title={columnName}>{columnName}</h3>
    <button
      class="p-1 hover:bg-muted rounded-md text-muted-foreground hover:text-foreground transition-colors"
      onclick={onClose}
      aria-label="Close panel"
    >
      <X class="w-4 h-4" />
    </button>
  </div>
  <div class="flex-1 overflow-auto p-4">
    <pre class="text-xs font-mono whitespace-pre-wrap break-all text-foreground">{formattedValue}</pre>
  </div>
</div>
