import { nanoid } from 'nanoid';
import type { ConnectionProfile, TestResult } from '../../../main/types';
import { snowboy } from '../ipc/client';

type ProfileInput = Omit<ConnectionProfile, 'id' | 'createdAt' | 'updatedAt'>;

class ProfilesStore {
  #profiles = $state<ConnectionProfile[]>([]);
  #activeProfileId = $state<string | null>(null);

  get list() {
    return this.#profiles;
  }

  get activeProfileId() {
    return this.#activeProfileId;
  }

  async refresh(): Promise<void> {
    const fresh = await snowboy.connections.listProfiles();
    this.#profiles = fresh;
    if (
      this.#activeProfileId !== null &&
      !fresh.some((p) => p.id === this.#activeProfileId)
    ) {
      this.#activeProfileId = null;
    }
  }

  async add(input: ProfileInput): Promise<ConnectionProfile> {
    const now = Date.now();
    const newProfile: ConnectionProfile = {
      ...input,
      id: nanoid(),
      createdAt: now,
      updatedAt: now
    };
    await snowboy.connections.saveProfile(newProfile);
    await this.refresh();
    const saved = this.#profiles.find((p) => p.id === newProfile.id);
    if (!saved) {
      throw new Error(`Saved profile ${newProfile.id} missing after refresh`);
    }
    return saved;
  }

  async update(id: string, patch: Partial<ConnectionProfile>): Promise<void> {
    const existing = this.#profiles.find((p) => p.id === id);
    if (!existing) {
      throw new Error(`No profile with id=${id}`);
    }
    const updated: ConnectionProfile = {
      ...existing,
      ...patch,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: Date.now()
    };
    await snowboy.connections.saveProfile(updated);
    await this.refresh();
  }

  async remove(id: string): Promise<void> {
    await snowboy.connections.deleteProfile(id);
    if (this.#activeProfileId === id) {
      this.#activeProfileId = null;
    }
    await this.refresh();
  }

  setActive(id: string | null): void {
    this.#activeProfileId = id;
  }

  async test(id: string): Promise<TestResult> {
    try {
      return await snowboy.connections.test(id);
    } catch (err: unknown) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err)
      };
    }
  }

  async setPassword(id: string, password: string): Promise<void> {
    await snowboy.connections.setPassword(id, password);
  }

  async clearPassword(id: string): Promise<void> {
    await snowboy.connections.clearPassword(id);
  }

  async hasPassword(id: string): Promise<boolean> {
    return await snowboy.connections.hasPassword(id);
  }
}

export const profiles = new ProfilesStore();

void profiles.refresh().catch((err: unknown) => {
  console.error('[profiles] initial load failed:', err);
});
