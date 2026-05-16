<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog';
  import ProfileList from './ProfileList.svelte';
  import ConnectionWizard from './ConnectionWizard.svelte';
  import type { ConnectionProfile } from '../../../main/types';

  let {
    open = false,
    onOpenChange = () => {},
    onConnect = () => {}
  } = $props<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConnect?: (profile: ConnectionProfile) => void;
  }>();

  type Screen = 'list' | 'wizard';
  let currentScreen = $state<Screen>('list');
  let editingProfile = $state<ConnectionProfile | null>(null);

  function handleAdd() {
    editingProfile = null;
    currentScreen = 'wizard';
  }

  function handleEdit(profile: ConnectionProfile) {
    editingProfile = profile;
    currentScreen = 'wizard';
  }

  function handleWizardCancel() {
    currentScreen = 'list';
  }

  function handleWizardSave() {
    currentScreen = 'list';
  }

  function handleConnect(profile: ConnectionProfile) {
    onConnect(profile);
    onOpenChange(false);
  }

  // Reset screen when dialog opens
  $effect(() => {
    if (open) {
      currentScreen = 'list';
    }
  });
</script>

<Dialog.Root {open} {onOpenChange}>
  <Dialog.Content class="sm:max-w-[600px] h-[80vh] max-h-[800px] flex flex-col">
    {#if currentScreen === 'list'}
      <ProfileList 
        onAdd={handleAdd} 
        onEdit={handleEdit} 
        onConnect={handleConnect} 
      />
    {:else}
      <ConnectionWizard 
        profile={editingProfile} 
        onCancel={handleWizardCancel} 
        onSave={handleWizardSave} 
        onConnect={handleConnect} 
      />
    {/if}
  </Dialog.Content>
</Dialog.Root>
