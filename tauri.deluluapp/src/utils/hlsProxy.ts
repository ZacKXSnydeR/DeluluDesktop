/**
 * HLS Proxy Utility
 * 
 * Interfaces with the Rust-side local proxy server for CDN header injection.
 * The proxy runs on 127.0.0.1:{random_port} and forwards all HLS requests
 * with the correct Referer/Origin headers that CDNs require.
 */

import { invoke } from '@tauri-apps/api/core';

let cachedPort: number | null = null;

/**
 * Get the local proxy server port.
 * The proxy starts on app launch — this polls until it's ready.
 */
export async function getProxyPort(): Promise<number> {
    if (cachedPort) return cachedPort;

    try {
        const port = await invoke<number>('get_proxy_port');
        cachedPort = port;
        console.log(`[HLS Proxy] Running on port ${port}`);
        return port;
    } catch (e) {
        console.error('[HLS Proxy] Failed to get port:', e);
        throw e;
    }
}

/**
 * Set CDN headers on the proxy. Call this before starting HLS playback.
 * These headers (Referer, Origin, User-Agent) will be injected into
 * every request the proxy makes to the CDN.
 */
export async function setProxyHeaders(headers?: Record<string, string>): Promise<void> {
    try {
        await invoke('set_proxy_headers', {
            referer: headers?.['Referer'] || headers?.['referer'] || 'https://vidlink.pro/',
            origin: headers?.['Origin'] || headers?.['origin'] || 'https://vidlink.pro',
            userAgent: headers?.['User-Agent'] || headers?.['user-agent'] || undefined,
        });
        console.log('[HLS Proxy] CDN headers set');
    } catch (e) {
        console.error('[HLS Proxy] Failed to set headers:', e);
    }
}

/**
 * Convert a CDN stream URL to a proxied URL.
 * The returned URL routes through the local Rust proxy which adds CDN headers.
 * 
 * Example:
 *   Input:  https://cdn.example.com/master.m3u8
 *   Output: http://127.0.0.1:54321/proxy?url=https%3A%2F%2Fcdn.example.com%2Fmaster.m3u8
 */
export function getProxiedUrl(originalUrl: string, port: number): string {
    return `http://127.0.0.1:${port}/proxy?url=${encodeURIComponent(originalUrl)}`;
}

/**
 * Clear the Rust-side proxy cache.
 * Called before starting a new stream so stale segments don't waste memory.
 */
export async function clearProxyCache(): Promise<void> {
    try {
        await invoke('clear_proxy_cache');
        console.log('[HLS Proxy] Cache cleared for new stream');
    } catch (e) {
        console.error('[HLS Proxy] Failed to clear cache:', e);
    }
}

/**
 * Initialize the proxy and convert a stream URL to proxied form.
 * Convenience function that handles the full setup flow.
 */
export async function proxyStreamUrl(
    streamUrl: string,
    headers?: Record<string, string>
): Promise<string> {
    // Clear old stream's cached segments before starting new stream
    await clearProxyCache();

    // Set CDN headers on the proxy
    await setProxyHeaders(headers);

    // Get proxy port
    const port = await getProxyPort();

    // Return proxied URL
    return getProxiedUrl(streamUrl, port);
}
