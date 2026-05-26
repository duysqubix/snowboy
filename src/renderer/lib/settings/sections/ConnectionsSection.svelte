<script lang="ts">
  import ProfileList from '../../connections/ProfileList.svelte';
  import ConnectionWizard from '../../connections/ConnectionWizard.svelte';
  import type { ConnectionProfile } from '../../../../main/types';

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

  function handleConnect() {
    // ProfileList handles the actual connection logic via sessions store
    // We just need to switch back to list if we were in wizard
    currentScreen = 'list';
  }
</script>

<div class="h-full flex flex-col">
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
</div>
