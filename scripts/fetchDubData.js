// scripts/fetchDubData.js
// Fetch dub data from AnimeSchedule for all cached anime
// Handles BOTH ongoing (timetable) AND completed dubs

require("dotenv").config();

const axios = require("axios");
const fs = require("fs");
const { getDb } = require("../firebase");

const DELAY = 500; // 0.5 sec between requests
const PROGRESS_FILE = "./dub_fetch_progress.json";

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function saveProgress(currentIndex, animeId, title) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify({
    currentIndex,
    animeId,
    title,
    lastUpdated: new Date().toISOString()
  }));
  console.log(`💾 Progress saved: ${currentIndex + 1} anime processed`);
}

function loadProgress() {
  try {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE));
  } catch {
    return null;
  }
}

async function getDubCount(anilistId, title, totalEpisodes) {
  if (!process.env.ANIMESCHEDULE_KEY) {
    console.log("⚠️ ANIMESCHEDULE_KEY not set");
    return null;
  }

  try {
    // Step 1: Get anime info from AnimeSchedule
    const animeRes = await axios.get("https://animeschedule.net/api/v3/anime", {
      params: { "anilist-ids": parseInt(anilistId) },
      headers: { Authorization: `Bearer ${process.env.ANIMESCHEDULE_KEY}` },
      timeout: 10000,
    });

    const data = animeRes.data;
    const entry = data.anime?.[0] || (Array.isArray(data) ? data[0] : data);

    if (!entry) {
      console.log(`❌ No route found for ${title} (${anilistId})`);
      return null;
    }

    // Check for dub premiere (not the default zero date)
    const hasDubPremier = entry.dubPremier && entry.dubPremier !== "0001-01-01T00:00:00Z";
    const isFinished = entry.status?.toLowerCase() === "finished";
    const totalEps = entry.episodes || totalEpisodes || 0;
    
    // Step 2: Get dub timetable (ongoing dubs)
    const timetableRes = await axios.get("https://animeschedule.net/api/v3/timetables/dub", {
      headers: { Authorization: `Bearer ${process.env.ANIMESCHEDULE_KEY}` },
      timeout: 10000,
    });

    let timetable = timetableRes.data;
    if (!Array.isArray(timetable)) {
      timetable = timetableRes.data?.data || timetableRes.data?.results || [];
    }

    // Try multiple matching methods
    let match = null;
    
    // Method 1: Match by route
    if (entry.route) {
      match = timetable.find(t => t.route === entry.route);
    }
    
    // Method 2: Match by AniList ID
    if (!match) {
      match = timetable.find(t => 
        t.anilistId === parseInt(anilistId) || 
        t.anilist_id === parseInt(anilistId) ||
        (t.anilistIds && t.anilistIds.includes(parseInt(anilistId)))
      );
    }
    
    // Method 3: Match by English title
    if (!match && entry.names?.english) {
      const englishTitle = entry.names.english.toLowerCase();
      match = timetable.find(t => {
        const tTitle = (t.title || t.english || '').toLowerCase();
        return tTitle === englishTitle || tTitle.includes(englishTitle) || englishTitle.includes(tTitle);
      });
    }

    // CASE 1: Ongoing dub (found in timetable)
    if (match) {
      const nextEpNum = match.episodeNumber || 0;
      const currentDubbed = Math.max(0, nextEpNum - 1);
      const nextEpDate = match.episodeDate ? new Date(match.episodeDate) : null;

      console.log(`✅ [ONGOING] ${title}: EP${currentDubbed} dubbed (next: EP${nextEpNum})`);

      return {
        dubEpisodes: currentDubbed,
        nextEpisode: nextEpNum,
        nextEpisodeDate: nextEpDate,
        isFinished: false,
        dubStatus: "ongoing",
        totalEpisodes: totalEps,
      };
    }
    
    // CASE 2: Completed dub (has dubPremier AND finished)
    else if (hasDubPremier && isFinished && totalEps > 0) {
      console.log(`✅ [COMPLETED] ${title}: All ${totalEps} episodes dubbed`);

      return {
        dubEpisodes: totalEps,
        nextEpisode: null,
        nextEpisodeDate: null,
        isFinished: true,
        dubStatus: "completed",
        totalEpisodes: totalEps,
      };
    }
    
    // CASE 3: Has dub but not finished (dub exists but no upcoming schedule)
    else if (hasDubPremier) {
      console.log(`⏳ [HAS DUB] ${title}: Dub exists (started ${entry.dubPremier?.split('T')[0]}) but no upcoming episodes`);
      
      return {
        dubEpisodes: 0,
        nextEpisode: null,
        nextEpisodeDate: null,
        isFinished: false,
        dubStatus: "pending",
        totalEpisodes: totalEps,
      };
    }
    
    // CASE 4: No dub at all
    else {
      console.log(`❌ [NO DUB] ${title}: No English dub available`);
      return null;
    }

  } catch (err) {
    console.error(`❌ Error for ${title}:`, err.message);
    return null;
  }
}

async function run() {
  const db = getDb();

  console.log("📚 Fetching all anime from animeCache...");
  
  let animeList = [];
  try {
    const snapshot = await db.collection("animeCache").get();
    animeList = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  } catch (err) {
    console.error("❌ Failed to fetch from animeCache:", err.message);
    console.log("💡 Make sure you've run fetchTopAnime.js first!");
    process.exit(1);
  }

  console.log(`📊 Found ${animeList.length} anime in cache`);

  // Check for saved progress
  const savedProgress = loadProgress();
  let startIndex = 0;
  
  if (savedProgress) {
    console.log(`📌 Found saved progress from ${savedProgress.lastUpdated}`);
    console.log(`   Last processed: ${savedProgress.title} (Index: ${savedProgress.currentIndex + 1})`);
    console.log(`   Resuming from next anime...`);
    startIndex = savedProgress.currentIndex + 1;
  }

  if (startIndex > 0 && startIndex < animeList.length) {
    console.log(`⏩ Resuming from anime #${startIndex + 1} of ${animeList.length}`);
  } else if (startIndex >= animeList.length) {
    console.log(`✅ All anime already processed!`);
    return;
  }

  let ongoingCount = 0;
  let completedCount = 0;
  let pendingCount = 0;
  let noDubCount = 0;
  let errorCount = 0;

  for (let i = startIndex; i < animeList.length; i++) {
    const anime = animeList[i];
    console.log(`\n[${i + 1}/${animeList.length}] 🔍 Processing: ${anime.title} (${anime.anilistId})`);

    try {
      const dubData = await getDubCount(anime.anilistId, anime.title, anime.episodes);

      if (dubData) {
        // Save dub data to dubCache collection
        await db.collection("dubCache").doc(anime.id).set({
          anilistId: anime.anilistId,
          title: anime.title,
          romajiTitle: anime.romajiTitle || null,
          englishTitle: anime.englishTitle || null,
          coverImage: anime.coverImage || null,
          totalEpisodes: dubData.totalEpisodes || anime.episodes || 0,
          dubEpisodes: dubData.dubEpisodes,
          nextEpisode: dubData.nextEpisode,
          nextEpisodeDate: dubData.nextEpisodeDate,
          isFinished: dubData.isFinished,
          dubStatus: dubData.dubStatus,
          lastUpdated: new Date(),
        }, { merge: true });

        if (dubData.dubStatus === "ongoing") ongoingCount++;
        else if (dubData.dubStatus === "completed") completedCount++;
        else if (dubData.dubStatus === "pending") pendingCount++;
      } else {
        noDubCount++;
      }
    } catch (err) {
      console.error(`❌ Failed to process ${anime.title}:`, err.message);
      errorCount++;
    }

    // Save progress every 10 anime
    if ((i + 1) % 10 === 0 || i === animeList.length - 1) {
      saveProgress(i, anime.anilistId, anime.title);
    }

    await sleep(DELAY);
  }

  // Final Summary
  console.log("\n" + "=".repeat(60));
  console.log("📊 FINAL SUMMARY");
  console.log("=".repeat(60));
  console.log(`📚 Total anime processed: ${animeList.length}`);
  console.log(`✅ Ongoing dubs: ${ongoingCount}`);
  console.log(`✅ Completed dubs: ${completedCount}`);
  console.log(`⏳ Pending dubs (has dub, no schedule): ${pendingCount}`);
  console.log(`❌ No dub available: ${noDubCount}`);
  if (errorCount > 0) console.log(`⚠️ Errors: ${errorCount}`);
  console.log("=".repeat(60));
  console.log(`💾 Dub data saved in 'dubCache' collection`);
  console.log("=".repeat(60));
  
  // Delete progress file when done
  if (fs.existsSync(PROGRESS_FILE)) {
    fs.unlinkSync(PROGRESS_FILE);
    console.log("🗑️ Progress file deleted (complete)");
  }
}

// Run the script
run().catch(err => {
  console.error("❌ Script failed:", err.message);
  process.exit(1);
});