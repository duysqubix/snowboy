<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import * as Select from '$lib/components/ui/select';
  import { snowboy } from '../ipc/client';
  import { profiles } from '../stores/profiles.svelte';
  import { sessions } from '../stores/sessions.svelte';
  import { normalizeAccountUrl, validateProfile } from './validation';
  import { passphraseAction } from './keyPair';
  import type { ConnectionProfile, AuthMethod, PrivateKeyCheck } from '../../../main/types';
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
  let privateKeyPath = $state(untrack(() => profile?.privateKeyPath || ''));
  let passphrase = $state('');
  let hasStoredPassphrase = $state(false);
  let keyCheck = $state<PrivateKeyCheck | null>(null);
  let isPickingKey = $state(false);
  // Set once the profile is in storage (edit mode, or after the first save in
  // add mode), so a retry updates that profile instead of adding another.
  let savedId = $state<string | null>(untrack(() => profile?.id ?? null));
  let isSaving = $state(false);
  // Numbers key checks so a slow, older result can't replace a newer one.
  let keyCheckSeq = 0;
  let defaultRole = $state(untrack(() => profile?.defaultRole || ''));
  let defaultWarehouse = $state(untrack(() => profile?.defaultWarehouse || ''));
  let defaultDatabase = $state(untrack(() => profile?.defaultDatabase || ''));
  let defaultSchema = $state(untrack(() => profile?.defaultSchema || ''));

  let isTesting = $state(false);

  let needsPassword = $derived(
    authMethod === 'password' || authMethod === 'password_mfa' || authMethod === 'pat'
  );
  let needsPasscode = $derived(authMethod === 'password_mfa');
  let isPat = $derived(authMethod === 'pat');
  let secretLabel = $derived(isPat ? 'Personal Access Token' : 'Password');
  let isKeyPair = $derived(authMethod === 'keypair');

  onMount(async () => {
    if (
      profile &&
      (profile.authMethod === 'password' ||
        profile.authMethod === 'password_mfa' ||
        profile.authMethod === 'pat')
    ) {
      try {
        hasExistingPassword = await profiles.hasPassword(profile.id);
      } catch {
        hasExistingPassword = false;
      }
    }
    if (profile && profile.authMethod === 'keypair') {
      try {
        hasStoredPassphrase = await snowboy.connections.hasPrivateKeyPassphrase(profile.id);
      } catch {
        hasStoredPassphrase = false;
      }
      try {
        await refreshKeyCheck();
      } catch {
        keyCheck = null;
      }
    }
  });

  let currentInput = $derived({
    name,
    accountUrl: normalizeAccountUrl(accountUrl),
    authMethod,
    username,
    privateKeyPath: isKeyPair ? privateKeyPath : undefined,
    defaultRole,
    defaultWarehouse,
    defaultDatabase,
    defaultSchema
  });

  let baseErrors = $derived(validateProfile(currentInput));
  let passwordError = $derived(
    needsPassword && savedId === null && password.trim().length === 0
      ? `${secretLabel} is required`
      : needsPassword && savedId !== null && !hasExistingPassword && password.trim().length === 0
        ? `No ${secretLabel} stored — enter one to enable this profile`
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
      // Saving under a method without a password deletes the stored one in main.
      hasExistingPassword = false;
      return;
    }
    if (password.trim().length > 0) {
      await profiles.setPassword(profileId, password);
      hasExistingPassword = true;
      password = '';
    }
  }

  /**
   * Parses the chosen key in main with the typed passphrase or, when
   * editing, the stored one (which never comes back to the renderer).
   */
  async function refreshKeyCheck(): Promise<PrivateKeyCheck | null> {
    const seq = ++keyCheckSeq;
    if (privateKeyPath === '') {
      keyCheck = null;
      return null;
    }
    const result = await snowboy.connections.checkPrivateKey(
      privateKeyPath,
      passphrase.length > 0 ? passphrase : undefined,
      savedId ?? undefined
    );
    if (seq === keyCheckSeq) keyCheck = result;
    return result;
  }

  async function handlePickKey() {
    isPickingKey = true;
    try {
      const picked = await snowboy.connections.pickPrivateKeyFile();
      if (picked !== null) {
        privateKeyPath = picked;
        await refreshKeyCheck();
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not open the private key file');
    } finally {
      isPickingKey = false;
    }
  }

  // Re-checks with an emptied field too, so the status falls back to the
  // stored passphrase (or asks for one) instead of going stale.
  async function handlePassphraseBlur() {
    if (privateKeyPath === '') return;
    try {
      await refreshKeyCheck();
    } catch {
      // Save checks the key again and reports any failure.
    }
  }

  async function persistKeyPassphrase(
    profileId: string,
    check: PrivateKeyCheck | null
  ): Promise<void> {
    const action = passphraseAction(check, passphrase, hasStoredPassphrase);
    if (action === 'store') {
      await snowboy.connections.setPrivateKeyPassphrase(profileId, passphrase);
      hasStoredPassphrase = true;
    } else if (action === 'clear') {
      await snowboy.connections.clearPrivateKeyPassphrase(profileId);
      hasStoredPassphrase = false;
    }
  }

  async function persistProfileAndSecrets(): Promise<ConnectionProfile> {
    isSaving = true;
    try {
      // Refuse to save a key that doesn't parse with its passphrase.
      const check = isKeyPair ? await refreshKeyCheck() : null;
      if (check !== null && !check.ok) {
        throw new Error(check.message);
      }
      let savedProfile: ConnectionProfile;
      if (savedId !== null) {
        const id = savedId;
        await profiles.update(id, currentInput);
        const found = profiles.list.find((p) => p.id === id);
        if (!found) {
          throw new Error('Saved profile vanished after refresh');
        }
        savedProfile = found;
      } else {
        savedProfile = await profiles.add(currentInput);
        savedId = savedProfile.id;
      }
      await persistPasswordIfPresent(savedProfile.id);
      await persistKeyPassphrase(savedProfile.id, check);
      return savedProfile;
    } finally {
      // The passphrase lives in the secrets store now (or was rejected);
      // don't keep it in component state either way.
      passphrase = '';
      isSaving = false;
    }
  }

  async function handleSave() {
    if (!isValid || isSaving) return;

    try {
      await persistProfileAndSecrets();
      onSave();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save profile');
    }
  }

  async function handleSaveAndTest() {
    if (!isValid || isSaving) return;
    if (needsPasscode && passcode.trim().length === 0) {
      toast.error('Enter the 6-digit MFA code from your authenticator app');
      return;
    }

    let savedProfile: ConnectionProfile;
    try {
      savedProfile = await persistProfileAndSecrets();
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
    if (!isValid || isSaving) return;
    if (needsPasscode && passcode.trim().length === 0) {
      toast.error('Enter the 6-digit MFA code from your authenticator app');
      return;
    }

    let savedProfile: ConnectionProfile;
    try {
      savedProfile = await persistProfileAndSecrets();
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
    { value: 'password', label: 'Password' },
    { value: 'pat', label: 'Personal Access Token (PAT)' },
    { value: 'keypair', label: 'Key pair (private key file)' }
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
        <div class="flex items-center justify-between gap-2">
          <Label for="password">{secretLabel} *</Label>
          {#if isPat}
            <a
              href="https://docs.snowflake.com/en/user-guide/programmatic-access-tokens"
              target="_blank"
              rel="noopener noreferrer"
              class="text-xs text-primary hover:underline"
              title="How to create a PAT in Snowflake"
            >
              How to create a PAT ↗
            </a>
          {/if}
        </div>
        <Input
          id="password"
          type="password"
          bind:value={password}
          placeholder={hasExistingPassword
            ? `Leave blank to keep the stored ${secretLabel}`
            : isPat
              ? 'Paste your Snowflake PAT'
              : 'Snowflake account password'}
          autocomplete={isPat ? 'off' : 'current-password'}
        />
        {#if savedId !== null && hasExistingPassword}
          <p class="text-xs text-muted-foreground">
            A {secretLabel} is already stored for this profile. Type a new one to replace it.
          </p>
        {/if}
        {#if isPat}
          <p class="text-xs text-muted-foreground">
            PATs bypass MFA and persist across launches. The PAT's bound role is used
            automatically — the Default Role field below is ignored for PAT profiles.
          </p>
        {/if}
        {#if getError('password')}
          <p class="text-xs text-destructive">{getError('password')}</p>
        {/if}
      </div>
    {/if}

    {#if isKeyPair}
      <div class="space-y-2">
        <div class="flex items-center justify-between gap-2">
          <Label for="privateKeyPath">Private key file *</Label>
          <a
            href="https://docs.snowflake.com/en/user-guide/key-pair-auth"
            target="_blank"
            rel="noopener noreferrer"
            class="text-xs text-primary hover:underline"
            title="How to set up key-pair authentication in Snowflake"
          >
            How to set up key-pair auth ↗
          </a>
        </div>
        <div class="flex items-center gap-2">
          <Input
            id="privateKeyPath"
            value={privateKeyPath}
            readonly
            placeholder="No file chosen"
            title={privateKeyPath}
            class="font-mono text-xs"
          />
          <Button
            variant="outline"
            class="shrink-0"
            onclick={handlePickKey}
            disabled={isPickingKey || isTesting || isSaving}
          >
            Browse…
          </Button>
        </div>
        {#if getError('privateKeyPath')}
          <p class="text-xs text-destructive">{getError('privateKeyPath')}</p>
        {:else if keyCheck?.ok}
          <p class="text-xs text-muted-foreground">
            {keyCheck.encrypted ? 'Encrypted' : 'Unencrypted'} RSA key. Public key fingerprint:
            <span class="break-all font-mono">{keyCheck.fingerprint}</span>
          </p>
        {:else if keyCheck && !keyCheck.ok}
          <p
            class="text-xs {keyCheck.problem === 'passphrase_required'
              ? 'text-muted-foreground'
              : 'text-destructive'}"
          >
            {keyCheck.message}
          </p>
        {/if}
      </div>

      <div class="space-y-2">
        <Label for="passphrase">Key passphrase</Label>
        <Input
          id="passphrase"
          type="password"
          bind:value={passphrase}
          onblur={handlePassphraseBlur}
          placeholder={hasStoredPassphrase
            ? 'Leave blank to keep the stored passphrase'
            : 'Only if the key is encrypted'}
          autocomplete="off"
        />
        {#if savedId !== null && hasStoredPassphrase}
          <p class="text-xs text-muted-foreground">
            A passphrase is stored for this profile. Type a new one to replace it.
          </p>
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
      {#if !isPat}
        <div class="space-y-2">
          <Label for="defaultRole">Default Role</Label>
          <Input id="defaultRole" bind:value={defaultRole} placeholder="Optional" />
        </div>
      {/if}
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
    <Button variant="outline" onclick={onCancel} disabled={isTesting || isSaving}>Cancel</Button>
    <Button variant="secondary" onclick={handleSave} disabled={!isValid || isTesting || isSaving}>
      Save
    </Button>
    <Button
      variant="outline"
      onclick={handleSaveAndTest}
      disabled={!isValid || isTesting || isSaving}
    >
      {isTesting ? 'Testing...' : 'Save & Test'}
    </Button>
    <Button onclick={handleSaveAndConnect} disabled={!isValid || isTesting || isSaving}>
      {isTesting ? 'Connecting...' : 'Save & Connect'}
    </Button>
  </div>
</div>
