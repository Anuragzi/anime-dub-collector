// ============================================================
// fetchMALForum.js — Fetch and parse dubbed anime from MAL forum thread
// ============================================================

const MAL_TOPIC_ID = "1692966";
const MAL_API_BASE = "https://api.myanimelist.net/v2";
const MAL_CLIENT_ID = process.env.MAL_CLIENT_ID;

async function fetchMALForum() {
  console.log("\n🔍 ===== MAL FORUM FETCH START =====");
  
  // Step 1: Check if Client ID exists
  if (!MAL_CLIENT_ID) {
    console.log("❌ MAL_CLIENT_ID is missing from environment variables");
    return [];
  }
  
  console.log(`✅ MAL_CLIENT_ID found: ${MAL_CLIENT_ID.substring(0, 5)}...${MAL_CLIENT_ID.substring(27)} (${MAL_CLIENT_ID.length} chars)`);
  
  // Step 2: Validate Client ID format
  if (!/^[a-f0-9]{32}$/.test(MAL_CLIENT_ID)) {
    console.log(`⚠️ WARNING: Client ID doesn't look like a valid MAL ID (should be 32 hex chars)`);
  }
  
  try {
    const url = `${MAL_API_BASE}/forum/topic/${MAL_TOPIC_ID}`;
    console.log(`📡 Fetching URL: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        "X-MAL-CLIENT-ID": MAL_CLIENT_ID
      }
    });
    
    console.log(`📡 Response status: ${response.status} ${response.statusText}`);
    
    // Step 3: Handle non-200 responses
    if (!response.ok) {
      const errorText = await response.text();
      console.log(`❌ API Error Response Body: ${errorText.substring(0, 500)}`);
      
      if (response.status === 401) {
        console.log("❌ Authentication failed! Your Client ID is invalid or revoked.");
      } else if (response.status === 404) {
        console.log("❌ Topic not found! Check if topic ID 1692966 is correct.");
      } else if (response.status === 429) {
        console.log("❌ Rate limited! Try again later.");
      }
      return [];
    }
    
    const data = await response.json();
    console.log(`✅ API call successful!`);
    console.log(`📦 Response has ${data.posts?.length || 0} posts`);
    
    // Step 4: Extract post content
    if (!data.posts || data.posts.length === 0) {
      console.log("⚠️ No posts found in topic");
      return [];
    }
    
    const firstPost = data.posts[0];
    const body = firstPost.body || firstPost.text || "";
    console.log(`📄 Post #1 body length: ${body.length} characters`);
    
    if (body.length === 0) {
      console.log("⚠️ Post body is empty!");
      return [];
    }
    
    // Step 5: Parse the content
    const updates = parseForumPost(body);
    console.log(`📊 Final result: ${updates.length} dub entries parsed`);
    
    if (updates.length > 0) {
      console.log(`📋 First 3 entries:`);
      updates.slice(0, 3).forEach((u, i) => {
        console.log(`   ${i+1}. ${u.title} (${u.type})`);
      });
    } else {
      // Debug: Show first 500 chars of body to see what went wrong
      console.log(`\n📄 First 500 chars of forum post (for debugging):`);
      console.log("─".repeat(50));
      console.log(body.substring(0, 500));
      console.log("─".repeat(50));
    }
    
    console.log("🔍 ===== MAL FORUM FETCH END =====\n");
    return updates;
    
  } catch (err) {
    console.log(`❌ NETWORK/DNS ERROR: ${err.message}`);
    console.log(`Stack trace: ${err.stack}`);
    return [];
  }
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

module.exports = fetchMALForum;