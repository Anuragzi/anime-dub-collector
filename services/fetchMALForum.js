// ============================================================
// fetchMALForum.js — Fixed parser that saves to Firebase-ready format
// ============================================================

const MAL_TOPIC_URL = "https://myanimelist.net/forum/?topicid=1692966";

async function fetchMALForum() {
  console.log("\n🔍 ===== MAL FORUM SCRAPE =====");
  
  try {
    const response = await fetch(MAL_TOPIC_URL, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    
    const html = await response.text();
    
    // Extract post content
    let match = html.match(/<div class="forum-board-message-text">([\s\S]*?)<\/div>/);
    if (!match) {
      console.log("❌ Could not find post content");
      return [];
    }
    
    let text = match[1]
      .replace(/<br\s*\/?>/g, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/\s{2,}/g, " ");
    
    const updates = [];
    let currentSection = null;
    const lines = text.split(/\n/);
    
    for (let line of lines) {
      line = line.trim();
      if (!line) continue;
      
      // Detect sections
      if (line.includes("Currently Streaming")) currentSection = "streaming";
      else if (line.includes("Upcoming SimulDubbed Anime for Spring")) currentSection = "simuldub";
      else if (line.includes("Upcoming SimulDubbed Anime for Summer")) currentSection = "simuldub";
      else if (line.includes("Upcoming Dubbed Anime")) currentSection = "upcoming";
      else if (line.includes("Announced Dubbed Anime")) currentSection = "announced";
      
      // Match ANY line that starts with a number or has "Episodes:"
      const hasEpisodeInfo = line.match(/Episodes?:|Episode\s+\d+/i);
      const hasDash = line.startsWith("-") || line.startsWith("•");
      const hasNumbered = line.match(/^\d+\./);
      
      if ((hasDash || hasNumbered || hasEpisodeInfo) && currentSection) {
        // Extract anime title (remove episode info)
        let title = line
          .replace(/^[-•\d\.\s]+/, "")
          .replace(/\([^)]*\)/g, "")
          .replace(/Episodes?:[^)]*\)?/gi, "")
          .replace(/\*+$/, "")
          .trim();
        
        // Extract episode number if exists
        let episode = null;
        const epMatch = line.match(/Episodes?:?\s*(\d+)/i);
        if (epMatch) episode = parseInt(epMatch[1]);
        
        if (title.length > 2 && !title.match(/^\d+$/)) {
          updates.push({
            title: title,
            episode: episode,
            type: currentSection,
            language: "English Dub",
            source: "MAL-Forum",
            timestamp: Date.now(),
            status: line.includes("*") ? "unconfirmed" : "confirmed",
            rawText: line.substring(0, 100) // for debugging
          });
        }
      }
    }
    
    console.log(`✅ Scraped ${updates.length} dubbed entries ready for Firebase`);
    
    // Log first 3 as sample
    if (updates.length > 0) {
      console.log(`📋 Examples:`);
      updates.slice(0, 3).forEach((u, i) => {
        console.log(`   ${i+1}. ${u.title} (${u.type})`);
      });
    }
    
    return updates;
    
  } catch (err) {
    console.log(`❌ Scrape failed: ${err.message}`);
    return [];
  }
}

module.exports = fetchMALForum;