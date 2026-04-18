// ============================================================
// index.js — Anime Dub News Collector (Main Runner)
// ============================================================
// FIXES APPLIED:
//   1. require("dotenv").config() is NOW THE FIRST LINE
//      — previously it ran after Express, so all process.env
//        values were undefined when services checked them.
//   2. express added to package.json dependencies (was missing)
//      — Railway was SIGTERMing because npm install failed.
//   3. fetchTwitter import wrapped in try/catch
//      — it referenced extractAnimeTitle which wasn't exported,
//        causing a crash at require-time before main() ran.
//   4. Reddit kept commented but import also removed cleanly.
//   5. Kitsu.io added as free source (no API key required)
// ============================================================

// ====== MUST BE FIRST — loads .env before anything else ======
require("dotenv").config();

// ====== EXPRESS (RAILWAY KEEP-ALIVE) ========================
const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.json({
    status: "running",
    service: "Anime Dub News Collector",
    lastRun: stats?.lastRun || "not yet",
    totalAdded: stats?.totalAdded || 0,
  });
});

app.listen(PORT, () => {
  console.log(`✅ Express keep-alive server running on port ${PORT}`);
});

// ====== IMPORTS =============================================
const cron = require("node-cron");
const { initFirebase, getDb } = require("./firebase");
const { fetchAnimeSchedule } = require("./services/fetchAnimeSchedule");
const fetchRSS = require("./services/fetchRSS");
const { fetchKitsu } = require("./services/fetchKitsu");  // ✅ ADDED

// Reddit disabled — uncomment below + in runCollection() to re-enable
// const { fetchReddit } = require("./services/fetchReddit");

// FIX: wrap Twitter import — crashes at require-time if util exports are missing
let fetchTwitter;
try {
  fetchTwitter = require("./services/fetchTwitter").fetchTwitter;
} catch (err) {
  console.warn(`⚠️  fetchTwitter failed to load: ${err.message} — Twitter source disabled`);
  fetchTwitter = async () => [];   // safe no-op fallback
}

const { makeDocId } = require("./utils/normalizeTitle");

// ====== CONFIG ==============================================
const COLLECTION_NAME = "dub_updates";
const RUN_INTERVAL_CRON = "*/20 * * * *";             // every 20 minutes
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;          // ignore updates > 7 days old

// ============================================================
// ====== STATS + LOGGING =====================================
// ============================================================
const stats = {
  totalRuns: 0,
  totalAdded: 0,
  totalSkipped: 0,
  totalErrors: 0,
  lastRun: null,
};

function log(level, msg) {
  const ts = new Date().toISOString();
  const prefix = {
    INFO:   "ℹ️ ",
    OK:     "✅",
    SKIP:   "⏭ ",
    WARN:   "⚠️ ",
    ERROR:  "❌",
  }[level] || "  ";
  console.log(`[${ts}] ${prefix} ${msg}`);
}

function logHeader(title) {
  const line = "═".repeat(55);
  console.log(`\n${line}\n  ${title}\n${line}`);
}

// ============================================================
// ====== VALIDATION ==========================================
// ============================================================
function isValidUpdate(update) {
  if (!update) return false;
  if (!update.title || update.title.length < 2) return false;
  if (!update.source) return false;
  if (!update.language) return false;
  if (!update.type) return false;
  if (update.timestamp && Date.now() - update.timestamp > MAX_AGE_MS) return false;
  return true;
}

// ============================================================
// ====== FIRESTORE SAVE (deduplication by docId) =============
// ============================================================
async function saveUpdate(update) {
  const db = getDb();
  const docId = makeDocId(update.title, update.episode);

  if (!docId) {
    log("WARN", `Could not generate docId for: "${update.title}"`);
    return "error";
  }

  try {
    const docRef = db.collection(COLLECTION_NAME).doc(docId);
    const existing = await docRef.get();

    if (existing.exists) {
      return "skipped";
    }

    const document = {
      title: update.title,
      normalizedTitle: update.normalizedTitle || update.title.toLowerCase(),
      episode: update.episode ?? null,
      type: update.type,
      language: update.language,
      source: update.source,
      timestamp: update.timestamp || Date.now(),

      // Optional fields — only included if present
      ...(update.nextEpisode     !== undefined && { nextEpisode: update.nextEpisode }),
      ...(update.nextEpisodeDate &&               { nextEpisodeDate: update.nextEpisodeDate }),
      ...(update.totalEpisodes   &&               { totalEpisodes: update.totalEpisodes }),
      ...(update.status          &&               { sourceStatus: update.status }),
      ...(update.sourceRoute     &&               { sourceRoute: update.sourceRoute }),
      ...(update.redditUrl       &&               { redditUrl: update.redditUrl }),
      ...(update.rawTitle        &&               { rawTitle: update.rawTitle }),
      ...(update.tweetId         &&               { tweetId: update.tweetId }),

      collectedAt: Date.now(),
      docId,
    };

    await docRef.set(document);
    return "added";
  } catch (err) {
    log("ERROR", `Failed to save "${update.title}" ep${update.episode}: ${err.message}`);
    return "error";
  }
}

// ============================================================
// ====== PROCESS A BATCH OF UPDATES ==========================
// ============================================================
async function processUpdates(updates, sourceName) {
  let added = 0, skipped = 0, errors = 0;

  for (const update of updates) {
    if (!isValidUpdate(update)) {
      skipped++;
      continue;
    }

    const result = await saveUpdate(update);

    if (result === "added") {
      added++;
      log("OK",   `[${sourceName}] NEW: "${update.title}" | Ep ${update.episode ?? "?"} | ${update.type}`);
    } else if (result === "skipped") {
      skipped++;
      log("SKIP", `[${sourceName}] DUP: "${update.title}" | Ep ${update.episode ?? "?"}`);
    } else {
      errors++;
    }
  }

  return { added, skipped, errors };
}

// ============================================================
// ====== MAIN COLLECTION RUN =================================
// ============================================================
async function runCollection() {
  stats.totalRuns++;
  stats.lastRun = new Date().toISOString();

  logHeader(`🎌 Dub Collector — Run #${stats.totalRuns} | ${stats.lastRun}`);

  const runStats = { added: 0, skipped: 0, errors: 0 };

  // ── SOURCE 1: AnimeSchedule.net ──────────────────────────
  log("INFO", "Fetching from AnimeSchedule.net...");
  try {
    const updates = await fetchAnimeSchedule();
    const result  = await processUpdates(updates, "AnimeSchedule");
    runStats.added   += result.added;
    runStats.skipped += result.skipped;
    runStats.errors  += result.errors;
    log("INFO", `AnimeSchedule → +${result.added} new | ${result.skipped} skipped | ${result.errors} errors`);
  } catch (err) {
    runStats.errors++;
    log("ERROR", `AnimeSchedule crashed: ${err.message}`);
  }

  // ── SOURCE 2: RSS Feeds ──────────────────────────────────
  log("INFO", "Fetching from RSS Feeds...");
  try {
    const updates = await fetchRSS();
    const result  = await processUpdates(updates, "RSS");
    runStats.added   += result.added;
    runStats.skipped += result.skipped;
    runStats.errors  += result.errors;
    log("INFO", `RSS → +${result.added} new | ${result.skipped} skipped | ${result.errors} errors`);
  } catch (err) {
    runStats.errors++;
    log("ERROR", `RSS crashed: ${err.message}`);
  }

  // ── SOURCE 3: Kitsu.io (free, no API key) ────────────────
  log("INFO", "Fetching from Kitsu.io...");
  try {
    const updates = await fetchKitsu();
    const result  = await processUpdates(updates, "Kitsu");
    runStats.added   += result.added;
    runStats.skipped += result.skipped;
    runStats.errors  += result.errors;
    log("INFO", `Kitsu → +${result.added} new | ${result.skipped} skipped | ${result.errors} errors`);
  } catch (err) {
    runStats.errors++;
    log("ERROR", `Kitsu crashed: ${err.message}`);
  }

  // ── SOURCE 4: Reddit (disabled — uncomment to enable) ────
  // log("INFO", "Fetching from Reddit...");
  // try {
  //   const updates = await fetchReddit();
  //   const result  = await processUpdates(updates, "Reddit");
  //   runStats.added   += result.added;
  //   runStats.skipped += result.skipped;
  //   runStats.errors  += result.errors;
  //   log("INFO", `Reddit → +${result.added} new | ${result.skipped} skipped | ${result.errors} errors`);
  // } catch (err) {
  //   runStats.errors++;
  //   log("ERROR", `Reddit crashed: ${err.message}`);
  // }

  // ── SOURCE 5: Twitter/X (skips if token not set) ─────────
  log("INFO", "Fetching from Twitter/X...");
  try {
    const updates = await fetchTwitter();
    const result  = await processUpdates(updates, "Twitter");
    runStats.added   += result.added;
    runStats.skipped += result.skipped;
    runStats.errors  += result.errors;
    log("INFO", `Twitter → +${result.added} new | ${result.skipped} skipped | ${result.errors} errors`);
  } catch (err) {
    runStats.errors++;
    log("ERROR", `Twitter crashed: ${err.message}`);
  }

  // ── SUMMARY ──────────────────────────────────────────────
  stats.totalAdded   += runStats.added;
  stats.totalSkipped += runStats.skipped;
  stats.totalErrors  += runStats.errors;

  logHeader(`📊 Run #${stats.totalRuns} Complete`);
  console.log(`  This run → ✅ ${runStats.added} added | ⏭  ${runStats.skipped} skipped | ❌ ${runStats.errors} errors`);
  console.log(`  All time → ✅ ${stats.totalAdded} added | ⏭  ${stats.totalSkipped} skipped | ❌ ${stats.totalErrors} errors`);
  console.log(`  Next run → in 20 minutes\n`);
}

// ============================================================
// ====== STARTUP =============================================
// ============================================================
async function main() {
  logHeader("🚀 Anime Dub News Collector — Starting Up");
  console.log(`  Port     : ${PORT}`);
  console.log(`  Interval : every 20 minutes`);
  console.log(`  Firestore: "${COLLECTION_NAME}" collection`);
  console.log(`  ANIMESCHEDULE_KEY  : ${process.env.ANIMESCHEDULE_KEY   ? "✅ set" : "❌ MISSING — dub data won't work!"}`);
  console.log(`  FIREBASE_KEY       : ${process.env.FIREBASE_KEY        ? "✅ set" : "❌ MISSING — nothing will save!"}`);
  console.log(`  TWITTER_BEARER_TOKEN: ${process.env.TWITTER_BEARER_TOKEN ? "✅ set" : "⚠️  not set (Twitter skipped)"}`);

  // Init Firebase
  initFirebase();

  // Run immediately on startup
  log("INFO", "Running first collection now...");
  await runCollection();

  // Schedule recurring runs
  cron.schedule(RUN_INTERVAL_CRON, async () => {
    await runCollection();
  });

  log("INFO", "Scheduler active — next run in 20 minutes");
}

// ====== CRASH GUARDS ========================================
process.on("unhandledRejection", (reason) => {
  log("ERROR", `Unhandled rejection: ${reason}`);
  stats.totalErrors++;
});

process.on("uncaughtException", (err) => {
  log("ERROR", `Uncaught exception: ${err.message}`);
  stats.totalErrors++;
});

main().catch((err) => {
  console.error("❌ Fatal startup error:", err.message);
  process.exit(1);
});