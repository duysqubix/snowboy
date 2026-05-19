<script lang="ts">
  import { onMount, setContext } from 'svelte';
  import { Splitpanes, Pane } from 'svelte-splitpanes';
  import { Toaster, toast } from 'svelte-sonner';

  import TopBar from '$lib/shell/TopBar.svelte';
  import LeftRail from '$lib/shell/LeftRail.svelte';
  import StatusBar from '$lib/shell/StatusBar.svelte';
  import TabBar from '$lib/shell/TabBar.svelte';
  import HistoryDrawer from '$lib/shell/HistoryDrawer.svelte';
  import PaneTree from '$lib/panes/PaneTree.svelte';
  import ConnectionDialog from '$lib/connections/ConnectionDialog.svelte';
  import MfaPromptDialog from '$lib/connections/MfaPromptDialog.svelte';

  import { tabs, installTabsKeymap } from '$lib/stores/tabs.svelte';
  import { panes as panesSingleton, type PaneTreeStore } from '$lib/stores/panes.svelte';
  import { installKeymap } from '$lib/utils/keymap';
  import { profiles } from '$lib/stores/profiles.svelte';
  import { sessions } from '$lib/stores/sessions.svelte';

  setContext<() => PaneTreeStore>('panes-store', () => tabs.active?.paneTree ?? panesSingleton);

  let connectionsOpen = $state(false);
  let historyOpen = $state(false);
  let mfaOpen = $state(false);

  let mfaProfileName = $derived(
    profiles.list.find((p) => p.id === profiles.activeProfileId)?.name ?? ''
  );

  $effect(() => {
    if (sessions.status === 'needs-mfa' && !mfaOpen) {
      mfaOpen = true;
    }
  });

  async function handleMfaSubmit(passcode: string): Promise<void> {
    const profileId = profiles.activeProfileId;
    if (profileId === null) return;
    try {
      await sessions.openWithPasscode(profileId, passcode);
      mfaOpen = false;
      toast.success('Connected');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(message);
    }
  }

  function handleMfaOpenChange(v: boolean): void {
    mfaOpen = v;
    if (!v && sessions.status === 'needs-mfa') {
      profiles.setActive(null);
    }
  }

  function openConnections(): void {
    setTimeout(() => {
      connectionsOpen = true;
    }, 0);
  }

  function toggleHistory(): void {
    historyOpen = !historyOpen;
  }

  function insertSqlIntoActivePane(sql: string) {
    toast.info('Insert into active pane pending (Wave 3)', { description: sql });
  }

  let lastKeymapTabId: string | null = null;
  let paneKeymapCleanup: (() => void) | null = null;

  onMount(() => {
    const cleanups: Array<() => void> = [];

    cleanups.push(installTabsKeymap(tabs));

    function handleHistoryToggle(e: KeyboardEvent) {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
      if (cmdOrCtrl && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        historyOpen = !historyOpen;
      }
    }
    window.addEventListener('keydown', handleHistoryToggle);
    cleanups.push(() => window.removeEventListener('keydown', handleHistoryToggle));

    return () => {
      for (const c of cleanups) c();
      if (paneKeymapCleanup) paneKeymapCleanup();
    };
  });

  $effect(() => {
    const id = tabs.activeId;
    if (id === lastKeymapTabId) return;
    lastKeymapTabId = id;
    if (paneKeymapCleanup) paneKeymapCleanup();
    paneKeymapCleanup = installKeymap(tabs.active?.paneTree ?? panesSingleton);
  });

  let activeTree = $derived(tabs.active?.paneTree.tree ?? panesSingleton.tree);
</script>

<div class="flex flex-col h-full w-full bg-background text-foreground overflow-hidden">
  <TopBar
    onOpenConnections={openConnections}
    onToggleHistory={toggleHistory}
  />

  <TabBar />

  <div class="flex-1 min-h-0 overflow-hidden">
    <Splitpanes theme="snowboy-theme">
      <Pane size={22} minSize={15}>
        <LeftRail onInsertSql={insertSqlIntoActivePane} />
      </Pane>
      <Pane size={78}>
        <div class="h-full w-full">
          <PaneTree tree={activeTree} />
        </div>
      </Pane>
    </Splitpanes>
  </div>

  <HistoryDrawer
    open={historyOpen}
    onClose={() => (historyOpen = false)}
    onRestore={insertSqlIntoActivePane}
  />

  <StatusBar />

  <ConnectionDialog
    open={connectionsOpen}
    onOpenChange={(v) => (connectionsOpen = v)}
    onConnect={(p) => toast.success(`Connected to ${p.name}`)}
  />

  <MfaPromptDialog
    open={mfaOpen}
    profileName={mfaProfileName}
    onOpenChange={handleMfaOpenChange}
    onSubmit={(code) => {
      void handleMfaSubmit(code);
    }}
  />

  <Toaster richColors position="bottom-right" />
</div>

<style>
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
