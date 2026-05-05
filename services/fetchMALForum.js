// ============================================================
// fetchMALForum.js — MAL Forum SimulDub Scraper (FIXED)
// Fetches currently streaming English dubbed anime from MAL forum
// ============================================================

async function fetchMALForum() {
  const URL = "https://myanimelist.net/forum/?topicid=1692966";

  // ─── HTML entity decoder ─────────────────────────────────────────────────
  function decodeEntities(str) {
    return str
      .replace(/&#039;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
  }

  // ─── Convert block-level / line-break tags to actual newlines ────────────
  function htmlToLines(html) {
    return html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/?(div|li|p|tr)[^>]*>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
      .replace(/[ \t]+/g, " ")
      .split("\n")
      .map((l) => decodeEntities(l).trim())
      .filter(Boolean);
  }

  // ─── Title cleaner ────────────────────────────────────────────────────────
  const DAYS = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b[,.\s-]*/i;
  const LEADING_NOISE = /^[\s\-–—•*#]+|^\d+[\s.\-–—]+/;

  function cleanTitle(raw) {
    let cleaned = raw
      .replace(DAYS, "")
      .replace(LEADING_NOISE, "")
      .replace(/^Currently Streaming SimulDubbed Anime\s*[-–—]?\s*/i, "")
      .replace(/^[\s\-–—•*#\d]+/, "")
      .trim();
    
    // Remove any leftover "Monday" etc that might remain
    cleaned = cleaned.replace(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s*/i, "");
    
    return cleaned;
  }

  // ─── Episode parser ───────────────────────────────────────────────────────
  const EP_PATTERN = /\((?:Episodes?:\s*)?(\d+)\/([\d?]+)\)/i;

  function parseEpisode(raw) {
    const m = raw.match(EP_PATTERN);
    if (!m) return null;
    return {
      episode: parseInt(m[1], 10),
      totalEpisodes: m[2] === "?" ? null : parseInt(m[2], 10),
    };
  }

  // ─── Main scrape ──────────────────────────────────────────────────────────
  try {
    console.log("\n🔍 ===== MAL FORUM SCRAPE =====");
    
    const response = await fetch(URL, {
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" 
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const lines = htmlToLines(html);
    const fullText = lines.join("\n");

    // Locate the relevant section
    const START_MARKER = "Currently Streaming SimulDubbed Anime";
    const END_MARKER = "Announced Dubbed Anime";

    const startIdx = fullText.indexOf(START_MARKER);
    if (startIdx === -1) {
      console.warn("⚠️ Start marker not found — page structure may have changed.");
      return [];
    }

    const endIdx = fullText.indexOf(END_MARKER, startIdx);
    const section = endIdx !== -1
      ? fullText.substring(startIdx, endIdx)
      : fullText.substring(startIdx);

    // Debug: first 200 chars of cleaned section
    console.log("📝 Cleaned sample:", section.replace(/\n/g, " ").substring(0, 200));

    // Line-by-line extraction
    const ENTRY_LINE = /^(.+?)\s+\((?:Episodes?:\s*)?\d+\/[\d?]+\)/i;

    const entries = [];
    const sectionLines = section.split("\n");

    for (const line of sectionLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const lineMatch = trimmed.match(ENTRY_LINE);
      if (!lineMatch) continue;

      const rawTitle = lineMatch[1];
      const epData = parseEpisode(trimmed);
      if (!epData) continue;

      let title = cleanTitle(rawTitle);

      // Skip if title is empty or too short
      if (title.length < 2) continue;

      // Skip section header
      if (/currently streaming simuldubbed anime/i.test(title)) continue;

      const entry = {
        title: title,
        episode: epData.episode,
        totalEpisodes: epData.totalEpisodes,
        type: "streaming",
        language: "English Dub",
        source: "MAL-Forum",
        timestamp: Date.now(),
        status: "confirmed",
        normalizedTitle: title.toLowerCase(),
      };

      console.log(`✅ Found: "${entry.title}" → Episode ${entry.episode}`);
      entries.push(entry);
    }

    console.log(`✅ Scraped ${entries.length} entries`);
    
    if (entries.length === 0) {
      console.log("⚠️ No entries found. Full section preview:");
      console.log(section.substring(0, 500));
    }
    
    return entries;

  } catch (err) {
    console.error("❌ fetchMALForum failed:", err.message);
    return [];
  }
}

// Export for your index.js
module.exports = fetchMALForum;