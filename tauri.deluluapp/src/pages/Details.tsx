import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { SkeletonDetail } from '../components/skeleton/Skeleton';
import { TrailerModal } from '../components/trailer/TrailerModal';
import { SeasonEpisodeSelector } from '../components/content/SeasonEpisodeSelector';
import { useAuth } from '../context/AuthContext';
import { useUserListsSafe } from '../context/UserListsContext';
import {
    getMovieDetails,
    getTVShowDetails,
    getCredits,
    getTrailer,
    getPosterUrl,
    getBackdropUrl,
    getProfileUrl,
    type TMDBContentDetails,
    type TMDBTVShowDetails,
    type TMDBCastMember,
    type TMDBSeason,
    type TMDBVideo,
} from '../services/tmdb';
import { watchService } from '../services/watchHistory';

import './Details.css';

export function Details() {
    const { mediaType, id } = useParams<{ mediaType: string; id: string }>();
    const navigate = useNavigate();
    const { isAuthenticated } = useAuth();
    const userLists = useUserListsSafe();

    const [details, setDetails] = useState<TMDBContentDetails | TMDBTVShowDetails | null>(null);
    const [seasons, setSeasons] = useState<TMDBSeason[]>([]);
    const [cast, setCast] = useState<TMDBCastMember[]>([]);
    const [trailer, setTrailer] = useState<TMDBVideo | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [showTrailerModal, setShowTrailerModal] = useState(false);


    useEffect(() => {
        const fetchDetails = async () => {
            if (!id || !mediaType) return;

            try {
                setIsLoading(true);
                const [contentDetails, credits] = await Promise.all([
                    mediaType === 'movie'
                        ? getMovieDetails(parseInt(id))
                        : getTVShowDetails(parseInt(id)),
                    getCredits(mediaType as 'movie' | 'tv', parseInt(id)),
                ]);

                setDetails(contentDetails);
                setCast(credits.cast.slice(0, 10));

                // Fetch trailer
                const trailerData = await getTrailer(
                    parseInt(id),
                    mediaType as 'movie' | 'tv'
                );
                setTrailer(trailerData);

                // Extract seasons for TV shows
                if (mediaType === 'tv' && 'seasons' in contentDetails) {
                    setSeasons((contentDetails as TMDBTVShowDetails).seasons || []);
                }
            } catch (error) {
                console.error('Error fetching details:', error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchDetails();
    }, [id, mediaType]);

    // Primary play action - uses VidLink streaming
    const handlePlay = async () => {
        if (!isAuthenticated) {
            setShowAuthModal(true);
            return;
        }
        if (!id || !mediaType || !details) return;

        const title = details.title || details.name || 'Video';
        const poster = details.poster_path || '';
        const genre = details.genres?.slice(0, 3).map((g) => g.name).join(', ') || '';
        const tmdbId = parseInt(id, 10);

        try {
            const existingProgress = await watchService.getProgress({
                tmdbId,
                mediaType: mediaType as 'movie' | 'tv',
            });

            const resumeTime = existingProgress?.current_time || 0;
            navigate(`/stream/${mediaType}/${id}?title=${encodeURIComponent(title)}&poster=${encodeURIComponent(poster)}&genre=${encodeURIComponent(genre)}&time=${resumeTime}`);
        } catch {
            navigate(`/stream/${mediaType}/${id}?title=${encodeURIComponent(title)}&poster=${encodeURIComponent(poster)}&genre=${encodeURIComponent(genre)}`);
        }
    };


    const handleToggleWatchlist = () => {
        if (!isAuthenticated) {
            setShowAuthModal(true);
            return;
        }
        if (!userLists || !details || !mediaType) return;

        const title = details.title || details.name || 'Unknown';
        userLists.toggleWatchlistItem({
            id: parseInt(id!),
            type: mediaType as 'movie' | 'tv',
            title,
            posterPath: details.poster_path,
        });
    };

    const handleToggleFavorites = () => {
        if (!isAuthenticated) {
            setShowAuthModal(true);
            return;
        }
        if (!userLists || !details || !mediaType) return;

        const title = details.title || details.name || 'Unknown';
        userLists.toggleFavoritesItem({
            id: parseInt(id!),
            type: mediaType as 'movie' | 'tv',
            title,
            posterPath: details.poster_path,
        });
    };

    // Check if current content is in lists
    const isInWatchlist = userLists && mediaType ?
        userLists.isInWatchlist(parseInt(id!), mediaType as 'movie' | 'tv') : false;
    const isInFavorites = userLists && mediaType ?
        userLists.isInFavorites(parseInt(id!), mediaType as 'movie' | 'tv') : false;

    if (isLoading || !details) {
        return (
            <div className="details-page page">
                <SkeletonDetail />
            </div>
        );
    }

    const title = details.title || details.name || 'Unknown';
    const releaseDate = details.release_date || details.first_air_date;
    const year = releaseDate ? new Date(releaseDate).getFullYear() : 'N/A';
    const runtime = details.runtime || (details.episode_run_time?.[0] ?? 0);

    return (
        <div className="details-page">
            {/* Backdrop */}
            <div
                className="details-backdrop"
                style={{
                    backgroundImage: `url(${getBackdropUrl(details.backdrop_path, 'original')})`,
                }}
            />
            <div className="details-backdrop-gradient" />

            {/* Content */}
            <div className="details-content">
                {/* Poster */}
                <div className="details-poster-wrapper">
                    <img
                        src={getPosterUrl(details.poster_path, 'large')}
                        alt={title}
                        className="details-poster"
                    />
                </div>

                {/* Info */}
                <div className="details-info">
                    <h1 className="details-title">{title}</h1>

                    <div className="details-meta">
                        <span className="details-rating">
                            <span className="details-rating-star">★</span>
                            {details.vote_average.toFixed(1)}
                        </span>
                        <span className="details-year">📅 {year}</span>
                        {runtime > 0 && (
                            <span className="details-runtime">⏱ {runtime} min</span>
                        )}
                        {details.number_of_seasons && (
                            <span className="details-seasons">{details.number_of_seasons} Seasons</span>
                        )}
                    </div>

                    {/* Genres */}
                    <div className="details-genres">
                        {details.genres.map((genre) => (
                            <span key={genre.id} className="tag">
                                {genre.name}
                            </span>
                        ))}
                    </div>

                    {/* Tagline */}
                    {details.tagline && (
                        <p className="details-tagline">"{details.tagline}"</p>
                    )}

                    {/* Overview */}
                    <p className="details-overview">{details.overview}</p>

                    {/* Action Buttons */}
                    <div className="details-actions">
                        <button className="btn btn-primary btn-lg" onClick={handlePlay}>
                            Play
                        </button>

                        <button
                            className="btn btn-ghost btn-lg"
                            onClick={() => trailer && setShowTrailerModal(true)}
                            disabled={!trailer}
                            title={trailer ? 'Watch Trailer' : 'No trailer available'}
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polygon points="5 3 19 12 5 21 5 3" />
                            </svg>
                            Trailer
                        </button>


                        <button
                            className={`btn btn-ghost btn-lg ${isInWatchlist ? 'btn-active' : ''}`}
                            onClick={handleToggleWatchlist}
                        >
                            {isInWatchlist ? (
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                                </svg>
                            ) : (
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M12 5v14M5 12h14" />
                                </svg>
                            )}
                            {isInWatchlist ? 'In Watchlist' : 'Watch List'}
                        </button>
                        <button
                            className={`btn btn-icon btn-ghost ${isInFavorites ? 'btn-active' : ''}`}
                            onClick={handleToggleFavorites}
                        >
                            <svg
                                width="20"
                                height="20"
                                viewBox="0 0 24 24"
                                fill={isInFavorites ? '#e50914' : 'none'}
                                stroke={isInFavorites ? '#e50914' : 'currentColor'}
                                strokeWidth="2"
                            >
                                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                            </svg>
                        </button>
                    </div>

                    {/* Cast */}
                    {cast.length > 0 && (
                        <div className="details-cast">
                            <h2 className="details-cast-title">Cast</h2>
                            <div className="details-cast-list">
                                {cast.map((member) => (
                                    <div key={member.id} className="details-cast-member">
                                        {member.profile_path ? (
                                            <img
                                                src={getProfileUrl(member.profile_path, 'medium')}
                                                alt={member.name}
                                                className="details-cast-photo"
                                                onError={(e) => {
                                                    (e.target as HTMLImageElement).style.display = 'none';
                                                    const placeholder = (e.target as HTMLImageElement).nextElementSibling;
                                                    if (placeholder) placeholder.classList.remove('hidden');
                                                }}
                                            />
                                        ) : null}
                                        <div className={`details-cast-placeholder ${member.profile_path ? 'hidden' : ''}`}>
                                            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                                <circle cx="12" cy="8" r="4" />
                                                <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
                                            </svg>
                                        </div>
                                        <span className="details-cast-name">{member.name}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Seasons & Episodes for TV Shows */}
                    {mediaType === 'tv' && seasons.length > 0 && id && (
                        <SeasonEpisodeSelector
                            tvId={parseInt(id)}
                            seasons={seasons}
                            showName={(details as any)?.name || 'TV Show'}
                            posterPath={details?.poster_path || undefined}
                            onEpisodeSelect={async (seasonNum, episodeNum, episodeName) => {
                                // Navigate to VidLink stream with episode info
                                const showName = (details as TMDBTVShowDetails)?.name || 'TV Show';
                                const episodeTitle = episodeName
                                    ? `${showName} - S${seasonNum}E${episodeNum}: ${episodeName}`
                                    : `${showName} - S${seasonNum}E${episodeNum}`;
                                const posterPath = details?.poster_path || '';
                                const genre = details.genres?.slice(0, 3).map((g) => g.name).join(', ') || '';
                                const tmdbId = parseInt(id, 10);

                                let resumeTime = 0;
                                try {
                                    const existingProgress = await watchService.getProgress({
                                        tmdbId,
                                        mediaType: 'tv',
                                        seasonNumber: seasonNum,
                                        episodeNumber: episodeNum,
                                    });
                                    resumeTime = existingProgress?.current_time || 0;
                                } catch {
                                    resumeTime = 0;
                                }

                                navigate(`/stream/tv/${id}?season=${seasonNum}&episode=${episodeNum}&title=${encodeURIComponent(episodeTitle)}&poster=${encodeURIComponent(posterPath)}&genre=${encodeURIComponent(genre)}&time=${resumeTime}`);
                            }}
                        />
                    )}
                </div>
            </div>

            {/* Auth Modal */}
            {showAuthModal && (
                <>
                    <div className="overlay" onClick={() => setShowAuthModal(false)} />
                    <div className="modal details-auth-modal">
                        <h2>Sign in Required</h2>
                        <p>You need to sign in to access streaming features.</p>
                        <div className="details-auth-buttons">
                            <button className="btn btn-primary" onClick={() => navigate('/settings')}>
                                Sign In
                            </button>
                            <button className="btn btn-ghost" onClick={() => setShowAuthModal(false)}>
                                Cancel
                            </button>
                        </div>
                    </div>
                </>
            )}



            {/* Trailer Modal */}
            {showTrailerModal && trailer && (
                <TrailerModal
                    youtubeKey={trailer.key}
                    title={`${title} - ${trailer.name}`}
                    onClose={() => setShowTrailerModal(false)}
                />
            )}
        </div>
    );
}
