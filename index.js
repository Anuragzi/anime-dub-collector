// ============================================================
// index.js — Anime Dub News Collector (Main Runner)
// ============================================================
// Runs every 20 minutes and:
//   1. Fetches dub updates from AnimeSchedule, Reddit, Twitter
//   2. Normalizes and deduplicates them
//   3. Stores new ones in Firestore "dub_updates" collection
//   4. Logs everything clearly
//
// Each Firestore document has a unique ID based on:
//   normalizedTitle + episode number
// This ensures the same anime+episode is never stored twice.
// ============================================================

require("dotenv").config();

const cron = require("node-cron");
const { initFirebase, getDb } = require("./firebase");
const { fetchAnimeSchedule } = require("./services/fetchAnimeSchedule");
// const { fetchReddit } = require("./services/fetchReddit");
const { fetchTwitter } = require("./services/fetchTwitter");
const { makeDocId } = require("./utils/normalizeTitle");

// ====== CONFIG ======
const COLLECTION_NAME = "dub_updates";
const RUN_INTERVAL_CRON = "*/20 * * * *"; // every 20 minutes
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // only keep updates < 7 days old

// ============================================================
// ====== LOGGING =============================================
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
    INFO: "ℹ️ ",
    OK: "✅",
    SKIP: "⏭ ",
    WARN: "⚠️ ",
    ERROR: "❌",
    HEADER: "═══",
  }[level] || "  ";
  console.log(`[${ts}] ${prefix} ${msg}`);
}

function logHeader(title) {
  const line = "═".repeat(50);
  console.log(`\n${line}`);
  console.log(`  ${title}`);
  console.log(`${line}`);
}

// ============================================================
// ====== DEDUPLICATION + STORAGE =============================
// ============================================================

/**
 * Validates a parsed update has all required fields.
 */
function isValidUpdate(update) {
  if (!update) return false;
  if (!update.title || update.title.length < 2) return false;
  if (!update.source) return false;
  if (!update.language) return false;
  if (!update.type) return false;

  // Skip updates older than MAX_AGE_MS
  if (update.timestamp && Date.now() - update.timestamp > MAX_AGE_MS) return false;

  return true;
}

/**
 * Saves a single dub update to Firestore.
 * Uses the docId as the document ID — if it already exists,
 * the write is skipped (no overwrite of older data).
 *
 * @param {object} update - Structured dub update
 * @returns {"added"|"skipped"|"error"}
 */
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

    // Build the clean document
    const document = {
      // Core fields (required)
      title: update.title,
      normalizedTitle: update.normalizedTitle || update.title.toLowerCase(),
      episode: update.episode ?? null,
      type: update.type,
      language: update.language,
      source: update.source,
      timestamp: update.timestamp || Date.now(),

      // Optional enrichment fields
      ...(update.nextEpisode !== undefined && { nextEpisode: update.nextEpisode }),
      ...(update.nextEpisodeDate && { nextEpisodeDate: update.nextEpisodeDate }),
      ...(update.totalEpisodes && { totalEpisodes: update.totalEpisodes }),
      ...(update.status && { sourceStatus: update.status }),
      ...(update.sourceRoute && { sourceRoute: update.sourceRoute }),
      ...(update.redditUrl && { redditUrl: update.redditUrl }),
      ...(update.rawTitle && { rawTitle: update.rawTitle }),
      ...(update.tweetId && { tweetId: update.tweetId }),

      // Metadata
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

/**
 * Processes an array of updates — validates, deduplicates, saves.
 * @param {Array} updates
 * @param {string} sourceName - for logging
 * @returns {{ added, skipped, errors }}
 */
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
      log("OK", `[${sourceName}] NEW: "${update.title}" | Ep ${update.episode ?? "?"} | Type: ${update.type}`);
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

  logHeader(`🎌 Anime Dub Collector — Run #${stats.totalRuns} | ${stats.lastRun}`);

  const runStats = { added: 0, skipped: 0, errors: 0 };

  // ── SOURCE 1: AnimeSchedule.net ─────────────────────────
  log("INFO", "Fetching from AnimeSchedule.net...");
  try {
    const asUpdates = await fetchAnimeSchedule();
    const asResult = await processUpdates(asUpdates, "AnimeSchedule");
    runStats.added += asResult.added;
    runStats.skipped += asResult.skipped;
    runStats.errors += asResult.errors;
    log("INFO", `AnimeSchedule done → +${asResult.added} new, ${asResult.skipped} skipped, ${asResult.errors} errors`);
  } catch (err) {
    runStats.errors++;
    log("ERROR", `AnimeSchedule fetch crashed: ${err.message}`);
  }

  // ── SOURCE 2: Reddit ────────────────────────────────────
 // log("INFO", "Fetching from Reddit...");
  //try {
 //   const rdUpdates = await fetchReddit();
 //   const rdResult = await processUpdates(rdUpdates, "Reddit");
 //   runStats.added += rdResult.added;
 //   runStats.skipped += rdResult.skipped;
//    runStats.errors += rdResult.errors;
//    log("INFO", `Reddit done → +${rdResult.added} new, ${rdResult.skipped} skipped, ${rdResult.errors} errors`);
 // } catch (err) {
 //   runStats.errors++;
 //   log("ERROR", `Reddit fetch crashed: ${err.message}`);
 // }

  // ── SOURCE 3: Twitter/X (optional) ──────────────────────
  log("INFO", "Fetching from Twitter/X...");
  try {
    const twUpdates = await fetchTwitter();
    const twResult = await processUpdates(twUpdates, "Twitter");
    runStats.added += twResult.added;
    runStats.skipped += twResult.skipped;
    runStats.errors += twResult.errors;
    log("INFO", `Twitter done → +${twResult.added} new, ${twResult.skipped} skipped, ${twResult.errors} errors`);
  } catch (err) {
    runStats.errors++;
    log("ERROR", `Twitter fetch crashed: ${err.message}`);
  }

  // ── RUN SUMMARY ─────────────────────────────────────────
  stats.totalAdded += runStats.added;
  stats.totalSkipped += runStats.skipped;
  stats.totalErrors += runStats.errors;

  logHeader(`📊 Run #${stats.totalRuns} Complete`);
  console.log(`  This run  → ✅ ${runStats.added} added | ⏭  ${runStats.skipped} skipped | ❌ ${runStats.errors} errors`);
  console.log(`  All time  → ✅ ${stats.totalAdded} added | ⏭  ${stats.totalSkipped} skipped | ❌ ${stats.totalErrors} errors`);
  console.log(`  Next run  → in 20 minutes\n`);
}

// ============================================================
// ====== STARTUP =============================================
// ============================================================
async function main() {
  logHeader("🚀 Anime Dub News Collector — Starting Up");
  console.log(`  Interval : every 20 minutes`);
  console.log(`  Sources  : AnimeSchedule.net, Reddit, Twitter/X`);
  console.log(`  Firestore: "${COLLECTION_NAME}" collection`);
  console.log(`  AnimeSchedule key: ${process.env.ANIMESCHEDULE_KEY ? "✅ set" : "❌ MISSING"}`);
  console.log(`  Twitter token: ${process.env.TWITTER_BEARER_TOKEN ? "✅ set" : "⚠️  not set (optional)"}`);
  console.log(`  Firebase key: ${process.env.FIREBASE_KEY ? "✅ set" : "❌ MISSING"}`);

  // Connect Firebase
  initFirebase();

  // Run immediately on startup
  log("INFO", "Running first collection immediately...");
  await runCollection();

  // Schedule recurring runs
  cron.schedule(RUN_INTERVAL_CRON, async () => {
    await runCollection();
  });

  log("INFO", `Scheduler active — running every 20 minutes`);
}

// ====== GLOBAL ERROR HANDLERS ======
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
