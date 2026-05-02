// ============================================================
// fetchMALForum.js — Fetch and parse dubbed anime from MAL forum thread
// ============================================================

const MAL_TOPIC_ID = "1692966";
const MAL_API_BASE = "https://api.myanimelist.net/v2";
const MAL_CLIENT_ID = process.env.MAL_CLIENT_ID;

if (!MAL_CLIENT_ID) {
  console.warn("⚠️ MAL_CLIENT_ID not set in .env — MAL forum fetching disabled");
}

// Parse a date string like "May 2, 2026" or "May 15. 2026" (note the period)
function parseDubDate(dateStr) {
  if (!dateStr) return null;
  // Clean up common issues: replace "." after day with ","
  const cleaned = dateStr.replace(/(\d+)\.\s+(\d{4})/, "$1, $2");
  const timestamp = Date.parse(cleaned);
  return isNaN(timestamp) ? null : timestamp;
}

// Extract anime title and date from lines like:
// "- NEEDY GIRL OVERDOSE - May 2, 2026"
// "My Hero Academia: More - May 2, 2026"
// "BLACK TORCH" (no date)
function parseLine(line) {
  // Remove bullet points and leading/trailing spaces
  let cleaned = line.replace(/^[-*•]\s*/, "").trim();
  if (!cleaned) return null;

  // Check for "Title - Date" pattern
  const lastDashIndex = cleaned.lastIndexOf(" - ");
  if (lastDashIndex !== -1) {
    const title = cleaned.substring(0, lastDashIndex).trim();
    const dateStr = cleaned.substring(lastDashIndex + 3).trim();
    const timestamp = parseDubDate(dateStr);
    
    if (title && timestamp) {
      return { title, releaseDate: timestamp, dateStr };
    }
  }
  
  // No date found, just return title
  return { title: cleaned, releaseDate: null, dateStr: null };
}

// Parse sections from the forum post body
function parseForumPost(body) {
  const updates = [];
  const lines = body.split(/\r?\n/);
  
  let currentSection = null;
  let isInBulletList = false;
  
  // Section headers to track
  const sectionMap = {
    "Currently Streaming SimulDubbed Anime": "streaming",
    "Upcoming SimulDubbed Anime for Spring 2026": "upcoming_spring",
    "Upcoming SimulDubbed Anime for Summer 2026": "upcoming_summer",
    "Upcoming Dubbed Anime": "upcoming",
    "Released Dubbed Anime Awaiting Streaming": "awaiting",
    "Announced Dubbed Anime": "announced"
  };
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    // Check if this line is a section header
    let matchedSection = null;
    for (const [header, sectionKey] of Object.entries(sectionMap)) {
      if (trimmed === header || trimmed.startsWith(header + " -") || trimmed === `## ${header}`) {
        currentSection = sectionKey;
        isInBulletList = false;
        matchedSection = sectionKey;
        break;
      }
    }
    if (matchedSection) continue;
    
    // Skip numeric counts like "- 38" or section metadata
    if (/^[-*•]\s*\d+$/.test(trimmed)) continue;
    if (trimmed.includes("** = Dub production suspended")) continue;
    if (trimmed.includes("* = Not confirmed")) continue;
    if (trimmed.includes("* - These are theatrical releases")) continue;
    if (trimmed.startsWith("Last Updated:")) continue;
    if (trimmed.startsWith("SIDE NOTE:")) continue;
    if (trimmed.startsWith("NOTE:")) continue;
    
    // Check if line starts with a bullet point
    const isBullet = /^[-*•]\s/.test(trimmed);
    
    if (isBullet || (currentSection && trimmed.match(/^[A-Za-z0-9\s\-:]+$/))) {
      const parsed = parseLine(trimmed);
      if (parsed && parsed.title && parsed.title.length > 1) {
        // Determine type based on section
        let type = "upcoming";
        if (currentSection === "streaming") type = "streaming";
        else if (currentSection === "awaiting") type = "awaiting_streaming";
        else if (currentSection === "announced") type = "announced";
        else if (currentSection === "upcoming_spring" || currentSection === "upcoming_summer") type = "simuldub";
        
        // Check for unconfirmed marker (* at end)
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
          type: type,
          language: "English Dub",
          source: "MAL-Forum",
          timestamp: parsed.releaseDate || Date.now(),
          releaseDate: parsed.releaseDate,
          status: status,
          section: currentSection
        });
      }
      isInBulletList = true;
    } else if (currentSection && isInBulletList && !trimmed.match(/^[-*•]/)) {
      // End of bullet list
      isInBulletList = false;
    }
  }
  
  return updates;
}

async function fetchMALForum() {
  if (!MAL_CLIENT_ID) {
    console.log("⏭ MAL_CLIENT_ID missing, skipping MAL forum fetch");
    return [];
  }
  
  try {
    const url = `${MAL_API_BASE}/forum/topic/${MAL_TOPIC_ID}`;
    const response = await fetch(url, {
      headers: {
        "X-MAL-CLIENT-ID": MAL_CLIENT_ID
      }
    });
    
    if (!response.ok) {
      throw new Error(`MAL API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Find the first post (topic starter)
    if (!data.posts || data.posts.length === 0) {
      console.log("No posts found in MAL topic");
      return [];
    }
    
    const firstPost = data.posts[0];
    const body = firstPost.body || firstPost.text || "";
    
    const updates = parseForumPost(body);
    console.log(`📋 MAL-Forum: Found ${updates.length} dub entries`);
    
    return updates;
    
  } catch (err) {
    console.error(`Error fetching MAL forum: ${err.message}`);
    return [];
  }
}

module.exports = fetchMALForum;