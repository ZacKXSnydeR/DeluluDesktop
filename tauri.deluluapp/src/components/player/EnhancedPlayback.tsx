import { useState, useEffect } from 'react';
import { searchContent, getBackdropUrl } from '../../services/tmdb';

interface EnhancedPlaybackProps {
    title: string;
    fileName: string;
    onBack: () => void;
    onPlayInVLC: () => void;
}

/**
 * Premium Enhanced Playback Page
 * 
 * This page should NOT feel like an error.
 * It should feel like: "We detected the best possible way to play this."
 * 
 * Core mindset: Frame limitation as optimization, not error.
 */
export function EnhancedPlayback({ title, fileName, onBack, onPlayInVLC }: EnhancedPlaybackProps) {
    const [showDetails, setShowDetails] = useState(false);
    const [posterUrl, setPosterUrl] = useState<string | null>(null);

    // Parse movie info from filename
    const yearMatch = fileName.match(/\b(19|20)\d{2}\b/);
    const year = yearMatch ? yearMatch[0] : '';

    // Extract resolution
    const resMatch = fileName.match(/\b(2160p|1080p|720p|480p)\b/i);
    const resolution = resMatch ? resMatch[1] : '';

    // Clean up title - AGGRESSIVELY remove ALL torrent/release noise
    let cleanTitle = title
        // Step 1: Remove website prefixes like "www.UIndex.org - " or "[YTS.MX]"
        .replace(/^[\[\(]?www\.[^\s\]\)]+[\]\)]?\s*[-–—]?\s*/gi, '')
        .replace(/^\[[^\]]+\]\s*/g, '')               // Remove [anything] at start
        .replace(/^\([^\)]+\)\s*/g, '')               // Remove (anything) at start

        // Step 2: Remove everything after year (year.quality.codec.group...)
        .replace(/[\.\s]+(19|20)\d{2}[\.\s]+.*$/i, '')
        .replace(/[\.\s]+(19|20)\d{2}$/i, '')         // Just year at end

        // Step 3: Remove common release patterns that might remain
        .replace(/\s+(REPACK|PROPER|EXTENDED|UNRATED|DIRECTORS\.?CUT|DC|THEATRICAL).*$/i, '')
        .replace(/\s*[-–]\s*[A-Za-z0-9]+$/i, '')      // Remove " - GroupName" at end

        // Step 4: Clean up formatting
        .replace(/\./g, ' ')                          // Dots to spaces
        .replace(/\s+/g, ' ')                         // Normalize multiple spaces
        .trim();

    // If still empty or too short, fallback
    const displayTitle = cleanTitle.length > 2 ? cleanTitle : 'Your Movie';

    // Fetch movie poster from TMDB
    useEffect(() => {
        async function fetchPoster() {
            if (!cleanTitle || cleanTitle.length < 3) return;

            try {
                // Search by title only (faster, more reliable)
                const response = await searchContent(cleanTitle);

                if (response.results && response.results.length > 0) {
                    // Find first result with backdrop
                    const movie = response.results.find((r) => r.backdrop_path || r.poster_path);
                    if (movie) {
                        const imagePath = movie.backdrop_path || movie.poster_path;
                        if (imagePath) {
                            setPosterUrl(getBackdropUrl(imagePath, 'large'));
                        }
                    }
                }
            } catch (error) {
                // Silent fail - no poster is fine
            }
        }

        fetchPoster();
    }, [cleanTitle]);

    // Get codec info for display (simplified, user-friendly)
    const lowerName = fileName.toLowerCase();
    const audioCodec = lowerName.includes('atmos') ? 'Dolby Atmos' :
        lowerName.includes('truehd') ? 'Dolby TrueHD' :
            lowerName.includes('ddp') || lowerName.includes('eac3') || lowerName.includes('ddpa') ? 'Dolby Digital+' :
                lowerName.includes('dts') ? 'DTS Surround' : '';

    // Technical details (hidden by default)
    const videoCodec = lowerName.includes('hevc') || lowerName.includes('x265') || lowerName.includes('h265') || lowerName.includes('h.265') ? 'HEVC (H.265)' : '';
    const source = fileName.match(/WEB-DL|WEBRip|BluRay|BDRip|HDRip|HDTV/i)?.[0] || '';

    return (
        <div style={{
            position: 'relative',
            width: '100%',
            height: '100vh',
            overflow: 'hidden',
            background: 'linear-gradient(180deg, #0d1117 0%, #161b22 50%, #0d1117 100%)',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}>
            {/* Movie poster background - blurred cinematic feel */}
            {posterUrl && (
                <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundImage: `url(${posterUrl})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    filter: 'blur(2px) brightness(0.7)',
                    transform: 'scale(1.1)', // Prevents blur edge artifacts
                    zIndex: 0,
                }} />
            )}

            {/* Subtle grain texture overlay */}
            <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                opacity: 0.03,
                background: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\'/%3E%3C/svg%3E")',
                zIndex: 1,
                pointerEvents: 'none',
            }} />

            {/* Heavy vignette - Netflix/Apple style */}
            <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'radial-gradient(ellipse at center, transparent 25%, rgba(0,0,0,0.7) 100%)',
                zIndex: 1,
                pointerEvents: 'none',
            }} />

            {/* Subtle ambient glow */}
            <div style={{
                position: 'absolute',
                top: '25%',
                left: '50%',
                transform: 'translateX(-50%)',
                width: '500px',
                height: '350px',
                background: 'radial-gradient(circle, rgba(255,140,50,0.06) 0%, transparent 60%)',
                borderRadius: '50%',
                filter: 'blur(80px)',
                zIndex: 0,
            }} />

            {/* Minimal back button */}
            <button
                onClick={onBack}
                style={{
                    position: 'absolute',
                    bottom: '24px',
                    left: '24px',
                    zIndex: 10,
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'rgba(255,255,255,0.4)',
                    fontSize: '28px',
                    padding: '8px',
                    transition: 'color 0.2s ease',
                }}
                onMouseEnter={(e) => e.currentTarget.style.color = 'white'}
                onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.4)'}
            >
                ←
            </button>

            {/* Main content - split layout */}
            <div style={{
                position: 'relative',
                zIndex: 2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                height: '100%',
                padding: 'clamp(40px, 6vw, 80px)',
                gap: '60px',
            }}>
                {/* LEFT SIDE - Title, metadata, button */}
                <div style={{
                    flex: '1',
                    maxWidth: '550px',
                }}>
                    {/* Movie title - hero element */}
                    <h1 style={{
                        fontSize: 'clamp(32px, 5vw, 56px)',
                        fontWeight: '700',
                        color: 'white',
                        marginBottom: '16px',
                        letterSpacing: '-0.02em',
                        lineHeight: '1.1',
                    }}>
                        {displayTitle}
                    </h1>

                    {/* Metadata line */}
                    <p style={{
                        fontSize: '14px',
                        color: 'rgba(255,255,255,0.5)',
                        marginBottom: '40px',
                        fontWeight: '400',
                        letterSpacing: '0.02em',
                    }}>
                        {[year, resolution, audioCodec].filter(Boolean).join('  •  ')}
                    </p>

                    {/* VLC Button - primary action */}
                    <button
                        onClick={onPlayInVLC}
                        style={{
                            background: 'linear-gradient(135deg, #ff7c00 0%, #ff9500 100%)',
                            color: 'white',
                            border: 'none',
                            padding: '18px 48px',
                            borderRadius: '100px',
                            cursor: 'pointer',
                            fontSize: '16px',
                            fontWeight: '600',
                            boxShadow: '0 12px 40px rgba(255,124,0,0.4)',
                            transition: 'all 0.25s ease',
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'translateY(-3px)';
                            e.currentTarget.style.boxShadow = '0 16px 50px rgba(255,124,0,0.5)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.boxShadow = '0 12px 40px rgba(255,124,0,0.4)';
                        }}
                    >
                        Play in VLC Player
                    </button>

                    {/* Subtext */}
                    <p style={{
                        color: 'rgba(255,255,255,0.35)',
                        fontSize: '12px',
                        marginTop: '16px',
                    }}>
                        Opens instantly in best quality
                    </p>
                </div>

                {/* RIGHT SIDE - Explanation */}
                <div style={{
                    flex: '0 0 320px',
                    padding: '32px',
                    background: 'rgba(0,0,0,0.3)',
                    borderRadius: '20px',
                    border: '1px solid rgba(255,255,255,0.08)',
                    backdropFilter: 'blur(10px)',
                }}>
                    <div style={{
                        fontSize: '13px',
                        color: 'rgba(255,255,255,0.4)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.1em',
                        marginBottom: '16px',
                    }}>
                        Why VLC?
                    </div>
                    <p style={{
                        fontSize: '14px',
                        color: 'rgba(255,255,255,0.7)',
                        lineHeight: '1.7',
                        marginBottom: '16px',
                    }}>
                        This title uses a high-efficiency cinema-grade format that ensures
                        superior video quality and surround sound.
                    </p>
                    <p style={{
                        fontSize: '13px',
                        color: 'rgba(255,255,255,0.5)',
                        lineHeight: '1.6',
                        marginBottom: '24px',
                    }}>
                        To preserve quality, playback will open in VLC Player.
                    </p>
                    <p style={{
                        fontSize: '12px',
                        color: 'rgba(255,255,255,0.4)',
                        fontStyle: 'italic',
                    }}>
                        Your stream is ready — only the player is switching.
                    </p>

                    {/* Technical details toggle */}
                    <button
                        onClick={() => setShowDetails(!showDetails)}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'rgba(255,255,255,0.3)',
                            fontSize: '11px',
                            cursor: 'pointer',
                            marginTop: '24px',
                            padding: '0',
                            transition: 'color 0.2s',
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.5)'}
                        onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.3)'}
                    >
                        {showDetails ? '▲ Hide' : '▼ Show'} technical details
                    </button>

                    {showDetails && (
                        <div style={{
                            marginTop: '12px',
                            fontSize: '11px',
                            color: 'rgba(255,255,255,0.4)',
                            lineHeight: '1.8',
                        }}>
                            {source && <div>Source: {source}</div>}
                            {videoCodec && <div>Video: {videoCodec}</div>}
                            {audioCodec && <div>Audio: {audioCodec}</div>}
                            {resolution && <div>Resolution: {resolution}</div>}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
