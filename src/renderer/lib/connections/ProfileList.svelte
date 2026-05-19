<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Separator } from '$lib/components/ui/separator';
  import { toast } from 'svelte-sonner';
  import { profiles } from '../stores/profiles.svelte';
  import { sessions } from '../stores/sessions.svelte';
  import type { ConnectionProfile } from '../../../main/types';
  import { Trash2 } from 'lucide-svelte';
  import MfaPromptDialog from './MfaPromptDialog.svelte';

  let {
    onAdd = () => {},
    onEdit = () => {},
    onConnect = () => {}
  } = $props<{
    onAdd?: () => void;
    onEdit?: (profile: ConnectionProfile) => void;
    onConnect?: (profile: ConnectionProfile) => void;
  }>();

  let mfaOpen = $state(false);
  let mfaProfile = $state<ConnectionProfile | null>(null);

  function formatAuthMethod(method: string) {
    switch (method) {
      case 'externalbrowser': return 'SSO';
      case 'password_mfa': return 'PW+MFA';
      case 'password': return 'PW';
      default: return method;
    }
  }

  async function handleConnectClick(profile: ConnectionProfile): Promise<void> {
    if (profile.authMethod === 'password_mfa') {
      mfaProfile = profile;
      mfaOpen = true;
      return;
    }
    onConnect(profile);
  }

  async function handleMfaSubmit(passcode: string): Promise<void> {
    if (!mfaProfile) return;
    const profile = mfaProfile;
    try {
      await sessions.openWithPasscode(profile.id, passcode);
      mfaOpen = false;
      mfaProfile = null;
      onConnect(profile);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Connection failed');
    }
  }
</script>

<MfaPromptDialog
  open={mfaOpen}
  profileName={mfaProfile?.name ?? ''}
  onOpenChange={(v) => {
    mfaOpen = v;
    if (!v) mfaProfile = null;
  }}
  onSubmit={(code) => {
    void handleMfaSubmit(code);
  }}
/>

<div class="flex flex-col h-full">
  <div class="flex items-center justify-between pb-4">
    <h2 class="text-lg font-semibold">Connection Profiles</h2>
    <Button onclick={onAdd} size="sm">+ Add new</Button>
  </div>

  <Separator />

  <div class="flex-1 overflow-y-auto py-4">
    {#if profiles.list.length === 0}
      <div class="flex h-full items-center justify-center text-sm text-muted-foreground">
        No profiles yet. Click 'Add new'.
      </div>
    {:else}
      <div class="flex flex-col gap-2">
        {#each profiles.list as profile (profile.id)}
          <div class="flex items-center justify-between rounded-lg border p-4 shadow-sm">
            <div class="flex flex-col gap-1">
              <div class="flex items-center gap-2">
                <span class="font-semibold">{profile.name}</span>
                <span class="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                  {formatAuthMethod(profile.authMethod)}
                </span>
              </div>
              <div class="text-sm text-muted-foreground">{profile.accountUrl}</div>
              {#if profile.defaultRole || profile.defaultWarehouse}
                <div class="text-xs text-muted-foreground">
                  {#if profile.defaultRole}Role: {profile.defaultRole}{/if}
                  {#if profile.defaultRole && profile.defaultWarehouse} &bull; {/if}
                  {#if profile.defaultWarehouse}WH: {profile.defaultWarehouse}{/if}
                </div>
              {/if}
            </div>
            <div class="flex items-center gap-2">
              <Button variant="ghost" size="sm" onclick={() => onEdit(profile)}>Edit</Button>
              <Button variant="ghost" size="icon" class="text-destructive hover:text-destructive hover:bg-destructive/10" onclick={() => profiles.remove(profile.id)}>
                <Trash2 class="h-4 w-4" />
              </Button>
              <Button size="sm" onclick={() => void handleConnectClick(profile)}>Connect</Button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
