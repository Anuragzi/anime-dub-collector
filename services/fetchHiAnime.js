// ============================================================
// services/fetchHiAnime.js
// Fetches structured episode data from HiAnime via Consumet.
//
// ENDPOINT:
//   GET https://api.consumet.org/anime/hianime/info?id={id}
//
// RETURNS:
//   {
//     totalEpisodes: number | null,
//     subEpisodes:   number | null,
//     dubEpisodes:   number | null,
//   }
//
// The Consumet HiAnime info endpoint nests episode data under
// multiple possible shapes. This module handles all of them:
//
//   Shape A (common):
//     data.info.totalEpisodes
//     data.episodes (array) — count items with hasDub / type
//
//   Shape B (alternate):
//     data.totalEpisodes
//     data.subOrDubOrBoth === "dub" | "sub" | "both"
//
//   Shape C (full episode list):
//     data.episodes[].isFiller, .type === "DUB" | "SUB"
//
// We try all shapes and take the first non-null value found.
// ============================================================

const axios = require("axios");
const { sleep } = require("../utils/hiAnimeCache");

const BASE_URL    = "https://api.consumet.org/anime/hianime";
const MAX_RETRIES  = 3;
const RETRY_DELAY  = 1500;
const REQUEST_DELAY = 500;

// ============================================================
// ====== FETCH WITH RETRY ====================================
// ============================================================
async function fetchWithRetry(url, retries = MAX_RETRIES) {
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await sleep(REQUEST_DELAY);

      const res = await axios.get(url, {
        timeout: 12000,
        headers: { "User-Agent": "AnimeDubTrackerBot/1.0" },
      });

      return res.data;
    } catch (err) {
      lastError = err;
      const status = err.response?.status;

      if (status === 404) {
        console.warn(`  [HiAnime Fetch] ID not found (404) for URL: ${url}`);
        return null;
      }

      if (status === 401 || status === 403) {
        console.error(`  [HiAnime Fetch] Auth error ${status}`);
        return null;
      }

      const waitMs = RETRY_DELAY * attempt;
      console.warn(
        `  [HiAnime Fetch] Attempt ${attempt}/${retries} failed` +
        ` (${status || err.message})` +
        (attempt < retries ? ` — retrying in ${waitMs}ms` : "")
      );

      if (attempt < retries) await sleep(waitMs);
    }
  }

  throw new Error(`All ${retries} attempts failed: ${lastError?.message}`);
}

// ============================================================
// ====== EPISODE DATA EXTRACTOR ==============================
// Handles all known Consumet response shapes gracefully.
// ============================================================
function extractEpisodeCounts(data) {
  if (!data) return { totalEpisodes: null, subEpisodes: null, dubEpisodes: null };

  // ── Try Shape A: data.info object ─────────────────────────
  const info    = data.info || data.anime?.info || {};
  const stats   = data.info?.stats || data.anime?.stats || {};
  const moreInfo = data.moreInfo || data.anime?.moreInfo || {};

  // ── Try Shape B: top-level fields ─────────────────────────
  // totalEpisodes — check every known location
  const totalEpisodes =
    info.totalEpisodes          ??
    stats.episodes?.total       ??
    stats.totalEpisodes         ??
    moreInfo.totalEpisodes      ??
    data.totalEpisodes          ??
    (Array.isArray(data.episodes) ? data.episodes.length : null);

  // subEpisodes
  const subEpisodes =
    stats.episodes?.sub         ??
    info.subEpisodes            ??
    data.subEpisodes            ??
    null;

  // dubEpisodes
  const dubEpisodes =
    stats.episodes?.dub         ??
    info.dubEpisodes            ??
    data.dubEpisodes            ??
    null;

  // ── Shape C fallback: count from episode list ─────────────
  // Only runs if we got an episode array but no dub/sub counts
  if (Array.isArray(data.episodes) && (subEpisodes === null || dubEpisodes === null)) {
    let subCount = 0;
    let dubCount = 0;

    for (const ep of data.episodes) {
      const type = (ep.type || ep.dubOrSub || "").toUpperCase();
      if (type === "SUB")  subCount++;
      if (type === "DUB")  dubCount++;
      // Some entries mark dub availability as a boolean
      if (ep.hasDub === true) dubCount++;
      if (ep.hasSub === true) subCount++;
    }

    return {
      totalEpisodes: totalEpisodes ?? data.episodes.length,
      subEpisodes:   subEpisodes   ?? (subCount > 0 ? subCount : null),
      dubEpisodes:   dubEpisodes   ?? (dubCount > 0 ? dubCount : null),
    };
  }

  return {
    totalEpisodes: typeof totalEpisodes === "number" ? totalEpisodes : null,
    subEpisodes:   typeof subEpisodes   === "number" ? subEpisodes   : null,
    dubEpisodes:   typeof dubEpisodes   === "number" ? dubEpisodes   : null,
  };
}

// ============================================================
// ====== MAIN EXPORT: fetchHiAnime ===========================
// ============================================================

/**
 * Fetches episode counts from HiAnime using a known anime ID.
 * Never throws — always returns null on failure.
 *
 * @param {string} hianimeId - HiAnime anime ID (e.g. "one-piece-100")
 * @returns {Promise<{totalEpisodes, subEpisodes, dubEpisodes}|null>}
 */
async function fetchHiAnime(hianimeId) {
  if (!hianimeId || typeof hianimeId !== "string") {
    console.warn("  [HiAnime Fetch] Invalid ID provided — skipping");
    return null;
  }

  console.log(`  [HiAnime Fetch] Fetching info for ID: ${hianimeId}`);

  const url = `${BASE_URL}/info?id=${encodeURIComponent(hianimeId)}`;

  let data;
  try {
    data = await fetchWithRetry(url);
  } catch (err) {
    console.error(`  [HiAnime Fetch] All retries failed for ID "${hianimeId}": ${err.message}`);
    return null;
  }

  if (!data) {
    console.log(`  [HiAnime Fetch] No data returned for ID: ${hianimeId}`);
    return null;
  }

  const counts = extractEpisodeCounts(data);

  console.log(
    `  [HiAnime Fetch] ID: ${hianimeId} →` +
    ` total=${counts.totalEpisodes ?? "?"} |` +
    ` sub=${counts.subEpisodes ?? "?"} |` +
    ` dub=${counts.dubEpisodes ?? "?"}`
  );

  return counts;
}

module.exports = { fetchHiAnime };
