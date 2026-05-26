<script lang="ts">
  import { Label } from '$lib/components/ui/label';
  import { Input } from '$lib/components/ui/input';
  import { Button } from '$lib/components/ui/button';
  import { settings } from '../../stores/settings.svelte';
  import { toast } from 'svelte-sonner';

  let dataDir = $derived(settings.current.dataDir);

  async function handleOpenLogFolder() {
    try {
      await navigator.clipboard.writeText(dataDir);
      toast.success('Path copied to clipboard', {
        description: dataDir
      });
    } catch {
      toast.error('Failed to copy path');
    }
  }
</script>

<div class="space-y-6">
  <div>
    <h3 class="text-lg font-medium">Advanced</h3>
    <p class="text-sm text-muted-foreground">System paths and troubleshooting.</p>
  </div>

  <div class="space-y-4">
    <div class="space-y-2">
      <Label>Data Directory</Label>
      <div class="flex gap-2 w-[500px]">
        <Input value={dataDir} readonly class="font-mono text-xs" />
        <Button variant="secondary" onclick={handleOpenLogFolder}>
          Copy Path
        </Button>
      </div>
      <p class="text-xs text-muted-foreground">
        Location of settings, profiles, and logs.
      </p>
    </div>
  </div>
</div>
