<script lang="ts">
  import * as Select from "$lib/components/ui/select";
  import { Button } from "$lib/components/ui/button";
</script>

<div class="flex h-12 items-center px-4 border-b border-border bg-background shrink-0">
  <h1 class="font-semibold text-lg mr-8">Snowboy</h1>
  
  <div class="flex items-center gap-2 flex-1">
    <Select.Root type="single">
      <Select.Trigger class="w-[140px] h-8">
        Select profile...
      </Select.Trigger>
      <Select.Content>
        <Select.Item value="default">Default</Select.Item>
      </Select.Content>
    </Select.Root>

    <Select.Root type="single">
      <Select.Trigger class="w-[140px] h-8">
        Select role...
      </Select.Trigger>
      <Select.Content>
        <Select.Item value="sysadmin">SYSADMIN</Select.Item>
      </Select.Content>
    </Select.Root>

    <Select.Root type="single">
      <Select.Trigger class="w-[140px] h-8">
        Select warehouse...
      </Select.Trigger>
      <Select.Content>
        <Select.Item value="compute_wh">COMPUTE_WH</Select.Item>
      </Select.Content>
    </Select.Root>

    <Select.Root type="single">
      <Select.Trigger class="w-[140px] h-8">
        Select database...
      </Select.Trigger>
      <Select.Content>
        <Select.Item value="snowboy_db">SNOWBOY_DB</Select.Item>
      </Select.Content>
    </Select.Root>

    <Select.Root type="single">
      <Select.Trigger class="w-[140px] h-8">
        Select schema...
      </Select.Trigger>
      <Select.Content>
        <Select.Item value="public">PUBLIC</Select.Item>
      </Select.Content>
    </Select.Root>
  </div>

  <div class="flex items-center justify-end w-32">
    <Button variant="outline" size="sm">Action</Button>
  </div>
</div>
