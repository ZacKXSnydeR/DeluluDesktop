"use strict";

const puppeteer = require("puppeteer");
const { DEFAULT_CONFIG, USER_AGENTS, VIEWPORTS } = require("./config");
const { pickRandom, wait } = require("./utils");
const {
  PLAY_SELECTORS,
  BLOCKED_RESOURCES,
  isBlockedDomain,
  looksLikeStream,
  isMasterPlaylist,
  streamPriority,
  looksLikeSubtitle,
  extractSubtitleLanguage,
  isValidSubtitle
} = require("./patterns");
const { ResultCache } = require("./cache");
const { AsyncQueue } = require("./queue");
const { buildProviderUrl, buildVidlinkUrl } = require("./vidlink");

function asErrorResult(error) {
  return {
    success: false,
    error: error instanceof Error ? error.message : String(error)
  };
}

function captureSubtitleCandidate(subtitlesMap, candidateUrl) {
  if (!candidateUrl || subtitlesMap.has(candidateUrl)) return;
  if (!looksLikeSubtitle(candidateUrl) || !isValidSubtitle(candidateUrl)) return;
  subtitlesMap.set(candidateUrl, {
    url: candidateUrl,
    language: extractSubtitleLanguage(candidateUrl)
  });
}

class LocalExtractor {
  constructor(options = {}) {
    this.config = { ...DEFAULT_CONFIG, ...(options.config || {}) };
    this.logger = options.logger || (() => {});
    this.cache = new ResultCache(this.config.cacheTtlMs);
    this.queue = new AsyncQueue(this.config.maxConcurrentExtractions);
    this.launchOptions = {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-web-security",
        "--disable-features=IsolateOrigins,site-per-process",
        "--disable-blink-features=AutomationControlled"
      ],
      ...(options.launchOptions || {})
    };
  }

  async extractUrl(targetUrl, requestOptions = {}) {
    return this.queue.run(async () => {
      const startedAt = Date.now();

      const validatedUrl = this.#validateTargetUrl(targetUrl);
      const cacheKey = validatedUrl;
      const bypassCache = Boolean(requestOptions.bypassCache);

      if (!bypassCache) {
        const cached = this.cache.get(cacheKey);
        if (cached) {
          return {
            ...cached,
            meta: {
              ...(cached.meta || {}),
              cacheHit: true,
              durationMs: Date.now() - startedAt
            }
          };
        }
      }

      const userAgent = requestOptions.userAgent || pickRandom(USER_AGENTS);
      const viewport = requestOptions.viewport || pickRandom(VIEWPORTS);
      const timeoutMs = requestOptions.timeoutMs || this.config.extractionTimeoutMs;

      const result = await this.#withTimeout(
        this.#extractInternal(validatedUrl, userAgent, viewport),
        timeoutMs,
        "Extraction timeout"
      );

      const enriched = {
        ...result,
        meta: {
          ...(result.meta || {}),
          cacheHit: false,
          durationMs: Date.now() - startedAt,
          targetUrl: validatedUrl
        }
      };

      if (enriched.success) {
        this.cache.set(cacheKey, enriched);
      }

      return enriched;
    });
  }

  async extractProvider(input, requestOptions = {}) {
    const targetUrl = buildProviderUrl(input);
    return this.extractUrl(targetUrl, requestOptions);
  }

  // Backward-compatible method name.
  async extractVidlink(input, requestOptions = {}) {
    const targetUrl = buildVidlinkUrl(input);
    return this.extractUrl(targetUrl, requestOptions);
  }

  getStats() {
    return {
      queue: this.queue.stats(),
      cache: {
        size: this.cache.size(),
        ttlMs: this.config.cacheTtlMs
      }
    };
  }

  async #extractInternal(targetUrl, userAgent, viewport) {
    let browser;
    let page;
    const streams = new Map();
    const subtitles = new Map();
    let bestStream = null;

    try {
      this.logger("info", "launch_browser", { targetUrl });
      browser = await puppeteer.launch(this.launchOptions);
      page = await browser.newPage();

      await page.setUserAgent(userAgent);
      await page.setViewport(viewport);
      await page.setExtraHTTPHeaders({
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      });

      await page.setRequestInterception(true);

      const popupHandler = async (target) => {
        if (target.type() !== "page") return;
        const popup = await target.page().catch(() => null);
        if (popup && popup !== page) {
          await popup.close().catch(() => {});
        }
      };

      browser.on("targetcreated", popupHandler);

      page.on("request", (request) => {
        const reqUrl = request.url();
        const resourceType = request.resourceType();

        if (BLOCKED_RESOURCES.includes(resourceType) || isBlockedDomain(reqUrl)) {
          request.abort().catch(() => {});
          return;
        }

        if (looksLikeStream(reqUrl)) {
          const headers = request.headers();
          const candidate = {
            url: reqUrl,
            headers: {
              Referer: headers.referer || targetUrl,
              "User-Agent": userAgent,
              Origin: new URL(targetUrl).origin
            },
            priority: streamPriority(reqUrl)
          };

          streams.set(reqUrl, candidate);
          if (!bestStream || candidate.priority > bestStream.priority) {
            bestStream = candidate;
          }
        }

        if (looksLikeSubtitle(reqUrl) && isValidSubtitle(reqUrl)) {
          captureSubtitleCandidate(subtitles, reqUrl);
        }

        request.continue().catch(() => {});
      });

      page.on("response", async (response) => {
        try {
          const headers = response.headers();
          const contentType = headers["content-type"] || "";

          if (!contentType.includes("json") && !contentType.includes("javascript")) {
            return;
          }

          const contentLength = Number(headers["content-length"] || 0);
          if (contentLength && contentLength > this.config.maxResponseBytesToScan) {
            return;
          }

          const text = await response.text().catch(() => "");
          if (Buffer.byteLength(text, "utf8") > this.config.maxResponseBytesToScan) {
            return;
          }

          const matches = text.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi) || [];
          const subtitleMatches = text.match(/https?:\/\/[^\s"'<>]+\.(vtt|srt|ass|ssa)[^\s"'<>]*/gi) || [];
          for (const match of matches) {
            if (streams.has(match)) continue;
            streams.set(match, {
              url: match,
              headers: {
                Referer: response.url(),
                "User-Agent": userAgent,
                Origin: new URL(targetUrl).origin
              },
              priority: streamPriority(match)
            });
          }

          for (const subtitleUrl of subtitleMatches) {
            captureSubtitleCandidate(subtitles, subtitleUrl);
          }
        } catch {
          // no-op: ignore parsing errors per response
        }
      });

      await page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: this.config.navigationTimeoutMs
      }).catch((error) => {
        this.logger("warn", "partial_navigation", { message: error.message });
      });

      await wait(this.config.initialWaitMs);

      const startedAt = Date.now();
      let attempts = 0;
      let foundMaster = false;

      while (
        attempts < this.config.maxClickAttempts &&
        Date.now() - startedAt < this.config.detectionWindowMs &&
        !foundMaster
      ) {
        const clicks = PLAY_SELECTORS.map(async (selector) => {
          try {
            const element = await page.$(selector);
            if (!element) return;
            const box = await element.boundingBox();
            if (!box || box.width < 10 || box.height < 10) return;
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            await wait(250);
          } catch {
            // no-op for individual selectors
          }
        });

        await Promise.all(clicks);

        await page.mouse.click(viewport.width / 2, viewport.height / 2).catch(() => {});

        if (bestStream && isMasterPlaylist(bestStream.url)) {
          foundMaster = true;
          await wait(this.config.earlyExitDelayMs);
          break;
        }

        attempts += 1;
        await wait(this.config.clickDelayMs);
      }

      await wait(1000);

      const allStreams = [...streams.values()].sort((a, b) => b.priority - a.priority);
      const allSubtitles = [...subtitles.values()];

      if (allStreams.length === 0) {
        return {
          success: false,
          error: "No streams found",
          subtitles: allSubtitles,
          all_streams: []
        };
      }

      bestStream = allStreams[0];
      return {
        success: true,
        stream_url: bestStream.url,
        headers: bestStream.headers,
        subtitles: allSubtitles,
        all_streams: allStreams.map((stream) => ({
          url: stream.url,
          priority: stream.priority
        }))
      };
    } catch (error) {
      return asErrorResult(error);
    } finally {
      try {
        if (page) {
          await page.close().catch(() => {});
        }
      } catch {
        // no-op
      }

      try {
        if (browser) {
          const pages = await browser.pages().catch(() => []);
          await Promise.allSettled(pages.map((p) => p.close().catch(() => {})));
          await browser.close().catch(() => {});
        }
      } catch {
        // no-op
      }
    }
  }

  #validateTargetUrl(targetUrl) {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      throw new Error("Invalid URL");
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Only http/https URLs are allowed");
    }

    return parsed.toString();
  }

  async #withTimeout(promise, timeoutMs, message) {
    let timeoutId;

    try {
      return await Promise.race([
        promise,
        new Promise((resolve) => {
          timeoutId = setTimeout(() => resolve({ success: false, error: message }), timeoutMs);
        })
      ]);
    } catch (error) {
      return asErrorResult(error);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }
}

module.exports = {
  LocalExtractor
};
