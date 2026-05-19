<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';

  let {
    open = false,
    profileName = '',
    onOpenChange = () => {},
    onSubmit
  }: {
    open: boolean;
    profileName?: string;
    onOpenChange: (v: boolean) => void;
    onSubmit: (passcode: string) => void;
  } = $props();

  let code = $state('');
  let submitting = $state(false);

  $effect(() => {
    if (open) {
      code = '';
      submitting = false;
    }
  });

  async function handleSubmit(): Promise<void> {
    if (code.trim().length === 0 || submitting) return;
    submitting = true;
    try {
      onSubmit(code.trim());
    } finally {
      submitting = false;
    }
  }

  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleSubmit();
    }
  }
</script>

<Dialog.Root {open} {onOpenChange}>
  <Dialog.Content class="sm:max-w-[420px]">
    <Dialog.Header>
      <Dialog.Title>Enter MFA code</Dialog.Title>
      <Dialog.Description>
        {profileName
          ? `${profileName} requires a 6-digit code from your authenticator app.`
          : 'Enter the 6-digit code from your authenticator app.'}
      </Dialog.Description>
    </Dialog.Header>

    <div class="space-y-2">
      <Label for="mfa-code">Authenticator code</Label>
      <Input
        id="mfa-code"
        type="text"
        inputmode="numeric"
        autocomplete="one-time-code"
        maxlength={10}
        bind:value={code}
        onkeydown={handleKeyDown}
        placeholder="123456"
      />
    </div>

    <div class="flex justify-end gap-2 pt-2">
      <Button variant="outline" size="sm" onclick={() => onOpenChange(false)} disabled={submitting}>
        Cancel
      </Button>
      <Button
        size="sm"
        onclick={handleSubmit}
        disabled={code.trim().length === 0 || submitting}
      >
        {submitting ? 'Connecting…' : 'Connect'}
      </Button>
    </div>
  </Dialog.Content>
</Dialog.Root>
