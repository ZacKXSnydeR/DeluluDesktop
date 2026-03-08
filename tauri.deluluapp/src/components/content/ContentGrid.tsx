import { type TMDBContent } from '../../services/tmdb';
import { ContentCard } from './ContentCard';
import './ContentGrid.css';

interface ContentGridProps {
    items: TMDBContent[];
    title?: string;
    subtitle?: string;
    isLoading?: boolean;
    loadedCount?: number;
    totalCount?: number;
    onLoadMore?: () => void;
}

export function ContentGrid({
    items,
    title,
    subtitle,
    isLoading = false,
    loadedCount,
    totalCount,
    onLoadMore,
}: ContentGridProps) {
    const hasMore = totalCount && loadedCount ? loadedCount < totalCount : false;

    return (
        <div className="content-grid">
            {(title || subtitle) && (
                <div className="content-grid-header">
                    {title && (
                        <h1 className="content-grid-title">
                            {title}
                        </h1>
                    )}
                    {subtitle && <p className="content-grid-subtitle">{subtitle}</p>}
                    {loadedCount && totalCount && (
                        <div className="content-grid-stats">
                            <span className="content-grid-count">
                                Showing {loadedCount.toLocaleString()} of {totalCount.toLocaleString()}
                            </span>
                        </div>
                    )}
                </div>
            )}
            <div className="content-grid-items">
                {items.map((item) => (
                    <ContentCard key={item.id} content={item} />
                ))}
                {isLoading &&
                    [...Array(12)].map((_, i) => (
                        <div key={`skeleton-${i}`} className="skeleton skeleton-card" />
                    ))}
            </div>

            {/* View More Button */}
            {hasMore && onLoadMore && !isLoading && (
                <div className="content-grid-footer">
                    <button
                        className="btn-load-more"
                        onClick={onLoadMore}
                        disabled={isLoading}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="6 9 12 15 18 9" />
                        </svg>
                        View More
                    </button>
                </div>
            )}
        </div>
    );
}
