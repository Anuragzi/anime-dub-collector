// ============================================================
// fetchMALForum.js — FIXED episode number extraction
// ============================================================

const MAL_TOPIC_URL = "https://myanimelist.net/forum/?topicid=1692966";

async function fetchMALForum() {
  console.log("\n🔍 ===== MAL FORUM SCRAPE =====");
  
  try {
    const response = await fetch(MAL_TOPIC_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
    });
    
    const html = await response.text();
    
    // Remove all HTML tags to get plain text
    let text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
    
    // Find the relevant section
    const startMarker = "Currently Streaming SimulDubbed Anime";
    const endMarker = "Announced Dubbed Anime";
    
    const startIndex = text.indexOf(startMarker);
    const endIndex = text.indexOf(endMarker, startIndex);
    
    if (startIndex === -1 || endIndex === -1) {
      console.log("❌ Could not find markers in text");
      return [];
    }
    
    let relevantText = text.substring(startIndex, endIndex);
    
    // DEBUG: Log first 500 chars to see what we're working with
    console.log("📝 Debug - Raw text sample:", relevantText.substring(0, 300));
    
    const entries = [];
    
    // ============================================================
    // FIXED: Better pattern to match "Title (Episodes: X/Y)"
    // ============================================================
    
    // Split by lines first (the forum text has line breaks)
    const lines = relevantText.split(/\n/);
    
    for (let line of lines) {
      line = line.trim();
      if (!line) continue;
      
      // Look for pattern: "Title (Episodes: 3/?)" or "Title (Episodes: 3/12)"
      // This regex captures:
      // Group 1: Title (anything before the parentheses)
      // Group 2: Current episode number
      // Group 3: Total episodes (could be ? or number)
      const episodeMatch = line.match(/^[-\s•*]*([^(]+?)\s*\(Episodes?:\s*(\d+)\/([?\d]+)\)/i);
      
      if (episodeMatch) {
        let title = episodeMatch[1].trim();
        const currentEp = episodeMatch[2];
        const totalEp = episodeMatch[3];
        
        // Clean up title - remove leading bullets, numbers, etc.
        title = title.replace(/^[-•*\d.]+\s*/, "").trim();
        
        // Skip day names
        if (title.match(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/i)) {
          continue;
        }
        
        // Skip if title is too short
        if (title.length < 2) continue;
        
        console.log(`📌 Found: "${title}" — Episode ${currentEp}/${totalEp === '?' ? '?' : totalEp}`);
        
        entries.push({
          title: title,
          episode: parseInt(currentEp),
          totalEpisodes: totalEp === '?' ? null : parseInt(totalEp),
          type: "streaming",
          language: "English Dub",
          source: "MAL-Forum",
          timestamp: Date.now(),
          status: "confirmed",
          normalizedTitle: title.toLowerCase()
        });
      } else {
        // Also catch just the episode number pattern for titles without the word "Episodes"
        const altMatch = line.match(/^[-\s•*]*([^(]+?)\s*\((\d+)\/([?\d]+)\)/i);
        if (altMatch) {
          let title = altMatch[1].trim();
          const currentEp = altMatch[2];
          const totalEp = altMatch[3];
          
          title = title.replace(/^[-•*\d.]+\s*/, "").trim();
          
          if (title.length > 2 && !title.match(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/i)) {
            console.log(`📌 Found (alt): "${title}" — Episode ${currentEp}/${totalEp === '?' ? '?' : totalEp}`);
            
            entries.push({
              title: title,
              episode: parseInt(currentEp),
              totalEpisodes: totalEp === '?' ? null : parseInt(totalEp),
              type: "streaming",
              language: "English Dub",
              source: "MAL-Forum",
              timestamp: Date.now(),
              status: "confirmed",
              normalizedTitle: title.toLowerCase()
            });
          }
        }
      }
    }
    
    // ============================================================
    // Also extract upcoming/announced anime (no episode numbers)
    // ============================================================
    const announcedStart = text.indexOf("Announced Dubbed Anime");
    const announcedEnd = text.indexOf("Upcoming Dubbed Anime", announcedStart);
    
    if (announcedStart !== -1) {
      let announcedText = text.substring(announcedStart, announcedEnd !== -1 ? announcedEnd : announcedStart + 2000);
      
      // Look for bullet points with titles
      const bulletPattern = /[-•]\s*([A-Z][a-zA-Z0-9\s:!?'"&,-]+?)(?=\s+[-•]|\s*$)/g;
      let bulletMatch;
      
      while ((bulletMatch = bulletPattern.exec(announcedText)) !== null) {
        let title = bulletMatch[1].trim();
        title = title.replace(/\*+$/, "").trim();
        
        // Skip if already added
        if (title.length > 2 && !entries.some(e => e.title === title) && 
            !title.match(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/i)) {
          
          console.log(`📌 Upcoming: "${title}"`);
          
          entries.push({
            title: title,
            episode: null,
            totalEpisodes: null,
            type: "upcoming",
            language: "English Dub",
            source: "MAL-Forum",
            timestamp: Date.now(),
            status: "announced",
            normalizedTitle: title.toLowerCase()
          });
        }
      }
    }
    
    console.log(`✅ Scraped ${entries.length} entries with episode data`);
    
    if (entries.length === 0) {
      console.log("⚠️ No entries found. Debug - Full relevant text preview:");
      console.log(relevantText.substring(0, 1000));
    } else {
      console.log(`📋 Examples: ${entries.slice(0, 5).map(e => `${e.title} (Ep ${e.episode || '?'})`).join(", ")}`);
    }
    
    return entries;
    
  } catch (err) {
    console.log(`❌ Scrape failed: ${err.message}`);
    console.error(err.stack);
    return [];
  }
}

module.exports = fetchMALForum;