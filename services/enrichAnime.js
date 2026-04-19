// ============================================================
// services/enrichAnime.js
// Merges AniList data with Firebase dub status data
// ============================================================

const { getDb } = require("../firebase");
const { getAnimeInfo } = require("./anilistService");

const DUB_DATA_COLLECTION = "dubData";
const CACHE_COLLECTION = "animeCache";

// In-memory cache for recent searches
const enrichCache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Get dub status from Firebase
 * @param {number} anilistId - AniList anime ID
 * @returns {Promise<object|null>} - Dub data or null
 */
async function getDubData(anilistId) {
  try {
    const db = getDb();
    const doc = await db.collection(DUB_DATA_COLLECTION).doc(String(anilistId)).get();
    
    if (doc.exists) {
      return doc.data();
    }
    return null;
  } catch (err) {
    console.error(`[Enrich] Failed to get dub data for ${anilistId}: ${err.message}`);
    return null;
  }
}

/**
 * Save dub status to Firebase
 * @param {number} anilistId - AniList anime ID
 * @param {object} dubData - Dub data to save
 */
async function saveDubData(anilistId, dubData) {
  try {
    const db = getDb();
    await db.collection(DUB_DATA_COLLECTION).doc(String(anilistId)).set({
      ...dubData,
      lastUpdated: Date.now()
    });
    return true;
  } catch (err) {
    console.error(`[Enrich] Failed to save dub data for ${anilistId}: ${err.message}`);
    return false;
  }
}

/**
 * Format dub status for display
 * @param {object} dubData - Dub data from Firebase
 * @param {number} totalEpisodes - Total episodes from AniList
 * @returns {string} - Formatted dub status string
 */
function formatDubStatus(dubData, totalEpisodes) {
  if (!dubData) {
    return "Dub status: Unknown";
  }

  const { dubEpisodes, dubAvailable, notes, lastUpdated } = dubData;
  
  if (!dubAvailable) {
    return "Dub Status: Not officially available";
  }

  let status = `Dub Status: ${dubEpisodes || "?"} / ${totalEpisodes || "?"} episodes`;
  
  if (notes) {
    status += ` (${notes})`;
  }

  return status;
}

/**
 * Get cached result if still valid
 * @param {string} title - Anime title
 */
function getCachedResult(title) {
  const cacheKey = title.toLowerCase().trim();
  const cached = enrichCache.get(cacheKey);
  
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.data;
  }
  
  return null;
}

/**
 * Cache the result
 * @param {string} title - Anime title
 * @param {object} data - Data to cache
 */
function cacheResult(title, data) {
  const cacheKey = title.toLowerCase().trim();
  enrichCache.set(cacheKey, {
    data: data,
    cachedAt: Date.now()
  });
}

/**
 * Main enrichment function
 * Fetches anime from AniList, merges with Firebase dub data
 * @param {string} title - Anime title to search
 * @returns {Promise<object>} - Enriched anime object
 */
async function enrichAnime(title) {
  if (!title) {
    return {
      found: false,
      error: "Title is required"
    };
  }

  // Check memory cache first
  const cached = getCachedResult(title);
  if (cached) {
    return {
      ...cached,
      fromCache: true
    };
  }

  // Fetch from AniList
  const anilistData = await getAnimeInfo(title);

  if (!anilistData.found) {
    return {
      found: false,
      title: title,
      error: "Anime not found"
    };
  }

  // Get dub data from Firebase
  const dubData = await getDubData(anilistData.anilistId);

  // Build enriched response
  const enriched = {
    found: true,
    // AniList data
    anilistId: anilistData.anilistId,
    title: anilistData.title,
    romajiTitle: anilistData.romajiTitle,
    englishTitle: anilistData.englishTitle,
    episodes: anilistData.episodes,
    status: anilistData.status,
    description: anilistData.description,
    coverImage: anilistData.coverImage,
    nextEpisode: anilistData.nextEpisode,
    format: anilistData.format,
    // Dub data from Firebase
    dubData: dubData,
    dubStatus: formatDubStatus(dubData, anilistData.episodes),
    // Formatted output
    formatted: formatAnimeResponse(anilistData, dubData),
    fetchedAt: Date.now()
  };

  // Cache the result
  cacheResult(title, enriched);

  return enriched;
}

/**
 * Format anime response for user display
 * @param {object} anime - AniList data
 * @param {object} dubData - Firebase dub data
 * @returns {string} - Formatted string
 */
function formatAnimeResponse(anime, dubData) {
  let output = "";
  
  // Title
  output += `📺 ${anime.title}\n`;
  
  // Episodes
  output += `Episodes: ${anime.episodes || "Unknown"}\n`;
  
  // Status
  output += `Status: ${anime.status}\n`;
  
  // Next episode
  if (anime.nextEpisode) {
    output += `Next Episode: ${anime.nextEpisode.formatted}\n`;
  }
  
  // Dub status
  output += formatDubStatus(dubData, anime.episodes);
  
  // Cover image
  if (anime.coverImage) {
    output += `\n\n🖼️ Cover: ${anime.coverImage}`;
  }
  
  // Description
  if (anime.description) {
    output += `\n\n📝 ${anime.description}`;
  }

  return output;
}

/**
 * Update dub status for an anime
 * @param {number} anilistId - AniList anime ID
 * @param {object} dubData - Dub data to save
 */
async function updateDubStatus(anilistId, dubData) {
  const success = await saveDubData(anilistId, dubData);
  
  // Clear cache for this anime
  // Note: We'd need the title to clear, so just clear all for simplicity
  enrichCache.clear();
  
  return success;
}

/**
 * Clear all caches
 */
function clearEnrichCache() {
  enrichCache.clear();
}

/**
 * Get cache stats
 */
function getEnrichCacheStats() {
  return {
    size: enrichCache.size,
    entries: Array.from(enrichCache.keys())
  };
}

module.exports = {
  enrichAnime,
  getDubData,
  saveDubData,
  updateDubStatus,
  formatDubStatus,
  clearEnrichCache,
  getEnrichCacheStats
};