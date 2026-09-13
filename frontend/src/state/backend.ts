import { create } from 'zustand';
import type { BackendHealth } from '@app/types';
import { apiUrl } from '../lib/backend';

/** 'blocked': the server answers but does not allow this site (ALLOWED_ORIGINS). */
export type BackendStatus = 'checking' | 'ok' | 'down' | 'blocked';

interface BackendStore {
  status: BackendStatus;
  health?: BackendHealth;
  check: () => Promise<void>;
}

/** What the backend reports at /v1/health; checked on load and on Retry. */
const useBackend = create<BackendStore>((set) => ({
  status: 'checking',
  check: async () => {
    set({ status: 'checking' });
    try {
      // Under /v1 so the Vite dev proxy forwards it; a plain /health would be answered by Vite itself.
      const response = await fetch(apiUrl('/v1/health'), { cache: 'no-store' });
      const data = response.ok ? await response.json().catch(() => null) as BackendHealth | null : null;
      if (data?.status !== 'ok') { set({ status: 'down', health: undefined }); return; }
      set({ status: data.originAllowed === false ? 'blocked' : 'ok', health: data });
    } catch {
      set({ status: 'down', health: undefined });
    }
  },
}));

export default useBackend;
