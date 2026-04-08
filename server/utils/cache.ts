type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

const MAX_CACHE_SIZE = 500;
const cache = new Map<string, CacheEntry>();

const evictExpired = () => {
  const now = Date.now();
  const keys = Array.from(cache.keys());
  for (let i = 0; i < keys.length; i++) {
    const entry = cache.get(keys[i]);
    if (entry && now > entry.expiresAt) {
      cache.delete(keys[i]);
    }
  }
};

export const getCache = <T>(key: string): T | null => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  // Move to end for LRU ordering (Map preserves insertion order)
  cache.delete(key);
  cache.set(key, entry);
  return entry.value as T;
};

export const setCache = (key: string, value: unknown, ttlMs: number) => {
  if (cache.has(key)) {
    cache.delete(key);
  } else if (cache.size >= MAX_CACHE_SIZE) {
    evictExpired();
    if (cache.size >= MAX_CACHE_SIZE) {
      // Evict oldest entry (first key in Map iteration order)
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  }
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
};

export const buildCacheKey = (parts: Array<string | number | undefined | null>) => {
  return parts.filter(Boolean).join('|');
};
