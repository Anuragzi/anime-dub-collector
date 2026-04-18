// ============================================================
// services/fetchRSS.js
// Fetches English dub anime news from RSS feeds.
//
// SOURCES:
//   1. Anime News Network — comprehensive anime news site
//   2. Crunchyroll        — official simulcast/simuldub announcements
//
// HOW IT WORKS:
//   - Fetches each RSS feed with retry logic (3 attempts)
//   - Parses items using rss-parser
//   - Filters items containing dub-related keywords
//   - Normalizes titles using shared normalizeTitle utility
//   - Returns clean, structured array of dub update objects
// ============================================================

const axios = require("axios");
const RSSParser = require("rss-parser");
const { normalizeTitle } = require("../utils/normalizeTitle");

// ====== RSS FEED SOURCES ====================================
const RSS_FEEDS = [
  {
    name: "Anime News Network",
    url: "https://www.animenewsnetwork.com/all/rss.xml",
  },
  {
    name: "Crunchyroll",
    url: "https://feeds.feedburner.com/crunchyroll/rss/anime",
  },
];

// ====== DUB FILTER KEYWORDS =================================
// A feed item must contain at least one of these (case-insensitive)
const DUB_KEYWORDS = ["dub", "english dub", "dubbed", "simuldub"];

// ====== RETRY CONFIG ========================================
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000; // base delay — doubles each attempt

// ====== RSS PARSER INSTANCE =================================
const parser = new RSSParser({
  timeout: 15000,
  headers: {
    "User-Agent": "AnimeDubTrackerBot/1.0",
    Accept: "application/rss+xml, application/xml, text/xml",
  },
  customFields: {
    item: [
      ["media:content", "mediaContent"],
      ["content:encoded", "contentEncoded"],
    ],
  },
});

// ============================================================
// ====== HELPERS =============================================
// ============================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Checks whether a feed item is dub-related by scanning
 * its title and description for known dub keywords.
 *
 * @param {object} item - Raw RSS feed item
 * @returns {boolean}
 */
function isDubRelated(item) {
  const searchText = [
    item.title || "",
    item.contentSnippet || "",
    item.content || "",
    item.contentEncoded || "",
  ]
    .join(" ")
    .toLowerCase();

  return DUB_KEYWORDS.some((keyword) => searchText.includes(keyword));
}

/**
 * Parses a raw RSS item into a clean structured object.
 *
 * @param {object} item   - Raw RSS feed item from rss-parser
 * @param {string} source - Human-readable source name (e.g. "Crunchyroll")
 * @returns {object|null} - Structured update object or null if invalid
 */
function parseItem(item, source) {
  const title = (item.title || "").trim();
  const link = (item.link || item.guid || "").trim();

  // Skip items missing title or link — not useful without them
  if (!title || !link) return null;

  // Resolve published date — rss-parser normalises this to isoDate
  const publishedAt = item.isoDate
    ? new Date(item.isoDate).getTime()
    : item.pubDate
    ? new Date(item.pubDate).getTime()
    : Date.now();

  // Sanity-check: reject timestamps that are clearly wrong
  if (isNaN(publishedAt)) return null;

  return {
    title,
    normalizedTitle: normalizeTitle(title),
    link,
    source,
    publishedAt,
  };
}

// ============================================================
// ====== FETCH WITH RETRY ====================================
// ============================================================

/**
 * Fetches raw RSS XML from a URL with automatic retry on failure.
 * Uses exponential backoff: 2s → 4s → 8s between attempts.
 *
 * @param {string} url
 * @returns {string} - Raw RSS XML string
 */
async function fetchFeedXml(url) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await axios.get(url, {
        timeout: 15000,
        responseType: "text",
        headers: {
          "User-Agent": "AnimeDubTrackerBot/1.0",
          Accept: "application/rss+xml, application/xml, text/xml, */*",
        },
      });
      return response.data;
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      const waitMs = RETRY_DELAY_MS * attempt; // 2s, 4s, 6s

      console.warn(
        `  [RSS] Attempt ${attempt}/${MAX_RETRIES} failed for ${url}` +
          ` — ${status ? `HTTP ${status}` : err.message}` +
          (attempt < MAX_RETRIES ? ` — retrying in ${waitMs / 1000}s` : "")
      );

      if (attempt < MAX_RETRIES) {
        await sleep(waitMs);
      }
    }
  }

  throw new Error(
    `All ${MAX_RETRIES} attempts failed for ${url}: ${lastError?.message}`
  );
}

// ============================================================
// ====== FETCH A SINGLE FEED =================================
// ============================================================

/**
 * Fetches, parses, and filters one RSS feed.
 *
 * @param {{ name: string, url: string }} feedConfig
 * @returns {Array} - Array of structured dub update objects
 */
async function fetchOneFeed(feedConfig) {
  const { name, url } = feedConfig;
  console.log(`  [RSS] Fetching feed: ${name} (${url})`);

  let xml;
  try {
    xml = await fetchFeedXml(url);
  } catch (err) {
    console.error(`  [RSS] ❌ Failed to fetch "${name}": ${err.message}`);
    return [];
  }

  let feed;
  try {
    feed = await parser.parseString(xml);
  } catch (err) {
    console.error(`  [RSS] ❌ Failed to parse "${name}": ${err.message}`);
    return [];
  }

  const items = feed.items || [];
  console.log(`  [RSS] "${name}" → ${items.length} total items`);

  // Filter to dub-related only, then parse into clean objects
  const dubItems = items
    .filter(isDubRelated)
    .map((item) => parseItem(item, name))
    .filter(Boolean); // remove nulls from parseItem

  console.log(`  [RSS] "${name}" → ${dubItems.length} dub-related posts`);
  return dubItems;
}

// ============================================================
// ====== MAIN EXPORT =========================================
// ============================================================

/**
 * Fetches dub-related items from all configured RSS feeds.
 *
 * @returns {Promise<Array>} - Deduplicated array of structured dub updates:
 *   {
 *     title:           string,   // original RSS item title
 *     normalizedTitle: string,   // cleaned for deduplication
 *     link:            string,   // article/post URL
 *     source:          string,   // feed name (e.g. "Crunchyroll")
 *     publishedAt:     number,   // Unix timestamp in ms
 *   }
 */
async function fetchRSS() {
  console.log("[RSS] Starting RSS feed fetch...");

  const allResults = [];

  // Fetch all feeds — continue even if one fails
  for (const feedConfig of RSS_FEEDS) {
    const items = await fetchOneFeed(feedConfig);
    allResults.push(...items);

    // Small delay between feeds — polite to servers
    if (RSS_FEEDS.indexOf(feedConfig) < RSS_FEEDS.length - 1) {
      await sleep(1000);
    }
  }

  // Deduplicate by link — same article shouldn't appear twice
  const seen = new Set();
  const deduped = allResults.filter((item) => {
    if (seen.has(item.link)) return false;
    seen.add(item.link);
    return true;
  });

  // Sort newest first
  deduped.sort((a, b) => b.publishedAt - a.publishedAt);

  console.log(
    `[RSS] Done — Found ${deduped.length} dub-related posts` +
      ` across ${RSS_FEEDS.length} feeds`
  );

  return deduped;
}

module.exports = fetchRSS;
