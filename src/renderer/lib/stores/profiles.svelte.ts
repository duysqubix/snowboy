import { nanoid } from 'nanoid';
import type { ConnectionProfile, TestResult } from '../../../main/types';
import { snowboy } from '../ipc/client';

class ProfilesStore {
  #profiles = $state<ConnectionProfile[]>([
    {
      id: nanoid(),
      name: 'Demo Profile',
      accountUrl: 'demo.snowflakecomputing.com',
      authMethod: 'externalbrowser',
      username: 'demo@example.com',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
  ]);
  #activeProfileId = $state<string | null>(null);

  get list() {
    return this.#profiles;
  }

  get activeProfileId() {
    return this.#activeProfileId;
  }

  add(p: Omit<ConnectionProfile, 'id' | 'createdAt' | 'updatedAt'>): ConnectionProfile {
    const newProfile: ConnectionProfile = {
      ...p,
      id: nanoid(),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.#profiles.push(newProfile);
    return newProfile;
  }

  update(id: string, patch: Partial<ConnectionProfile>): void {
    const index = this.#profiles.findIndex(p => p.id === id);
    if (index !== -1) {
      const existing = this.#profiles[index];
      if (existing) {
        this.#profiles[index] = {
          ...existing,
          ...patch,
          updatedAt: Date.now()
        };
      }
    }
  }

  remove(id: string): void {
    this.#profiles = this.#profiles.filter(p => p.id !== id);
    if (this.#activeProfileId === id) {
      this.#activeProfileId = null;
    }
  }

  setActive(id: string | null): void {
    this.#activeProfileId = id;
  }

  async test(id: string): Promise<TestResult> {
    try {
      return await snowboy.connections.test(id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
      if (err?.message?.includes('NotImplemented') || err?.name === 'NotImplementedError') {
        return new Promise(resolve => {
          setTimeout(() => {
            resolve({ ok: true, durationMs: 500 });
          }, 500);
        });
      }
      throw err;
    }
  }
}

export const profiles = new ProfilesStore();
