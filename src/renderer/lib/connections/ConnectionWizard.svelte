<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import * as Select from '$lib/components/ui/select';
  import { profiles } from '../stores/profiles.svelte';
  import { sessions } from '../stores/sessions.svelte';
  import { normalizeAccountUrl, validateProfile } from './validation';
  import type { ConnectionProfile, AuthMethod } from '../../../main/types';
  import { toast } from 'svelte-sonner';

  import { onMount, untrack } from 'svelte';

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
  let password = $state('');
  let passcode = $state('');
  let hasExistingPassword = $state(false);
  let defaultRole = $state(untrack(() => profile?.defaultRole || ''));
  let defaultWarehouse = $state(untrack(() => profile?.defaultWarehouse || ''));
  let defaultDatabase = $state(untrack(() => profile?.defaultDatabase || ''));
  let defaultSchema = $state(untrack(() => profile?.defaultSchema || ''));

  let isTesting = $state(false);

  let needsPassword = $derived(
    authMethod === 'password' || authMethod === 'password_mfa'
  );
  let needsPasscode = $derived(authMethod === 'password_mfa');

  onMount(async () => {
    if (profile && (profile.authMethod === 'password' || profile.authMethod === 'password_mfa')) {
      try {
        hasExistingPassword = await profiles.hasPassword(profile.id);
      } catch {
        hasExistingPassword = false;
      }
    }
  });

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

  let baseErrors = $derived(validateProfile(currentInput));
  let passwordError = $derived(
    needsPassword && !profile && password.trim().length === 0
      ? 'Password is required for password authentication'
      : needsPassword && profile && !hasExistingPassword && password.trim().length === 0
        ? 'No password stored — enter one to enable this profile'
        : undefined
  );
  let errors = $derived(
    passwordError !== undefined
      ? [...baseErrors, { field: 'password', message: passwordError }]
      : baseErrors
  );
  let isValid = $derived(errors.length === 0);

  function getError(field: string): string | undefined {
    return errors.find(e => e.field === field)?.message;
  }

  async function persistPasswordIfPresent(profileId: string): Promise<void> {
    if (!needsPassword) {
      return;
    }
    if (password.trim().length > 0) {
      await profiles.setPassword(profileId, password);
      hasExistingPassword = true;
      password = '';
    }
  }

  async function persistProfileAndPassword(): Promise<ConnectionProfile> {
    let savedProfile: ConnectionProfile;
    if (profile) {
      await profiles.update(profile.id, currentInput);
      const found = profiles.list.find((p) => p.id === profile!.id);
      if (!found) {
        throw new Error('Saved profile vanished after refresh');
      }
      savedProfile = found;
    } else {
      savedProfile = await profiles.add(currentInput);
    }
    await persistPasswordIfPresent(savedProfile.id);
    return savedProfile;
  }

  async function handleSave() {
    if (!isValid) return;

    try {
      await persistProfileAndPassword();
      onSave();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save profile');
    }
  }

  async function handleSaveAndTest() {
    if (!isValid) return;
    if (needsPasscode && passcode.trim().length === 0) {
      toast.error('Enter the 6-digit MFA code from your authenticator app');
      return;
    }

    let savedProfile: ConnectionProfile;
    try {
      savedProfile = await persistProfileAndPassword();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save profile');
      return;
    }

    isTesting = true;
    try {
      const result = await profiles.test(
        savedProfile.id,
        needsPasscode ? passcode.trim() : undefined
      );
      if (result.ok) {
        toast.success(`Connection OK${result.durationMs ? ` (${result.durationMs}ms)` : ''}`);
      } else {
        toast.error(result.message || 'Connection failed');
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      passcode = '';
      isTesting = false;
    }
  }

  async function handleSaveAndConnect() {
    if (!isValid) return;
    if (needsPasscode && passcode.trim().length === 0) {
      toast.error('Enter the 6-digit MFA code from your authenticator app');
      return;
    }

    let savedProfile: ConnectionProfile;
    try {
      savedProfile = await persistProfileAndPassword();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save profile');
      return;
    }

    isTesting = true;
    try {
      if (needsPasscode) {
        await sessions.openWithPasscode(savedProfile.id, passcode.trim());
      } else {
        const result = await profiles.test(savedProfile.id);
        if (!result.ok) {
          toast.error(result.message || 'Connection failed');
          return;
        }
      }
      profiles.setActive(savedProfile.id);
      onConnect(savedProfile);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      passcode = '';
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

    {#if needsPassword}
      <div class="space-y-2">
        <Label for="password">Password *</Label>
        <Input
          id="password"
          type="password"
          bind:value={password}
          placeholder={hasExistingPassword
            ? 'Leave blank to keep the stored password'
            : 'Snowflake account password'}
          autocomplete="current-password"
        />
        {#if profile && hasExistingPassword}
          <p class="text-xs text-muted-foreground">
            A password is already stored for this profile. Type a new one to replace it.
          </p>
        {/if}
        {#if getError('password')}
          <p class="text-xs text-destructive">{getError('password')}</p>
        {/if}
      </div>
    {/if}

    {#if needsPasscode}
      <div class="space-y-2">
        <Label for="passcode">MFA passcode</Label>
        <Input
          id="passcode"
          type="text"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength={10}
          bind:value={passcode}
          placeholder="6-digit code from your authenticator app"
        />
        <p class="text-xs text-muted-foreground">
          Required for <strong>Save & Test</strong> and <strong>Save & Connect</strong>. Single-use
          — you'll be asked again on every new sign-in.
        </p>
      </div>
    {/if}

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
    <Button variant="outline" onclick={handleSaveAndTest} disabled={!isValid || isTesting}>
      {isTesting ? 'Testing...' : 'Save & Test'}
    </Button>
    <Button onclick={handleSaveAndConnect} disabled={!isValid || isTesting}>
      {isTesting ? 'Connecting...' : 'Save & Connect'}
    </Button>
  </div>
</div>
