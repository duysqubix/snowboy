<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import * as Select from '$lib/components/ui/select';
  import { profiles } from '../stores/profiles.svelte';
  import { normalizeAccountUrl, validateProfile } from './validation';
  import type { ConnectionProfile, AuthMethod } from '../../../main/types';
  import { toast } from 'svelte-sonner';

  import { untrack } from 'svelte';

  let {
    profile = null,
    onCancel = () => {},
    onSave = () => {},
    onConnect = () => {}
  } = $props<{
    profile?: ConnectionProfile | null;
    onCancel?: () => void;
    onSave?: () => void;
    onConnect?: (profile: ConnectionProfile) => void;
  }>();

  let name = $state(untrack(() => profile?.name || ''));
  let accountUrl = $state(untrack(() => profile?.accountUrl || ''));
  let authMethod = $state<AuthMethod>(untrack(() => profile?.authMethod || 'externalbrowser'));
  let username = $state(untrack(() => profile?.username || ''));
  let defaultRole = $state(untrack(() => profile?.defaultRole || ''));
  let defaultWarehouse = $state(untrack(() => profile?.defaultWarehouse || ''));
  let defaultDatabase = $state(untrack(() => profile?.defaultDatabase || ''));
  let defaultSchema = $state(untrack(() => profile?.defaultSchema || ''));

  let isTesting = $state(false);

  let currentInput = $derived({
    name,
    accountUrl: normalizeAccountUrl(accountUrl),
    authMethod,
    username,
    defaultRole,
    defaultWarehouse,
    defaultDatabase,
    defaultSchema
  });

  let errors = $derived(validateProfile(currentInput));
  let isValid = $derived(errors.length === 0);

  function getError(field: string): string | undefined {
    return errors.find(e => e.field === field)?.message;
  }

  async function handleSave() {
    if (!isValid) return;

    try {
      if (profile) {
        await profiles.update(profile.id, currentInput);
      } else {
        await profiles.add(currentInput);
      }
      onSave();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save profile');
    }
  }

  async function handleSaveAndConnect() {
    if (!isValid) return;

    let savedProfile: ConnectionProfile;
    try {
      if (profile) {
        await profiles.update(profile.id, currentInput);
        const found = profiles.list.find(p => p.id === profile!.id);
        if (!found) {
          toast.error('Saved profile vanished after refresh');
          return;
        }
        savedProfile = found;
      } else {
        savedProfile = await profiles.add(currentInput);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save profile');
      return;
    }

    isTesting = true;
    try {
      const result = await profiles.test(savedProfile.id);
      if (result.ok) {
        onConnect(savedProfile);
      } else {
        toast.error(result.message || 'Connection failed');
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      isTesting = false;
    }
  }

  const authOptions = [
    { value: 'externalbrowser', label: 'SSO (External Browser)' },
    { value: 'password_mfa', label: 'Password + MFA' },
    { value: 'password', label: 'Password' }
  ];

  let selectedAuthOption = $derived(authOptions.find(o => o.value === authMethod) || authOptions[0]);
</script>

<div class="flex flex-col h-full">
  <div class="pb-4">
    <h2 class="text-lg font-semibold">{profile ? 'Edit Profile' : 'Add New Profile'}</h2>
  </div>

  <div class="flex-1 overflow-y-auto py-4 space-y-4 pr-2">
    <div class="space-y-2">
      <Label for="name">Name *</Label>
      <Input id="name" bind:value={name} placeholder="My Connection" />
      {#if getError('name')}
        <p class="text-xs text-destructive">{getError('name')}</p>
      {/if}
    </div>

    <div class="space-y-2">
      <Label for="accountUrl">Account URL *</Label>
      <Input id="accountUrl" bind:value={accountUrl} placeholder="account.region.snowflakecomputing.com" />
      {#if getError('accountUrl')}
        <p class="text-xs text-destructive">{getError('accountUrl')}</p>
      {/if}
    </div>

    <div class="space-y-2">
      <Label for="authMethod">Auth Method *</Label>
      <Select.Root
        type="single"
        value={authMethod}
        onValueChange={(v) => {
          if (v) authMethod = v as AuthMethod;
        }}
      >
        <Select.Trigger id="authMethod">
          {selectedAuthOption?.label || 'Select auth method'}
        </Select.Trigger>
        <Select.Content>
          {#each authOptions as option (option.value)}
            <Select.Item value={option.value}>{option.label}</Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
      {#if getError('authMethod')}
        <p class="text-xs text-destructive">{getError('authMethod')}</p>
      {/if}
    </div>

    <div class="space-y-2">
      <Label for="username">Username *</Label>
      <Input id="username" bind:value={username} placeholder="user@example.com" />
      {#if getError('username')}
        <p class="text-xs text-destructive">{getError('username')}</p>
      {/if}
    </div>

    <div class="grid grid-cols-2 gap-4">
      <div class="space-y-2">
        <Label for="defaultRole">Default Role</Label>
        <Input id="defaultRole" bind:value={defaultRole} placeholder="Optional" />
      </div>
      <div class="space-y-2">
        <Label for="defaultWarehouse">Default Warehouse</Label>
        <Input id="defaultWarehouse" bind:value={defaultWarehouse} placeholder="Optional" />
      </div>
      <div class="space-y-2">
        <Label for="defaultDatabase">Default Database</Label>
        <Input id="defaultDatabase" bind:value={defaultDatabase} placeholder="Optional" />
      </div>
      <div class="space-y-2">
        <Label for="defaultSchema">Default Schema</Label>
        <Input id="defaultSchema" bind:value={defaultSchema} placeholder="Optional" />
      </div>
    </div>
  </div>

  <div class="flex items-center justify-end gap-2 pt-4 border-t mt-auto">
    <Button variant="outline" onclick={onCancel} disabled={isTesting}>Cancel</Button>
    <Button variant="secondary" onclick={handleSave} disabled={!isValid || isTesting}>Save</Button>
    <Button onclick={handleSaveAndConnect} disabled={!isValid || isTesting}>
      {isTesting ? 'Connecting...' : 'Save & Connect'}
    </Button>
  </div>
</div>
