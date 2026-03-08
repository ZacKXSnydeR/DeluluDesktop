"use strict";

const STREAM_PATTERNS = [
  /\.m3u8(\?|$)/i,
  /master\.m3u8/i,
  /index\.m3u8/i,
  /playlist\.m3u8/i,
  /manifest.*\.m3u8/i,
  /hls.*\.m3u8/i,
  /\.mpd(\?|$)/i,
  /\.mp4(\?|$)/i
];

const MASTER_PATTERNS = [/master/i, /index/i, /manifest/i, /playlist/i];

const SUBTITLE_PATTERNS = [
  /\.vtt(\?|$)/i,
  /\.srt(\?|$)/i,
  /\.ass(\?|$)/i,
  /\.ssa(\?|$)/i,
  /subtitle.*\.vtt/i,
  /caption.*\.vtt/i,
  /\/vtt\//i,
  /\/subtitles\//i,
  /\/captions\//i
];

const SUBTITLE_LANGUAGE_MAP = {
  en: "English",
  eng: "English",
  english: "English",
  bn: "Bengali",
  bangla: "Bengali",
  bengali: "Bengali",
  hi: "Hindi",
  hindi: "Hindi",
  ar: "Arabic",
  arabic: "Arabic",
  es: "Spanish",
  spanish: "Spanish",
  fr: "French",
  french: "French",
  de: "German",
  german: "German",
  zh: "Chinese",
  chinese: "Chinese",
  ja: "Japanese",
  japanese: "Japanese",
  ko: "Korean",
  korean: "Korean",
  pt: "Portuguese",
  portuguese: "Portuguese",
  ru: "Russian",
  russian: "Russian",
  it: "Italian",
  italian: "Italian",
  tr: "Turkish",
  turkish: "Turkish"
};

const PLAY_SELECTORS = [
  ".play-button",
  ".play-btn",
  ".play",
  "#play",
  "button[class*='play']",
  "div[class*='play']",
  "[aria-label*='play' i]",
  ".vjs-big-play-button",
  ".jw-icon-display",
  ".plyr__control--overlaid",
  "[data-plyr='play']",
  "video",
  ".player",
  "#player"
];

const BLOCKED_RESOURCES = ["image", "stylesheet", "font", "imageset"];

const BLOCKED_DOMAINS = [
  "googlesyndication.com",
  "googleadservices.com",
  "google-analytics.com",
  "doubleclick.net",
  "facebook.net",
  "amazon-adsystem.com",
  "popads.net",
  "propellerads.com",
  "hotjar.com"
];

function isBlockedDomain(url) {
  return BLOCKED_DOMAINS.some((domain) => url.includes(domain));
}

function looksLikeStream(url) {
  return STREAM_PATTERNS.some((pattern) => pattern.test(url));
}

function isMasterPlaylist(url) {
  return MASTER_PATTERNS.some((pattern) => pattern.test(url));
}

function streamPriority(url) {
  let score = 0;
  if (url.includes(".m3u8")) score += 10;
  if (url.includes("master")) score += 5;
  if (url.includes("index")) score += 4;
  if (url.includes("manifest")) score += 3;
  if (/segment|chunk|\.ts\?/.test(url)) score -= 5;
  return score;
}

function looksLikeSubtitle(url) {
  return SUBTITLE_PATTERNS.some((pattern) => pattern.test(url));
}

function extractSubtitleLanguage(url) {
  const lower = url.toLowerCase();
  for (const [code, language] of Object.entries(SUBTITLE_LANGUAGE_MAP)) {
    if (
      lower.includes(`/${code}/`) ||
      lower.includes(`/${code}.`) ||
      lower.includes(`_${code}.`) ||
      lower.includes(`-${code}.`) ||
      lower.includes(`=${code}&`) ||
      lower.includes(`lang=${code}`) ||
      lower.includes(`language=${code}`)
    ) {
      return language;
    }
  }
  return "Unknown";
}

function isValidSubtitle(url) {
  const lower = url.toLowerCase();
  if (!/\.(vtt|srt|ass|ssa)(\?|$)/i.test(url)) return false;
  if (lower.includes("analytics") || lower.includes("tracking") || lower.includes("pixel") || lower.includes("beacon")) {
    return false;
  }
  return url.length >= 20;
}

module.exports = {
  PLAY_SELECTORS,
  BLOCKED_RESOURCES,
  isBlockedDomain,
  looksLikeStream,
  isMasterPlaylist,
  streamPriority,
  looksLikeSubtitle,
  extractSubtitleLanguage,
  isValidSubtitle
};
