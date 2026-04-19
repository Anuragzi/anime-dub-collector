// ============================================================
// scripts/fetchTopAnime.js
// Fetch Top 500 Anime from AniList and store in Firebase
// ============================================================

require("dotenv").config();

const axios = require("axios");
const { getDb } = require("../firebase");

const ANILIST_URL = "https://graphql.anilist.co";
const PER_PAGE = 50;
const TOTAL_PAGES = 10; // 50 * 10 = 500
const DELAY = 1200; // 1.2 sec (safe)

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchPage(page) {
  const query = `
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(type: ANIME, sort: POPULARITY_DESC) {
          id
          title {
            romaji
            english
          }
          episodes
          status
          coverImage {
            large
          }
        }
      }
    }
  `;

  const res = await axios.post(ANILIST_URL, {
    query,
    variables: { page, perPage: PER_PAGE }
  });

  return res.data.data.Page.media;
}

async function run() {
  const db = getDb();

  for (let page = 1; page <= TOTAL_PAGES; page++) {
    console.log(`📄 Fetching page ${page}...`);

    try {
      const animeList = await fetchPage(page);

      for (const anime of animeList) {
        const id = String(anime.id);

        await db.collection("animeCache").doc(id).set({
          anilistId: anime.id,
          title: anime.title.english || anime.title.romaji,
          romajiTitle: anime.title.romaji,
          englishTitle: anime.title.english,
          episodes: anime.episodes || 0,
          status: anime.status,
          coverImage: anime.coverImage?.large || null,
          savedAt: Date.now()
        });

        console.log(`✅ Saved: ${anime.title.english || anime.title.romaji}`);
      }

      await sleep(DELAY); // avoid rate limit

    } catch (err) {
      console.error(`❌ Page ${page} failed:`, err.message);
    }
  }

  console.log("🎉 DONE: Top 500 anime stored!");
}

run();