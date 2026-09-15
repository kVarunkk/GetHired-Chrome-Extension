// MV3 service workers have no localStorage/window, and popups close on blur,
// so we persist the Supabase session in chrome.storage.local instead.
// This adapter is passed into createClient() as `auth.storage`.

export const chromeStorageAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    const result = await chrome.storage.local.get(key);
    return (result[key] as string | undefined) ?? null;
  },
  setItem: async (key: string, value: string): Promise<void> => {
    await chrome.storage.local.set({ [key]: value });
  },
  removeItem: async (key: string): Promise<void> => {
    await chrome.storage.local.remove(key);
  },
};
