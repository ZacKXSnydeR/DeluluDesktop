/**
 * VidLink Streaming Page
 * 
 * Streams content from VidLink using HLS extractor
 * Supports both movies and TV shows
 * Premium loading experience with cinematic transitions
 * Mini player support for background playback
 * Stream caching for instant replay
 * TitleBar (minimal) in windowed mode, hidden in fullscreen
 */

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { DeluluPlayer } from '../components/player/DeluluPlayer';
import { PremiumLoader } from '../components/loading/PremiumLoader';
import { TitleBar } from '../components/layout/TitleBar';
import { useMiniPlayer } from '../context/MiniPlayerContext';
import { getMovieStream, getTVStream } from '../services/vidlink';
import { getPosterUrl, getSeasonDetails } from '../services/tmdb';
import { proxyStreamUrl } from '../utils/hlsProxy';
import { watchService } from '../services/watchHistory';
import type { VidLinkStreamResult } from '../services/vidlink';
import './VidLinkStream.css';

interface NextEpisodeInfo {
    title: string;
    seasonNumber: number;
    episodeNumber: number;
    episodeName?: string;
    posterUrl?: string;
}

export function VidLinkStream() {
    const { type, id } = useParams<{ type: 'movie' | 'tv'; id: string }>();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { miniPlayer, activateMiniPlayer, deactivateMiniPlayer } = useMiniPlayer();
    const videoRef = useRef<HTMLVideoElement | null>(null);

    const season = parseInt(searchParams.get('season') || '1');
    const episode = parseInt(searchParams.get('episode') || '1');
    const title = searchParams.get('title') || 'Video';
    const posterPath = searchParams.get('poster') || '';
    const genre = searchParams.get('genre') || '';
    const initialTime = parseFloat(searchParams.get('time') || '0');
    const parsedTmdbId = id ? parseInt(id, 10) : undefined;

    const [streamData, setStreamData] = useState<VidLinkStreamResult | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isTransitioning, setIsTransitioning] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [nextEpisode, setNextEpisode] = useState<NextEpisodeInfo | null>(null);
    const [pendingMiniDetach, setPendingMiniDetach] = useState(false);
    const hasRetriedRef = useRef(false);

    // Track fullscreen state
    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };

        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);

    const inlineResumeStreamData = useMemo(() => {
        if (!miniPlayer.isActive || !miniPlayer.streamUrl || !type || !id || !miniPlayer.source) {
            return null;
        }

        const source = miniPlayer.source;
        const sameType = source.mediaType === type;
        const sameId = String(source.tmdbId) === String(id);
        const sameSeason = type === 'tv' ? (source.season ?? 1) === season : true;
        const sameEpisode = type === 'tv' ? (source.episode ?? 1) === episode : true;

        if (!sameType || !sameId || !sameSeason || !sameEpisode) {
            return null;
        }

        return {
            success: true,
            streamUrl: miniPlayer.streamUrl,
            headers: miniPlayer.streamData?.headers,
            subtitles: miniPlayer.streamData?.subtitles,
        } as VidLinkStreamResult;
    }, [miniPlayer, type, id, season, episode]);

    useEffect(() => {
        if (!type || !id) return;

        let isMounted = true;

        const fetchStream = async (bypassCache = false) => {
            setIsLoading(true);
            setError(null);

            if (!bypassCache && inlineResumeStreamData?.streamUrl) {
                setStreamData(inlineResumeStreamData);
                setIsLoading(false);
                setIsTransitioning(false);
                setPendingMiniDetach(true);
                return;
            }

            const tmdbId = parseInt(id);

            try {
                let result: VidLinkStreamResult;
                if (type === 'movie') {
                    result = await getMovieStream(tmdbId, bypassCache);
                } else {
                    result = await getTVStream(tmdbId, season, episode, bypassCache);
                }

                if (!isMounted) return;

                if (result.success && result.streamUrl) {
                    console.log('[VidLink] Stream result:', {
                        streamUrl: result.streamUrl,
                        subtitles: result.subtitles,
                        subtitleCount: result.subtitles?.length || 0
                    });

                    try {
                        const proxiedUrl = await proxyStreamUrl(
                            result.streamUrl,
                            result.headers as Record<string, string> | undefined
                        );
                        result = { ...result, streamUrl: proxiedUrl };
                        console.log('[VidLink] Proxied URL:', proxiedUrl);
                    } catch (proxyErr) {
                        console.warn('[VidLink] Proxy failed, using direct URL:', proxyErr);
                    }

                    setIsTransitioning(true);

                    setTimeout(() => {
                        if (!isMounted) return;
                        setStreamData(result);
                        setIsLoading(false);
                    }, 300);
                } else {
                    setError(result.error || 'Stream not available');
                    setIsLoading(false);
                }
            } catch (err) {
                if (!isMounted) return;
                setError(String(err));
                setIsLoading(false);
            }
        };

        fetchStream();
        hasRetriedRef.current = false;

        return () => {
            isMounted = false;
        };
    }, [type, id, season, episode, inlineResumeStreamData]);

    // Auto-retry when HLS reports fatal error (expired/blocked stream link)
    const handleFatalError = useCallback((errorType: string, details: string) => {
        console.warn('[VidLink] HLS fatal error:', errorType, details);

        // Only retry once per stream load to avoid infinite loops
        if (hasRetriedRef.current) {
            console.warn('[VidLink] Already retried, not retrying again');
            return;
        }

        // Only retry manifest/network errors (not decode errors)
        const isRetryable = errorType === 'networkError' || details.includes('manifest');
        if (!isRetryable) return;

        hasRetriedRef.current = true;
        console.log('[VidLink] 🔄 Retrying with fresh stream extraction (bypassCache)...');

        if (!type || !id) return;

        let isMounted = true;
        const fetchFresh = async () => {
            setIsLoading(true);
            setError(null);
            const tmdbId = parseInt(id);
            try {
                let result: VidLinkStreamResult;
                if (type === 'movie') {
                    result = await getMovieStream(tmdbId, true);
                } else {
                    result = await getTVStream(tmdbId, season, episode, true);
                }
                if (!isMounted) return;
                if (result.success && result.streamUrl) {
                    try {
                        const proxiedUrl = await proxyStreamUrl(
                            result.streamUrl,
                            result.headers as Record<string, string> | undefined
                        );
                        result = { ...result, streamUrl: proxiedUrl };
                    } catch { /* use direct url */ }
                    setStreamData(result);
                    setIsLoading(false);
                } else {
                    setError('Stream unavailable after retry');
                    setIsLoading(false);
                }
            } catch (err) {
                if (!isMounted) return;
                setError(String(err));
                setIsLoading(false);
            }
        };
        fetchFresh();

        // Cleanup: prevent state updates on unmounted component
        return () => { isMounted = false; };
    }, [type, id, season, episode]);

    useEffect(() => {
        if (type !== 'tv' || !parsedTmdbId) {
            setNextEpisode(null);
            return;
        }

        let isMounted = true;
        const poster = posterPath ? getPosterUrl(posterPath, 'large') : undefined;
        const cleanSeriesTitle = (() => {
            const episodePattern = /^(.*?)\s*-\s*s\d+e\d+.*$/i;
            const seasonPattern = /^(.*?)\s*-\s*season\s*\d+.*$/i;
            const match = title.match(episodePattern) || title.match(seasonPattern);
            if (match?.[1]) return match[1].trim();
            return title.split(' - ')[0].trim() || title;
        })();

        const resolveNextEpisode = async () => {
            try {
                const currentSeason = await getSeasonDetails(parsedTmdbId, season);
                const nextInSeason = currentSeason.episodes.find((ep) => ep.episode_number === episode + 1);

                if (nextInSeason) {
                    if (!isMounted) return;
                    setNextEpisode({
                        title: cleanSeriesTitle,
                        seasonNumber: season,
                        episodeNumber: nextInSeason.episode_number,
                        episodeName: nextInSeason.name,
                        posterUrl: poster,
                    });
                    return;
                }

                const nextSeason = await getSeasonDetails(parsedTmdbId, season + 1);
                const firstEpisode = nextSeason.episodes.find((ep) => ep.episode_number === 1);
                if (!isMounted) return;

                if (firstEpisode) {
                    setNextEpisode({
                        title: cleanSeriesTitle,
                        seasonNumber: season + 1,
                        episodeNumber: 1,
                        episodeName: firstEpisode.name,
                        posterUrl: poster,
                    });
                } else {
                    setNextEpisode(null);
                }
            } catch {
                if (isMounted) setNextEpisode(null);
            }
        };

        resolveNextEpisode();
        return () => {
            isMounted = false;
        };
    }, [type, parsedTmdbId, season, episode, title, posterPath]);

    const syncProgressNow = useCallback(async () => {
        if (!parsedTmdbId || !videoRef.current) return;
        if (type !== 'movie' && type !== 'tv') return;

        const video = videoRef.current;
        if (!video.duration || Number.isNaN(video.duration) || video.duration <= 0) return;
        if (video.currentTime < 10) return; // Don't save if barely watched

        // Use immediateSave for guaranteed persistence (bypasses queue)
        await watchService.immediateSave({
            tmdbId: parsedTmdbId,
            mediaType: type,
            seasonNumber: type === 'tv' ? season : undefined,
            episodeNumber: type === 'tv' ? episode : undefined,
            currentTime: video.currentTime,
            totalDuration: video.duration,
        });
    }, [parsedTmdbId, type, season, episode]);

    const handleMinimize = useCallback(() => {
        const streamUrl = streamData?.streamUrl;
        if (!streamUrl || !id || !type) return;
        syncProgressNow().catch(console.error);
        const currentTime = videoRef.current?.currentTime || 0;
        activateMiniPlayer({
            url: streamUrl,
            title,
            hash: `vidlink-${type}-${id}`,
            fileIndex: 0,
            currentTime,
            source: {
                mediaType: type,
                tmdbId: parseInt(id, 10),
                season: type === 'tv' ? season : undefined,
                episode: type === 'tv' ? episode : undefined,
                posterPath,
                genre,
            },
            streamData: {
                headers: streamData?.headers,
                subtitles: streamData?.subtitles,
            },
        });
        // Always return to details page to avoid going back to a previous episode route.
        navigate(`/details/${type}/${id}`);
    }, [streamData, id, type, title, activateMiniPlayer, navigate, syncProgressNow, season, episode, posterPath, genre]);

    const handleBack = useCallback(() => {
        syncProgressNow().catch(console.error);
        navigate(-1);
    }, [navigate, syncProgressNow]);

    const handleCancel = useCallback(() => {
        syncProgressNow().catch(console.error);
        navigate(-1);
    }, [navigate, syncProgressNow]);

    const handlePlayNextEpisode = useCallback(() => {
        if (type !== 'tv' || !id || !nextEpisode) return;

        const nextTitle = nextEpisode.episodeName
            ? `${nextEpisode.title} - S${nextEpisode.seasonNumber}E${nextEpisode.episodeNumber}: ${nextEpisode.episodeName}`
            : `${nextEpisode.title} - S${nextEpisode.seasonNumber}E${nextEpisode.episodeNumber}`;

        navigate(
            `/stream/tv/${id}?season=${nextEpisode.seasonNumber}&episode=${nextEpisode.episodeNumber}&title=${encodeURIComponent(nextTitle)}&poster=${encodeURIComponent(posterPath)}&genre=${encodeURIComponent(genre)}&time=0`
        );
    }, [type, id, nextEpisode, navigate, posterPath, genre]);

    const handlePlayerReady = useCallback(() => {
        if (!pendingMiniDetach) return;
        deactivateMiniPlayer();
        setPendingMiniDetach(false);
    }, [pendingMiniDetach, deactivateMiniPlayer]);

    const posterUrl = posterPath
        ? getPosterUrl(posterPath, 'large')
        : undefined;

    const backdropUrl = posterPath
        ? `https://image.tmdb.org/t/p/original${posterPath}`
        : undefined;

    const bgImage = backdropUrl || posterUrl;
    const metadataLabel = type === 'tv'
        ? `Season ${season} - Episode ${episode}`
        : 'Movie';

    // Loading state with premium loader
    if (isLoading) {
        return (
            <PremiumLoader
                posterUrl={posterUrl}
                backdropUrl={backdropUrl}
                title={title}
                quality="HD"
                onCancel={handleCancel}
            />
        );
    }

    // Error state — centered layout with poster + error card
    if (error || !streamData?.streamUrl) {
        return (
            <div className="premium-loader">
                <TitleBar minimal />

                {bgImage && (
                    <div
                        className="premium-loader-backdrop"
                        style={{ backgroundImage: `url(${bgImage})` }}
                    />
                )}
                <div className="premium-loader-gradient-left" />
                <div className="premium-loader-gradient-bottom" />

                {/* Centered error layout */}
                <div className="error-center-layout">
                    {/* Small poster tile */}
                    {posterUrl && (
                        <img src={posterUrl} alt={title} className="error-poster-tile" />
                    )}

                    {/* Error info */}
                    <div className="error-info">
                        <h2 className="error-title">{title}</h2>
                        <p className="error-msg">
                            {error && error.includes('[Extractor]')
                                ? error
                                : 'Sorry, this stream is not available right now.'}
                        </p>
                        <div className="error-btns">
                            <button className="error-back-btn" onClick={handleBack}>
                                Go Back
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // Player with cinematic transition
    return (
        <div className={`vidlink-stream-page ${isTransitioning ? 'transitioning' : ''}`}>
            {!isFullscreen && <TitleBar minimal />}

            <DeluluPlayer
                src={streamData!.streamUrl!}
                headers={streamData!.headers}
                title={title}
                posterUrl={posterUrl}
                metadataLabel={metadataLabel}
                genreLabel={genre}
                isSeries={type === 'tv'}
                nextEpisode={nextEpisode || undefined}
                onPlayNextEpisode={type === 'tv' ? handlePlayNextEpisode : undefined}
                onMinimize={handleMinimize}
                onBack={handleBack}
                showQualitySelector={true}
                videoRef={videoRef}
                initialTime={initialTime}
                tmdbId={parsedTmdbId}
                mediaType={type}
                seasonNumber={type === 'tv' ? season : undefined}
                episodeNumber={type === 'tv' ? episode : undefined}
                subtitles={streamData!.subtitles?.map(sub => ({
                    label: sub.language,
                    src: sub.url,
                    language: sub.language.toLowerCase().split(' ')[0],
                })) || []}
                onReady={handlePlayerReady}
                onFatalError={handleFatalError}
            />
        </div>
    );
}

