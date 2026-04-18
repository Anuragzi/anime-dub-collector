// ============================================================
// services/fetchTwitter.js
// FIX: Removed import of extractAnimeTitle which was never
// exported from normalizeTitle.js — caused crash at require-time
// before main() could even run.
// ============================================================

const axios = require("axios");
const {
  isDubRelated,
  extractEpisodeNumber,
  classifyUpdateType,
  normalizeTitle,
} = require("../utils/normalizeTitle");

const SOURCE_NAME = "twitter";

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
      if (attempt < retries) await sleep(RETRY_DELAY_MS * attempt);
      else throw err;
    }
  }
}

// FIX: extractAnimeTitle defined locally here (was wrongly imported before)
function extractAnimeTitleFromTweet(text) {
  return text
    .replace(/@\w+/g, "")
    .replace(/#\w+/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s*(english|eng)?\s*dub(bed)?\s*(episode|ep|#)?\s*\d*.*$/i, "")
    .replace(/\s*episode\s*\d+.*/i, "")
    .trim();
}

function parseTweet(tweet) {
  try {
    const text = tweet.text || "";
    if (!isDubRelated(text)) return null;

    const cleanText = text.replace(/https?:\/\/\S+/g, "").trim();
    const title = extractAnimeTitleFromTweet(cleanText);
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

async function fetchTwitter() {
  if (!process.env.TWITTER_BEARER_TOKEN) {
    console.log("  [Twitter] TWITTER_BEARER_TOKEN not set — skipping");
    return [];
  }

  console.log("  [Twitter] Starting Twitter fetch...");

  const headers = { Authorization: `Bearer ${process.env.TWITTER_BEARER_TOKEN}` };
  const allTweets = [];

  for (const query of SEARCH_QUERIES) {
    try {
      const url = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=10&tweet.fields=created_at`;
      const data = await fetchWithRetry(url, headers);
      const tweets = data?.data || [];
      console.log(`  [Twitter] "${query.slice(0, 40)}..." → ${tweets.length} tweets`);
      allTweets.push(...tweets);
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