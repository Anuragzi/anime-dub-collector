// ============================================================
// utils/hiAnimeCache.js
// Shared in-memory cache + sleep utility for HiAnime modules.
//
// WHY SHARED:
//   Both searchHiAnime.js and fetchHiAnime.js need the cache.
//   Putting it here means one Map instance is shared across
//   both files in the same Node.js process (module singleton).
//
// CACHE STRUCTURE:
//   titleCache : Map<string, string|null>
//     key   → normalized anime title (lowercase)
//     value → HiAnime ID string, or null if not found
//
//   episodeCache : Map<string, object|null>
//     key   → HiAnime ID string
//     value → { totalEpisodes, subEpisodes, dubEpisodes } or null
//
// TTL:
//   Cache entries expire after CACHE_TTL_MS (default: 4 hours).
//   This prevents stale dub counts from sitting forever while
//   still avoiding redundant API calls within a normal run.
// ============================================================

const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

// ============================================================
// ====== TITLE → HIANIME ID CACHE ============================
// ============================================================
const _titleStore   = new Map(); // key → { value, expiresAt }

const titleCache = {
  has(key) {
    const entry = _titleStore.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      _titleStore.delete(key);
      return false;
    }
    return true;
  },

  get(key) {
    const entry = _titleStore.get(key);
    if (!entry || Date.now() > entry.expiresAt) return undefined;
    return entry.value;
  },

  set(key, value) {
    _titleStore.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  },

  delete(key) { _titleStore.delete(key); },

  size() { return _titleStore.size; },

  clear() { _titleStore.clear(); },
};

// ============================================================
// ====== HIANIME ID → EPISODE COUNTS CACHE ===================
// ============================================================
const _episodeStore = new Map();

const episodeCache = {
  has(key) {
    const entry = _episodeStore.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      _episodeStore.delete(key);
      return false;
    }
    return true;
  },

  get(key) {
    const entry = _episodeStore.get(key);
    if (!entry || Date.now() > entry.expiresAt) return undefined;
    return entry.value;
  },

  set(key, value) {
    _episodeStore.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  },

  delete(key) { _episodeStore.delete(key); },

  size() { return _episodeStore.size; },

  clear() { _episodeStore.clear(); },
};

// ============================================================
// ====== SLEEP UTILITY =======================================
// Used by both modules for request delay + retry backoff.
// ============================================================
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// ====== CACHE STATS (for logging) ===========================
// ============================================================
function getCacheStats() {
  return {
    titleCacheSize:   titleCache.size(),
    episodeCacheSize: episodeCache.size(),
    ttlHours: CACHE_TTL_MS / 3600000,
  };
}

module.exports = { titleCache, episodeCache, sleep, getCacheStats };
