import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import {
    getUserLists,
    toggleWatchlist,
    toggleFavorites,
    removeFromWatchlist,
    removeFromFavorites,
    isInWatchlist as checkInWatchlist,
    isInFavorites as checkInFavorites,
    type UserLists,
    type SavedContent,
} from '../services/userLists';

interface UserListsContextType {
    lists: UserLists;
    isLoading: boolean;
    toggleWatchlistItem: (content: Omit<SavedContent, 'addedAt'>) => void;
    toggleFavoritesItem: (content: Omit<SavedContent, 'addedAt'>) => void;
    removeFromWatchlist: (id: number, type: 'movie' | 'tv') => void;
    removeFromFavorites: (id: number, type: 'movie' | 'tv') => void;
    isInWatchlist: (id: number, type: 'movie' | 'tv') => boolean;
    isInFavorites: (id: number, type: 'movie' | 'tv') => boolean;
    refreshLists: () => void;
}

const UserListsContext = createContext<UserListsContextType | null>(null);

export function UserListsProvider({ children }: { children: ReactNode }) {
    const { user, isAuthenticated } = useAuth();
    const [lists, setLists] = useState<UserLists>({ watchlist: [], favorites: [] });
    const [isLoading, setIsLoading] = useState(false);

    // Load lists from localStorage - instant!
    const loadLists = useCallback(() => {
        if (!user?.uid) {
            setLists({ watchlist: [], favorites: [] });
            return;
        }

        // Instant load from localStorage
        const userLists = getUserLists(user.uid);
        setLists(userLists);
    }, [user?.uid]);

    // Load on mount and when user changes
    useEffect(() => {
        if (isAuthenticated && user?.uid) {
            setIsLoading(true);
            loadLists();
            setIsLoading(false);
        } else {
            setLists({ watchlist: [], favorites: [] });
        }
    }, [isAuthenticated, user?.uid, loadLists]);

    const handleToggleWatchlist = useCallback((content: Omit<SavedContent, 'addedAt'>) => {
        if (!user?.uid) return;

        toggleWatchlist(user.uid, content);
        loadLists(); // Refresh state
    }, [user?.uid, loadLists]);

    const handleToggleFavorites = useCallback((content: Omit<SavedContent, 'addedAt'>) => {
        if (!user?.uid) return;

        toggleFavorites(user.uid, content);
        loadLists(); // Refresh state
    }, [user?.uid, loadLists]);

    const handleRemoveFromWatchlist = useCallback((id: number, type: 'movie' | 'tv') => {
        if (!user?.uid) return;

        removeFromWatchlist(user.uid, id, type);
        loadLists(); // Refresh state
    }, [user?.uid, loadLists]);

    const handleRemoveFromFavorites = useCallback((id: number, type: 'movie' | 'tv') => {
        if (!user?.uid) return;

        removeFromFavorites(user.uid, id, type);
        loadLists(); // Refresh state
    }, [user?.uid, loadLists]);

    const handleIsInWatchlist = useCallback((id: number, type: 'movie' | 'tv'): boolean => {
        if (!user?.uid) return false;
        return checkInWatchlist(user.uid, id, type);
    }, [user?.uid]);

    const handleIsInFavorites = useCallback((id: number, type: 'movie' | 'tv'): boolean => {
        if (!user?.uid) return false;
        return checkInFavorites(user.uid, id, type);
    }, [user?.uid]);

    const value: UserListsContextType = {
        lists,
        isLoading,
        toggleWatchlistItem: handleToggleWatchlist,
        toggleFavoritesItem: handleToggleFavorites,
        removeFromWatchlist: handleRemoveFromWatchlist,
        removeFromFavorites: handleRemoveFromFavorites,
        isInWatchlist: handleIsInWatchlist,
        isInFavorites: handleIsInFavorites,
        refreshLists: loadLists,
    };

    return (
        <UserListsContext.Provider value={value}>
            {children}
        </UserListsContext.Provider>
    );
}

export function useUserLists(): UserListsContextType {
    const context = useContext(UserListsContext);
    if (!context) {
        throw new Error('useUserLists must be used within a UserListsProvider');
    }
    return context;
}

export function useUserListsSafe(): UserListsContextType | null {
    return useContext(UserListsContext);
}
