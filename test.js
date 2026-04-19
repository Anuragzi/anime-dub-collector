// ============================================================
// test.js — Quick test for enrichAnime
// ============================================================

require("dotenv").config();

const { initFirebase } = require("./firebase");
initFirebase(); // 🔥 initialize first

const { enrichAnime } = require("./services/enrichAnime");

async function test() {
  console.log("🔍 Searching for: Jujutsu Kaisen\n");
  
  const result = await enrichAnime("Jujutsu Kaisen");
  
  if (result.found) {
    console.log("✅ Found!\n");
    console.log(result.formatted);
    console.log("\n--- Raw Data ---");
    console.log("AniList ID:", result.anilistId);
    console.log("Episodes:", result.episodes);
    console.log("Status:", result.status);
    console.log("Dub Data:", result.dubData);
  } else {
    console.log("❌ Not found:", result.error);
  }
}

test();