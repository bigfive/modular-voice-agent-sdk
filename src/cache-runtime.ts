/**
 * Runtime Model Cache - Browser-safe
 *
 * In-memory cache for loaded models/resources.
 * Backends use this to share heavy resources (models, tokenizers) across sessions.
 * The cache is keyed by a unique string identifier (e.g., "transformers-llm:model-name:dtype").
 *
 * This module has NO Node.js dependencies and works in both browser and server.
 */

const runtimeCache = new Map<string, unknown>();

/**
 * Get a cached resource, or load it if not cached.
 * @param key - Unique cache key
 * @param loader - Async function to load the resource if not cached
 * @returns The cached or newly loaded resource
 */
export async function getCachedOrLoad<T>(key: string, loader: () => Promise<T>): Promise<T> {
  if (runtimeCache.has(key)) {
    return runtimeCache.get(key) as T;
  }
  const resource = await loader();
  runtimeCache.set(key, resource);
  return resource;
}

/**
 * Check if a resource is in the cache.
 */
export function isCached(key: string): boolean {
  return runtimeCache.has(key);
}

/**
 * Clear a specific cached resource.
 */
export function clearCached(key: string): void {
  runtimeCache.delete(key);
}

/**
 * Clear all cached resources.
 */
export function clearAllCached(): void {
  runtimeCache.clear();
}

