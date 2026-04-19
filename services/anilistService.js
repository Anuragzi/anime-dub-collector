// ============================================================
// services/anilistService.js
// AniList GraphQL API integration for anime data
// ============================================================

const axios = require("axios");

const ANILIST_GRAPHQL_URL = "https://graphql.anilist.co";
const REQUEST_DELAY_MS = 1000;

// In-memory cache
const searchCache = new Map();

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Search AniList for anime by title
 * @param {string} title - Anime title to search
 * @returns {Promise<object|null>} - Anime data or null if not found
 */
async function searchAniList(title) {
  if (!title) return null;

  const cacheKey = title.toLowerCase().trim();
  
  // Check cache first
  if (searchCache.has(cacheKey)) {
    return searchCache.get(cacheKey);
  }

  const query = `
    query ($search: String) {
      Media(search: $search, type: ANIME) {
        id
        title {
          romaji
          english
          native
        }
        episodes
        status
        description
        coverImage {
          large
          medium
        }
        nextAiringEpisode {
          episode
          airingAt
        }
        format
        startDate {
          year
          month
          day
        }
        endDate {
          year
          month
          day
        }
      }
    }
  `;

  try {
    await sleep(REQUEST_DELAY_MS);
    
    const res = await axios.post(
      ANILIST_GRAPHQL_URL,
      { query, variables: { search: title } },
      { timeout: 15000, headers: { "Content-Type": "application/json" } }
    );

    const media = res.data?.data?.Media;
    
    if (!media) {
      searchCache.set(cacheKey, null);
      return null;
    }

    // Format the response
    const animeData = formatAnimeData(media);
    searchCache.set(cacheKey, animeData);
    
    return animeData;
    
  } catch (err) {
    console.error(`[AniList] Search failed for "${title}": ${err.message}`);
    return null;
  }
}

/**
 * Format AniList response into clean object
 */
function formatAnimeData(media) {
  const title = media.title.english || media.title.romaji || "Unknown";
  
  // Format description (remove HTML tags, limit length)
  let description = media.description || "";
  description = description.replace(/<[^>]*>/g, "").trim();
  if (description.length > 300) {
    description = description.substring(0, 297) + "...";
  }

  // Format next airing
  let nextEpisode = null;
  if (media.nextAiringEpisode) {
    const airingAt = new Date(media.nextAiringEpisode.airingAt * 1000);
    const dateStr = airingAt.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "April",
      year: "numeric"
    });
    
    nextEpisode = {
      episode: media.nextAiringEpisode.episode,
      airingAt: media.nextAiringEpisode.airingAt,
      formatted: `Ep ${media.nextAiringEpisode.episode} on ${dateStr}`
    };
  }

  // Format status
  const statusMap = {
    RELEASING: "Releasing",
    FINISHED: "Finished",
    NOT_YET_RELEASED: "Not Yet Released",
    CANCELLED: "Cancelled",
    HIATUS: "On Hiatus"
  };

  return {
    anilistId: media.id,
    title: title,
    romajiTitle: media.title.romaji,
    englishTitle: media.title.english,
    nativeTitle: media.title.native,
    episodes: media.episodes || 0,
    status: statusMap[media.status] || media.status,
    description: description,
    coverImage: media.coverImage?.large || media.coverImage?.medium || null,
    format: media.format || "TV",
    startDate: media.startDate ? 
      `${media.startDate.year || "?"}` : null,
    endDate: media.endDate ?
      `${media.endDate.year || "?"}` : null,
    nextEpisode: nextEpisode,
    fetchedAt: Date.now()
  };
}

/**
 * Get anime info by title (main export)
 * @param {string} title - Anime title
 * @returns {Promise<object>} - Anime info object
 */
async function getAnimeInfo(title) {
  const result = await searchAniList(title);
  
  if (!result) {
    return {
      found: false,
      title: title,
      error: "Anime not found"
    };
  }

  return {
    found: true,
    ...result
  };
}

/**
 * Clear cache (useful for testing)
 */
function clearCache() {
  searchCache.clear();
}

/**
 * Get cache stats
 */
function getCacheStats() {
  return {
    size: searchCache.size,
    keys: Array.from(searchCache.keys())
  };
}

module.exports = {
  getAnimeInfo,
  searchAniList,
  clearCache,
  getCacheStats
};