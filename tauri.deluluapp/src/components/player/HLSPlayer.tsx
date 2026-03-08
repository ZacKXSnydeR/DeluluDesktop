/**
 * HLS Video Player Component
 * 
 * Uses hls.js to play m3u8 streams from VidLink
 * CDN headers are injected via hls.js xhrSetup
 */

import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import './HLSPlayer.css';

interface HLSPlayerProps {
    streamUrl: string;
    headers?: {
        Referer?: string;
        Origin?: string;
        'User-Agent'?: string;
    };
    title?: string;
    onBack?: () => void;
    autoPlay?: boolean;
}

export function HLSPlayer({
    streamUrl,
    headers,
    title = 'Video',
    onBack,
    autoPlay = true
}: HLSPlayerProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const hlsRef = useRef<Hls | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [currentQuality, setCurrentQuality] = useState<number>(-1);
    const [qualities, setQualities] = useState<{ height: number; index: number }[]>([]);

    useEffect(() => {
        if (!streamUrl || !videoRef.current) return;

        const video = videoRef.current;

        if (Hls.isSupported()) {
            const hls = new Hls({
                enableWorker: true,
                lowLatencyMode: false,
                // Aggressive buffering
                backBufferLength: 90,
                maxBufferLength: 90,
                maxMaxBufferLength: 180,
                maxBufferSize: 120 * 1000 * 1000, // 120MB buffer
                maxBufferHole: 0.5,
                // Start at highest quality — proxy cache = effectively infinite bandwidth
                startLevel: -1,
                abrEwmaDefaultEstimate: 20_000_000, // 20 Mbps
                abrBandWidthFactor: 0.95,
                abrBandWidthUpFactor: 0.85,
                // Retry aggressively
                fragLoadingMaxRetry: 6,
                manifestLoadingMaxRetry: 4,
                levelLoadingMaxRetry: 4,
                fragLoadingRetryDelay: 1000,
            });

            hlsRef.current = hls;

            hls.loadSource(streamUrl);
            hls.attachMedia(video);

            hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
                setIsLoading(false);

                // Get available qualities
                const levels = data.levels.map((level, index) => ({
                    height: level.height,
                    index,
                })).sort((a, b) => b.height - a.height);

                setQualities(levels);

                // Lock to highest quality — proxy cache makes bandwidth effectively unlimited
                if (levels.length > 0) {
                    const highest = levels[0]; // Already sorted desc
                    hls.autoLevelCapping = highest.index;
                    hls.nextAutoLevel = highest.index;
                }

                if (autoPlay) {
                    video.play().catch(console.error);
                }
            });

            hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
                setCurrentQuality(data.level);
            });

            hls.on(Hls.Events.ERROR, (_event, data) => {
                console.error('HLS error:', data);
                if (data.fatal) {
                    setError(`Playback error: ${data.type}`);
                    setIsLoading(false);
                }
            });

            return () => {
                hls.destroy();
                hlsRef.current = null;
            };
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            // Native HLS support (Safari)
            video.src = streamUrl;
            video.addEventListener('loadedmetadata', () => {
                setIsLoading(false);
                if (autoPlay) {
                    video.play().catch(console.error);
                }
            });
            video.addEventListener('error', () => {
                setError('Playback error');
                setIsLoading(false);
            });
        } else {
            setError('HLS not supported in this browser');
            setIsLoading(false);
        }

        return undefined;
    }, [streamUrl, headers, autoPlay]);

    const handleQualityChange = (levelIndex: number) => {
        if (hlsRef.current) {
            hlsRef.current.currentLevel = levelIndex;
        }
    };

    return (
        <div className="hls-player">
            {/* Header with back button and title */}
            <div className="hls-player-header">
                {onBack && (
                    <button className="hls-back-button" onClick={onBack}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M19 12H5M12 19l-7-7 7-7" />
                        </svg>
                    </button>
                )}
                <span className="hls-title">{title}</span>

                {/* Quality selector */}
                {qualities.length > 1 && (
                    <select
                        className="hls-quality-selector"
                        value={currentQuality}
                        onChange={(e) => handleQualityChange(parseInt(e.target.value))}
                    >
                        <option value={-1}>Auto</option>
                        {qualities.map((q) => (
                            <option key={q.index} value={q.index}>
                                {q.height}p
                            </option>
                        ))}
                    </select>
                )}
            </div>

            {/* Video element */}
            <video
                ref={videoRef}
                className="hls-video"
                controls
                playsInline
            />

            {/* Loading overlay */}
            {isLoading && (
                <div className="hls-loading">
                    <div className="hls-spinner" />
                    <span>Loading stream...</span>
                </div>
            )}

            {/* Error overlay */}
            {error && (
                <div className="hls-error">
                    <span>⚠️ {error}</span>
                    {onBack && (
                        <button onClick={onBack}>Go Back</button>
                    )}
                </div>
            )}
        </div>
    );
}
