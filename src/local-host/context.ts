import type { ExtensionSite, ExtensionStorageArea } from '../runtime.js';

/** Local published-site simulation. Typeroll owns preview routing and storage. */
export function createSite(origin: string, navigate: (url: string) => void): ExtensionSite {
  function url(pathInput: string): string {
    const path = String(pathInput || '/');
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
      throw new Error('Extension site paths must be root-relative');
    }
    return new URL(path, origin).href;
  }
  return { url, navigate: (path) => navigate(url(path)) };
}

export function createStorageArea(
  store: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  installationId: string,
): ExtensionStorageArea {
  function storageKey(value: string): string {
    const key = String(value || '');
    if (!key || key.length > 128) {
      throw new Error('Extension storage keys must contain 1-128 characters');
    }
    return `typeroll:extension:${installationId}:${key}`;
  }
  return {
    get(key) {
      const raw = store.getItem(storageKey(key));
      if (raw === null) return undefined;
      try { return JSON.parse(raw); } catch { return undefined; }
    },
    set(key, value) {
      const namespacedKey = storageKey(key);
      const encoded = JSON.stringify(value);
      if (encoded === undefined) throw new Error('Extension storage values must be JSON-compatible');
      if (encoded.length > 65536) throw new Error('Extension storage values may not exceed 64 KiB');
      store.setItem(namespacedKey, encoded);
    },
    remove(key) { store.removeItem(storageKey(key)); },
  };
}
