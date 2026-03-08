// TMDb API Service Layer
const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY;
const TMDB_READ_TOKEN = import.meta.env.VITE_TMDB_READ_TOKEN;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

// Image size configurations
export const ImageSizes = {
    poster: {
        small: 'w185',
        medium: 'w342',
        large: 'w500',
        original: 'original',
    },
    backdrop: {
        small: 'w300',
        medium: 'w780',
        large: 'w1280',
        original: 'original',
    },
    profile: {
        small: 'w45',
        medium: 'w185',
        large: 'h632',
        original: 'original',
    },
};

// Types
export interface TMDBMovie {
    id: number;
    title: string;
    original_title: string;
    overview: string;
    poster_path: string | null;
    backdrop_path: string | null;
    release_date: string;
    vote_average: number;
    vote_count: number;
    popularity: number;
    genre_ids: number[];
    adult: boolean;
    media_type?: 'movie';
}

export interface TMDBTVShow {
    id: number;
    name: string;
    original_name: string;
    overview: string;
    poster_path: string | null;
    backdrop_path: string | null;
    first_air_date: string;
    vote_average: number;
    vote_count: number;
    popularity: number;
    genre_ids: number[];
    media_type?: 'tv';
}

export type TMDBContent = TMDBMovie | TMDBTVShow;

export interface TMDBGenre {
    id: number;
    name: string;
}

export interface TMDBCastMember {
    id: number;
    name: string;
    character: string;
    profile_path: string | null;
    order: number;
}

export interface TMDBContentDetails {
    id: number;
    title?: string;
    name?: string;
    overview: string;
    poster_path: string | null;
    backdrop_path: string | null;
    release_date?: string;
    first_air_date?: string;
    vote_average: number;
    vote_count: number;
    genres: TMDBGenre[];
    runtime?: number;
    episode_run_time?: number[];
    number_of_seasons?: number;
    number_of_episodes?: number;
    tagline: string;
    status: string;
}

export interface TMDBCredits {
    cast: TMDBCastMember[];
}

// Season in TV series details
export interface TMDBSeason {
    id: number;
    season_number: number;
    name: string;
    episode_count: number;
    poster_path: string | null;
    air_date: string | null;
    overview: string;
}

// Episode in season details
export interface TMDBEpisode {
    id: number;
    episode_number: number;
    name: string;
    overview: string;
    still_path: string | null;
    runtime: number | null;
    air_date: string | null;
    vote_average: number;
}

// Season details response (with episodes)
export interface TMDBSeasonDetails {
    id: number;
    season_number: number;
    name: string;
    overview: string;
    poster_path: string | null;
    episodes: TMDBEpisode[];
}

// Extended TV show details with seasons
export interface TMDBTVShowDetails extends TMDBContentDetails {
    seasons: TMDBSeason[];
}

export interface TMDBResponse<T> {
    page: number;
    results: T[];
    total_pages: number;
    total_results: number;
}

// API Headers
const getHeaders = () => ({
    Authorization: `Bearer ${TMDB_READ_TOKEN}`,
    'Content-Type': 'application/json',
});

// Utility functions
export function getImageUrl(
    path: string | null,
    size: string = 'original'
): string {
    if (!path) return '/placeholder-poster.jpg';
    return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

export function getPosterUrl(path: string | null, size: keyof typeof ImageSizes.poster = 'medium'): string {
    return getImageUrl(path, ImageSizes.poster[size]);
}

export function getBackdropUrl(path: string | null, size: keyof typeof ImageSizes.backdrop = 'large'): string {
    return getImageUrl(path, ImageSizes.backdrop[size]);
}

export function getProfileUrl(path: string | null, size: keyof typeof ImageSizes.profile = 'medium'): string {
    return getImageUrl(path, ImageSizes.profile[size]);
}

export function getTitle(content: TMDBContent): string {
    return 'title' in content ? content.title : content.name;
}

export function getReleaseYear(content: TMDBContent): string {
    const date = 'release_date' in content ? content.release_date : content.first_air_date;
    return date ? new Date(date).getFullYear().toString() : 'N/A';
}

export function getMediaType(content: TMDBContent): 'movie' | 'tv' {
    if (content.media_type) return content.media_type;
    return 'title' in content ? 'movie' : 'tv';
}

// ==========================================
// In-memory TTL cache for TMDB API responses
// ==========================================
interface CacheEntry<T = unknown> {
    data: T;
    timestamp: number;
}

const TTL_LIST = 10 * 60 * 1000;   // 10 min for list endpoints
const TTL_DETAIL = 30 * 60 * 1000; // 30 min for detail endpoints

const responseCache = new Map<string, CacheEntry>();
const inFlightRequests = new Map<string, Promise<unknown>>();

function getCacheTTL(endpoint: string): number {
    // Detail endpoints have longer TTL
    if (/^\/(movie|tv)\/\d+/.test(endpoint)) return TTL_DETAIL;
    return TTL_LIST;
}

/** Clear all cached TMDB responses */
export function clearTMDBCache(): void {
    responseCache.clear();
    console.log('[TMDB Cache] Cleared all cached responses');
}

// API Functions
async function fetchTMDB<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${TMDB_BASE_URL}${endpoint}`);
    url.searchParams.set('api_key', TMDB_API_KEY);
    Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, value);
    });

    const cacheKey = url.toString();
    const ttl = getCacheTTL(endpoint);

    // 1. Check cache
    const cached = responseCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < ttl) {
        return cached.data as T;
    }

    // 2. In-flight deduplication — if same request is already in progress, wait for it
    const inFlight = inFlightRequests.get(cacheKey);
    if (inFlight) {
        return inFlight as Promise<T>;
    }

    // 3. Make the request
    const promise = (async () => {
        const response = await fetch(url.toString(), {
            headers: getHeaders(),
        });

        if (!response.ok) {
            throw new Error(`TMDB API Error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        // Store in cache
        responseCache.set(cacheKey, { data, timestamp: Date.now() });

        return data;
    })();

    // Track in-flight
    inFlightRequests.set(cacheKey, promise);
    promise.finally(() => inFlightRequests.delete(cacheKey));

    return promise as Promise<T>;
}

// Get trending content
export async function getTrending(
    mediaType: 'all' | 'movie' | 'tv' = 'all',
    timeWindow: 'day' | 'week' = 'week'
): Promise<TMDBContent[]> {
    const response = await fetchTMDB<TMDBResponse<TMDBContent>>(
        `/trending/${mediaType}/${timeWindow}`
    );
    return response.results;
}

// Get popular movies
export async function getPopularMovies(page: number = 1): Promise<TMDBResponse<TMDBMovie>> {
    return fetchTMDB<TMDBResponse<TMDBMovie>>('/movie/popular', { page: page.toString() });
}

// Get popular TV shows
export async function getPopularTVShows(page: number = 1): Promise<TMDBResponse<TMDBTVShow>> {
    return fetchTMDB<TMDBResponse<TMDBTVShow>>('/tv/popular', { page: page.toString() });
}

// Get top rated movies
export async function getTopRatedMovies(page: number = 1): Promise<TMDBResponse<TMDBMovie>> {
    return fetchTMDB<TMDBResponse<TMDBMovie>>('/movie/top_rated', { page: page.toString() });
}

// Get top rated TV shows
export async function getTopRatedTVShows(page: number = 1): Promise<TMDBResponse<TMDBTVShow>> {
    return fetchTMDB<TMDBResponse<TMDBTVShow>>('/tv/top_rated', { page: page.toString() });
}

// Get movie details
export async function getMovieDetails(id: number): Promise<TMDBContentDetails> {
    return fetchTMDB<TMDBContentDetails>(`/movie/${id}`);
}

// Get TV show details (with seasons)
export async function getTVShowDetails(id: number): Promise<TMDBTVShowDetails> {
    return fetchTMDB<TMDBTVShowDetails>(`/tv/${id}`);
}

// Get season details with episodes
export async function getSeasonDetails(
    tvId: number,
    seasonNumber: number
): Promise<TMDBSeasonDetails> {
    return fetchTMDB<TMDBSeasonDetails>(`/tv/${tvId}/season/${seasonNumber}`);
}

// Get still (episode thumbnail) URL
export function getStillUrl(path: string | null, size: 'small' | 'medium' | 'large' = 'medium'): string {
    if (!path) return '/placeholder-episode.jpg';
    const sizeMap = { small: 'w185', medium: 'w300', large: 'w500' };
    return `${TMDB_IMAGE_BASE}/${sizeMap[size]}${path}`;
}

// Get content credits (cast)
export async function getCredits(
    mediaType: 'movie' | 'tv',
    id: number
): Promise<TMDBCredits> {
    return fetchTMDB<TMDBCredits>(`/${mediaType}/${id}/credits`);
}

// Search content
export async function searchContent(
    query: string,
    page: number = 1
): Promise<TMDBResponse<TMDBContent>> {
    return fetchTMDB<TMDBResponse<TMDBContent>>('/search/multi', {
        query,
        page: page.toString(),
        include_adult: 'false',
    });
}

// Get genres
export async function getMovieGenres(): Promise<TMDBGenre[]> {
    const response = await fetchTMDB<{ genres: TMDBGenre[] }>('/genre/movie/list');
    return response.genres;
}

export async function getTVGenres(): Promise<TMDBGenre[]> {
    const response = await fetchTMDB<{ genres: TMDBGenre[] }>('/genre/tv/list');
    return response.genres;
}

// Get discover movies with filters
export async function discoverMovies(
    params: {
        page?: number;
        with_genres?: string;
        sort_by?: string;
        year?: number;
    } = {}
): Promise<TMDBResponse<TMDBMovie>> {
    const queryParams: Record<string, string> = {};
    if (params.page) queryParams.page = params.page.toString();
    if (params.with_genres) queryParams.with_genres = params.with_genres;
    if (params.sort_by) queryParams.sort_by = params.sort_by;
    if (params.year) queryParams.primary_release_year = params.year.toString();

    return fetchTMDB<TMDBResponse<TMDBMovie>>('/discover/movie', queryParams);
}

// Get discover TV shows with filters
export async function discoverTVShows(
    params: {
        page?: number;
        with_genres?: string;
        sort_by?: string;
        year?: number;
    } = {}
): Promise<TMDBResponse<TMDBTVShow>> {
    const queryParams: Record<string, string> = {};
    if (params.page) queryParams.page = params.page.toString();
    if (params.with_genres) queryParams.with_genres = params.with_genres;
    if (params.sort_by) queryParams.sort_by = params.sort_by;
    if (params.year) queryParams.first_air_date_year = params.year.toString();

    return fetchTMDB<TMDBResponse<TMDBTVShow>>('/discover/tv', queryParams);
}

// Get random content
export async function getRandomContent(): Promise<TMDBContent> {
    const randomPage = Math.floor(Math.random() * 100) + 1;
    const mediaType = Math.random() > 0.5 ? 'movie' : 'tv';

    const response = mediaType === 'movie'
        ? await getPopularMovies(randomPage)
        : await getPopularTVShows(randomPage);

    const randomIndex = Math.floor(Math.random() * response.results.length);
    return response.results[randomIndex];
}

// Search multi (alias for searchContent) - returns content with media_type
export async function searchMulti(
    query: string,
    page: number = 1
): Promise<TMDBResponse<TMDBContent & { media_type: 'movie' | 'tv' | 'person' }>> {
    return fetchTMDB<TMDBResponse<TMDBContent & { media_type: 'movie' | 'tv' | 'person' }>>('/search/multi', {
        query,
        page: page.toString(),
        include_adult: 'false',
    });
}

// Video/Trailer types
export interface TMDBVideo {
    id: string;
    key: string;      // YouTube video key
    name: string;
    site: string;     // "YouTube", "Vimeo", etc.
    type: string;     // "Trailer", "Teaser", "Featurette", etc.
    official: boolean;
    published_at: string;
}

interface TMDBVideosResponse {
    id: number;
    results: TMDBVideo[];
}

// Get videos (trailers, teasers, etc.) for a movie or TV show
export async function getVideos(
    id: number,
    type: 'movie' | 'tv'
): Promise<TMDBVideo[]> {
    const endpoint = type === 'movie' ? `/movie/${id}/videos` : `/tv/${id}/videos`;
    const response = await fetchTMDB<TMDBVideosResponse>(endpoint);
    return response.results || [];
}

// Get the best trailer for a movie or TV show
export async function getTrailer(
    id: number,
    type: 'movie' | 'tv'
): Promise<TMDBVideo | null> {
    const videos = await getVideos(id, type);

    // Filter for YouTube videos only
    const youtubeVideos = videos.filter(v => v.site === 'YouTube');

    // Priority: Official Trailer > Trailer > Teaser > any video
    const officialTrailer = youtubeVideos.find(v => v.type === 'Trailer' && v.official);
    if (officialTrailer) return officialTrailer;

    const trailer = youtubeVideos.find(v => v.type === 'Trailer');
    if (trailer) return trailer;

    const teaser = youtubeVideos.find(v => v.type === 'Teaser');
    if (teaser) return teaser;

    // Return first YouTube video if no trailer found
    return youtubeVideos[0] || null;
}

