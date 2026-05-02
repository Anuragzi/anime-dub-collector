// ============================================================
// fetchMALForum.js — Working scraper for MAL forum
// ============================================================

const MAL_TOPIC_URL = "https://myanimelist.net/forum/?topicid=1692966";

async function fetchMALForum() {
  console.log("\n🔍 ===== MAL FORUM SCRAPE =====");
  
  try {
    const response = await fetch(MAL_TOPIC_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
    });
    
    const html = await response.text();
    
    // Try MULTIPLE patterns to find the post content
    let postText = "";
    
    // Pattern 1: Modern MAL structure
    let match = html.match(/<div[^>]*class="[^"]*message-text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    
    // Pattern 2: Alternative class
    if (!match) {
      match = html.match(/<td[^>]*class="[^"]*forum_board_content[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    }
    
    // Pattern 3: Look for the first post's content div
    if (!match) {
      match = html.match(/<div class="forum-board-message-text">([\s\S]*?)<\/div>/);
    }
    
    // Pattern 4: Extract ANY large text block that looks like the dub list
    if (!match) {
      const textMatch = html.match(/(Currently Streaming SimulDubbed Anime[\s\S]*?Announced Dubbed Anime[\s\S]*?<\/div>)/);
      if (textMatch) postText = textMatch[1];
    }
    
    if (match) {
      postText = match[1];
    }
    
    if (!postText || postText.length < 500) {
      console.log("❌ Could not find post content, trying raw text extraction...");
      
      // Fallback: Remove all HTML and search for known text
      const plainText = html.replace(/<[^>]*>/g, ' ');
      
      if (plainText.includes("Currently Streaming SimulDubbed Anime")) {
        // Extract from "Currently Streaming" to "Released Dubbed Anime"
        const start = plainText.indexOf("Currently Streaming SimulDubbed Anime");
        const end = plainText.indexOf("Released Dubbed Anime", start);
        if (start !== -1 && end !== -1) {
          postText = plainText.substring(start, end);
          console.log("✅ Extracted via raw text fallback");
        }
      }
    }
    
    if (!postText || postText.length < 100) {
      console.log("❌ Still cannot find content. MAL may have changed their layout.");
      return [];
    }
    
    // Clean and parse
    let text = postText
      .replace(/<br\s*\/?>/g, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .replace(/•/g, "-");
    
    const updates = [];
    let currentSection = null;
    const lines = text.split(/\n|\.\s+(?=-)/);
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      if (trimmed.includes("Currently Streaming")) currentSection = "streaming";
      else if (trimmed.includes("Upcoming SimulDubbed Anime for Spring")) currentSection = "simuldub";
      else if (trimmed.includes("Upcoming SimulDubbed Anime for Summer")) currentSection = "simuldub";
      else if (trimmed.includes("Upcoming Dubbed Anime")) currentSection = "upcoming";
      else if (trimmed.includes("Announced Dubbed Anime")) currentSection = "announced";
      
      // Match patterns like "- Anime Name - May 2, 2026" or "- Anime Name"
      const bulletMatch = trimmed.match(/^[-–•]\s*(.+?)(?:\s+-\s+(.+?))?$/);
      if (bulletMatch && currentSection) {
        let title = bulletMatch[1].trim();
        const dateStr = bulletMatch[2]?.trim();
        
        // Clean up title
        title = title.replace(/\*+$/, "").trim();
        if (title.length > 2 && !title.match(/^\d+$/)) {
          updates.push({
            title: title,
            type: currentSection,
            language: "English Dub",
            source: "MAL-Forum",
            timestamp: dateStr ? Date.parse(dateStr) || Date.now() : Date.now(),
            releaseDate: dateStr || null,
            status: line.includes("*") ? "unconfirmed" : "confirmed"
          });
        }
      }
    }
    
    console.log(`✅ Scraped ${updates.length} dubbed anime entries`);
    
    if (updates.length === 0) {
      console.log("⚠️ No entries found. The forum format may have changed.");
      // Log a sample of cleaned text for debugging
      console.log("Sample of cleaned text:", text.substring(0, 500));
    } else {
      console.log(`📋 First 3: ${updates.slice(0, 3).map(u => u.title).join(", ")}`);
    }
    
    return updates;
    
  } catch (err) {
    console.log(`❌ Scrape failed: ${err.message}`);
    return [];
  }
}

module.exports = fetchMALForum;