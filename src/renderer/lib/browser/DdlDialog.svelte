<script lang="ts">
  import { AlertCircle, Loader2 } from 'lucide-svelte';
  import { toast } from 'svelte-sonner';

  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { ScrollArea } from '$lib/components/ui/scroll-area';
  import { snowboy } from '../ipc/client';
  import type { ObjectRef, SessionId } from '../../../main/types';

  let {
    open = $bindable(false),
    objectName = '',
    objectRef = null,
    sessionId = null
  } = $props<{
    open: boolean;
    objectName: string;
    objectRef: ObjectRef | null;
    sessionId: SessionId | null;
  }>();

  let ddlText = $state('');
  let loading = $state(false);
  let error = $state<string | null>(null);

  let lastLoadKey: string | null = null;

  $effect(() => {
    if (!open) {
      lastLoadKey = null;
      return;
    }
    const ref = objectRef;
    const sid = sessionId;
    if (ref === null || sid === null) return;
    const key = `${sid}|${ref.kind}|${ref.database}|${ref.schema}|${ref.name}`;
    if (key === lastLoadKey) return;
    lastLoadKey = key;
    void loadDdl(sid, ref);
  });

  async function loadDdl(sid: SessionId, ref: ObjectRef): Promise<void> {
    loading = true;
    error = null;
    ddlText = '';
    try {
      ddlText = await snowboy.schema.getDDL(sid, ref);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  function handleCopy() {
    navigator.clipboard
      .writeText(ddlText)
      .then(() => {
        toast.success('DDL copied to clipboard');
      })
      .catch(() => {
        toast.error('Failed to copy DDL');
      });
  }

  function handleRetry() {
    const ref = objectRef;
    const sid = sessionId;
    if (ref === null || sid === null) return;
    lastLoadKey = null;
    void loadDdl(sid, ref);
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-w-[800px]">
    <Dialog.Header>
      <Dialog.Title class="truncate" title={objectName}>{objectName}</Dialog.Title>
    </Dialog.Header>
    <div class="min-h-[400px]">
      {#if loading}
        <div
          class="flex items-center justify-center gap-2 h-[400px] text-sm text-muted-foreground"
        >
          <Loader2 class="w-4 h-4 animate-spin" />
          Loading DDL…
        </div>
      {:else if error !== null}
        <div class="flex flex-col items-center justify-center gap-3 h-[400px] px-6">
          <AlertCircle class="w-8 h-8 text-destructive" />
          <div class="text-sm font-medium">Failed to load DDL</div>
          <div class="text-xs text-muted-foreground text-center break-words">{error}</div>
          <Button size="sm" variant="outline" onclick={handleRetry}>Retry</Button>
        </div>
      {:else}
        <ScrollArea class="h-[400px] w-full rounded-md border bg-muted p-4">
          <pre class="text-sm font-mono whitespace-pre"><code>{ddlText || '(no DDL returned)'}</code></pre>
        </ScrollArea>
      {/if}
    </div>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => (open = false)}>Close</Button>
      <Button
        onclick={handleCopy}
        disabled={loading || error !== null || ddlText.length === 0}
      >
        Copy DDL
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
