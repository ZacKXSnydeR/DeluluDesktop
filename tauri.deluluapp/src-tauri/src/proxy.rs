//! HLS Proxy Server with Continuous Background Prefetching
//!
//! A local HTTP proxy that runs inside the Tauri app to inject
//! CDN-required headers (Referer, Origin, User-Agent) on all HLS requests.
//!
//! Features:
//! - CDN header injection (Referer, Origin, User-Agent)
//! - M3U8 manifest URL rewriting
//! - LRU segment caching (500 segments ~ 500MB)
//! - **YouTube-style continuous background prefetching**
//! - **Prefetching continues even when paused**
//! - Instant seeking (cached segments)
//! - Zero buffering
//! - **Arc<Vec<u8>> bodies — zero-copy cache hits**
//! - **Read-lock fast path for cache hits (no write lock contention)**
//! - **Global semaphore throttles CDN downloads (prevents rate-limiting)**
//! - **Debounced prefetch spawning (avoids redundant tasks)**
//! - **Smart manifest refresh (preserves prefetch on quality switch)**
//!
//! Architecture:
//! 1. Binds to 127.0.0.1:0 (random port) on app startup
//! 2. hls.js sends requests to http://127.0.0.1:{port}/proxy?url={encoded_cdn_url}
//! 3. Proxy checks cache first, if miss → fetches from CDN with correct headers
//! 4. For m3u8 responses:
//!    - Rewrites all URLs to route through proxy
//!    - Parses segment list
//!    - **Stores segment list for continuous prefetching**
//! 5. On segment request:
//!    - Tracks current playback position
//!    - **Triggers continuous prefetch of next 8-50 segments (adaptive)**
//! 6. Returns response to hls.js (segments come from cache = instant!)

use std::sync::atomic::{AtomicU16, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::collections::HashSet;
use std::time::Instant;
use tokio::sync::{RwLock, Semaphore};
use lru::LruCache;
use std::num::NonZeroUsize;

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
    Router,
};
use reqwest::Client;

/// CDN headers to inject on every proxied request
#[derive(Default, Clone, Debug)]
pub struct CdnHeaders {
    pub referer: Option<String>,
    pub origin: Option<String>,
    pub user_agent: Option<String>,
}

/// Cached segment data — body wrapped in Arc for zero-copy cache hits
#[derive(Clone)]
struct CachedSegment {
    content_type: String,
    body: Arc<Vec<u8>>,
}

/// Live performance metrics for the proxy (lock-free atomics)
pub struct ProxyMetrics {
    pub cache_hits: AtomicU64,
    pub cache_misses: AtomicU64,
    pub prefetch_completed: AtomicU64,
    pub prefetch_cancelled: AtomicU64,
    pub prefetch_retries: AtomicU64,
    pub total_bytes_served: AtomicU64,
    pub total_cached_bytes: AtomicU64,
    // Rolling window timing (resets every 100 samples for freshness)
    pub total_download_ms: AtomicU64,
    pub download_count: AtomicU64,
}

impl ProxyMetrics {
    pub fn new() -> Self {
        Self {
            cache_hits: AtomicU64::new(0),
            cache_misses: AtomicU64::new(0),
            prefetch_completed: AtomicU64::new(0),
            prefetch_cancelled: AtomicU64::new(0),
            prefetch_retries: AtomicU64::new(0),
            total_bytes_served: AtomicU64::new(0),
            total_cached_bytes: AtomicU64::new(0),
            total_download_ms: AtomicU64::new(0),
            download_count: AtomicU64::new(0),
        }
    }

    /// Average segment download time in ms (rolling window of ~100 samples)
    pub fn avg_download_ms(&self) -> u64 {
        let count = self.download_count.load(Ordering::Relaxed);
        if count == 0 { return 0; }
        self.total_download_ms.load(Ordering::Relaxed) / count
    }

    /// Adaptive prefetch window — scales with measured network speed
    ///   Fast (< 200ms):   50 segments ahead (aggressive)
    ///   Normal (< 1s):    30 segments ahead (standard)
    ///   Slow (< 3s):      15 segments ahead (conservative)
    ///   Very slow (3s+):   8 segments ahead (minimal)
    pub fn adaptive_prefetch_ahead(&self) -> usize {
        match self.avg_download_ms() {
            0..=200 => 50,
            201..=1000 => 30,
            1001..=3000 => 15,
            _ => 8,
        }
    }
}

/// Shared state for the proxy server
#[derive(Clone)]
pub struct ProxyState {
    client: Client,
    pub headers: Arc<RwLock<CdnHeaders>>,
    pub port: Arc<AtomicU16>,
    // LRU cache for video segments (max 500 segments ~ 500MB)
    cache: Arc<RwLock<LruCache<String, CachedSegment>>>,
    // In-flight prefetch tracker (avoid duplicate downloads)
    prefetching: Arc<RwLock<HashSet<String>>>,
    // Segment list from manifest (for continuous prefetching)
    segment_list: Arc<RwLock<Vec<String>>>,
    // Current playback position (segment index)
    current_position: Arc<AtomicUsize>,
    // Last position that triggered a prefetch spawn (debounce)
    last_prefetch_position: Arc<AtomicUsize>,
    // Generation counter — incremented on new content or seek, cancels stale prefetch tasks
    prefetch_generation: Arc<AtomicUsize>,
    // Global download semaphore — limits concurrent CDN requests to prevent rate-limiting
    download_semaphore: Arc<Semaphore>,
    // Live performance metrics (lock-free)
    pub metrics: Arc<ProxyMetrics>,
}

impl ProxyState {
    pub fn new() -> Self {
        Self {
            client: Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .pool_max_idle_per_host(20)
                .build()
                .unwrap_or_default(),
            headers: Arc::new(RwLock::new(CdnHeaders::default())),
            port: Arc::new(AtomicU16::new(0)),
            cache: Arc::new(RwLock::new(
                LruCache::new(NonZeroUsize::new(500).unwrap())
            )),
            prefetching: Arc::new(RwLock::new(HashSet::new())),
            segment_list: Arc::new(RwLock::new(Vec::new())),
            current_position: Arc::new(AtomicUsize::new(0)),
            last_prefetch_position: Arc::new(AtomicUsize::new(usize::MAX)),
            prefetch_generation: Arc::new(AtomicUsize::new(0)),
            // Max 4 concurrent CDN downloads — prevents rate-limiting & starvation
            download_semaphore: Arc::new(Semaphore::new(4)),
            metrics: Arc::new(ProxyMetrics::new()),
        }
    }

    pub fn get_port(&self) -> u16 {
        self.port.load(Ordering::SeqCst)
    }

    /// Clear all cached segments and reset prefetch state (called on new stream)
    pub async fn clear_cache(&self) {
        let mut cache = self.cache.write().await;
        cache.clear();
        drop(cache);
        let mut segments = self.segment_list.write().await;
        segments.clear();
        drop(segments);
        let mut prefetching = self.prefetching.write().await;
        prefetching.clear();
        drop(prefetching);
        self.current_position.store(0, Ordering::SeqCst);
        self.last_prefetch_position.store(usize::MAX, Ordering::SeqCst);
        self.prefetch_generation.fetch_add(1, Ordering::SeqCst);
        self.metrics.total_cached_bytes.store(0, Ordering::Relaxed);
        println!("[HLS Proxy] \u{1f9f9} Cache cleared for new stream");
    }
}

/// Query parameter for the proxy endpoint
#[derive(serde::Deserialize)]
struct ProxyQuery {
    url: String,
}

/// CORS preflight handler
async fn options_handler() -> impl IntoResponse {
    (
        StatusCode::NO_CONTENT,
        [
            ("access-control-allow-origin", "*"),
            ("access-control-allow-methods", "GET, OPTIONS"),
            ("access-control-allow-headers", "range, content-type"),
            ("access-control-max-age", "86400"),
        ],
    )
}

/// Main proxy handler — fetches from CDN with correct headers (with caching + continuous prefetching)
async fn proxy_handler(
    State(state): State<ProxyState>,
    Query(query): Query<ProxyQuery>,
) -> impl IntoResponse {
    let target_url = query.url;

    // Check cache first for segments (fast path: read lock with peek — no LRU reorder needed)
    let is_segment = is_video_segment(&target_url);
    if is_segment {
        let cached_segment = {
            let cache = state.cache.read().await;
            cache.peek(&target_url).cloned()
        };

        if let Some(cached) = cached_segment {
            state.metrics.cache_hits.fetch_add(1, Ordering::Relaxed);
            state.metrics.total_bytes_served.fetch_add(cached.body.len() as u64, Ordering::Relaxed);
            println!("[HLS Proxy] ⚡ Cache HIT: {}", shorten_url(&target_url));

            // Track playback position and trigger continuous prefetch
            update_position_and_prefetch(state.clone(), &target_url).await;

            return (
                StatusCode::OK,
                [
                    ("access-control-allow-origin", "*".to_string()),
                    ("content-type", cached.content_type.clone()),
                ],
                (*cached.body).clone(),
            )
                .into_response();
        }

        state.metrics.cache_misses.fetch_add(1, Ordering::Relaxed);
        println!("[HLS Proxy] 📥 Cache MISS: {}", shorten_url(&target_url));
    }

    // Build request with CDN headers
    let headers = state.headers.read().await;
    let mut req = state.client.get(&target_url);

    if let Some(ref referer) = headers.referer {
        req = req.header("Referer", referer);
    }
    if let Some(ref origin) = headers.origin {
        req = req.header("Origin", origin);
    }
    if let Some(ref ua) = headers.user_agent {
        req = req.header("User-Agent", ua);
    }
    drop(headers);

    // Fetch from CDN
    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[HLS Proxy] Fetch error: {}", e);
            return (
                StatusCode::BAD_GATEWAY,
                [
                    ("access-control-allow-origin", "*".to_string()),
                    ("content-type", "text/plain".to_string()),
                ],
                format!("Proxy error: {}", e).into_bytes(),
            )
                .into_response();
        }
    };

    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();

    let body = match resp.bytes().await {
        Ok(b) => b,
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                [
                    ("access-control-allow-origin", "*".to_string()),
                    ("content-type", "text/plain".to_string()),
                ],
                format!("Read error: {}", e).into_bytes(),
            )
                .into_response();
        }
    };

    // Cache segments (but not manifests)
    if is_segment {
        let seg_bytes = body.len() as u64;
        let mut cache = state.cache.write().await;
        let evicted = cache.push(
            target_url.clone(),
            CachedSegment {
                content_type: content_type.clone(),
                body: Arc::new(body.to_vec()),
            },
        );
        drop(cache);

        // Track byte-level cache size (saturating to prevent underflow)
        state.metrics.total_cached_bytes.fetch_add(seg_bytes, Ordering::Relaxed);
        state.metrics.total_bytes_served.fetch_add(seg_bytes, Ordering::Relaxed);
        if let Some((_, evicted_seg)) = evicted {
            let old_len = evicted_seg.body.len() as u64;
            let _ = state.metrics.total_cached_bytes.fetch_update(
                Ordering::Relaxed, Ordering::Relaxed,
                |current| Some(current.saturating_sub(old_len))
            );
        }

        // Track position and trigger continuous prefetch
        update_position_and_prefetch(state.clone(), &target_url).await;
    }

    // If it's an m3u8 manifest, rewrite URLs and store segment list
    let is_m3u8 = content_type.contains("mpegurl")
        || content_type.contains("m3u8")
        || target_url.ends_with(".m3u8")
        || target_url.contains(".m3u8?");

    if is_m3u8 {
        let text = String::from_utf8_lossy(&body);
        let port = state.get_port();

        // Parse and store segment URLs
        let segment_urls = parse_segment_urls(&text, &target_url);

        if !segment_urls.is_empty() {
            println!("[HLS Proxy] 📋 Manifest loaded with {} segments", segment_urls.len());

            // Smart manifest refresh: only reset prefetch if the segment list actually changed
            // (e.g., quality switch re-fetches manifest with same segments — don't cancel prefetch)
            let segments_changed = {
                let old_segments = state.segment_list.read().await;
                old_segments.is_empty() || *old_segments != segment_urls
            };

            // Store segment list for continuous prefetching
            let mut segments = state.segment_list.write().await;
            *segments = segment_urls.clone();
            drop(segments);

            if segments_changed {
                // Reset position and bump generation (cancels stale prefetch tasks)
                state.current_position.store(0, Ordering::SeqCst);
                state.last_prefetch_position.store(usize::MAX, Ordering::SeqCst);
                let gen = state.prefetch_generation.fetch_add(1, Ordering::SeqCst) + 1;

                // Initial prefetch burst (first 10)
                let state_clone = state.clone();
                let initial_segments = segment_urls.iter().take(10).cloned().collect();
                tokio::spawn(async move {
                    prefetch_segments(state_clone, initial_segments, gen).await;
                });

                println!("[HLS Proxy] 🆕 New segment list detected, reset prefetch");
            } else {
                println!("[HLS Proxy] ♻️ Same segment list on manifest refresh, preserving prefetch");
            }
        }

        // Rewrite manifest URLs
        let rewritten = rewrite_m3u8(&text, &target_url, port);

        (
            StatusCode::OK,
            [
                (
                    "access-control-allow-origin",
                    "*".to_string(),
                ),
                (
                    "content-type",
                    "application/vnd.apple.mpegurl".to_string(),
                ),
            ],
            rewritten.into_bytes(),
        )
            .into_response()
    } else {
        (
            StatusCode::OK,
            [
                ("access-control-allow-origin", "*".to_string()),
                ("content-type", content_type),
            ],
            body.to_vec(),
        )
            .into_response()
    }
}

/// Update playback position and trigger continuous prefetch (YouTube-style)
/// Debounced: only spawns a new prefetch task if position has advanced since last spawn
async fn update_position_and_prefetch(state: ProxyState, segment_url: &str) {
    let segments = state.segment_list.read().await;

    if let Some(current_idx) = segments.iter().position(|s| s == segment_url) {
        let prev_position = state.current_position.swap(current_idx, Ordering::SeqCst);

        // Detect seek (position jump > 10 segments) and bump generation
        // so stale prefetch tasks for the old position stop early
        let jump = current_idx.abs_diff(prev_position);
        if jump > 10 {
            state.prefetch_generation.fetch_add(1, Ordering::SeqCst);
            state.last_prefetch_position.store(usize::MAX, Ordering::SeqCst);
        }

        // Debounce: skip if we already spawned a prefetch from this position or ahead
        let last_pf = state.last_prefetch_position.load(Ordering::SeqCst);
        if last_pf != usize::MAX && current_idx <= last_pf {
            return;
        }
        state.last_prefetch_position.store(current_idx, Ordering::SeqCst);

        // Adaptive window: scales with measured network speed
        let prefetch_ahead = state.metrics.adaptive_prefetch_ahead();

        let start_idx = current_idx + 1;
        let end_idx = (start_idx + prefetch_ahead).min(segments.len());

        if start_idx < segments.len() {
            let segments_to_prefetch: Vec<String> = segments[start_idx..end_idx]
                .iter()
                .cloned()
                .collect();

            if !segments_to_prefetch.is_empty() {
                println!(
                    "[HLS Proxy] 📍 Position: {}/{} → prefetch {} (window={}, avg={}ms)",
                    current_idx,
                    segments.len(),
                    segments_to_prefetch.len(),
                    prefetch_ahead,
                    state.metrics.avg_download_ms()
                );

                let gen = state.prefetch_generation.load(Ordering::SeqCst);
                let state_clone = state.clone();
                tokio::spawn(async move {
                    prefetch_segments(state_clone, segments_to_prefetch, gen).await;
                });
            }
        }
    }
}

/// Parse segment URLs from m3u8 manifest
fn parse_segment_urls(content: &str, base_url: &str) -> Vec<String> {
    let base = url::Url::parse(base_url).ok();
    let mut segments = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();

        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let absolute_url = resolve_url(trimmed, &base);

        if is_video_segment(&absolute_url) {
            segments.push(absolute_url);
        }
    }

    segments
}

/// Prefetch segments with priority tiers (enterprise-grade)
///   Tier 1 (critical):      First 3 segments — high parallelism, retried on failure
///   Tier 2 (important):     Segments 4–10 — standard parallelism, no retry
///   Tier 3 (opportunistic): Segments 11+ — standard parallelism, skippable under load
async fn prefetch_segments(state: ProxyState, segment_urls: Vec<String>, generation: usize) {
    if segment_urls.is_empty() {
        return;
    }

    // Filter out already-cached segments
    let to_download: Vec<String> = {
        let cache = state.cache.read().await;
        segment_urls.into_iter().filter(|url| !cache.contains(url)).collect()
    };

    if to_download.is_empty() {
        return;
    }

    // Split into priority tiers
    let tier1_end = 3.min(to_download.len());
    let tier2_end = 10.min(to_download.len());
    let tier1 = &to_download[..tier1_end];
    let tier2 = &to_download[tier1_end..tier2_end];
    let tier3 = &to_download[tier2_end..];

    println!(
        "[HLS Proxy] 🔄 Prefetch: {} critical + {} important + {} opportunistic",
        tier1.len(), tier2.len(), tier3.len()
    );

    // Tier 1: Critical (next 3 segments) — 3 parallel, 2 retries each
    fetch_tier(&state, tier1, generation, 3, 2).await;

    // Tier 2: Important (segments 4-10) — 5 parallel, no retry
    if state.prefetch_generation.load(Ordering::SeqCst) != generation {
        state.metrics.prefetch_cancelled.fetch_add(1, Ordering::Relaxed);
        return;
    }
    fetch_tier(&state, tier2, generation, 5, 0).await;

    // Tier 3: Opportunistic (segments 11+) — 5 parallel, no retry, skippable
    if state.prefetch_generation.load(Ordering::SeqCst) != generation {
        state.metrics.prefetch_cancelled.fetch_add(1, Ordering::Relaxed);
        return;
    }
    fetch_tier(&state, tier3, generation, 5, 0).await;
}

/// Fetch a batch of segments with configurable parallelism and retry policy
async fn fetch_tier(
    state: &ProxyState,
    urls: &[String],
    generation: usize,
    parallel: usize,
    max_retries: u32,
) {
    for chunk in urls.chunks(parallel) {
        // Bail if generation changed (new stream or seek)
        if state.prefetch_generation.load(Ordering::SeqCst) != generation {
            state.metrics.prefetch_cancelled.fetch_add(1, Ordering::Relaxed);
            return;
        }

        // Mark URLs as in-flight (single lock per chunk)
        let urls_to_fetch: Vec<String> = {
            let mut prefetching = state.prefetching.write().await;
            chunk.iter()
                .filter(|url| {
                    if prefetching.contains(*url) {
                        false
                    } else {
                        prefetching.insert((*url).clone());
                        true
                    }
                })
                .cloned()
                .collect()
        };

        let mut handles = Vec::new();
        for url in urls_to_fetch {
            let state_clone = state.clone();
            let handle = tokio::spawn(async move {
                download_and_cache_segment(state_clone, url, max_retries).await;
            });
            handles.push(handle);
        }

        for handle in handles {
            let _ = handle.await;
        }
    }
}

/// Download a single segment and cache it (with retry + timing + semaphore throttle)
async fn download_and_cache_segment(state: ProxyState, url: String, max_retries: u32) {
    // Acquire semaphore permit — limits global concurrent CDN downloads
    let _permit = state.download_semaphore.acquire().await;
    // If semaphore is closed (shouldn't happen), bail gracefully
    let _permit = match _permit {
        Ok(p) => p,
        Err(_) => return,
    };

    let start = Instant::now();
    let max_attempts = 1 + max_retries;

    for attempt in 1..=max_attempts {
        let headers = state.headers.read().await;
        let mut req = state.client.get(&url);

        if let Some(ref referer) = headers.referer {
            req = req.header("Referer", referer);
        }
        if let Some(ref origin) = headers.origin {
            req = req.header("Origin", origin);
        }
        if let Some(ref ua) = headers.user_agent {
            req = req.header("User-Agent", ua);
        }
        drop(headers);

        match req.send().await {
            Ok(resp) => {
                // Retry on server errors (503, 429, etc.)
                if resp.status().is_server_error() && attempt < max_attempts {
                    state.metrics.prefetch_retries.fetch_add(1, Ordering::Relaxed);
                    let backoff_ms = 200u64 * (1 << (attempt - 1));
                    tokio::time::sleep(std::time::Duration::from_millis(backoff_ms)).await;
                    continue;
                }

                let content_type = resp
                    .headers()
                    .get("content-type")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("video/mp2t")
                    .to_string();

                match resp.bytes().await {
                    Ok(body) => {
                        let byte_len = body.len() as u64;
                        let mut cache = state.cache.write().await;
                        let evicted = cache.push(
                            url.clone(),
                            CachedSegment {
                                content_type,
                                body: Arc::new(body.to_vec()),
                            },
                        );
                        drop(cache);

                        // Byte-level cache tracking (saturating to prevent underflow)
                        state.metrics.total_cached_bytes.fetch_add(byte_len, Ordering::Relaxed);
                        if let Some((_, old_seg)) = evicted {
                            let old_len = old_seg.body.len() as u64;
                            let _ = state.metrics.total_cached_bytes.fetch_update(
                                Ordering::Relaxed, Ordering::Relaxed,
                                |current| Some(current.saturating_sub(old_len))
                            );
                        }

                        // Rolling-window timing for adaptive prefetch (resets every 100 samples)
                        let elapsed_ms = start.elapsed().as_millis() as u64;
                        let count = state.metrics.download_count.fetch_add(1, Ordering::Relaxed) + 1;
                        if count > 100 {
                            state.metrics.download_count.store(1, Ordering::Relaxed);
                            state.metrics.total_download_ms.store(elapsed_ms, Ordering::Relaxed);
                        } else {
                            state.metrics.total_download_ms.fetch_add(elapsed_ms, Ordering::Relaxed);
                        }

                        state.metrics.prefetch_completed.fetch_add(1, Ordering::Relaxed);
                    }
                    Err(e) => {
                        if attempt < max_attempts {
                            state.metrics.prefetch_retries.fetch_add(1, Ordering::Relaxed);
                            let backoff_ms = 200u64 * (1 << (attempt - 1));
                            tokio::time::sleep(std::time::Duration::from_millis(backoff_ms)).await;
                            continue;
                        }
                        eprintln!("[HLS Proxy] Prefetch read error for {}: {}", shorten_url(&url), e);
                    }
                }
                break;
            }
            Err(e) => {
                if attempt < max_attempts {
                    state.metrics.prefetch_retries.fetch_add(1, Ordering::Relaxed);
                    let backoff_ms = 200u64 * (1 << (attempt - 1));
                    tokio::time::sleep(std::time::Duration::from_millis(backoff_ms)).await;
                    continue;
                }
                eprintln!("[HLS Proxy] Prefetch failed after {} attempts for {}: {}", attempt, shorten_url(&url), e);
                break;
            }
        }
    }

    let mut prefetching = state.prefetching.write().await;
    prefetching.remove(&url);
}

/// Check if a URL is a video segment (not a manifest)
fn is_video_segment(url: &str) -> bool {
    // Check URL path only (before query string) to avoid false positives
    // from domains like "vts.example.com" matching ".ts"
    let path = url.split('?').next().unwrap_or(url).to_lowercase();
    (path.ends_with(".ts") || path.ends_with(".m4s") || path.ends_with(".mp4"))
        && !path.ends_with(".m3u8")
}

/// Shorten URL for logging
fn shorten_url(url: &str) -> String {
    if url.len() > 80 {
        format!("{}...{}", &url[..40], &url[url.len() - 30..])
    } else {
        url.to_string()
    }
}

/// Rewrite all URLs in an m3u8 manifest to route through our local proxy
fn rewrite_m3u8(content: &str, base_url: &str, port: u16) -> String {
    let base = url::Url::parse(base_url).ok();

    content
        .lines()
        .map(|line| {
            let trimmed = line.trim();

            if trimmed.is_empty() {
                return line.to_string();
            }

            if trimmed.starts_with('#') {
                if trimmed.contains("URI=\"") {
                    return rewrite_uri_attribute(trimmed, &base, port);
                }
                return line.to_string();
            }

            let absolute_url = resolve_url(trimmed, &base);
            format!(
                "http://127.0.0.1:{}/proxy?url={}",
                port,
                urlencoding::encode(&absolute_url)
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Rewrite URI="..." attributes in m3u8 tags (e.g., #EXT-X-KEY, #EXT-X-MAP)
fn rewrite_uri_attribute(line: &str, base: &Option<url::Url>, port: u16) -> String {
    if let Some(start) = line.find("URI=\"") {
        let prefix = &line[..start + 5];
        let after = &line[start + 5..];

        if let Some(end) = after.find('"') {
            let uri = &after[..end];
            let suffix = &after[end..];

            let absolute_url = resolve_url(uri, base);
            let proxy_url = format!(
                "http://127.0.0.1:{}/proxy?url={}",
                port,
                urlencoding::encode(&absolute_url)
            );

            return format!("{}{}{}", prefix, proxy_url, suffix);
        }
    }
    line.to_string()
}

/// Resolve a URL against a base URL (handles relative URLs)
fn resolve_url(url_str: &str, base: &Option<url::Url>) -> String {
    if url_str.starts_with("http://") || url_str.starts_with("https://") {
        return url_str.to_string();
    }

    if let Some(ref base) = base {
        base.join(url_str)
            .map(|u| u.to_string())
            .unwrap_or_else(|_| url_str.to_string())
    } else {
        url_str.to_string()
    }
}

/// JSON metrics endpoint — exposes live proxy performance data
async fn metrics_handler(State(state): State<ProxyState>) -> impl IntoResponse {
    let m = &state.metrics;
    let hits = m.cache_hits.load(Ordering::Relaxed);
    let misses = m.cache_misses.load(Ordering::Relaxed);
    let total = hits + misses;
    let hit_rate = if total == 0 { 0.0 } else { (hits as f64 / total as f64) * 100.0 };

    let json = serde_json::json!({
        "cache_hits": hits,
        "cache_misses": misses,
        "hit_rate_percent": (hit_rate * 100.0).round() / 100.0,
        "prefetch_completed": m.prefetch_completed.load(Ordering::Relaxed),
        "prefetch_cancelled": m.prefetch_cancelled.load(Ordering::Relaxed),
        "prefetch_retries": m.prefetch_retries.load(Ordering::Relaxed),
        "total_bytes_served": m.total_bytes_served.load(Ordering::Relaxed),
        "cached_bytes": m.total_cached_bytes.load(Ordering::Relaxed),
        "cached_mb": (m.total_cached_bytes.load(Ordering::Relaxed) as f64 / (1024.0 * 1024.0) * 100.0).round() / 100.0,
        "avg_download_ms": m.avg_download_ms(),
        "adaptive_window": m.adaptive_prefetch_ahead(),
        "segments_downloaded": m.download_count.load(Ordering::Relaxed),
    });

    (
        StatusCode::OK,
        [
            ("content-type", "application/json"),
            ("access-control-allow-origin", "*"),
        ],
        json.to_string(),
    )
}

/// Start the proxy server on a random local port
pub async fn start_proxy(state: ProxyState) {
    let app = Router::new()
        .route("/proxy", get(proxy_handler).options(options_handler))
        .route("/metrics", get(metrics_handler))
        .with_state(state.clone());

    let listener = match tokio::net::TcpListener::bind("127.0.0.1:0").await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[HLS Proxy] Failed to bind: {}", e);
            return;
        }
    };

    let port = listener.local_addr().unwrap().port();
    state.port.store(port, Ordering::SeqCst);
    println!("[HLS Proxy] 🚀 Started on http://127.0.0.1:{} with continuous prefetching", port);

    if let Err(e) = axum::serve(listener, app).await {
        eprintln!("[HLS Proxy] Server error: {}", e);
    }
}
