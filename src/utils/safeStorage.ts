// Safe localStorage proxy helper to guard against SecurityError in sandbox/iframes where localStorage is restricted
const createSafeStorage = () => {
  // In-memory fallback dictionary
  const fallbackStore: Record<string, string> = {};

  // Check if localStorage is fully accessible
  let isSupported = false;
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      // Test writing and reading
      const testKey = "__storage_test__";
      window.localStorage.setItem(testKey, "1");
      const readVal = window.localStorage.getItem(testKey);
      window.localStorage.removeItem(testKey);
      if (readVal === "1") {
        isSupported = true;
      }
    }
  } catch (e) {
    console.warn("localStorage is not accessible in this context. Falling back to secure in-memory storage.", e);
    isSupported = false;
  }

  return {
    getItem(key: string): string | null {
      if (isSupported) {
        try {
          return window.localStorage.getItem(key);
        } catch (e) {
          console.warn(`safeLocalStorage.getItem failed for key: ${key}`, e);
        }
      }
      return key in fallbackStore ? fallbackStore[key] : null;
    },

    setItem(key: string, value: string): void {
      if (isSupported) {
        try {
          window.localStorage.setItem(key, value);
          return;
        } catch (e) {
          console.warn(`safeLocalStorage.setItem failed for key: ${key}`, e);
        }
      }
      fallbackStore[key] = String(value);
    },

    removeItem(key: string): void {
      if (isSupported) {
        try {
          window.localStorage.removeItem(key);
          return;
        } catch (e) {
          console.warn(`safeLocalStorage.removeItem failed for key: ${key}`, e);
        }
      }
      delete fallbackStore[key];
    },

    clear(): void {
      if (isSupported) {
        try {
          window.localStorage.clear();
          return;
        } catch (e) {
          console.warn("safeLocalStorage.clear failed", e);
        }
      }
      for (const key of Object.keys(fallbackStore)) {
        delete fallbackStore[key];
      }
    },

    isSupported(): boolean {
      return isSupported;
    }
  };
};

export const safeLocalStorage = createSafeStorage();
