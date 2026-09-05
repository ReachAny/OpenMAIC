'use client';

import { useEffect } from 'react';
import { useSettingsStore } from '@/lib/store/settings';

/**
 * Fetches server-configured providers on mount and merges into settings store.
 * Renders nothing — purely a side-effect component.
 */
export function ServerProvidersInit() {
  const fetchServerProviders = useSettingsStore((state) => state.fetchServerProviders);

  useEffect(() => {
    let active = true;
    void (async () => {
      // Hydration can race this mount effect. Wait for persisted settings to
      // settle before applying the authoritative catalog, otherwise a stale
      // persisted `isServerConfigured` flag could overwrite a fail-closed
      // response.
      await useSettingsStore.persist.rehydrate();
      if (active) await fetchServerProviders();
    })();
    return () => {
      active = false;
    };
  }, [fetchServerProviders]);

  return null;
}
