import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { MiniPlayerProvider } from './context/MiniPlayerContext';
import { UserListsProvider } from './context/UserListsContext';
import { Navbar } from './components/layout/Navbar';
import { SearchModal } from './components/layout/SearchModal';
import { UserDropdown } from './components/layout/UserDropdown';
import { MiniPlayer } from './components/player/MiniPlayer';
import { Home } from './pages/Home';
import { Movies } from './pages/Movies';
import { TVShows } from './pages/TVShows';
import { Details } from './pages/Details';
import { Random } from './pages/Random';
import { MyList } from './pages/MyList';
import { Settings } from './pages/Settings';
import { VidLinkStream } from './pages/VidLinkStream';
import { AuthPage } from './pages/auth/AuthPage';
import { ProtectedRoute } from './components/auth/ProtectedRoute';

import { useLenis } from './hooks/useLenis';
import { initDatabase } from './services/database';

import './styles/index.css';

// Wrapper component to conditionally render Navbar
function AppContent() {
    const location = useLocation();
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
    const [isOffline, setIsOffline] = useState(!navigator.onLine);


    // Offline detection
    useEffect(() => {
        const goOffline = () => setIsOffline(true);
        const goOnline = () => setIsOffline(false);
        window.addEventListener('offline', goOffline);
        window.addEventListener('online', goOnline);
        return () => {
            window.removeEventListener('offline', goOffline);
            window.removeEventListener('online', goOnline);
        };
    }, []);



    // Initialize Lenis smooth scrolling
    useLenis();

    // Initialize database and prepare extractor engine silently in the background
    useEffect(() => {
        let cancelled = false;
        const prepare = async () => {
            try {
                await initDatabase();
                const { invoke } = await import('@tauri-apps/api/core');
                await invoke('prepare_extractor_engine');
            } catch (err) {
                if (!cancelled) console.error('[Engine] Preparation failed:', err);
            }
        };
        prepare().catch(console.error);
        return () => { cancelled = true; };
    }, []);


    const handleSearchClick = () => {
        setIsSearchOpen(true);
        setIsUserDropdownOpen(false);
    };

    const handleUserClick = () => {
        setIsUserDropdownOpen((prev) => !prev);
        setIsSearchOpen(false);
    };

    // Hide navbar on auth page and streaming pages
    const hideNavbar = location.pathname === '/auth' || location.pathname.startsWith('/stream');

    return (
        <>
            {!hideNavbar && (
                <Navbar onSearchClick={handleSearchClick} onUserClick={handleUserClick} />
            )}
            <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/movies" element={<Movies />} />
                <Route path="/tv-shows" element={<TVShows />} />
                {/* Movie/TV details - support both /movie/:id and /details/:mediaType/:id */}
                <Route path="/movie/:id" element={<Details />} />
                <Route path="/tv/:id" element={<Details />} />
                <Route path="/details/:mediaType/:id" element={<Details />} />
                <Route path="/random" element={<Random />} />
                <Route path="/continue-watching" element={<ProtectedRoute><MyList /></ProtectedRoute>} />
                <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
                {/* Streaming routes — auth required */}
                <Route path="/stream" element={<ProtectedRoute><VidLinkStream /></ProtectedRoute>} />
                <Route path="/stream/:type/:id" element={<ProtectedRoute><VidLinkStream /></ProtectedRoute>} />
                <Route path="/auth" element={<AuthPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>

            {isSearchOpen && <SearchModal isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />}

            {isUserDropdownOpen && (
                <UserDropdown isOpen={isUserDropdownOpen} onClose={() => setIsUserDropdownOpen(false)} />
            )}

            {/* Global mini player */}
            {!hideNavbar && <MiniPlayer />}

            {/* Offline popup */}
            {isOffline && (
                <div className="offline-popup">
                    <div className="offline-popup-inner">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="1" y1="1" x2="23" y2="23" />
                            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
                            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
                            <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
                            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
                            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                            <line x1="12" y1="20" x2="12.01" y2="20" />
                        </svg>
                        <span>No internet connection</span>
                    </div>
                </div>
            )}


        </>
    );
}

function App() {
    return (
        <BrowserRouter>
            <AuthProvider>
                <UserListsProvider>
                    <MiniPlayerProvider>
                        <AppContent />
                    </MiniPlayerProvider>
                </UserListsProvider>
            </AuthProvider>
        </BrowserRouter>
    );
}

export default App;
