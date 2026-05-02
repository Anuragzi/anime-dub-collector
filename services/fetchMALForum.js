// ============================================================
// fetchMALForum.js — Scrape dubbed anime from MAL forum thread
// ============================================================

const MAL_TOPIC_URL = "https://myanimelist.net/forum/?topicid=1692966";

function parseDubDate(dateStr) {
  if (!dateStr) return null;
  const cleaned = dateStr.replace(/(\d+)\.\s+(\d{4})/, "$1, $2");
  const timestamp = Date.parse(cleaned);
  return isNaN(timestamp) ? null : timestamp;
}

function parseLine(line) {
  let cleaned = line.replace(/^[-*•]\s*/, "").trim();
  if (!cleaned) return null;

  const lastDashIndex = cleaned.lastIndexOf(" - ");
  if (lastDashIndex !== -1) {
    const title = cleaned.substring(0, lastDashIndex).trim();
    const dateStr = cleaned.substring(lastDashIndex + 3).trim();
    const timestamp = parseDubDate(dateStr);
    
    if (title && timestamp) {
      return { title, releaseDate: timestamp };
    }
  }
  
  return { title: cleaned, releaseDate: null };
}

async function fetchMALForum() {
  console.log("\n🔍 ===== MAL FORUM SCRAPE =====");
  
  try {
    const response = await fetch(MAL_TOPIC_URL, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    
    const html = await response.text();
    
    // Extract the first post's text content
    const postMatch = html.match(/<div class="forum-board-message-text">([\s\S]*?)<\/div>/);
    
    if (!postMatch) {
      console.log("❌ Could not find post content");
      return [];
    }
    
    // Clean HTML tags
    let text = postMatch[1]
      .replace(/<br\s*\/?>/g, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&amp;/g, "&");
    
    const updates = [];
    let currentSection = null;
    const lines = text.split(/\n/);
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Detect sections
      if (trimmed.includes("Currently Streaming")) currentSection = "streaming";
      else if (trimmed.includes("Upcoming SimulDubbed Anime for Spring")) currentSection = "simuldub";
      else if (trimmed.includes("Upcoming SimulDubbed Anime for Summer")) currentSection = "simuldub";
      else if (trimmed.includes("Upcoming Dubbed Anime")) currentSection = "upcoming";
      else if (trimmed.includes("Announced Dubbed Anime")) currentSection = "announced";
      
      // Parse bullet points
      if (trimmed.startsWith("-") && currentSection && !trimmed.match(/^- \d+$/)) {
        const parsed = parseLine(trimmed);
        if (parsed && parsed.title && parsed.title.length > 2) {
          updates.push({
            title: parsed.title.replace(/\*$/, "").trim(),
            type: currentSection,
            language: "English Dub",
            source: "MAL-Forum",
            timestamp: parsed.releaseDate || Date.now(),
            releaseDate: parsed.releaseDate,
            status: parsed.title.includes("*") ? "unconfirmed" : "confirmed"
          });
        }
      }
    }
    
    console.log(`✅ Scraped ${updates.length} dubbed anime entries`);
    if (updates.length > 0) {
      console.log(`📋 Examples: ${updates.slice(0, 3).map(u => u.title).join(", ")}`);
    }
    
    return updates;
    
  } catch (err) {
    console.log(`❌ Scrape failed: ${err.message}`);
    return [];
  }
}

module.exports = fetchMALForum;