// ============================================================
// services/fetchReddit.js
// Fetches dub-related posts from r/anime and r/Animedubs
// using Reddit's public JSON API (no auth required).
//
// Reddit provides .json endpoints on any subreddit:
//   https://www.reddit.com/r/Animedubs/new.json
//   https://www.reddit.com/r/anime/search.json?q=english+dub
//
// Rate limit: Reddit allows ~60 requests/min unauthenticated.
// We stay well below this by fetching 2 subreddits per run.
// ============================================================

const axios = require("axios");
const {
  makeDocId,
  isDubRelated,
  extractEpisodeNumber,
  classifyUpdateType,
  normalizeTitle,
} = require("../utils/normalizeTitle");

const SOURCE_NAME = "reddit";

// Subreddits to monitor
const SUBREDDITS = [
  { name: "Animedubs", mode: "new" },          // dedicated dub sub
  { name: "anime", mode: "search", q: "english dub episode" },
];

// Keywords that must appear for a post to be accepted
const REQUIRED_KEYWORDS = [
  "dub", "dubbed", "english dub", "eng dub",
];

// Noise filter — skip posts with these in the title
const SKIP_KEYWORDS = [
  "discussion", "question", "help", "recommendation",
  "which dub", "best dub", "worst dub", "opinion",
  "rant", "meta", "weekly thread",
];

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

async function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function fetchWithRetry(url, options = {}, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(url, {
        ...options,
        timeout: 15000,
        headers: {
          // Reddit requires a user-agent string
          "User-Agent": "AnimeDubTrackerBot/1.0 (by /u/AnimeDubTrackerApp)",
          ...options.headers,
        },
      });
      return res.data;
    } catch (err) {
      const status = err.response?.status;

      // Reddit rate limit
      if (status === 429) {
        const retryAfter = parseInt(err.response.headers["retry-after"] || "60");
        console.warn(`  [Reddit] Rate limited — waiting ${retryAfter}s`);
        await sleep(retryAfter * 1000);
        continue;
      }

      console.warn(`  [Reddit] Attempt ${attempt}/${retries} failed: ${status || err.message}`);

      if (attempt < retries) {
        await sleep(RETRY_DELAY_MS * attempt);
      } else {
        throw err;
      }
    }
  }
}

/**
 * Decides if a Reddit post is a genuine English dub update.
 * Returns false for noise/discussion posts.
 */
function isValidDubPost(title, selftext = "") {
  const combined = `${title} ${selftext}`.toLowerCase();

  // Must contain at least one dub keyword
  const hasDubKeyword = REQUIRED_KEYWORDS.some((kw) => combined.includes(kw));
  if (!hasDubKeyword) return false;

  // Skip discussion/noise posts
  const isNoise = SKIP_KEYWORDS.some((kw) => combined.includes(kw));
  if (isNoise) return false;

  return true;
}

/**
 * Extracts a clean anime title from a Reddit post title.
 * Reddit posts often follow patterns like:
 *   "Frieren Episode 5 English Dub is now on Crunchyroll"
 *   "[Dub] Re:Zero Episode 12 released"
 */
function extractAnimeTitle(postTitle) {
  let title = postTitle;

  // Remove common Reddit post prefixes/suffixes
  title = title
    .replace(/^\[dub\]\s*/i, "")
    .replace(/^\[eng dub\]\s*/i, "")
    .replace(/^\[english dub\]\s*/i, "")
    .replace(/\s*-\s*(english|eng)\s*dub.*$/i, "")
    .replace(/\s*(english|eng)?\s*dub(bed)?\s*(episode|ep|#)\s*\d+.*/i, "")
    .replace(/\s*episode\s*\d+.*/i, "")
    .replace(/\s*ep\s*\d+.*/i, "")
    .replace(/\s*#\d+.*/i, "")
    .replace(/\s*(is\s+)?(now\s+)?(available|streaming|out|released|live).*/i, "")
    .replace(/\s*(on|at)\s+(crunchyroll|funimation|hidive|netflix|amazon|disney).*/i, "")
    .trim();

  // Strip trailing punctuation
  title = title.replace(/[:\-–—,]+$/, "").trim();

  return title || null;
}

/**
 * Parses a single Reddit post into a structured dub update.
 */
function parseRedditPost(post) {
  try {
    const { title, selftext, created_utc, permalink, subreddit } = post.data;

    if (!title) return null;

    // Validate it's a real dub post
    if (!isValidDubPost(title, selftext)) return null;

    // Extract info
    const animeTitle = extractAnimeTitle(title);
    if (!animeTitle || animeTitle.length < 3) return null;

    const episode = extractEpisodeNumber(title) || extractEpisodeNumber(selftext);
    const type = classifyUpdateType(`${title} ${selftext}`);

    return {
      title: animeTitle,
      normalizedTitle: normalizeTitle(animeTitle),
      episode: episode,
      type,
      language: "English",
      source: `reddit/r/${subreddit}`,
      redditUrl: `https://reddit.com${permalink}`,
      rawTitle: title,
      timestamp: created_utc ? created_utc * 1000 : Date.now(),
    };
  } catch (err) {
    console.warn(`  [Reddit] Parse error: ${err.message}`);
    return null;
  }
}

/**
 * Fetches new posts from a subreddit's new feed.
 */
async function fetchSubredditNew(subredditName, limit = 25) {
  const url = `https://www.reddit.com/r/${subredditName}/new.json?limit=${limit}`;
  console.log(`  [Reddit] Fetching r/${subredditName}/new...`);

  try {
    const data = await fetchWithRetry(url);
    const posts = data?.data?.children || [];
    console.log(`  [Reddit] Got ${posts.length} posts from r/${subredditName}`);
    return posts;
  } catch (err) {
    console.error(`  [Reddit] Failed to fetch r/${subredditName}: ${err.message}`);
    return [];
  }
}

/**
 * Fetches posts from a subreddit matching a search query.
 */
async function fetchSubredditSearch(subredditName, query, limit = 25) {
  const url = `https://www.reddit.com/r/${subredditName}/search.json?q=${encodeURIComponent(query)}&sort=new&restrict_sr=1&limit=${limit}`;
  console.log(`  [Reddit] Searching r/${subredditName} for "${query}"...`);

  try {
    const data = await fetchWithRetry(url);
    const posts = data?.data?.children || [];
    console.log(`  [Reddit] Got ${posts.length} search results from r/${subredditName}`);
    return posts;
  } catch (err) {
    console.error(`  [Reddit] Search failed for r/${subredditName}: ${err.message}`);
    return [];
  }
}

/**
 * Main export — fetches all Reddit sources and returns normalized updates.
 * @returns {Array} - Array of structured dub update objects
 */
async function fetchReddit() {
  console.log("  [Reddit] Starting Reddit fetch...");
  const allPosts = [];

  for (const config of SUBREDDITS) {
    let posts = [];

    if (config.mode === "new") {
      posts = await fetchSubredditNew(config.name);
    } else if (config.mode === "search") {
      posts = await fetchSubredditSearch(config.name, config.q);
    }

    allPosts.push(...posts);

    // Small delay between subreddits to be polite
    await sleep(1500);
  }

  console.log(`  [Reddit] Total raw posts: ${allPosts.length}`);

  const updates = [];
  for (const post of allPosts) {
    const parsed = parseRedditPost(post);
    if (parsed) updates.push(parsed);
  }

  console.log(`  [Reddit] Parsed ${updates.length} valid dub updates`);
  return updates;
}

module.exports = { fetchReddit };
