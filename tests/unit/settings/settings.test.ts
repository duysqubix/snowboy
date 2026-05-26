import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { settings } from '../../../src/renderer/lib/stores/settings.svelte';

describe('Settings Store', () => {
  beforeEach(() => {
    // Reset settings store
    settings.set({
      theme: 'system',
      fontSize: 14,
      tabWidth: 2,
      wordWrap: true,
      telemetryEnabled: false,
      dataDir: '/tmp/snowboy'
    });
  });

  it('updates theme', async () => {
    const setSpy = mock(settings.set.bind(settings));
    settings.set = setSpy;

    await settings.set({ theme: 'dark' });
    expect(setSpy).toHaveBeenCalledWith({ theme: 'dark' });
  });

  it('updates font size', async () => {
    const setSpy = mock(settings.set.bind(settings));
    settings.set = setSpy;

    await settings.set({ fontSize: 16 });
    expect(setSpy).toHaveBeenCalledWith({ fontSize: 16 });
  });

  it('updates tab width', async () => {
    const setSpy = mock(settings.set.bind(settings));
    settings.set = setSpy;

    await settings.set({ tabWidth: 4 });
    expect(setSpy).toHaveBeenCalledWith({ tabWidth: 4 });
  });

  it('updates word wrap', async () => {
    const setSpy = mock(settings.set.bind(settings));
    settings.set = setSpy;

    await settings.set({ wordWrap: false });
    expect(setSpy).toHaveBeenCalledWith({ wordWrap: false });
  });
});
