// ============================================================
// buildMappings.js — Build anime mapping database
// Uses AniList + HiAnime → Firebase Firestore
// ============================================================

require("dotenv").config();

// ====== IMPORTS =============================================
const axios = require("axios");
const { initFirebase, getDb } = require("./firebase");
const { searchHiAnime } = require("./services/searchHiAnime");

// ====== CONFIG ==============================================
const ANILIST_GRAPHQL_URL = "https://graphql.anilist.co";
const PAGES_TO_FETCH = 20;
const ANIME_PER_PAGE = 50;
const REQUEST_DELAY_MS = 1200;
const MAX_RETRIES = 2;

// In-memory cache to avoid duplicate searches
const mappingCache = new Map();
const failedCache = new Set();

// ====== LOGGING =============================================
function log(level, msg) {
  const ts = new Date().toISOString();
  const prefix = {
    INFO: "ℹ️ ",
    OK: "✅",
    WARN: "⚠️ ",
    ERROR: "❌",
  }[level] || "  ";
  console.log(`[${ts}] ${prefix} ${msg}`);
}

function logHeader(title) {
  const line = "═".repeat(55);
  console.log(`\n${line}\n  ${title}\n${line}`);
}

// ====== UTILITIES ===========================================
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Normalize title for matching
function normalize(title) {
  if (!title) return "";
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

// ====== ANILIST API =========================================
async function fetchAnimePage(page) {
  const query = `
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(type: ANIME, format: TV) {
          id
          title {
            romaji
            english
          }
        }
      }
    }
  `;

  try {
    const res = await axios.post(
      ANILIST_GRAPHQL_URL,
      { query, variables: { page, perPage: ANIME_PER_PAGE } },
      { timeout: 15000 }
    );
    return res.data?.data?.Page?.media || [];
  } catch (err) {
    log("ERROR", `Failed to fetch page ${page}: ${err.message}`);
    return [];
  }
}

// ====== HIANIME SEARCH WITH RETRY ==========================
async function searchWithRetry(title) {
  // Check cache first
  const normalized = normalize(title);
  if (mappingCache.has(normalized)) {
    return mappingCache.get(normalized);
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await sleep(REQUEST_DELAY_MS + Math.random() * 300);
      
      const hianimeId = await searchHiAnime(title);
      
      if (hianimeId) {
        mappingCache.set(normalized, hianimeId);
        return hianimeId;
      }
      
      // No result found, don't retry
      return null;
      
    } catch (err) {
      const isLastAttempt = attempt === MAX_RETRIES;
      const waitTime = attempt * 1000;
      
      if (!isLastAttempt) {
        log("WARN", `Retry ${attempt}/${MAX_RETRIES} for "${title}" — waiting ${waitTime}ms`);
        await sleep(waitTime);
      } else {
        log("ERROR", `Search failed for "${title}": ${err.message}`);
      }
    }
  }

  return null;
}

// ====== PROCESS ANIME =======================================
async function processAnime(anime) {
  const romaji = anime.title?.romaji || "";
  const english = anime.title?.english || "";
  
  // Prefer english, fallback to romaji
  const title = english || romaji;
  
  if (!title) return null;

  const normalized = normalize(title);
  
  // Skip if already cached
  if (mappingCache.has(normalized)) {
    return { title, normalized, hianimeId: mappingCache.get(normalized), cached: true };
  }

  // Search HiAnime
  const hianimeId = await searchWithRetry(title);

  if (hianimeId) {
    log("OK", `Mapped: ${title} → ${hianimeId}`);
    return { title, normalized, hianimeId, success: true };
  } else {
    log("WARN", `Failed: ${title}`);
    failedCache.add(title);
    return { title, normalized, hianimeId: null, success: false };
  }
}

// ====== FIREBASE FIRESTORE =================================
async function saveToFirebase(mappings, failed) {
  const db = getDb();
  
  try {
    // Save successful mappings
    const mappingDoc = {};
    for (const m of mappings) {
      if (m.hianimeId) {
        mappingDoc[m.normalized] = m.hianimeId;
      }
    }

    await db.collection("config").doc("animeMappings").set(mappingDoc);
    log("INFO", `Saved ${Object.keys(mappingDoc).length} mappings to Firestore`);

    // Save failed titles
    const failedDoc = {
      titles: Array.from(failedCache),
      updatedAt: Date.now(),
    };

    await db.collection("config").doc("failedMappings").set(failedDoc);
    log("INFO", `Saved ${failed.size} failed titles to Firestore`);

    return true;
  } catch (err) {
    log("ERROR", `Firebase save failed: ${err.message}`);
    return false;
  }
}

// ====== MAIN FUNCTION ======================================
async function main() {
  logHeader("🚀 Building Anime Mappings");

  // Initialize Firebase
  initFirebase();
  log("INFO", "Firebase initialized");

  const allMappings = [];
  let totalProcessed = 0;
  let totalMapped = 0;
  let totalFailed = 0;

  // Fetch pages
  for (let page = 1; page <= PAGES_TO_FETCH; page++) {
    log("INFO", `Fetching page ${page}/${PAGES_TO_FETCH}...`);
    
    const animeList = await fetchAnimePage(page);
    
    if (animeList.length === 0) {
      log("WARN", `No more anime found at page ${page}, stopping`);
      break;
    }

    log("INFO", `Got ${animeList.length} anime from page ${page}`);

    // Process each anime
    for (const anime of animeList) {
      const result = await processAnime(anime);
      
      if (result) {
        totalProcessed++;
        
        if (result.hianimeId) {
          totalMapped++;
          allMappings.push(result);
        } else {
          totalFailed++;
        }
      }

      // Progress update every 50 anime
      if (totalProcessed % 50 === 0) {
        log("INFO", `Progress: ${totalProcessed} processed, ${totalMapped} mapped, ${totalFailed} failed`);
      }
    }

    // Delay between pages
    await sleep(REQUEST_DELAY_MS);
  }

  // Save to Firebase
  logHeader("💾 Saving to Firestore");
  await saveToFirebase(allMappings, failedCache);

  // Summary
  logHeader("📊 Completed");
  console.log(`Total processed: ${totalProcessed}`);
  console.log(`Successfully mapped: ${totalMapped}`);
  console.log(`Failed: ${totalFailed}`);
  console.log(`Cache size: ${mappingCache.size}`);
}

// ====== ERROR HANDLING =====================================
process.on("unhandledRejection", err => {
  log("ERROR", `Unhandled: ${err.message}`);
});

process.on("uncaughtException", err => {
  log("ERROR", `Crash: ${err.message}`);
});

// Run
main();