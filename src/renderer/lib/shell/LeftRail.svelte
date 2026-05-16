<script lang="ts">
  import ObjectBrowser from '$lib/browser/ObjectBrowser.svelte';
  import { toast } from 'svelte-sonner';

  let { onInsertSql }: { onInsertSql?: (sql: string) => void } = $props();

  function handleInsertSql(sql: string) {
    if (onInsertSql) {
      onInsertSql(sql);
    } else {
      toast.info('Insert pending — Wave 3 wires this up', { description: sql });
    }
  }
</script>

<div class="h-full w-full bg-background">
  <ObjectBrowser onInsertSql={handleInsertSql} />
</div>
