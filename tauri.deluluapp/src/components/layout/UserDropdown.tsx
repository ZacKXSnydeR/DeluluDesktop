import { useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { signOut } from '../../config/firebase';
import './UserDropdown.css';

interface UserDropdownProps {
    isOpen: boolean;
    onClose: () => void;
}

export function UserDropdown({ isOpen, onClose }: UserDropdownProps) {
    const { user, isAuthenticated } = useAuth();
    const dropdownRef = useRef<HTMLDivElement>(null);
    const navigate = useNavigate();

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                onClose();
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen, onClose]);

    const handleSignOut = async () => {
        try {
            await signOut();
            onClose();
        } catch (error) {
            console.error('Sign out error:', error);
        }
    };

    const handleGoToSettings = () => {
        navigate('/settings');
        onClose();
    };

    const handleGoToWatchlist = () => {
        navigate('/continue-watching?tab=watchlist');
        onClose();
    };

    const handleGoToFavorites = () => {
        navigate('/continue-watching?tab=favorites');
        onClose();
    };


    if (!isOpen) return null;

    return (
        <div className="user-dropdown" ref={dropdownRef}>
            {isAuthenticated && user ? (
                <>
                    <div className="user-dropdown-header">
                        <div className="user-dropdown-avatar">
                            {user.photoURL ? (
                                <img src={user.photoURL} alt="Profile" />
                            ) : (
                                user.email?.charAt(0).toUpperCase() || '?'
                            )}
                        </div>
                        <div className="user-dropdown-info">
                            {user.displayName && <p className="user-dropdown-name">{user.displayName}</p>}
                            <p className="user-dropdown-email">{user.email}</p>
                        </div>
                    </div>
                    <div className="user-dropdown-menu">
                        <button className="user-dropdown-item" onClick={handleGoToWatchlist}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="user-dropdown-icon">
                                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                            </svg>
                            Watchlist
                        </button>
                        <button className="user-dropdown-item" onClick={handleGoToFavorites}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="user-dropdown-icon">
                                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                            </svg>
                            Favorites
                        </button>
                        <button className="user-dropdown-item" onClick={handleGoToSettings}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="user-dropdown-icon">
                                <circle cx="12" cy="12" r="3" />
                                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                            </svg>
                            Settings
                        </button>
                    </div>

                    <div className="user-dropdown-divider" />

                    <div className="user-dropdown-footer">
                        <button className="user-dropdown-item user-dropdown-signout" onClick={handleSignOut}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="user-dropdown-icon">
                                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                                <polyline points="16 17 21 12 16 7" />
                                <line x1="21" y1="12" x2="9" y2="12" />
                            </svg>
                            Sign Out
                        </button>
                    </div>
                </>
            ) : (
                <div className="user-dropdown-auth">
                    <div className="user-dropdown-auth-prompt">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <circle cx="12" cy="8" r="4" />
                            <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
                        </svg>
                        <h3>Welcome to Delulu</h3>
                        <p>Sign in to save your watchlist and favorites</p>
                    </div>
                    <button
                        className="user-dropdown-signin-btn"
                        onClick={() => {
                            navigate('/auth');
                            onClose();
                        }}
                    >
                        Sign In / Sign Up
                    </button>
                </div>
            )}
        </div>
    );
}
