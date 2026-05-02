// ============================================================
// fetchMALForum.js — Fetch dubbed anime from MAL forum thread using Jikan API
// ============================================================

const JIKAN_API_BASE = "https://api.jikan.moe/v4";
const MAL_TOPIC_ID = "1692966";

// Rate limiting: Jikan API allows ~3 requests per second
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Parse a date string like "May 2, 2026" or "May 15. 2026"
function parseDubDate(dateStr) {
  if (!dateStr) return null;
  const cleaned = dateStr.replace(/(\d+)\.\s+(\d{4})/, "$1, $2");
  const timestamp = Date.parse(cleaned);
  return isNaN(timestamp) ? null : timestamp;
}

// Parse individual line
function parseLine(line) {
  let cleaned = line.replace(/^[-*•]\s*/, "").trim();
  if (!cleaned) return null;

  const lastDashIndex = cleaned.lastIndexOf(" - ");
  if (lastDashIndex !== -1) {
    const title = cleaned.substring(0, lastDashIndex).trim();
    const dateStr = cleaned.substring(lastDashIndex + 3).trim();
    const timestamp = parseDubDate(dateStr);
    
    if (title && timestamp) {
      return { title, releaseDate: timestamp, dateStr };
    }
  }
  
  return { title: cleaned, releaseDate: null, dateStr: null };
}

// Parse forum post body
function parseForumPost(body) {
  const updates = [];
  const lines = body.split(/\r?\n/);
  
  let currentSection = null;
  
  const sectionMap = {
    "Currently Streaming SimulDubbed Anime": "streaming",
    "Upcoming SimulDubbed Anime for Spring 2026": "simuldub",
    "Upcoming SimulDubbed Anime for Summer 2026": "simuldub",
    "Upcoming Dubbed Anime": "upcoming",
    "Released Dubbed Anime Awaiting Streaming": "awaiting",
    "Announced Dubbed Anime": "announced"
  };
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    // Check for section headers
    for (const [header, sectionKey] of Object.entries(sectionMap)) {
      if (trimmed.includes(header)) {
        currentSection = sectionKey;
        break;
      }
    }
    
    // Skip non-content lines
    if (/^[-*•]\s*\d+$/.test(trimmed)) continue;
    if (trimmed.includes("** = Dub production suspended")) continue;
    if (trimmed.includes("* = Not confirmed")) continue;
    if (trimmed.startsWith("Last Updated:")) continue;
    if (trimmed.startsWith("SIDE NOTE:")) continue;
    if (trimmed.startsWith("NOTE:")) continue;
    
    // Parse bullet points
    const isBullet = /^[-*•]\s/.test(trimmed);
    if (isBullet && currentSection) {
      const parsed = parseLine(trimmed);
      if (parsed && parsed.title && parsed.title.length > 1) {
        let status = "confirmed";
        let cleanTitle = parsed.title;
        if (cleanTitle.endsWith("*")) {
          status = "unconfirmed";
          cleanTitle = cleanTitle.slice(0, -1).trim();
        } else if (cleanTitle.endsWith("**")) {
          status = "suspended";
          cleanTitle = cleanTitle.slice(0, -2).trim();
        }
        
        updates.push({
          title: cleanTitle,
          originalTitle: parsed.title,
          episode: null,
          type: currentSection,
          language: "English Dub",
          source: "MAL-Forum",
          timestamp: parsed.releaseDate || Date.now(),
          releaseDate: parsed.releaseDate,
          status: status
        });
      }
    }
  }
  
  return updates;
}

async function fetchMALForum() {
  console.log("\n🔍 ===== MAL FORUM FETCH (via Jikan API) =====");
  
  try {
    // ✅ CORRECT ENDPOINT: /forum/topic/{id}
    const url = `${JIKAN_API_BASE}/forum/topic/${MAL_TOPIC_ID}`;
    console.log(`📡 Fetching URL: ${url}`);
    
    const response = await fetch(url);
    
    console.log(`📡 Response status: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      console.log(`❌ Jikan API error: ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    
    // Check the response structure
    console.log(`📦 Response data keys: ${Object.keys(data)}`);
    
    if (!data.data) {
      console.log("⚠️ No data found in response");
      return [];
    }
    
    // Get the first post (original post)
    const topicData = data.data;
    const firstPost = topicData;
    const body = firstPost?.body || "";
    
    console.log(`✅ Topic title: ${topicData.title || 'N/A'}`);
    console.log(`📄 Post body length: ${body.length} characters`);
    
    if (!body) {
      console.log("⚠️ First post body is empty");
      return [];
    }
    
    const updates = parseForumPost(body);
    console.log(`📊 Final result: ${updates.length} dub entries parsed`);
    
    if (updates.length > 0) {
      console.log(`📋 First 3 entries:`);
      updates.slice(0, 3).forEach((u, i) => {
        console.log(`   ${i+1}. ${u.title} (${u.type})`);
      });
    } else {
      // Debug: Show first 500 chars of body to understand format
      console.log(`\n📄 First 500 chars of forum post (for debugging):`);
      console.log("─".repeat(50));
      console.log(body.substring(0, 500));
      console.log("─".repeat(50));
    }
    
    // Respect Jikan API rate limits
    await delay(1000);
    
    console.log("🔍 ===== MAL FORUM FETCH END =====\n");
    return updates;
    
  } catch (err) {
    console.log(`❌ Jikan API error: ${err.message}`);
    return [];
  }
}

module.exports = fetchMALForum;