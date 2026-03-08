"use strict";

const DEFAULT_CONFIG = {
  navigationTimeoutMs: 18000,
  initialWaitMs: 1800,
  detectionWindowMs: 12000,
  maxClickAttempts: 7,
  clickDelayMs: 700,
  earlyExitDelayMs: 800,
  extractionTimeoutMs: 55000,
  maxConcurrentExtractions: 1,
  cacheTtlMs: 30 * 60 * 1000,
  maxResponseBytesToScan: 1_000_000
};

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0"
];

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1536, height: 864 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 }
];

module.exports = {
  DEFAULT_CONFIG,
  USER_AGENTS,
  VIEWPORTS
};
