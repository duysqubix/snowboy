<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { ScrollArea } from '$lib/components/ui/scroll-area';
  import { toast } from 'svelte-sonner';

  let {
    open = $bindable(false),
    objectName = '',
    ddlText = ''
  } = $props<{
    open: boolean;
    objectName: string;
    ddlText: string;
  }>();

  function handleCopy() {
    navigator.clipboard.writeText(ddlText).then(() => {
      toast.success('DDL copied to clipboard');
    }).catch(() => {
      toast.error('Failed to copy DDL');
    });
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-w-[700px]">
    <Dialog.Header>
      <Dialog.Title>{objectName}</Dialog.Title>
    </Dialog.Header>
    <ScrollArea class="h-[400px] w-full rounded-md border bg-muted p-4">
      <pre class="text-sm"><code>{ddlText}</code></pre>
    </ScrollArea>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => open = false}>Close</Button>
      <Button onclick={handleCopy}>Copy DDL</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
