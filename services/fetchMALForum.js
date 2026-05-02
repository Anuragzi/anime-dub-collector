// ============================================================
// fetchMALForum.js — Working extractor based on your successful output
// ============================================================

const MAL_TOPIC_URL = "https://myanimelist.net/forum/?topicid=1692966";

async function fetchMALForum() {
  console.log("\n🔍 ===== MAL FORUM SCRAPE =====");
  
  try {
    const response = await fetch(MAL_TOPIC_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
    });
    
    const html = await response.text();
    
    // Use the method that actually worked (from your 2nd screenshot)
    // Remove all HTML tags to get plain text
    let text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
    
    // Find the relevant section (from "Currently Streaming" to "Announced Dubbed Anime")
    const startMarker = "Currently Streaming SimulDubbed Anime";
    const endMarker = "Announced Dubbed Anime";
    
    const startIndex = text.indexOf(startMarker);
    const endIndex = text.indexOf(endMarker, startIndex);
    
    if (startIndex === -1 || endIndex === -1) {
      console.log("❌ Could not find markers in text");
      return [];
    }
    
    let relevantText = text.substring(startIndex, endIndex);
    
    // Split by patterns that indicate a new entry
    // Pattern: "(" then "Episodes:" then ")" then "/" then next title
    const entries = [];
    
    // Match pattern: Title (Episodes: X/Y) 
    const episodePattern = /([A-Z][a-zA-Z0-9\s:!?'"&,-]+?)\s+\(Episodes:\s*([\d?]+)\/([\d?]+)\)/g;
    
    let match;
    while ((match = episodePattern.exec(relevantText)) !== null) {
      let title = match[1].trim();
      const currentEp = match[2];
      const totalEp = match[3];
      
      // Clean title (remove leading numbers/bullets)
      title = title.replace(/^[-•\d.]+\s*/, "");
      
      if (title.length > 2 && !title.match(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/i)) {
        entries.push({
          title: title,
          episode: parseInt(currentEp) || null,
          totalEpisodes: parseInt(totalEp) || null,
          type: "streaming",
          language: "English Dub",
          source: "MAL-Forum",
          timestamp: Date.now(),
          status: "confirmed"
        });
      }
    }
    
    // Also catch titles without episode info (for upcoming/announced sections)
    // Look for bullet points
    const bulletPattern = /[-•]\s*([A-Z][a-zA-Z0-9\s:!?'"&,-]+?)(?=\s+[-•]|\s*$)/g;
    let bulletMatch;
    while ((bulletMatch = bulletPattern.exec(relevantText)) !== null) {
      let title = bulletMatch[1].trim();
      title = title.replace(/\*+$/, "").trim();
      
      // Skip if already added via episode pattern
      if (title.length > 2 && !entries.some(e => e.title === title) && 
          !title.match(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/i)) {
        entries.push({
          title: title,
          episode: null,
          totalEpisodes: null,
          type: "upcoming",
          language: "English Dub",
          source: "MAL-Forum",
          timestamp: Date.now(),
          status: title.includes("*") ? "unconfirmed" : "confirmed"
        });
      }
    }
    
    console.log(`✅ Scraped ${entries.length} entries`);
    
    if (entries.length > 0) {
      console.log(`📋 Examples: ${entries.slice(0, 5).map(e => e.title).join(", ")}`);
    } else {
      console.log("⚠️ Sample text (first 500 chars):", relevantText.substring(0, 500));
    }
    
    return entries;
    
  } catch (err) {
    console.log(`❌ Scrape failed: ${err.message}`);
    return [];
  }
}

module.exports = fetchMALForum;