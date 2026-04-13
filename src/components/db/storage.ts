export function getStoredString(key: string, fallback: string) {
  if (typeof window === "undefined") return fallback;

  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function getStoredNumberInRange(
  key: string,
  fallback: number,
  min: number,
  max: number,
) {
  if (typeof window === "undefined") return fallback;

  try {
    const value = Number(localStorage.getItem(key));
    if (!Number.isFinite(value)) return fallback;
    return Math.min(Math.max(value, min), max);
  } catch {
    return fallback;
  }
}

export function getStoredJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;

  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function setStoredValue(key: string, value: string) {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage quota and privacy mode errors.
  }
}

export function removeStoredValues(keys: string[]) {
  if (typeof window === "undefined") return;

  keys.forEach((key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      // Ignore storage errors for each key independently.
    }
  });
}