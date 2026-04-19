// ============================================================
// services/enrichWithHiAnime.js
// Integration layer — enriches anime update objects with real
// episode counts from HiAnime via the Consumet API.
//
// FLOW FOR EACH UPDATE:
//   1. Check if hianimeId is already stored (skip search)
//   2. If not → call searchHiAnime(title) to find the ID
//   3. Check episode cache before hitting fetchHiAnime()
//   4. Merge totalEpisodes, subEpisodes, dubEpisodes into update
//   5. Return enriched update (original untouched if API fails)
//
// SAFETY:
//   - Never throws — all failures return the original update
//   - Every external call is wrapped in try/catch
//   - Null/undefined fields are handled gracefully
//
// RATE LIMITING:
//   - 500ms built into searchHiAnime + fetchHiAnime per call
//   - enrichBatch() adds an additional 500ms between items
//     to avoid hammering Consumet when processing many shows
// ============================================================

const { searchHiAnime } = require("./searchHiAnime");
const { fetchHiAnime }  = require("./fetchHiAnime");
const { episodeCache, sleep, getCacheStats } = require("../utils/hiAnimeCache");

const BATCH_DELAY_MS = 500; // extra gap between batch items

// ============================================================
// ====== ENRICH A SINGLE UPDATE ==============================
// ============================================================

/**
 * Enriches a single anime update object with HiAnime episode data.
 * Returns the original update if enrichment fails at any step.
 *
 * @param {object} update - Anime update object (must have .title)
 * @returns {Promise<object>} - Enriched update object
 */
async function enrichUpdate(update) {
  // Guard: must have a title to search
  if (!update?.title) {
    console.warn("  [HiAnime Enrich] Update missing title — skipping enrichment");
    return update;
  }

  const label = `"${update.title}"`;

  try {
    // ── Step 1: Resolve HiAnime ID ───────────────────────────
    let hianimeId = update.hianimeId || null;

    if (!hianimeId) {
      console.log(`  [HiAnime Enrich] No stored ID for ${label} — searching...`);
      try {
        hianimeId = await searchHiAnime(update.title);
      } catch (err) {
        console.error(`  [HiAnime Enrich] Search failed for ${label}: ${err.message}`);
        return update; // return original, don't crash
      }
    }

    if (!hianimeId) {
      console.log(`  [HiAnime Enrich] No HiAnime match for ${label} — skipping`);
      return update;
    }

    // ── Step 2: Fetch episode counts (with episode cache) ────
    let episodeCounts;

    if (episodeCache.has(hianimeId)) {
      episodeCounts = episodeCache.get(hianimeId);
      console.log(`  [HiAnime Enrich] Episode cache hit for ID: ${hianimeId}`);
    } else {
      try {
        episodeCounts = await fetchHiAnime(hianimeId);
        // Cache even null results to avoid redundant failures
        episodeCache.set(hianimeId, episodeCounts);
      } catch (err) {
        console.error(`  [HiAnime Enrich] Fetch failed for ${label} (${hianimeId}): ${err.message}`);
        return update;
      }
    }

    if (!episodeCounts) {
      console.log(`  [HiAnime Enrich] No episode data for ${label} — skipping merge`);
      // Still store the ID so we don't re-search next time
      return { ...update, hianimeId };
    }

    // ── Step 3: Merge into update ────────────────────────────
    const enriched = {
      ...update,
      hianimeId,
      // Only overwrite if HiAnime gave us a real value
      totalEpisodes: episodeCounts.totalEpisodes ?? update.totalEpisodes ?? null,
      subEpisodes:   episodeCounts.subEpisodes   ?? update.subEpisodes   ?? null,
      dubEpisodes:   episodeCounts.dubEpisodes   ?? update.dubEpisodes   ?? null,
      hiAnimeEnriched: true,
      enrichedAt: Date.now(),
    };

    console.log(
      `  [HiAnime Enrich] ✅ ${label} enriched →` +
      ` total=${enriched.totalEpisodes ?? "?"} |` +
      ` sub=${enriched.subEpisodes ?? "?"} |` +
      ` dub=${enriched.dubEpisodes ?? "?"}`
    );

    return enriched;

  } catch (err) {
    // Top-level catch — guarantee we never crash the caller
    console.error(`  [HiAnime Enrich] Unexpected error for ${label}: ${err.message}`);
    return update;
  }
}

// ============================================================
// ====== ENRICH A BATCH OF UPDATES ===========================
// ============================================================

/**
 * Enriches an array of anime updates with HiAnime episode data.
 * Processes sequentially with delay to respect rate limits.
 * Failures on individual items don't affect the rest.
 *
 * @param {object[]} updates - Array of anime update objects
 * @returns {Promise<object[]>} - Array of enriched update objects
 */
async function enrichBatch(updates) {
  if (!Array.isArray(updates) || updates.length === 0) {
    return updates || [];
  }

  // Quick health check - try one request to see if API is working
  try {
    const testResult = await searchHiAnime("test");
    // If we get here, API is working
  } catch (err) {
    console.log(`[HiAnime Enrich] ⚠️ API unavailable (${err.message}) — skipping enrichment for ${updates.length} items`);
    return updates; // Return original updates without enrichment
  }

  console.log(`[HiAnime Enrich] Starting batch enrichment for ${updates.length} items...`);

  const stats = { enriched: 0, skipped: 0, failed: 0 };
  const enriched = [];

  for (let i = 0; i < updates.length; i++) {
    const update = updates[i];

    try {
      const result = await enrichUpdate(update);
      enriched.push(result);

      if (result?.hiAnimeEnriched) stats.enriched++;
      else stats.skipped++;
    } catch (err) {
      // Should never reach here due to enrichUpdate's own catch,
      // but this is the final safety net for the batch
      console.error(`  [HiAnime Enrich] Batch item ${i} crashed: ${err.message}`);
      enriched.push(update); // push original to keep array length intact
      stats.failed++;
    }

    // Rate limit gap between items (except after last)
    if (i < updates.length - 1) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  const cacheStats = getCacheStats();
  console.log(
    `[HiAnime Enrich] Batch complete →` +
    ` ✅ ${stats.enriched} enriched |` +
    ` ⏭  ${stats.skipped} skipped |` +
    ` ❌ ${stats.failed} failed |` +
    ` 📦 cache: ${cacheStats.titleCacheSize} titles, ${cacheStats.episodeCacheSize} episodes`
  );

  return enriched;
}

// ============================================================
// ====== MANUAL CACHE WARM-UP (optional optimization) ========
// Call this on startup with known IDs to pre-populate cache
// and avoid search API calls for frequently tracked shows.
// ============================================================

/**
 * Pre-populates the title cache with known title → ID mappings.
 * Useful when you already know the HiAnime IDs for popular shows.
 *
 * @param {Array<{title: string, id: string}>} knownMappings
 */
function prewarmCache(knownMappings) {
  if (!Array.isArray(knownMappings)) return;

  const { titleCache } = require("../utils/hiAnimeCache");

  let count = 0;
  for (const { title, id } of knownMappings) {
    if (title && id) {
      titleCache.set(title.toLowerCase().trim(), id);
      count++;
    }
  }

  if (count > 0) {
    console.log(`[HiAnime Enrich] Cache pre-warmed with ${count} known mappings`);
  }
}

module.exports = { enrichUpdate, enrichBatch, prewarmCache };
