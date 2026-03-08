/**
 * Stream Cache Service
 * 
 * Caches extracted VidLink stream URLs locally
 * - Stored in user's app data directory (invisible to user)
 * - Key format: movie-{tmdbId} or tv-{tmdbId}-S{season}E{episode}
 * - Links don't expire quickly, so cache is long-lived
 * - Automatic cache hit on subsequent plays
 */

// Subtitle track
export interface SubtitleTrack {
    language: string;
    url: string;
}

// Cache structure
interface CachedStream {
    streamUrl: string;
    headers?: {
        Referer?: string;
        Origin?: string;
        'User-Agent'?: string;
    };
    subtitles?: SubtitleTrack[]; // Subtitle tracks from extractor
    cachedAt: number; // timestamp
    quality?: string;
}

interface StreamCache {
    version: number;
    streams: Record<string, CachedStream>;
}

// Cache key generators
export function getMovieCacheKey(tmdbId: number): string {
    return `movie-${tmdbId}`;
}

export function getTVCacheKey(tmdbId: number, season: number, episode: number): string {
    return `tv-${tmdbId}-S${season}E${episode}`;
}

// Cache file path (stored in localStorage for web/Electron hybrid)
const CACHE_KEY = 'delulu-stream-cache';
const CACHE_VERSION = 2; // Bumped to include subtitles
const CACHE_MAX_AGE_HOURS = 24; // Cache stream/subtitle links for 1 day

// Initialize empty cache
function getEmptyCache(): StreamCache {
    return {
        version: CACHE_VERSION,
        streams: {},
    };
}

// Load cache from localStorage
function loadCache(): StreamCache {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return getEmptyCache();

        const cache: StreamCache = JSON.parse(raw);

        // Version check
        if (cache.version !== CACHE_VERSION) {
            console.log('[StreamCache] Version mismatch, resetting cache');
            return getEmptyCache();
        }

        return cache;
    } catch (err) {
        console.error('[StreamCache] Failed to load cache:', err);
        return getEmptyCache();
    }
}

// Save cache to localStorage
function saveCache(cache: StreamCache): void {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (err) {
        console.error('[StreamCache] Failed to save cache:', err);
    }
}

// Check if cached entry is still valid
function isEntryValid(entry: CachedStream): boolean {
    const maxAge = CACHE_MAX_AGE_HOURS * 60 * 60 * 1000;
    return Date.now() - entry.cachedAt < maxAge;
}

/**
 * Get cached stream for a movie
 */
export function getCachedMovieStream(tmdbId: number): CachedStream | null {
    const cache = loadCache();
    const key = getMovieCacheKey(tmdbId);
    const entry = cache.streams[key];

    if (entry && isEntryValid(entry)) {
        console.log(`[StreamCache] Cache HIT for movie ${tmdbId}`);
        return entry;
    }

    if (entry) {
        // Expired, remove it
        delete cache.streams[key];
        saveCache(cache);
    }

    console.log(`[StreamCache] Cache MISS for movie ${tmdbId}`);
    return null;
}

/**
 * Get cached stream for a TV episode
 */
export function getCachedTVStream(tmdbId: number, season: number, episode: number): CachedStream | null {
    const cache = loadCache();
    const key = getTVCacheKey(tmdbId, season, episode);
    const entry = cache.streams[key];

    if (entry && isEntryValid(entry)) {
        console.log(`[StreamCache] Cache HIT for TV ${tmdbId} S${season}E${episode}`);
        return entry;
    }

    if (entry) {
        // Expired, remove it
        delete cache.streams[key];
        saveCache(cache);
    }

    console.log(`[StreamCache] Cache MISS for TV ${tmdbId} S${season}E${episode}`);
    return null;
}

/**
 * Cache a movie stream
 */
export function cacheMovieStream(
    tmdbId: number,
    streamUrl: string,
    headers?: CachedStream['headers'],
    subtitles?: SubtitleTrack[]
): void {
    const cache = loadCache();
    const key = getMovieCacheKey(tmdbId);

    cache.streams[key] = {
        streamUrl,
        headers,
        subtitles,
        cachedAt: Date.now(),
    };

    saveCache(cache);
    console.log(`[StreamCache] Cached movie ${tmdbId}`);
}

/**
 * Cache a TV episode stream
 */
export function cacheTVStream(
    tmdbId: number,
    season: number,
    episode: number,
    streamUrl: string,
    headers?: CachedStream['headers'],
    subtitles?: SubtitleTrack[]
): void {
    const cache = loadCache();
    const key = getTVCacheKey(tmdbId, season, episode);

    cache.streams[key] = {
        streamUrl,
        headers,
        subtitles,
        cachedAt: Date.now(),
    };

    saveCache(cache);
    console.log(`[StreamCache] Cached TV ${tmdbId} S${season}E${episode}`);
}

/**
 * Clear entire cache
 */
export function clearStreamCache(): void {
    localStorage.removeItem(CACHE_KEY);
    console.log('[StreamCache] Cache cleared');
}

/**
 * Get cache stats
 */
export function getCacheStats(): { count: number; sizeKB: number } {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return { count: 0, sizeKB: 0 };

    const cache: StreamCache = JSON.parse(raw);
    return {
        count: Object.keys(cache.streams).length,
        sizeKB: Math.round(raw.length / 1024 * 100) / 100,
    };
}

/**
 * Remove expired entries (cleanup)
 */
export function cleanupExpiredEntries(): number {
    const cache = loadCache();
    let removed = 0;

    for (const key of Object.keys(cache.streams)) {
        if (!isEntryValid(cache.streams[key])) {
            delete cache.streams[key];
            removed++;
        }
    }

    if (removed > 0) {
        saveCache(cache);
        console.log(`[StreamCache] Cleaned up ${removed} expired entries`);
    }

    return removed;
}
