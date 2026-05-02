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
    
    // Extract the first post's content
    let match = html.match(/<div class="forum-board-message-text">([\s\S]*?)<\/div>/);
    if (!match) {
      console.log("❌ Could not find post content");
      return [];
    }
    
    let text = match[1]
      .replace(/<br\s*\/?>/g, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/\r/g, "");
    
    const updates = [];
    const lines = text.split(/\n/);
    
    let currentSection = null;
    
    for (let line of lines) {
      line = line.trim();
      if (!line) continue;
      
      // Detect sections
      if (line.includes("Currently Streaming")) currentSection = "streaming";
      else if (line.includes("Upcoming SimulDubbed Anime for Spring")) currentSection = "simuldub_spring";
      else if (line.includes("Upcoming SimulDubbed Anime for Summer")) currentSection = "simuldub_summer";
      else if (line.includes("Upcoming Dubbed Anime")) currentSection = "upcoming";
      else if (line.includes("Announced Dubbed Anime")) currentSection = "announced";
      
      // Skip known non-title lines
      if (line.match(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/i)) continue;
      if (line.includes("** = Dub production suspended")) continue;
      if (line.includes("* - Not confirmed")) continue;
      if (line.startsWith("Last Updated:")) continue;
      if (line.match(/^[-•]\s*\d+$/)) continue;
      
      // Extract title and date using regex
      let title = null;
      let releaseDate = null;
      let status = "confirmed";
      
      // Pattern: "Title - Month Day, Year" or "Title - Month Day. Year"
      const dateMatch = line.match(/^(.+?)\s+-\s+([A-Za-z]+\s+\d{1,2}[.,]?\s+\d{4})/);
      if (dateMatch && currentSection) {
        title = dateMatch[1].trim();
        releaseDate = dateMatch[2].trim();
      } 
      // Pattern: Just a title (for "Announced" section or titles without dates)
      else if (currentSection && line.length > 3 && !line.match(/^\d/)) {
        // Remove bullet points if present
        title = line.replace(/^[-•]\s*/, "").trim();
      }
      
      // Check for unconfirmed status (* at end)
      if (title && title.endsWith("*")) {
        status = "unconfirmed";
        title = title.slice(0, -1).trim();
      }
      if (releaseDate && releaseDate.endsWith("*")) {
        status = "unconfirmed";
        releaseDate = releaseDate.slice(0, -1).trim();
      }
      
      // Skip if title is just a number or single word like "Monday"
      if (title && currentSection && title.length > 2 && !title.match(/^\d+$/)) {
        updates.push({
          title: title,
          episode: null,
          type: currentSection,
          language: "English Dub",
          source: "MAL-Forum",
          timestamp: releaseDate ? Date.parse(releaseDate) || Date.now() : Date.now(),
          releaseDate: releaseDate || null,
          status: status
        });
      }
    }
    
    console.log(`✅ Scraped ${updates.length} entries`);
    
    if (updates.length > 0) {
      console.log(`📋 Examples: ${updates.slice(0, 5).map(u => u.title).join(", ")}`);
    } else {
      console.log("⚠️ Sample of cleaned text (first 300 chars):", text.substring(0, 300));
    }
    
    return updates;
    
  } catch (err) {
    console.log(`❌ Scrape failed: ${err.message}`);
    return [];
  }
}

module.exports = fetchMALForum;