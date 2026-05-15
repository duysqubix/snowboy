<script lang="ts">
  import TopBar from "$lib/shell/TopBar.svelte";
  import LeftRail from "$lib/shell/LeftRail.svelte";
  import StatusBar from "$lib/shell/StatusBar.svelte";
  import { Splitpanes, Pane } from "svelte-splitpanes";
</script>

<div class="flex flex-col h-full w-full bg-background text-foreground overflow-hidden">
  <TopBar />
  
  <div class="flex-1 overflow-hidden">
    <Splitpanes theme="snowboy-theme">
      <Pane size={25} minSize={20}>
        <LeftRail />
      </Pane>
      <Pane size={75}>
        <div class="h-full w-full flex items-center justify-center text-muted-foreground">
          Worksheet panes appear here
        </div>
      </Pane>
    </Splitpanes>
  </div>

  <StatusBar />
</div>

<style>
  /* Minimal theme for splitpanes to match shadcn */
  :global(.splitpanes.snowboy-theme .splitpanes__splitter) {
    background-color: hsl(var(--border));
    position: relative;
  }
  :global(.splitpanes.snowboy-theme .splitpanes__splitter:before) {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    transition: opacity 0.4s;
    background-color: hsl(var(--primary) / 0.2);
    opacity: 0;
    z-index: 1;
  }
  :global(.splitpanes.snowboy-theme .splitpanes__splitter:hover:before) {
    opacity: 1;
  }
  :global(.splitpanes.snowboy-theme.splitpanes--vertical > .splitpanes__splitter:before) {
    left: -2px;
    right: -2px;
    height: 100%;
  }
  :global(.splitpanes.snowboy-theme.splitpanes--horizontal > .splitpanes__splitter:before) {
    top: -2px;
    bottom: -2px;
    width: 100%;
  }
</style>
