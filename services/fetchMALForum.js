// ============================================================
// fetchMALForum.js — Direct text extraction from MAL forum
// ============================================================

const MAL_TOPIC_URL = "https://myanimelist.net/forum/?topicid=1692966";

async function fetchMALForum() {
  console.log("\n🔍 ===== MAL FORUM SCRAPE (Direct Text) =====");
  
  try {
    const response = await fetch(MAL_TOPIC_URL, {
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });
    
    const html = await response.text();
    
    // Extract the first post's content div
    let match = html.match(/<div class="forum-board-message-text">([\s\S]*?)<\/div>/);
    if (!match) {
      console.log("❌ Could not find post content");
      return [];
    }
    
    // Convert HTML to plain text
    let text = match[1]
      .replace(/<br\s*\/?>/g, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&nbsp;/g, " ")
      .replace(/\r/g, "")
      .replace(/\n\s*\n/g, "\n");
    
    const updates = [];
    
    // Helper to extract titles from a section
    function extractFromSection(sectionName, startMarker, endMarker, type) {
      // Find the section
      const startIndex = text.indexOf(startMarker);
      if (startIndex === -1) return;
      
      let endIndex = text.indexOf(endMarker, startIndex);
      if (endIndex === -1) endIndex = text.length;
      
      const sectionText = text.substring(startIndex, endIndex);
      const lines = sectionText.split("\n");
      
      for (let line of lines) {
        line = line.trim();
        if (!line) continue;
        
        // Skip lines that are just numbers or headers
        if (line.match(/^\d+$/)) continue;
        if (line.includes("Not confirmed")) continue;
        if (line.match(/^[-•]\s*\d+$/)) continue;
        
        // Remove bullet points
        let cleanLine = line.replace(/^[-•]\s*/, "");
        
        // Extract title and date
        let title = null;
        let releaseDate = null;
        let status = "confirmed";
        
        // Pattern: "Title - Month Day, Year"
        const dateMatch = cleanLine.match(/^(.+?)\s+-\s+([A-Za-z]+\s+\d{1,2}[,.]?\s+\d{4})/);
        if (dateMatch) {
          title = dateMatch[1].trim();
          releaseDate = dateMatch[2].trim().replace(/\./, ",");
        } 
        // Pattern: Just a title (no date)
        else if (cleanLine.length > 3 && !cleanLine.match(/^\d/)) {
          title = cleanLine;
        }
        
        // Check for unconfirmed status
        if (title && title.endsWith("*")) {
          status = "unconfirmed";
          title = title.slice(0, -1).trim();
        }
        
        // Skip weekdays and short words
        if (title && title.length > 2 && !title.match(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/i)) {
          updates.push({
            title: title,
            episode: null,
            type: type,
            language: "English Dub",
            source: "MAL-Forum",
            timestamp: releaseDate ? Date.parse(releaseDate) || Date.now() : Date.now(),
            releaseDate: releaseDate || null,
            status: status,
            section: sectionName
          });
        }
      }
    }
    
    // Extract from each section
    console.log("📋 Processing sections...");
    
    // Spring 2026 SimulDubs
    extractFromSection(
      "Spring 2026",
      "Upcoming SimulDubbed Anime for Spring 2026",
      "Upcoming SimulDubbed Anime for Summer",
      "simuldub_spring"
    );
    
    // Summer 2026 SimulDubs
    extractFromSection(
      "Summer 2026",
      "Upcoming SimulDubbed Anime for Summer 2026",
      "Upcoming Dubbed Anime",
      "simuldub_summer"
    );
    
    // Upcoming Dubbed Anime
    extractFromSection(
      "Upcoming",
      "Upcoming Dubbed Anime",
      "Released Dubbed Anime Awaiting Streaming",
      "upcoming"
    );
    
    // Announced Dubbed Anime
    extractFromSection(
      "Announced",
      "Announced Dubbed Anime",
      "Released Dubbed Anime",
      "announced"
    );
    
    // Remove duplicates (same title in multiple sections)
    const uniqueTitles = new Map();
    for (const update of updates) {
      const key = update.title.toLowerCase();
      if (!uniqueTitles.has(key)) {
        uniqueTitles.set(key, update);
      }
    }
    
    const finalUpdates = Array.from(uniqueTitles.values());
    
    console.log(`✅ Scraped ${finalUpdates.length} unique dub entries`);
    
    if (finalUpdates.length > 0) {
      console.log(`📋 Examples:`);
      finalUpdates.slice(0, 10).forEach((u, i) => {
        console.log(`   ${i+1}. ${u.title}${u.releaseDate ? ` (${u.releaseDate})` : ""} [${u.type}]`);
      });
    } else {
      console.log("⚠️ No entries found. Sample text (first 500 chars):");
      console.log(text.substring(0, 500));
    }
    
    return finalUpdates;
    
  } catch (err) {
    console.log(`❌ Scrape failed: ${err.message}`);
    return [];
  }
}

module.exports = fetchMALForum;