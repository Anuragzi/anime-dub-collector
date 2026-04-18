// ============================================================
// index.js — Anime Dub News Collector (Main Runner)
// ============================================================

// ====== MUST BE FIRST — loads .env before anything else ======
require("dotenv").config();

// ====== EXPRESS (RAILWAY KEEP-ALIVE) ========================
const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

const stats = {
  totalRuns: 0,
  totalAdded: 0,
  totalSkipped: 0,
  totalErrors: 0,
  lastRun: null,
};

app.get("/", (req, res) => {
  res.json({
    status: "running",
    service: "Anime Dub News Collector",
    lastRun: stats.lastRun || "not yet",
    totalAdded: stats.totalAdded || 0,
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

// Twitter safe import
let fetchTwitter;
try {
  fetchTwitter = require("./services/fetchTwitter").fetchTwitter;
} catch (err) {
  console.warn(`⚠️ fetchTwitter failed: ${err.message}`);
  fetchTwitter = async () => [];
}

const { makeDocId } = require("./utils/normalizeTitle");

// ====== CONFIG ==============================================
const COLLECTION_NAME = "dub_updates";
const RUN_INTERVAL_CRON = "*/20 * * * *";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// ====== LOGGING =============================================
function log(level, msg) {
  const ts = new Date().toISOString();
  const prefix = {
    INFO: "ℹ️ ",
    OK: "✅",
    SKIP: "⏭ ",
    WARN: "⚠️ ",
    ERROR: "❌",
  }[level] || "  ";
  console.log(`[${ts}] ${prefix} ${msg}`);
}

function logHeader(title) {
  const line = "═".repeat(55);
  console.log(`\n${line}\n  ${title}\n${line}`);
}

// ====== VALIDATION ==========================================
function isValidUpdate(update) {
  if (!update) return false;
  if (!update.title || update.title.length < 2) return false;
  if (!update.source) return false;
  if (!update.language) return false;
  if (!update.type) return false;
  if (update.timestamp && Date.now() - update.timestamp > MAX_AGE_MS) return false;
  return true;
}

// ====== SAVE TO FIRESTORE ===================================
async function saveUpdate(update) {
  const db = getDb();
  const docId = makeDocId(update.title, update.episode);

  if (!docId) {
    log("WARN", `No docId for: ${update.title}`);
    return "error";
  }

  try {
    const docRef = db.collection(COLLECTION_NAME).doc(docId);
    const existing = await docRef.get();

    if (existing.exists) return "skipped";

    const document = {
      title: update.title,
      normalizedTitle: update.normalizedTitle || update.title.toLowerCase(),
      episode: update.episode ?? null,
      type: update.type,
      language: update.language,
      source: update.source,
      timestamp: update.timestamp || Date.now(),

      ...(update.nextEpisode && { nextEpisode: update.nextEpisode }),
      ...(update.nextEpisodeDate && { nextEpisodeDate: update.nextEpisodeDate }),
      ...(update.totalEpisodes && { totalEpisodes: update.totalEpisodes }),

      collectedAt: Date.now(),
      docId,
    };

    await docRef.set(document);
    return "added";
  } catch (err) {
    log("ERROR", `Save failed: ${err.message}`);
    return "error";
  }
}

// ====== PROCESS UPDATES =====================================
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
      log("OK", `[${sourceName}] NEW: ${update.title} Ep ${update.episode}`);
    } else if (result === "skipped") {
      skipped++;
    } else {
      errors++;
    }
  }

  return { added, skipped, errors };
}

// ====== MAIN RUN ============================================
async function runCollection() {
  stats.totalRuns++;
  stats.lastRun = new Date().toISOString();

  logHeader(`🎌 Run #${stats.totalRuns}`);

  const runStats = { added: 0, skipped: 0, errors: 0 };

  // AnimeSchedule
  try {
    const updates = await fetchAnimeSchedule();
    const result = await processUpdates(updates, "AnimeSchedule");
    Object.keys(runStats).forEach(k => runStats[k] += result[k]);
  } catch (err) {
    log("ERROR", err.message);
  }

  // RSS ✅ FIXED (was causing crash before)
  try {
    const updates = await fetchRSS();
    const result = await processUpdates(updates, "RSS");
    Object.keys(runStats).forEach(k => runStats[k] += result[k]);
  } catch (err) {
    log("ERROR", err.message);
  }

  // Twitter
  try {
    const updates = await fetchTwitter();
    const result = await processUpdates(updates, "Twitter");
    Object.keys(runStats).forEach(k => runStats[k] += result[k]);
  } catch (err) {
    log("ERROR", err.message);
  }

  stats.totalAdded += runStats.added;
  stats.totalSkipped += runStats.skipped;
  stats.totalErrors += runStats.errors;

  logHeader("📊 Completed");
  console.log(`Added: ${runStats.added} | Skipped: ${runStats.skipped}`);
}

// ====== START ===============================================
async function main() {
  logHeader("🚀 Starting Collector");

  initFirebase();

  await runCollection();

  cron.schedule(RUN_INTERVAL_CRON, runCollection);

  log("INFO", "Scheduler started (20 min)");
}

// ====== ERROR HANDLING ======================================
process.on("unhandledRejection", err => {
  log("ERROR", err);
});

process.on("uncaughtException", err => {
  log("ERROR", err);
});

main();