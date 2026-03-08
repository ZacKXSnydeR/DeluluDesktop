import { useState, useRef, useEffect, useCallback } from 'react';
import type { MutableRefObject } from 'react';
import Hls from 'hls.js';
import {
    Play,
    Pause,
    Volume2,
    VolumeX,
    Volume1,
    Maximize,
    Minimize,
    SkipBack,
    SkipForward,
    Settings,
    Subtitles,
    ChevronLeft,
    Check,
    X,
} from 'lucide-react';
import { watchService } from '../../services/watchHistory';

import './DeluluPlayer.css';

// ============================================
// VTT PARSER
// ============================================
function parseVTT(vttContent: string): Array<{ start: number; end: number; text: string }> {
    const cues: Array<{ start: number; end: number; text: string }> = [];
    const lines = vttContent.split('\n');

    let i = 0;
    while (i < lines.length) {
        const line = lines[i].trim();

        // Look for timestamp lines (e.g., "00:00:05.000 --> 00:00:08.000")
        if (line.includes('-->')) {
            const timeParts = line.split('-->');
            if (timeParts.length === 2) {
                const start = parseVTTTime(timeParts[0].trim());
                const end = parseVTTTime(timeParts[1].trim().split(' ')[0]); // Remove positioning data

                // Collect text lines until empty line
                const textLines: string[] = [];
                i++;
                while (i < lines.length && lines[i].trim() !== '') {
                    textLines.push(lines[i].trim());
                    i++;
                }

                if (textLines.length > 0 && !isNaN(start) && !isNaN(end)) {
                    cues.push({
                        start,
                        end,
                        text: textLines.join('\n').replace(/<[^>]+>/g, ''), // Strip HTML tags
                    });
                }
            }
        }
        i++;
    }

    return cues;
}

function parseVTTTime(timeStr: string): number {
    // Handle formats: "00:00:05.000" or "00:05.000"
    const parts = timeStr.split(':');
    if (parts.length === 3) {
        const hours = parseFloat(parts[0]);
        const minutes = parseFloat(parts[1]);
        const seconds = parseFloat(parts[2]);
        return hours * 3600 + minutes * 60 + seconds;
    } else if (parts.length === 2) {
        const minutes = parseFloat(parts[0]);
        const seconds = parseFloat(parts[1]);
        return minutes * 60 + seconds;
    }
    return NaN;
}

// ============================================
// TYPES
// ============================================
interface DeluluPlayerProps {
    src: string;
    title?: string;
    posterUrl?: string;
    metadataLabel?: string;
    genreLabel?: string;
    isSeries?: boolean;
    nextEpisode?: {
        title: string;
        seasonNumber: number;
        episodeNumber: number;
        episodeName?: string;
        posterUrl?: string;
    };
    onPlayNextEpisode?: () => void;
    onBack?: () => void;
    onMinimize?: () => void;
    onReady?: () => void;
    onFatalError?: (type: string, details: string) => void;
    initialTime?: number;
    videoRef?: MutableRefObject<HTMLVideoElement | null>;
    showQualitySelector?: boolean;
    headers?: {
        Referer?: string;
        Origin?: string;
        'User-Agent'?: string;
    };
    subtitles?: SubtitleTrack[];
    // Watch tracking props
    tmdbId?: number;
    mediaType?: 'movie' | 'tv';
    seasonNumber?: number;
    episodeNumber?: number;
}

interface SubtitleTrack {
    label: string;
    src: string;
    language: string;
    default?: boolean;
}

interface QualityLevel {
    height: number;
    index: number;
    bitrate: number;
}

interface SubtitleSettings {
    fontSize: number;
    textColor: string;
    bgOpacity: number;
    position: 'bottom' | 'top';
}

// ============================================
// COMPONENT
// ============================================
export function DeluluPlayer({
    src,
    title = 'Video',
    posterUrl,
    metadataLabel,
    genreLabel,
    isSeries = false,
    nextEpisode,
    onPlayNextEpisode,
    onBack,
    onMinimize,
    onReady,
    onFatalError,
    initialTime = 0,
    videoRef: externalVideoRef,
    showQualitySelector = true,
    headers,
    subtitles = [],
    // Watch tracking
    tmdbId,
    mediaType,
    seasonNumber,
    episodeNumber,
}: DeluluPlayerProps) {
    // Refs
    const internalVideoRef = useRef<HTMLVideoElement>(null);
    const videoRef = externalVideoRef || internalVideoRef;
    const containerRef = useRef<HTMLDivElement>(null);
    const progressRef = useRef<HTMLDivElement>(null);
    const settingsPanelRef = useRef<HTMLDivElement>(null);
    const settingsToggleRef = useRef<HTMLButtonElement>(null);
    const subtitlePanelRef = useRef<HTMLDivElement>(null);
    const subtitleToggleRef = useRef<HTMLButtonElement>(null);
    const suppressNextToggleRef = useRef(false);
    const hlsRef = useRef<Hls | null>(null);
    const preferredAutoLevelRef = useRef<number>(-1);
    const lastAutoBoostAtRef = useRef<number>(0);
    const currentQualityRef = useRef<number>(-1);
    const hideControlsTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
    const readyNotifiedRef = useRef(false);

    // Playback state
    const [isPlaying, setIsPlaying] = useState(false);
    const [isEnded, setIsEnded] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showControls, setShowControls] = useState(true);
    const [isBuffering, setIsBuffering] = useState(false);
    const [buffered, setBuffered] = useState(0);

    // UI state
    const [showSettings, setShowSettings] = useState(false);
    const [showSubtitleSettings, setShowSubtitleSettings] = useState(false);

    const [hoverTime, setHoverTime] = useState<number | null>(null);
    const [hoverPosition, setHoverPosition] = useState(0);

    // Quality state
    const [qualities, setQualities] = useState<QualityLevel[]>([]);
    const [currentQuality, setCurrentQuality] = useState<number>(-1); // -1 = Auto
    const [isHLS, setIsHLS] = useState(false);

    useEffect(() => {
        currentQualityRef.current = currentQuality;
    }, [currentQuality]);

    // Subtitle state
    const [activeSubtitle, setActiveSubtitle] = useState<number>(0); // default to first track when available
    const [subtitleSettings, setSubtitleSettings] = useState<SubtitleSettings>({
        fontSize: 32,
        textColor: '#ffffff',
        bgOpacity: 0.5,
        position: 'bottom',
    });

    // Custom subtitle rendering state
    const [subtitleCues, setSubtitleCues] = useState<Array<{ start: number; end: number; text: string }>>([]);
    const [currentSubtitleText, setCurrentSubtitleText] = useState<string>('');

    // Debug: Log subtitle prop
    useEffect(() => {
        console.log('[DeluluPlayer] Subtitles prop:', subtitles);
        console.log('[DeluluPlayer] Subtitle count:', subtitles.length);
    }, [subtitles]);

    // Watch history tracking
    useEffect(() => {
        console.log('[DeluluPlayer] Watch tracking check:', { tmdbId, mediaType, hasVideo: !!videoRef.current });
        if (!tmdbId || !mediaType || !videoRef.current) {
            console.log('[DeluluPlayer] Watch tracking SKIP - missing props');
            return;
        }
        console.log('[DeluluPlayer] Watch tracking START:', { tmdbId, mediaType, season: seasonNumber, episode: episodeNumber });

        const video = videoRef.current;
        let progressTimer: NodeJS.Timeout;

        // Track progress update function
        const trackProgress = () => {
            if (!video.duration || isNaN(video.duration)) {
                console.log('[DeluluPlayer] Skip track - no duration');
                return;
            }
            console.log('[DeluluPlayer] Progress:', (video.currentTime / video.duration * 100).toFixed(1) + '%');

            watchService.updateProgress({
                tmdbId,
                mediaType,
                seasonNumber,
                episodeNumber,
                currentTime: video.currentTime,
                totalDuration: video.duration,
            });
        };

        // Track every 5 seconds
        progressTimer = setInterval(trackProgress, 5000);

        // Track on pause/ended
        const handlePause = () => trackProgress();
        const handleEnded = () => trackProgress();

        video.addEventListener('pause', handlePause);
        video.addEventListener('ended', handleEnded);

        return () => {
            clearInterval(progressTimer);
            video.removeEventListener('pause', handlePause);
            video.removeEventListener('ended', handleEnded);
            // Final sync on unmount
            trackProgress();
            watchService.syncToDatabase().catch(console.error);
        };
    }, [tmdbId, mediaType, seasonNumber, episodeNumber, videoRef]);

    // Load and parse VTT file when subtitle is selected
    useEffect(() => {
        if (activeSubtitle < 0 || !subtitles[activeSubtitle]) {
            setSubtitleCues([]);
            setCurrentSubtitleText('');
            return;
        }

        const loadSubtitle = async () => {
            try {
                const response = await fetch(subtitles[activeSubtitle].src);
                if (!response.ok) throw new Error('Failed to fetch subtitle');

                const vttContent = await response.text();
                const cues = parseVTT(vttContent);
                console.log('[DeluluPlayer] Parsed VTT cues:', cues.length);
                setSubtitleCues(cues);
            } catch (err) {
                console.error('[DeluluPlayer] Failed to load subtitle:', err);
                setSubtitleCues([]);
            }
        };

        loadSubtitle();
    }, [activeSubtitle, subtitles]);

    // Auto-enable subtitle by default for each new stream (user can still turn it off)
    useEffect(() => {
        if (!subtitles.length) {
            setActiveSubtitle(-1);
            return;
        }
        const defaultIndex = subtitles.findIndex((sub) => sub.default);
        setActiveSubtitle(defaultIndex >= 0 ? defaultIndex : 0);
    }, [src, subtitles]);

    // Update current subtitle text based on video time
    useEffect(() => {
        if (subtitleCues.length === 0) {
            setCurrentSubtitleText('');
            return;
        }

        // Find matching cue for current time
        const cue = subtitleCues.find(c => currentTime >= c.start && currentTime <= c.end);
        const newText = cue?.text || '';
        if (newText !== currentSubtitleText) {
            console.log('[DeluluPlayer] Subtitle text:', newText ? newText.substring(0, 50) : '(none)', 'at', currentTime.toFixed(1));
        }
        setCurrentSubtitleText(newText);
    }, [currentTime, subtitleCues, currentSubtitleText]);

    // ========================================
    // HLS INITIALIZATION
    // ========================================
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !src) return;
        readyNotifiedRef.current = false;

        const isM3U8 = src.includes('.m3u8') || src.includes('m3u8');

        // Use Tauri HTTP plugin loader for CDN header injection
        if (isM3U8 && Hls.isSupported()) {
            setIsHLS(true);

            const hls = new Hls({
                enableWorker: true,
                lowLatencyMode: false,
                startPosition: initialTime > 0 ? initialTime : -1,
                // Aggressive buffering for smooth playback
                backBufferLength: 90,
                maxBufferLength: 90,
                maxMaxBufferLength: 180,
                maxBufferSize: 120 * 1000 * 1000, // 120MB buffer
                maxBufferHole: 0.5,
                // Start at HIGHEST quality — proxy cache makes bandwidth effectively infinite
                startLevel: -1, // -1 = auto, but with high estimate it picks top
                abrEwmaDefaultEstimate: 20_000_000, // 20 Mbps — assume fast (proxy serves from cache)
                abrEwmaFastLive: 2,
                abrEwmaSlowLive: 6,
                abrEwmaFastVoD: 2,
                abrEwmaSlowVoD: 6,
                abrBandWidthFactor: 0.95,
                abrBandWidthUpFactor: 0.85, // Aggressive upswitch (was 0.7)
                // Retry aggressively
                fragLoadingMaxRetry: 6,
                manifestLoadingMaxRetry: 4,
                levelLoadingMaxRetry: 4,
                fragLoadingRetryDelay: 1000,
            });

            hlsRef.current = hls;
            hls.loadSource(src);
            hls.attachMedia(video);

            hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
                const sourceLevels = data.levels.map((level, index) => ({
                    height: level.height || 0,
                    index,
                    bitrate: level.bitrate || 0,
                }));

                // Get available quality levels
                const levels = sourceLevels
                    .sort((a, b) => b.height - a.height);

                setQualities(levels);

                // Smart quality preference: pick the highest available level
                // (since our proxy prefetches segments, bandwidth is effectively unlimited)
                const highest = sourceLevels
                    .filter((level) => level.height > 0)
                    .sort((a, b) => b.height - a.height)[0];
                const preferredAutoLevel = highest?.index ?? -1;
                preferredAutoLevelRef.current = preferredAutoLevel;

                // Tell ABR to target the highest level immediately
                if (preferredAutoLevel >= 0) {
                    hls.autoLevelCapping = preferredAutoLevel;
                    hls.nextAutoLevel = preferredAutoLevel;
                }

                if (initialTime > 0) {
                    video.currentTime = initialTime;
                }
                video.play().catch(console.error);
            });

            hls.on(Hls.Events.LEVEL_SWITCHED, () => {
                // Quality level switched - handled by currentQuality state
            });

            hls.on(Hls.Events.FRAG_BUFFERED, () => {
                // In auto mode, continuously nudge ABR toward the highest level.
                // Since the proxy serves most segments from cache, bandwidth
                // measurements can be noisy — this ensures we always ramp up.
                if (currentQualityRef.current !== -1) return; // User locked a specific level
                const preferred = preferredAutoLevelRef.current;
                if (preferred < 0) return;
                if (hls.currentLevel >= preferred) return;

                const media = hls.media;
                if (!media || media.readyState < 3) return;

                let bufferedAhead = 0;
                if (media.buffered.length > 0) {
                    const bufferedEnd = media.buffered.end(media.buffered.length - 1);
                    bufferedAhead = Math.max(0, bufferedEnd - media.currentTime);
                }
                // Boost when we have >=6s buffer (was 12s) — proxy cache makes this safe
                if (bufferedAhead < 6) return;

                const now = Date.now();
                if (now - lastAutoBoostAtRef.current < 2000) return; // Every 2s (was 4s)

                hls.nextAutoLevel = preferred;
                lastAutoBoostAtRef.current = now;
            });

            hls.on(Hls.Events.ERROR, (_event, data) => {
                if (data.fatal) {
                    console.error('[DeluluPlayer] HLS fatal error:', data);
                    if (onFatalError) {
                        onFatalError(data.type, data.details);
                    }
                }
            });

            return () => {
                hls.destroy();
                hlsRef.current = null;
            };
        } else if (isM3U8 && video.canPlayType('application/vnd.apple.mpegurl')) {
            // Native HLS (Safari)
            setIsHLS(true);
            video.src = src;
            if (initialTime > 0) {
                video.currentTime = initialTime;
            }
        } else {
            // Regular video (MP4, WebM)
            setIsHLS(false);
            video.src = src;
            if (initialTime > 0) {
                video.currentTime = initialTime;
            }
        }

        return undefined;
    }, [src, headers, initialTime]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !onReady) return;

        const notifyReady = () => {
            if (readyNotifiedRef.current) return;
            readyNotifiedRef.current = true;
            onReady();
        };

        video.addEventListener('loadeddata', notifyReady);
        video.addEventListener('canplay', notifyReady);

        return () => {
            video.removeEventListener('loadeddata', notifyReady);
            video.removeEventListener('canplay', notifyReady);
        };
    }, [videoRef, onReady, src]);

    // ========================================
    // QUALITY CHANGE
    // ========================================
    const handleQualityChange = (levelIndex: number) => {
        if (hlsRef.current) {
            if (levelIndex === -1) {
                hlsRef.current.currentLevel = -1;
                if (preferredAutoLevelRef.current >= 0) {
                    hlsRef.current.autoLevelCapping = preferredAutoLevelRef.current;
                }
            } else {
                hlsRef.current.autoLevelCapping = -1;
                hlsRef.current.currentLevel = levelIndex;
            }
            setCurrentQuality(levelIndex);
        }
        setShowSettings(false);
    };

    // ========================================
    // TIME FORMATTING
    // ========================================
    const formatTime = (seconds: number): string => {
        if (!isFinite(seconds) || isNaN(seconds)) return '0:00';
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        if (hrs > 0) {
            return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    // ========================================
    // CONTROL VISIBILITY
    // ========================================
    const resetHideTimeout = useCallback(() => {
        if (hideControlsTimeout.current) {
            clearTimeout(hideControlsTimeout.current);
        }
        setShowControls(true);
        hideControlsTimeout.current = setTimeout(() => {
            const video = videoRef.current;
            const activelyPlaying = Boolean(video && !video.paused && !video.ended);
            if (activelyPlaying && !showSettings && !showSubtitleSettings) {
                setShowControls(false);
            }
        }, 3000);
    }, [showSettings, showSubtitleSettings, videoRef]);

    useEffect(() => {
        if (isPlaying) {
            resetHideTimeout();
            return;
        }

        if (hideControlsTimeout.current) {
            clearTimeout(hideControlsTimeout.current);
        }
        setShowControls(true);
    }, [isPlaying, resetHideTimeout]);

    useEffect(() => {
        return () => {
            if (hideControlsTimeout.current) {
                clearTimeout(hideControlsTimeout.current);
            }
        };
    }, []);

    // Close settings/subtitle panels on outside click (without toggling playback on same click)
    useEffect(() => {
        if (!showSettings && !showSubtitleSettings) return;

        const onDocumentPointerDown = (event: MouseEvent) => {
            const target = event.target as Node;

            const insideSubtitlePanel = subtitlePanelRef.current?.contains(target);
            const subtitleToggleClicked = subtitleToggleRef.current?.contains(target);
            const insideSettingsPanel = settingsPanelRef.current?.contains(target);
            const settingsToggleClicked = settingsToggleRef.current?.contains(target);

            const clickedInsideAnyPanel = insideSubtitlePanel || insideSettingsPanel;
            const clickedAnyToggle = subtitleToggleClicked || settingsToggleClicked;

            if (!clickedInsideAnyPanel && !clickedAnyToggle) {
                // Prevent this same click from also toggling pause/resume on player container.
                suppressNextToggleRef.current = true;
                setShowSettings(false);
                setShowSubtitleSettings(false);
            }
        };

        document.addEventListener('mousedown', onDocumentPointerDown);
        return () => {
            document.removeEventListener('mousedown', onDocumentPointerDown);
        };
    }, [showSettings, showSubtitleSettings]);

    // ========================================
    // PLAYBACK CONTROLS
    // ========================================
    const togglePlay = () => {
        if (videoRef.current) {
            if (isEnded) {
                videoRef.current.currentTime = 0;
                setIsEnded(false);
            }
            if (isPlaying) {
                videoRef.current.pause();
            } else {
                videoRef.current.play();
            }
        }
    };

    const toggleFullscreen = () => {
        if (!document.fullscreenElement) {
            containerRef.current?.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    };

    const toggleMute = () => {
        if (videoRef.current) {
            videoRef.current.muted = !isMuted;
            setIsMuted(!isMuted);
        }
    };

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newVolume = parseFloat(e.target.value);
        if (videoRef.current) {
            videoRef.current.volume = newVolume;
            setVolume(newVolume);
            setIsMuted(newVolume === 0);
        }
    };

    const skip = (seconds: number) => {
        if (videoRef.current) {
            videoRef.current.currentTime = Math.max(
                0,
                Math.min(duration, videoRef.current.currentTime + seconds)
            );
        }
    };

    const jumpToPercent = (percent: number) => {
        if (!videoRef.current || !duration || !isFinite(duration)) return;
        const clamped = Math.max(0, Math.min(100, percent));
        videoRef.current.currentTime = (clamped / 100) * duration;
    };

    const adjustVolume = (delta: number) => {
        if (!videoRef.current) return;
        const newVol = Math.max(0, Math.min(1, volume + delta));
        videoRef.current.volume = newVol;
        setVolume(newVol);
        setIsMuted(newVol === 0);
    };

    const toggleSubtitles = () => {
        if (!subtitles.length) return;
        if (activeSubtitle >= 0) {
            handleSubtitleChange(-1);
            return;
        }
        const defaultIndex = subtitles.findIndex((sub) => sub.default);
        handleSubtitleChange(defaultIndex >= 0 ? defaultIndex : 0);
    };

    // ========================================
    // PROGRESS BAR
    // ========================================
    const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
        if (progressRef.current && videoRef.current) {
            const rect = progressRef.current.getBoundingClientRect();
            const pos = (e.clientX - rect.left) / rect.width;
            videoRef.current.currentTime = pos * duration;
        }
    };

    const handleProgressHover = (e: React.MouseEvent<HTMLDivElement>) => {
        if (progressRef.current) {
            const rect = progressRef.current.getBoundingClientRect();
            const pos = (e.clientX - rect.left) / rect.width;
            setHoverPosition(e.clientX - rect.left);
            setHoverTime(pos * duration);
        }
    };

    // ========================================
    // VIDEO EVENT HANDLERS
    // ========================================
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const onPlay = () => {
            setIsPlaying(true);
            setIsEnded(false);
        };
        const onPause = () => setIsPlaying(false);
        const onTimeUpdate = () => {
            setCurrentTime(video.currentTime);
            setIsEnded((prev) => (
                prev && video.currentTime < Math.max(0, video.duration - 0.5) ? false : prev
            ));
        };
        const onDurationChange = () => setDuration(video.duration);
        const onWaiting = () => setIsBuffering(true);
        const onPlaying = () => setIsBuffering(false);
        const onEnded = () => {
            setIsPlaying(false);
            setIsEnded(true);
        };
        const onProgress = () => {
            if (video.buffered.length > 0) {
                const bufferedEnd = video.buffered.end(video.buffered.length - 1);
                setBuffered((bufferedEnd / video.duration) * 100);
            }
        };
        const onFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };

        video.addEventListener('play', onPlay);
        video.addEventListener('pause', onPause);
        video.addEventListener('timeupdate', onTimeUpdate);
        video.addEventListener('durationchange', onDurationChange);
        video.addEventListener('waiting', onWaiting);
        video.addEventListener('playing', onPlaying);
        video.addEventListener('ended', onEnded);
        video.addEventListener('progress', onProgress);
        document.addEventListener('fullscreenchange', onFullscreenChange);

        return () => {
            video.removeEventListener('play', onPlay);
            video.removeEventListener('pause', onPause);
            video.removeEventListener('timeupdate', onTimeUpdate);
            video.removeEventListener('durationchange', onDurationChange);
            video.removeEventListener('waiting', onWaiting);
            video.removeEventListener('playing', onPlaying);
            video.removeEventListener('ended', onEnded);
            video.removeEventListener('progress', onProgress);
            document.removeEventListener('fullscreenchange', onFullscreenChange);
        };
    }, []);

    // ========================================
    // KEYBOARD SHORTCUTS
    // ========================================
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            if (!target) return;

            // Ignore while typing/editing
            if (
                target instanceof HTMLInputElement ||
                target instanceof HTMLTextAreaElement ||
                target.isContentEditable
            ) {
                return;
            }

            // Keep OS/browser shortcuts untouched
            if (e.ctrlKey || e.metaKey || e.altKey) return;

            const key = e.key.toLowerCase();
            let handled = true;
            const nearEndThresholdSeconds = 120;
            const canPlayNextEpisodeWithHotkey = Boolean(
                isSeries &&
                nextEpisode &&
                onPlayNextEpisode &&
                (isEnded || (duration > 0 && Math.max(0, duration - currentTime) <= nearEndThresholdSeconds))
            );

            if (key >= '0' && key <= '9') {
                e.preventDefault();
                jumpToPercent(Number(key) * 10);
                resetHideTimeout();
                return;
            }

            switch (e.code) {
                case 'Space':
                case 'KeyK':
                    e.preventDefault();
                    togglePlay();
                    break;
                case 'KeyJ':
                    e.preventDefault();
                    skip(-10);
                    break;
                case 'KeyL':
                    e.preventDefault();
                    skip(10);
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    skip(e.shiftKey ? -10 : -5);
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    skip(e.shiftKey ? 10 : 5);
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    adjustVolume(0.05);
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    adjustVolume(-0.05);
                    break;
                case 'KeyF':
                case 'F11':
                    e.preventDefault();
                    toggleFullscreen();
                    break;
                case 'KeyM':
                    e.preventDefault();
                    toggleMute();
                    break;
                case 'KeyC':
                    e.preventDefault();
                    toggleSubtitles();
                    break;
                case 'KeyS':
                    e.preventDefault();
                    if (showSettings || showSubtitleSettings) {
                        setShowSettings(false);
                        setShowSubtitleSettings(false);
                    } else if (showQualitySelector && isHLS && qualities.length > 0) {
                        setShowSettings(true);
                    }
                    break;
                case 'KeyN':
                    if (canPlayNextEpisodeWithHotkey) {
                        e.preventDefault();
                        onPlayNextEpisode?.();
                    } else {
                        handled = false;
                    }
                    break;
                case 'Home':
                    e.preventDefault();
                    jumpToPercent(0);
                    break;
                case 'End':
                    e.preventDefault();
                    jumpToPercent(99.5);
                    break;
                case 'Escape':
                    e.preventDefault();
                    if (showSettings || showSubtitleSettings) {
                        setShowSettings(false);
                        setShowSubtitleSettings(false);
                    } else if (document.fullscreenElement) {
                        document.exitFullscreen().catch(() => undefined);
                    }
                    break;
                default:
                    handled = false;
                    break;
            }
            if (handled) {
                resetHideTimeout();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [
        volume,
        showSettings,
        showSubtitleSettings,
        showQualitySelector,
        isHLS,
        qualities.length,
        subtitles,
        activeSubtitle,
        onPlayNextEpisode,
        duration,
        currentTime,
        isEnded,
        isSeries,
        nextEpisode,
        resetHideTimeout,
    ]);

    // ========================================
    // SUBTITLE HANDLING
    // ========================================
    const handleSubtitleChange = (index: number) => {
        setActiveSubtitle(index);
        const video = videoRef.current;
        if (!video) return;

        // Disable all tracks first
        for (let i = 0; i < video.textTracks.length; i++) {
            video.textTracks[i].mode = 'hidden';
        }

        // Enable selected track
        if (index >= 0 && video.textTracks[index]) {
            video.textTracks[index].mode = 'showing';
        }
    };

    // ========================================
    // BACK/MINIMIZE HANDLERS
    // ========================================
    const handleBack = () => {
        if (onMinimize) {
            // Mini player mode
            onMinimize();
        } else if (onBack) {
            onBack();
        }
    };


    // Volume icon based on level
    const VolumeIcon = isMuted || volume === 0
        ? VolumeX
        : volume < 0.5
            ? Volume1
            : Volume2;

    // Current quality label
    const currentQualityLabel = currentQuality === -1
        ? 'Auto'
        : `${qualities.find(q => q.index === currentQuality)?.height || 0}p`;

    // Progress percentage
    const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
    const remainingSeconds = Math.max(0, duration - currentTime);
    const playedSeconds = Math.floor(currentTime);
    const remainingWholeSeconds = Math.ceil(remainingSeconds);
    const nearEndThresholdSeconds = 120;
    const shouldShowNextEpisodeCta = Boolean(
        isSeries &&
        nextEpisode &&
        onPlayNextEpisode &&
        (isEnded || (!isPlaying && duration > 0 && remainingSeconds <= nearEndThresholdSeconds))
    );
    const displayTitle = (() => {
        // Keep movie titles intact; strip TV suffixes like " - S1E1..." for pause card headline.
        if (!metadataLabel?.toLowerCase().includes('season')) return title;
        const episodePattern = /^(.*?)\s*-\s*s\d+e\d+.*$/i;
        const seasonPattern = /^(.*?)\s*-\s*season\s*\d+.*$/i;
        const match = title.match(episodePattern) || title.match(seasonPattern);
        if (match?.[1]) return match[1].trim();
        const fallback = title.split(' - ')[0];
        return fallback.trim() || title;
    })();
    const pauseTitle = isEnded && nextEpisode ? nextEpisode.title : displayTitle;
    const pauseMetadata = isEnded && nextEpisode
        ? `Season ${nextEpisode.seasonNumber} - Episode ${nextEpisode.episodeNumber}`
        : metadataLabel;
    const pausePoster = isEnded && nextEpisode?.posterUrl ? nextEpisode.posterUrl : posterUrl;
    const nextEpisodeLabel = nextEpisode
        ? `Season ${nextEpisode.seasonNumber} - Episode ${nextEpisode.episodeNumber}${nextEpisode.episodeName ? `: ${nextEpisode.episodeName}` : ''}`
        : '';

    return (
        <div
            ref={containerRef}
            className={`delulu-player ${showControls ? 'show-controls' : ''} ${!isPlaying && !isBuffering ? 'is-paused' : ''}`}
            onMouseMove={resetHideTimeout}
            onMouseLeave={() => {
                if (isPlaying) setShowControls(false);
            }}
            onClick={(e) => {
                if (suppressNextToggleRef.current) {
                    suppressNextToggleRef.current = false;
                    return;
                }

                // If a panel is open, first click should only close panels.
                if (showSettings || showSubtitleSettings) {
                    setShowSettings(false);
                    setShowSubtitleSettings(false);
                    return;
                }

                // Click on video area to toggle play (not on controls)
                if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === 'VIDEO') {
                    togglePlay();
                }
            }}
        >
            {/* Video Element */}
            <video
                ref={videoRef}
                className="delulu-video"
                playsInline
                style={{
                    // Subtitle styling via CSS custom properties
                    '--subtitle-font-size': `${subtitleSettings.fontSize}px`,
                    '--subtitle-color': subtitleSettings.textColor,
                    '--subtitle-bg-opacity': subtitleSettings.bgOpacity,
                } as React.CSSProperties}
            >
                {/* Subtitles rendered via custom overlay - no native tracks needed */}
            </video>

            {/* Buffering Indicator */}
            {isBuffering && (
                <div className="delulu-buffering">
                    <div className="delulu-buffering-spinner" />
                </div>
            )}

            {/* Custom Subtitle Overlay */}
            {isPlaying && currentSubtitleText && (
                <div
                    className="delulu-subtitle-overlay"
                    style={{
                        fontSize: `${subtitleSettings.fontSize}px`,
                        color: subtitleSettings.textColor,
                        backgroundColor: `rgba(0, 0, 0, ${subtitleSettings.bgOpacity})`,
                        bottom: subtitleSettings.position === 'bottom' ? '80px' : 'auto',
                        top: subtitleSettings.position === 'top' ? '80px' : 'auto',
                    }}
                >
                    {currentSubtitleText.split('\n').map((line, i) => (
                        <span key={i}>{line}<br /></span>
                    ))}
                </div>
            )}

            {/* Top Gradient */}
            <div className="delulu-gradient-top" />

            {/* Bottom Gradient */}
            <div className="delulu-gradient-bottom" />

            {/* Top Bar - Title & Back */}
            <div className="delulu-top-bar">
                <button className="delulu-back-btn" onClick={handleBack}>
                    <ChevronLeft size={24} strokeWidth={1.5} />
                </button>
                <span className="delulu-title">{title}</span>
            </div>

            {/* Pause Overlay */}
            {!isPlaying && !isBuffering && (
                <div className="delulu-pause-overlay">
                    <div className="delulu-pause-card" onClick={() => { if (!isEnded) togglePlay(); }}>
                        {pausePoster && (
                            <img
                                className="delulu-pause-poster"
                                src={pausePoster}
                                alt={pauseTitle}
                            />
                        )}
                        <div className="delulu-pause-content">
                            {isEnded && shouldShowNextEpisodeCta && (
                                <p className="delulu-pause-status">Episode Finished</p>
                            )}
                            <h3 className="delulu-pause-title">{pauseTitle}</h3>
                            {!isEnded && pauseMetadata && (
                                <p className="delulu-pause-meta">{pauseMetadata}</p>
                            )}
                            {shouldShowNextEpisodeCta && nextEpisodeLabel && (
                                <p className="delulu-pause-upnext">Up Next - {nextEpisodeLabel}</p>
                            )}
                            {genreLabel && (
                                <p className="delulu-pause-genre">{genreLabel}</p>
                            )}
                            <div className="delulu-pause-stats">
                                {isEnded ? (
                                    <>
                                        <span>{formatTime(Math.floor(duration))} watched</span>
                                        <span>Ready for next episode</span>
                                    </>
                                ) : (
                                    <>
                                        <span>{formatTime(playedSeconds)} played</span>
                                        <span>{formatTime(remainingWholeSeconds)} left</span>
                                    </>
                                )}
                            </div>
                            {shouldShowNextEpisodeCta && (
                                <button
                                    className="delulu-next-episode-btn"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onPlayNextEpisode?.();
                                    }}
                                >
                                    Play Next Episode
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Bottom Controls */}
            <div className="delulu-controls">
                {/* Progress Bar */}
                <div
                    ref={progressRef}
                    className="delulu-progress"
                    onClick={handleSeek}
                    onMouseMove={handleProgressHover}
                    onMouseLeave={() => setHoverTime(null)}
                >
                    {/* Buffered */}
                    <div className="delulu-progress-buffered" style={{ width: `${buffered}%` }} />

                    {/* Played */}
                    <div className="delulu-progress-played" style={{ width: `${progress}%` }} />

                    {/* Scrubber */}
                    <div className="delulu-progress-scrubber" style={{ left: `${progress}%` }} />

                    {/* Hover Preview */}
                    {hoverTime !== null && (
                        <div className="delulu-progress-hover" style={{ left: hoverPosition }}>
                            {formatTime(hoverTime)}
                        </div>
                    )}
                </div>

                {/* Control Bar */}
                <div className="delulu-control-bar">
                    {/* Left Controls */}
                    <div className="delulu-controls-left">
                        {/* Play/Pause */}
                        <button className="delulu-btn" onClick={togglePlay}>
                            {isPlaying ? (
                                <Pause size={22} strokeWidth={1.5} />
                            ) : (
                                <Play size={22} strokeWidth={1.5} />
                            )}
                        </button>

                        {/* Skip Back */}
                        <button className="delulu-btn" onClick={() => skip(-10)}>
                            <SkipBack size={20} strokeWidth={1.5} />
                        </button>

                        {/* Skip Forward */}
                        <button className="delulu-btn" onClick={() => skip(10)}>
                            <SkipForward size={20} strokeWidth={1.5} />
                        </button>

                        {/* Volume */}
                        <div className="delulu-volume">
                            <button className="delulu-btn" onClick={toggleMute}>
                                <VolumeIcon size={20} strokeWidth={1.5} />
                            </button>
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.05"
                                value={isMuted ? 0 : volume}
                                onChange={handleVolumeChange}
                                className="delulu-volume-slider"
                            />
                        </div>

                        {/* Time */}
                        <span className="delulu-time">
                            {formatTime(currentTime)} / {formatTime(duration)}
                        </span>
                    </div>

                    {/* Right Controls */}
                    <div className="delulu-controls-right">
                        {/* Subtitles */}
                        {subtitles.length > 0 && (
                            <button
                                ref={subtitleToggleRef}
                                className={`delulu-btn ${activeSubtitle >= 0 ? 'active' : ''}`}
                                onClick={() => setShowSubtitleSettings(!showSubtitleSettings)}
                            >
                                <Subtitles size={20} strokeWidth={1.5} />
                            </button>
                        )}

                        {/* Settings (Quality) */}
                        {showQualitySelector && isHLS && qualities.length > 0 && (
                            <button
                                ref={settingsToggleRef}
                                className="delulu-btn"
                                onClick={() => setShowSettings(!showSettings)}
                            >
                                <Settings size={20} strokeWidth={1.5} />
                                <span className="delulu-quality-badge">{currentQualityLabel}</span>
                            </button>
                        )}


                        {/* Fullscreen */}
                        <button className="delulu-btn" onClick={toggleFullscreen}>
                            {isFullscreen ? (
                                <Minimize size={20} strokeWidth={1.5} />
                            ) : (
                                <Maximize size={20} strokeWidth={1.5} />
                            )}
                        </button>
                    </div>
                </div>
            </div>

            {/* Settings Panel (Quality) */}
            {showSettings && (
                <div ref={settingsPanelRef} className="delulu-panel delulu-settings-panel">
                    <div className="delulu-panel-header">
                        <span>Quality</span>
                        <button onClick={() => setShowSettings(false)}>
                            <X size={18} strokeWidth={1.5} />
                        </button>
                    </div>
                    <div className="delulu-panel-options">
                        <button
                            className={`delulu-option ${currentQuality === -1 ? 'active' : ''}`}
                            onClick={() => handleQualityChange(-1)}
                        >
                            <span>Auto</span>
                            {currentQuality === -1 && <Check size={16} />}
                        </button>
                        {qualities.map((q) => (
                            <button
                                key={q.index}
                                className={`delulu-option ${currentQuality === q.index ? 'active' : ''}`}
                                onClick={() => handleQualityChange(q.index)}
                            >
                                <span>{q.height}p</span>
                                {currentQuality === q.index && <Check size={16} />}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Subtitle Settings Panel */}
            {showSubtitleSettings && (
                <div ref={subtitlePanelRef} className="delulu-panel delulu-subtitle-panel">
                    <div className="delulu-panel-header">
                        <span>Subtitles</span>
                        <button onClick={() => setShowSubtitleSettings(false)}>
                            <X size={18} strokeWidth={1.5} />
                        </button>
                    </div>
                    <div className="delulu-panel-options">
                        <button
                            className={`delulu-option ${activeSubtitle === -1 ? 'active' : ''}`}
                            onClick={() => handleSubtitleChange(-1)}
                        >
                            <span>Off</span>
                            {activeSubtitle === -1 && <Check size={16} />}
                        </button>
                        {subtitles.map((sub, index) => (
                            <button
                                key={index}
                                className={`delulu-option ${activeSubtitle === index ? 'active' : ''}`}
                                onClick={() => handleSubtitleChange(index)}
                            >
                                <span>{sub.label}</span>
                                {activeSubtitle === index && <Check size={16} />}
                            </button>
                        ))}
                    </div>

                    {/* Subtitle Customization */}
                    {activeSubtitle >= 0 && (
                        <div className="delulu-subtitle-customize">
                            <div className="delulu-customize-row">
                                <label>Font Size</label>
                                <input
                                    type="range"
                                    min="14"
                                    max="60"
                                    value={subtitleSettings.fontSize}
                                    onChange={(e) => setSubtitleSettings(s => ({
                                        ...s,
                                        fontSize: parseInt(e.target.value)
                                    }))}
                                />
                                <span>{subtitleSettings.fontSize}px</span>
                            </div>
                            <div className="delulu-customize-row">
                                <label>Background</label>
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.05"
                                    value={subtitleSettings.bgOpacity}
                                    onChange={(e) => setSubtitleSettings(s => ({
                                        ...s,
                                        bgOpacity: parseFloat(e.target.value)
                                    }))}
                                />
                                <span>{Math.round(subtitleSettings.bgOpacity * 100)}%</span>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
