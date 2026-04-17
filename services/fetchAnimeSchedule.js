// ============================================================
// services/fetchAnimeSchedule.js
// Fetches the current English dub timetable from AnimeSchedule.net
// API v3 and converts entries into normalized dub_update objects.
//
// HOW IT WORKS:
//   GET /api/v3/timetables/dub
//   Returns this week's dub schedule. Each entry has:
//     - route          : unique show slug
//     - title          : show name
//     - episodeNumber  : NEXT episode about to air
//     - episodeDate    : when it airs (ISO datetime, UTC)
//     - episodes       : total episode count
//     - status         : "finished" | "airing" | etc.
//
//   Current dubbed count = episodeNumber - 1
//   (episodeNumber is UPCOMING, so current = one behind)
//
//   For FINISHED shows, episodeNumber IS the last episode.
// ============================================================

const axios = require("axios");
const { makeDocId, classifyUpdateType, normalizeTitle } = require("../utils/normalizeTitle");

const BASE_URL = "https://animeschedule.net/api/v3";
const SOURCE_NAME = "animeschedule.net";

// Retry config
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

async function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * Fetches a URL with automatic retry on failure.
 */
async function fetchWithRetry(url, options = {}, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(url, { ...options, timeout: 15000 });
      return res.data;
    } catch (err) {
      const status = err.response?.status;
      console.warn(
        `  [AnimeSchedule] Attempt ${attempt}/${retries} failed: ${status || err.message}`
      );

      // Don't retry on auth errors
      if (status === 401 || status === 403) {
        throw new Error(`Auth error ${status} — check ANIMESCHEDULE_KEY`);
      }

      if (attempt < retries) {
        await sleep(RETRY_DELAY_MS * attempt); // exponential backoff
      } else {
        throw err;
      }
    }
  }
}

/**
 * Converts a raw AnimeSchedule timetable entry into a structured update.
 * @param {object} entry - Raw timetable entry
 * @returns {object|null} - Structured dub update or null if invalid
 */
function parseTimetableEntry(entry) {
  try {
    const rawTitle = entry.title || entry.romaji || entry.english || entry.route || "";
    if (!rawTitle) return null;

    const nextEpNum = parseInt(entry.episodeNumber) || 0;
    const episodeDate = entry.episodeDate ? new Date(entry.episodeDate) : null;
    const now = new Date();

    // Determine current dubbed episode count and update type
    let dubEpisodes;
    let type;

    if (entry.status === "finished") {
      // Show finished airing — episodeNumber IS the last episode
      dubEpisodes = nextEpNum;
      type = "new_episode";
    } else if (episodeDate && episodeDate > now) {
      // Next episode hasn't aired yet → current dubbed = nextEpNum - 1
      dubEpisodes = Math.max(0, nextEpNum - 1);
      type = dubEpisodes === 0 ? "announcement" : "new_episode";
    } else if (episodeDate && episodeDate <= now) {
      // Episode date has passed — it's likely out now
      dubEpisodes = nextEpNum;
      type = "new_episode";
    } else {
      dubEpisodes = Math.max(0, nextEpNum - 1);
      type = "new_episode";
    }

    // Skip entries with no meaningful data
    if (dubEpisodes === 0 && type !== "announcement") return null;

    return {
      title: rawTitle,
      normalizedTitle: normalizeTitle(rawTitle),
      episode: dubEpisodes,
      nextEpisode: nextEpNum,
      nextEpisodeDate: episodeDate ? episodeDate.getTime() : null,
      type,
      language: "English",
      source: SOURCE_NAME,
      sourceRoute: entry.route || null,
      totalEpisodes: entry.episodes || null,
      status: entry.status || null,
      timestamp: Date.now(),
    };
  } catch (err) {
    console.warn(`  [AnimeSchedule] Parse error for entry: ${err.message}`);
    return null;
  }
}

/**
 * Fetches this week's dub timetable entries from AnimeSchedule.net.
 * @returns {Array} - Array of structured dub update objects
 */
async function fetchAnimeSchedule() {
  if (!process.env.ANIMESCHEDULE_KEY) {
    console.warn("  [AnimeSchedule] ANIMESCHEDULE_KEY not set — skipping");
    return [];
  }

  console.log("  [AnimeSchedule] Fetching dub timetable...");

  let raw;
  try {
    raw = await fetchWithRetry(`${BASE_URL}/timetables/dub`, {
      headers: { Authorization: `Bearer ${process.env.ANIMESCHEDULE_KEY}` },
    });
  } catch (err) {
    console.error(`  [AnimeSchedule] Failed to fetch timetable: ${err.message}`);
    return [];
  }

  if (!Array.isArray(raw)) {
    console.error("  [AnimeSchedule] Unexpected response format (not an array)");
    return [];
  }

  console.log(`  [AnimeSchedule] Got ${raw.length} raw timetable entries`);

  const updates = [];
  for (const entry of raw) {
    const parsed = parseTimetableEntry(entry);
    if (parsed) updates.push(parsed);
  }

  console.log(`  [AnimeSchedule] Parsed ${updates.length} valid dub updates`);
  return updates;
}

/**
 * Also fetches dub data for specific AniList IDs (used by bot for tracking).
 * @param {number} anilistId
 * @returns {object|null}
 */
async function fetchAnimeScheduleById(anilistId) {
  if (!process.env.ANIMESCHEDULE_KEY) return null;

  try {
    const data = await fetchWithRetry(`${BASE_URL}/anime`, {
      params: { "anilist-ids": parseInt(anilistId) },
      headers: { Authorization: `Bearer ${process.env.ANIMESCHEDULE_KEY}` },
    });
    return data?.[0] || null;
  } catch (err) {
    console.error(`  [AnimeSchedule] ID lookup failed for ${anilistId}: ${err.message}`);
    return null;
  }
}

module.exports = { fetchAnimeSchedule, fetchAnimeScheduleById };
