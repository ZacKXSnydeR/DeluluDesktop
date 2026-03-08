import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    type TMDBContent,
    getBackdropUrl,
    getTitle,
    getReleaseYear,
    getMediaType,
} from '../../services/tmdb';
import './HeroCarousel.css';

interface HeroCarouselProps {
    items: TMDBContent[];
    autoPlayInterval?: number;
}

export function HeroCarousel({ items, autoPlayInterval = 6000 }: HeroCarouselProps) {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isTransitioning, setIsTransitioning] = useState(false);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const navigate = useNavigate();

    // Swipe gesture state
    const [dragStart, setDragStart] = useState<number | null>(null);
    const [isDragging, setIsDragging] = useState(false);

    const currentItem = items[currentIndex];
    const currentMediaType = currentItem ? getMediaType(currentItem) : null;

    useEffect(() => {
        if (items.length <= 1) return;

        intervalRef.current = setInterval(() => {
            handleNext();
        }, autoPlayInterval);

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
        };
    }, [currentIndex, items.length, autoPlayInterval]);

    const handleNext = () => {
        setIsTransitioning(true);
        setTimeout(() => {
            setCurrentIndex((prev) => (prev + 1) % items.length);
            setIsTransitioning(false);
        }, 300);
    };

    const handlePrev = () => {
        setIsTransitioning(true);
        setTimeout(() => {
            setCurrentIndex((prev) => (prev - 1 + items.length) % items.length);
            setIsTransitioning(false);
        }, 300);
    };

    const handleDotClick = (index: number) => {
        if (index === currentIndex) return;
        setIsTransitioning(true);
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
        }
        setTimeout(() => {
            setCurrentIndex(index);
            setIsTransitioning(false);
        }, 300);
    };

    // Swipe/Drag handlers
    const handleDragStart = (clientX: number) => {
        setDragStart(clientX);
        setIsDragging(true);
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
        }
    };

    const handleDragEnd = (clientX: number) => {
        if (dragStart === null) return;

        const diff = dragStart - clientX;
        const threshold = 50; // Minimum swipe distance

        if (Math.abs(diff) > threshold) {
            if (diff > 0) {
                handleNext(); // Swipe left -> next
            } else {
                handlePrev(); // Swipe right -> previous
            }
        }

        setDragStart(null);
        setIsDragging(false);
    };

    // Mouse events
    const handleMouseDown = (e: React.MouseEvent) => {
        handleDragStart(e.clientX);
    };

    const handleMouseUp = (e: React.MouseEvent) => {
        handleDragEnd(e.clientX);
    };

    const handleMouseLeave = () => {
        if (isDragging && dragStart !== null) {
            setDragStart(null);
            setIsDragging(false);
        }
    };

    // Touch events
    const handleTouchStart = (e: React.TouchEvent) => {
        handleDragStart(e.touches[0].clientX);
    };

    const handleTouchEnd = (e: React.TouchEvent) => {
        if (e.changedTouches.length > 0) {
            handleDragEnd(e.changedTouches[0].clientX);
        }
    };

    const handlePlayClick = () => {
        const mediaType = getMediaType(currentItem);
        navigate(`/details/${mediaType}/${currentItem.id}`);
    };

    const handleMoreInfoClick = () => {
        const mediaType = getMediaType(currentItem);
        navigate(`/details/${mediaType}/${currentItem.id}`);
    };

    if (!currentItem) return null;

    return (
        <div
            className={`hero-carousel ${isDragging ? 'hero-carousel-dragging' : ''}`}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
        >
            <div
                className={`hero-backdrop ${isTransitioning ? 'hero-backdrop-transitioning' : ''}`}
                style={{
                    backgroundImage: `url(${getBackdropUrl(currentItem.backdrop_path, 'original')})`,
                }}
            />
            <div className="hero-gradient" />
            <div className="hero-content hero-content-entering" key={`hero-content-${currentIndex}`}>
                <span className="hero-tag">
                    🔥 {currentMediaType === 'movie' ? 'FEATURED MOVIE' : 'FEATURED SERIES'}
                </span>
                <h1 className="hero-title">{getTitle(currentItem)}</h1>
                <div className="hero-meta">
                    <span className="hero-rating">
                        <span className="hero-rating-star">★</span>
                        {currentItem.vote_average.toFixed(1)}% Match
                    </span>
                    <span className="hero-year">📅 {getReleaseYear(currentItem)}</span>
                    <span className="hero-type">
                        {currentMediaType === 'movie' ? 'MOVIE' : 'TV SERIES'}
                    </span>
                </div>
                <p className="hero-overview">
                    {currentItem.overview.length > 200
                        ? `${currentItem.overview.substring(0, 200)}...`
                        : currentItem.overview}
                </p>
                <div className="hero-buttons">
                    <button className="btn btn-primary btn-lg hero-play-btn" onClick={handlePlayClick}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8 5v14l11-7z" />
                        </svg>
                        Play Now
                    </button>
                    <button className="btn btn-secondary btn-lg hero-more-info-btn" onClick={handleMoreInfoClick}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <path d="M12 16v-4M12 8h.01" />
                        </svg>
                        More Info
                    </button>
                </div>
            </div>
            <div className="hero-dots">
                {items.map((_, index) => (
                    <button
                        key={index}
                        className={`hero-dot ${index === currentIndex ? 'hero-dot-active' : ''}`}
                        onClick={() => handleDotClick(index)}
                        aria-label={`Go to slide ${index + 1}`}
                    />
                ))}
            </div>
        </div>
    );
}
