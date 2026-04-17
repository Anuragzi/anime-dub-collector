// ============================================================
// utils/normalizeTitle.js
// Normalizes anime titles for deduplication and matching.
// ============================================================

// Common season/part suffixes to strip for base matching
const SEASON_PATTERNS = [
  /\b(season|s)\s*\d+\b/gi,
  /\bpart\s*\d+\b/gi,
  /\bcour\s*\d+\b/gi,
  /\b\d+(st|nd|rd|th)\s+season\b/gi,
  /\bseason\b/gi,
];

// Words that indicate a dub-related post/title
const DUB_KEYWORDS = [
  "english dub",
  "eng dub",
  "dub episode",
  "dub release",
  "dubbed episode",
  "now dubbed",
  "dub announced",
  "dub premiere",
  "dub confirmation",
  "english dubbed",
  "dub date",
  "dub delay",
  "dub schedule",
  "dub update",
  "new dub",
  "dub ep",
  "[dub]",
  "(dub)",
];

/**
 * Normalizes an anime title for consistent storage and deduplication.
 * @param {string} title - Raw anime title
 * @returns {string} - Normalized title key
 */
function normalizeTitle(title) {
  if (!title || typeof title !== "string") return "";

  return title
    .toLowerCase()
    .replace(/["""''`]/g, "")           // remove quotes
    .replace(/[^\w\s]/g, " ")           // remove special chars
    .replace(/\s+/g, " ")              // collapse whitespace
    .trim();
}

/**
 * Creates a deduplication key from title + episode number.
 * This is used as the Firestore document ID.
 * @param {string} title
 * @param {number|null} episode
 * @returns {string}
 */
function makeDocId(title, episode) {
  const normalizedTitle = normalizeTitle(title)
    .replace(/\s+/g, "_")
    .slice(0, 80);                       // keep doc IDs manageable

  if (episode !== null && episode !== undefined && !isNaN(episode)) {
    return `${normalizedTitle}__ep${episode}`;
  }
  return `${normalizedTitle}__announcement`;
}

/**
 * Checks if a piece of text contains dub-related keywords.
 * @param {string} text - Post title, body, or description
 * @returns {boolean}
 */
function isDubRelated(text) {
  if (!text || typeof text !== "string") return false;
  const lower = text.toLowerCase();
  return DUB_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Tries to extract an episode number from a text string.
 * Handles formats like "Episode 7", "Ep7", "EP 12", "#7"
 * @param {string} text
 * @returns {number|null}
 */
function extractEpisodeNumber(text) {
  if (!text) return null;

  const patterns = [
    /\bep(?:isode)?\s*#?\s*(\d+)\b/i,
    /\bepisode\s+(\d+)\b/i,
    /#(\d+)\b/,
    /\b(\d+)\s*(?:dub|dubbed)\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const num = parseInt(match[1]);
      if (num > 0 && num < 10000) return num;   // sanity check
    }
  }
  return null;
}

/**
 * Classifies the type of dub update from text.
 * @param {string} text
 * @returns {"new_episode"|"announcement"|"delay"}
 */
function classifyUpdateType(text) {
  if (!text) return "announcement";
  const lower = text.toLowerCase();

  if (
    lower.includes("delay") ||
    lower.includes("postpone") ||
    lower.includes("pushed back") ||
    lower.includes("schedule change") ||
    lower.includes("hiatus")
  ) {
    return "delay";
  }

  if (
    lower.includes("episode") ||
    lower.includes(" ep ") ||
    lower.includes("ep.") ||
    lower.includes("now available") ||
    lower.includes("now streaming") ||
    lower.includes("out now") ||
    lower.includes("released")
  ) {
    return "new_episode";
  }

  return "announcement";
}

module.exports = {
  normalizeTitle,
  makeDocId,
  isDubRelated,
  extractEpisodeNumber,
  classifyUpdateType,
};
