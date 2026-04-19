// ============================================================
// services/searchHiAnime.js
// Searches HiAnime via Consumet API to find an anime's ID.
//
// ENDPOINT:
//   GET https://api.consumet.org/anime/hianime/{query}
//
// FLOW:
//   1. Normalize the title for best search results
//   2. Hit the Consumet search endpoint with retry logic
//   3. Score all results and pick the closest match
//   4. Return the HiAnime ID string (e.g. "one-piece-100")
//   5. Return null if nothing matches — never throws
//
// CACHING:
//   Results are cached in a shared Map (title → id) so the
//   same search never hits the API twice per process lifetime.
// ============================================================

const axios = require("axios");

const BASE_URL = "https://api.consumet.org/anime/hianime";

// Shared cache imported by fetchHiAnime.js too
const { titleCache, sleep } = require("../utils/hiAnimeCache");

const MAX_RETRIES  = 3;
const RETRY_DELAY  = 1500; // ms — doubles each attempt
const REQUEST_DELAY = 500; // ms — polite gap before every request

// ============================================================
// ====== TITLE NORMALIZATION =================================
// Strips season/part markers so "Re:Zero Season 3" → "rezero"
// giving a cleaner search term that Consumet handles better.
// ============================================================
function normalizeForSearch(title) {
  if (!title) return "";
  return title
    .toLowerCase()
    .replace(/\bseason\s*\d+\b/gi, "")
    .replace(/\bs\d+\b/gi, "")
    .replace(/\bpart\s*\d+\b/gi, "")
    .replace(/\bcour\s*\d+\b/gi, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ============================================================
// ====== SIMILARITY SCORER ===================================
// Simple word-overlap score between two strings (0–1).
// Used to pick the best result when Consumet returns multiples.
// ============================================================
function similarityScore(a, b) {
  const setA = new Set(normalizeForSearch(a).split(" ").filter(Boolean));
  const setB = new Set(normalizeForSearch(b).split(" ").filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;

  let overlap = 0;
  for (const word of setA) {
    if (setB.has(word)) overlap++;
  }
  return overlap / Math.max(setA.size, setB.size);
}

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

      // Don't retry on 404 — anime simply not found
      if (status === 404) return null;

      // Don't retry on auth/permission errors
      if (status === 401 || status === 403) {
        console.error(`  [HiAnime Search] Auth error ${status} — stopping retries`);
        return null;
      }

      const waitMs = RETRY_DELAY * attempt;
      console.warn(
        `  [HiAnime Search] Attempt ${attempt}/${retries} failed` +
        ` (${status || err.message})` +
        (attempt < retries ? ` — retrying in ${waitMs}ms` : "")
      );

      if (attempt < retries) await sleep(waitMs);
    }
  }

  throw new Error(`All ${retries} attempts failed: ${lastError?.message}`);
}

// ============================================================
// ====== MAIN EXPORT: searchHiAnime ==========================
// ============================================================

/**
 * Searches HiAnime for an anime by title and returns its ID.
 *
 * @param {string} title - Anime title to search for
 * @returns {Promise<string|null>} - HiAnime ID or null if not found
 */
async function searchHiAnime(title) {
  if (!title || typeof title !== "string") {
    console.warn("  [HiAnime Search] Invalid title provided — skipping");
    return null;
  }

  const cacheKey = title.toLowerCase().trim();

  // ── Cache hit ──────────────────────────────────────────────
  if (titleCache.has(cacheKey)) {
    const cached = titleCache.get(cacheKey);
    console.log(`  [HiAnime Search] Cache hit: "${title}" → ${cached || "not found"}`);
    return cached;
  }

  console.log(`  [HiAnime Search] Searching: ${title}`);

  const searchTerm = normalizeForSearch(title);
  if (!searchTerm) {
    console.warn(`  [HiAnime Search] Title normalized to empty string — skipping`);
    titleCache.set(cacheKey, null);
    return null;
  }

  const url = `${BASE_URL}/${encodeURIComponent(searchTerm)}`;

  let data;
  try {
    data = await fetchWithRetry(url);
  } catch (err) {
    console.error(`  [HiAnime Search] Failed for "${title}": ${err.message}`);
    // Cache null so we don't hammer the API on repeated failures
    titleCache.set(cacheKey, null);
    return null;
  }

  // Consumet returns { results: [...] } or null on no match
  const results = data?.results;
  if (!results || results.length === 0) {
    console.log(`  [HiAnime Search] No results for "${title}"`);
    titleCache.set(cacheKey, null);
    return null;
  }

  // ── Pick best match by similarity score ───────────────────
  let bestMatch  = null;
  let bestScore  = -1;

  for (const result of results) {
    const candidateTitles = [
      result.title,
      result.japaneseTitle,
      result.otherName,
    ].filter(Boolean);

    for (const candidate of candidateTitles) {
      const score = similarityScore(title, candidate);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = result;
      }
    }
  }

  // Require at least 30% word overlap to avoid false positives
  if (!bestMatch || bestScore < 0.3) {
    console.log(
      `  [HiAnime Search] No confident match for "${title}"` +
      ` (best score: ${bestScore.toFixed(2)})`
    );
    titleCache.set(cacheKey, null);
    return null;
  }

  const id = bestMatch.id || null;
  console.log(
    `  [HiAnime Search] Found ID: ${id}` +
    ` ("${bestMatch.title}", score: ${bestScore.toFixed(2)})`
  );

  // Cache for this process lifetime
  titleCache.set(cacheKey, id);

  return id;
}

module.exports = { searchHiAnime };
