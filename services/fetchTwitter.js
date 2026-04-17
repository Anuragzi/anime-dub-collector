// ============================================================
// services/fetchTwitter.js
// Fetches dub-related tweets from Twitter/X.
//
// NOTE ON TWITTER/X API ACCESS:
// The free Twitter API v2 tier (Basic) allows read access
// but requires manual app approval and a paid plan ($100/mo)
// for search endpoints. The service below is written for the
// Basic tier if you ever upgrade, but it gracefully skips
// if TWITTER_BEARER_TOKEN is not set.
//
// HOW TO GET ACCESS:
// 1. Go to https://developer.twitter.com/en/portal/projects
// 2. Create a new app under a project
// 3. Go to "Keys and Tokens" → copy Bearer Token
// 4. Add to Railway env: TWITTER_BEARER_TOKEN=your_token
//
// ACCOUNTS/HASHTAGS MONITORED:
// - Search queries: "english dub anime", "anime dub episode"
// - Useful accounts: @Crunchyroll, @FUNimation, @HIDIVEOfficial
// ============================================================

const axios = require("axios");
const {
  isDubRelated,
  extractEpisodeNumber,
  classifyUpdateType,
  normalizeTitle,
  extractAnimeTitle,
} = require("../utils/normalizeTitle");

const SOURCE_NAME = "twitter";

// Search queries to run
const SEARCH_QUERIES = [
  "\"english dub\" anime episode -filter:retweets lang:en",
  "\"dub episode\" anime released -filter:retweets lang:en",
  "anime \"now dubbed\" -filter:retweets lang:en",
];

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 3000;

async function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function fetchWithRetry(url, headers, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(url, { headers, timeout: 15000 });
      return res.data;
    } catch (err) {
      const status = err.response?.status;

      // Twitter rate limit
      if (status === 429) {
        const resetTime = err.response.headers["x-rate-limit-reset"];
        const waitMs = resetTime
          ? Math.max(0, parseInt(resetTime) * 1000 - Date.now()) + 1000
          : 60000;
        console.warn(`  [Twitter] Rate limited — waiting ${Math.round(waitMs / 1000)}s`);
        await sleep(waitMs);
        continue;
      }

      if (status === 401 || status === 403) {
        throw new Error(`Auth error ${status} — check TWITTER_BEARER_TOKEN`);
      }

      console.warn(`  [Twitter] Attempt ${attempt}/${retries} failed: ${status || err.message}`);

      if (attempt < retries) {
        await sleep(RETRY_DELAY_MS * attempt);
      } else {
        throw err;
      }
    }
  }
}

/**
 * Tries to extract anime title from a tweet text.
 * Tweets are messier than Reddit — do best effort.
 */
function parseTweet(tweet) {
  try {
    const text = tweet.text || "";
    if (!isDubRelated(text)) return null;

    // Remove URLs from text before processing
    const cleanText = text.replace(/https?:\/\/\S+/g, "").trim();

    // Try to find title: often before "episode" or "ep"
    let title = cleanText
      .replace(/@\w+/g, "")                      // remove mentions
      .replace(/#\w+/g, "")                       // remove hashtags
      .replace(/\s*(english|eng)?\s*dub(bed)?\s*(episode|ep|#)?\s*\d*.*$/i, "")
      .replace(/\s*episode\s*\d+.*/i, "")
      .trim();

    if (!title || title.length < 3) return null;

    const episode = extractEpisodeNumber(cleanText);
    const type = classifyUpdateType(cleanText);
    const createdAt = tweet.created_at ? new Date(tweet.created_at).getTime() : Date.now();

    return {
      title,
      normalizedTitle: normalizeTitle(title),
      episode,
      type,
      language: "English",
      source: SOURCE_NAME,
      tweetId: tweet.id,
      rawText: text,
      timestamp: createdAt,
    };
  } catch (err) {
    console.warn(`  [Twitter] Parse error: ${err.message}`);
    return null;
  }
}

/**
 * Main export — fetches dub tweets if TWITTER_BEARER_TOKEN is set.
 * @returns {Array}
 */
async function fetchTwitter() {
  if (!process.env.TWITTER_BEARER_TOKEN) {
    console.log("  [Twitter] TWITTER_BEARER_TOKEN not set — skipping Twitter source");
    return [];
  }

  console.log("  [Twitter] Starting Twitter fetch...");

  const headers = {
    Authorization: `Bearer ${process.env.TWITTER_BEARER_TOKEN}`,
  };

  const allTweets = [];

  for (const query of SEARCH_QUERIES) {
    try {
      const url = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=10&tweet.fields=created_at,author_id`;
      const data = await fetchWithRetry(url, headers);

      const tweets = data?.data || [];
      console.log(`  [Twitter] Query "${query.slice(0, 40)}..." → ${tweets.length} tweets`);
      allTweets.push(...tweets);

      // Respectful delay between queries
      await sleep(2000);
    } catch (err) {
      console.error(`  [Twitter] Query failed: ${err.message}`);
    }
  }

  const updates = [];
  for (const tweet of allTweets) {
    const parsed = parseTweet(tweet);
    if (parsed) updates.push(parsed);
  }

  console.log(`  [Twitter] Parsed ${updates.length} valid dub updates`);
  return updates;
}

module.exports = { fetchTwitter };
