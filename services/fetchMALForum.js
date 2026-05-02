// ============================================================
// fetchMALForum.js — Scrape dubbed anime from MAL forum thread
// ============================================================

const MAL_TOPIC_URL = "https://myanimelist.net/forum/?topicid=1692966";

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

// Parse forum post body from HTML
function parseForumPostFromHTML(html) {
  const updates = [];
  
  // Extract the first post's content
  // Look for the <div class="forum-board-message"> or similar
  let postContent = "";
  
  // Method 1: Find the first post's message div
  const msgMatch = html.match(/<div class="forum-board-message[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>\s*<div class="forum-board-footer/);
  if (msgMatch) {
    postContent = msgMatch[1];
  }
  
  // Method 2: Fallback - extract plain text from the first post area
  if (!postContent) {
    const titleMatch = html.match(/<div class="forum-board-message clearfix">\s*<div class="forum-board-message-text">([\s\S]*?)<\/div>/);
    if (titleMatch) {
      postContent = titleMatch[1];
    }
  }
  
  if (!postContent) {
    console.log("⚠️ Could not extract post content from HTML");
    return [];
  }
  
  // Clean HTML tags
  let text = postContent
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
  
  // Parse line by line
  const lines = text.split(/\r?\n/);
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
  console.log("\n🔍 ===== MAL FORUM FETCH (Direct Scrape) =====");
  
  try {
    console.log(`📡 Fetching URL: ${MAL_TOPIC_URL}`);
    
    const response = await fetch(MAL_TOPIC_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });
    
    console.log(`📡 Response status: ${response.status}`);
    
    if (!response.ok) {
      console.log(`❌ Failed to fetch: ${response.status}`);
      return [];
    }
    
    const html = await response.text();
    console.log(`📄 HTML length: ${html.length} characters`);
    
    const updates = parseForumPostFromHTML(html);
    console.log(`📊 Final result: ${updates.length} dub entries parsed`);
    
    if (updates.length > 0) {
      console.log(`📋 First 3 entries:`);
      updates.slice(0, 3).forEach((u, i) => {
        console.log(`   ${i+1}. ${u.title} (${u.type})`);
      });
    }
    
    console.log("🔍 ===== MAL FORUM FETCH END =====\n");
    return updates;
    
  } catch (err) {
    console.log(`❌ Scraping error: ${err.message}`);
    return [];
  }
}

module.exports = fetchMALForum;