import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Hls from 'hls.js';
import { useMiniPlayer } from '../../context/MiniPlayerContext';
import './MiniPlayer.css';

export function MiniPlayer() {
    const { miniPlayer, deactivateMiniPlayer, updateCurrentTime } = useMiniPlayer();
    const navigate = useNavigate();
    const videoRef = useRef<HTMLVideoElement>(null);
    const hlsRef = useRef<Hls | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const [isPlaying, setIsPlaying] = useState(true);
    const [isDragging, setIsDragging] = useState(false);
    const [position, setPosition] = useState({ x: 20, y: 20 }); // Bottom-right default
    const dragStart = useRef({ x: 0, y: 0 });
    const positionStart = useRef({ x: 0, y: 0 });

    // Check if this is a VidLink stream (hash starts with 'vidlink-')
    // Check if stream is HLS
    const isHLSStream = miniPlayer.streamUrl?.includes('.m3u8') || miniPlayer.streamUrl?.includes('m3u8');

    // Initialize video/HLS
    useEffect(() => {
        if (!miniPlayer.isActive || !miniPlayer.streamUrl || !videoRef.current) return;

        const video = videoRef.current;

        // For HLS streams, use hls.js
        if (isHLSStream && Hls.isSupported()) {
            const hls = new Hls({
                enableWorker: true,
                lowLatencyMode: false,
                startPosition: miniPlayer.currentTime > 0 ? miniPlayer.currentTime : -1,
                // Highest quality from start — proxy cache = fast
                startLevel: -1,
                abrEwmaDefaultEstimate: 20_000_000,
                abrBandWidthUpFactor: 0.85,
            });

            hlsRef.current = hls;
            hls.loadSource(miniPlayer.streamUrl);
            hls.attachMedia(video);

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                video.currentTime = miniPlayer.currentTime;
                video.play().catch(() => { });
                setIsPlaying(true);
            });

            return () => {
                hls.destroy();
                hlsRef.current = null;
            };
        } else if (isHLSStream && video.canPlayType('application/vnd.apple.mpegurl')) {
            // Native HLS (Safari)
            video.src = miniPlayer.streamUrl;
            video.currentTime = miniPlayer.currentTime;
            video.play().catch(() => { });
            setIsPlaying(true);
        } else {
            // Regular video (direct streams)
            video.src = miniPlayer.streamUrl;
            video.currentTime = miniPlayer.currentTime;
            video.play().catch(() => { });
            setIsPlaying(true);
        }
    }, [miniPlayer.isActive, miniPlayer.streamUrl, miniPlayer.currentTime, isHLSStream]);

    // Handle drag start
    const handleDragStart = (e: React.MouseEvent) => {
        e.preventDefault();
        setIsDragging(true);
        dragStart.current = { x: e.clientX, y: e.clientY };
        positionStart.current = { ...position };
    };

    // Handle drag move
    useEffect(() => {
        const handleDragMove = (e: MouseEvent) => {
            if (!isDragging) return;

            const dx = dragStart.current.x - e.clientX;
            const dy = dragStart.current.y - e.clientY;

            setPosition({
                x: Math.max(0, positionStart.current.x + dx),
                y: Math.max(0, positionStart.current.y + dy),
            });
        };

        const handleDragEnd = () => {
            setIsDragging(false);
        };

        if (isDragging) {
            document.addEventListener('mousemove', handleDragMove);
            document.addEventListener('mouseup', handleDragEnd);
        }

        return () => {
            document.removeEventListener('mousemove', handleDragMove);
            document.removeEventListener('mouseup', handleDragEnd);
        };
    }, [isDragging]);

    // Toggle play/pause
    const togglePlay = () => {
        if (videoRef.current) {
            if (isPlaying) {
                videoRef.current.pause();
            } else {
                videoRef.current.play();
            }
            setIsPlaying(!isPlaying);
        }
    };

    // Expand to full screen
    const expandToFullscreen = () => {
        if (videoRef.current && miniPlayer.source) {
            const currentTime = videoRef.current.currentTime;
            updateCurrentTime(currentTime);

            const source = miniPlayer.source;
            const params = new URLSearchParams();
            params.set('title', miniPlayer.title || '');
            params.set('time', String(currentTime));

            if (source.mediaType === 'tv') {
                params.set('season', String(source.season ?? 1));
                params.set('episode', String(source.episode ?? 1));
            }
            if (source.posterPath) params.set('poster', source.posterPath);
            if (source.genre) params.set('genre', source.genre);

            navigate(`/stream/${source.mediaType}/${source.tmdbId}?${params.toString()}`);
        }
    };

    // Close mini player
    const closeMiniPlayer = () => {
        // Cleanup HLS if active
        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }
        deactivateMiniPlayer();
    };

    if (!miniPlayer.isActive || !miniPlayer.streamUrl) {
        return null;
    }

    return (
        <div
            ref={containerRef}
            className={`mini-player ${isDragging ? 'mini-player-dragging' : ''}`}
            style={{ right: position.x, bottom: position.y }}
        >
            {/* Drag handle */}
            <div className="mini-player-header" onMouseDown={handleDragStart}>
                <span className="mini-player-title">{miniPlayer.title}</span>
                <div className="mini-player-header-actions">
                    <button className="mini-player-btn" onClick={expandToFullscreen} title="Expand">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
                        </svg>
                    </button>
                    <button className="mini-player-btn" onClick={closeMiniPlayer} title="Close">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Video */}
            <div className="mini-player-video-container" onClick={togglePlay}>
                <video
                    ref={videoRef}
                    className="mini-player-video"
                    autoPlay
                    muted={false}
                    playsInline
                />
                {/* Play/pause overlay */}
                {!isPlaying && (
                    <div className="mini-player-play-overlay">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="white">
                            <path d="M8 5v14l11-7z" />
                        </svg>
                    </div>
                )}
            </div>
        </div>
    );
}
