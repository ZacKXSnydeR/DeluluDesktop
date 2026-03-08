import { useState, useEffect } from 'react';
import { clearStreamCache, getCacheStats } from '../services/streamCache';
import { useAuth } from '../context/AuthContext';
import { signOut, signInWithEmail, signUpWithEmail, resetPassword } from '../config/firebase';
import { mapFirebaseAuthError } from '../utils/authErrors';
import Silk from '../components/background/Silk';
import './Settings.css';

type AuthMode = 'signin' | 'signup' | 'reset';

export function Settings() {
    const { user, isAuthenticated, isLoading } = useAuth();
    const [authMode, setAuthMode] = useState<AuthMode>('signin');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');

    // Streaming engine status - always online since backend auto-starts
    const engineStatus = 'online';

    // Cache stats
    const [cacheStats, setCacheStats] = useState<{ count: number; sizeKB: number } | null>(null);
    const [isClearingCache, setIsClearingCache] = useState(false);
    const [cacheClearMsg, setCacheClearMsg] = useState('');

    useEffect(() => {
        loadCacheStats();
    }, []);

    const loadCacheStats = () => {
        const stats = getCacheStats();
        setCacheStats(stats);
    };

    const handleClearCache = () => {
        setIsClearingCache(true);
        setCacheClearMsg('');
        try {
            clearStreamCache();
            setCacheClearMsg('Stream link cache cleared successfully');
            loadCacheStats();
        } catch {
            setCacheClearMsg('Failed to clear cache');
        } finally {
            setIsClearingCache(false);
            setTimeout(() => setCacheClearMsg(''), 4000);
        }
    };


    const handleEmailSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccessMessage('');
        setIsSubmitting(true);
        const normalizedEmail = email.trim().toLowerCase();

        try {
            if (authMode === 'signup') {
                if (password !== confirmPassword) {
                    setError('Passwords do not match');
                    setIsSubmitting(false);
                    return;
                }
                if (password.length < 6) {
                    setError('Password must be at least 6 characters');
                    setIsSubmitting(false);
                    return;
                }
                await signUpWithEmail(normalizedEmail, password);
            } else if (authMode === 'signin') {
                await signInWithEmail(normalizedEmail, password);
            } else if (authMode === 'reset') {
                await resetPassword(normalizedEmail);
                setSuccessMessage('Password reset email sent');
                setAuthMode('signin');
            }
        } catch (err: unknown) {
            const firebaseError = err as { code?: string };
            setError(mapFirebaseAuthError(firebaseError.code));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSignOut = async () => {
        try {
            await signOut();
        } catch (err) {
            console.error('Error signing out:', err);
        }
    };

    if (isLoading) {
        return (
            <div className="control-center page">
                <div className="control-center-loading">Loading...</div>
            </div>
        );
    }

    return (
        <div className="control-center">
            {/* 3D Silk Background */}
            <Silk
                speed={3}
                scale={1.2}
                color="#1a1a2e"
                noiseIntensity={1.2}
                rotation={0}
            />

            <div className="control-center-container">
                <header className="control-header">
                    <h1 className="control-center-title">Control Center</h1>
                    <p className="control-center-subtitle">Manage your account, streaming system, and preferences</p>
                </header>

                <div className="control-grid">
                    {/* Left Column - Profile */}
                    <div className="control-column">
                        <section className="control-section">
                            <h2 className="section-title">Profile Identity</h2>

                            {isAuthenticated && user ? (
                                <div className="control-card">
                                    <div className="profile-header">
                                        <div className="profile-avatar-ring">
                                            <div className="profile-avatar">
                                                {user.photoURL ? (
                                                    <img src={user.photoURL} alt="Profile" />
                                                ) : (
                                                    <span>{user.email?.charAt(0).toUpperCase() || '?'}</span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="profile-info">
                                            <h3 className="profile-name">{user.displayName || user.email}</h3>
                                            <div className="profile-status">
                                                <span className="status-dot"></span>
                                                <span>Active Session</span>
                                            </div>
                                        </div>
                                    </div>
                                    <p className="profile-trust">Your preferences sync securely</p>
                                    <button className="btn-secondary-subtle" onClick={handleSignOut}>
                                        Sign Out
                                    </button>
                                </div>
                            ) : (
                                <div className="control-card">
                                    <form onSubmit={handleEmailSubmit} className="auth-form">
                                        <input
                                            type="email"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            placeholder="Email"
                                            className="input-field"
                                            required
                                        />

                                        {authMode !== 'reset' && (
                                            <input
                                                type="password"
                                                value={password}
                                                onChange={(e) => setPassword(e.target.value)}
                                                placeholder="Password"
                                                className="input-field"
                                                required
                                            />
                                        )}

                                        {authMode === 'signup' && (
                                            <input
                                                type="password"
                                                value={confirmPassword}
                                                onChange={(e) => setConfirmPassword(e.target.value)}
                                                placeholder="Confirm Password"
                                                className="input-field"
                                                required
                                            />
                                        )}

                                        {error && <p className="message-error">{error}</p>}
                                        {successMessage && <p className="message-success">{successMessage}</p>}

                                        <button type="submit" className="btn-primary" disabled={isSubmitting}>
                                            {isSubmitting ? 'Please wait...' : authMode === 'signin' ? 'Sign In' : authMode === 'signup' ? 'Create Account' : 'Reset Password'}
                                        </button>

                                        <div className="auth-links">
                                            {authMode === 'signin' ? (
                                                <>
                                                    <button type="button" className="link-button" onClick={() => { setAuthMode('signup'); setError(''); }}>
                                                        Create account
                                                    </button>
                                                    <button type="button" className="link-button" onClick={() => { setAuthMode('reset'); setError(''); }}>
                                                        Forgot password?
                                                    </button>
                                                </>
                                            ) : (
                                                <button type="button" className="link-button" onClick={() => { setAuthMode('signin'); setError(''); }}>
                                                    Back to sign in
                                                </button>
                                            )}
                                        </div>
                                    </form>
                                </div>
                            )}
                        </section>
                    </div>

                    {/* Right Column - Settings */}
                    <div className="control-column">
                        {/* Streaming Engine */}
                        <section className="control-section">
                            <h2 className="section-title">Streaming Engine</h2>
                            <div className="control-card">
                                <div className="engine-row">
                                    <div className={`status-pill status-${engineStatus}`}>
                                        <span className="status-indicator"></span>
                                        <span>Online</span>
                                    </div>
                                </div>
                                <p className="engine-note">Optimized automatically for best performance</p>
                            </div>
                        </section>

                        {/* Stream Cache */}
                        <section className="control-section">
                            <h2 className="section-title">Stream Cache</h2>
                            <div className="control-card">
                                {cacheStats ? (
                                    <div className="cache-stats">
                                        <div className="cache-stat-row">
                                            <span className="cache-stat-label">Cached Links</span>
                                            <span className="cache-stat-value">{cacheStats.count}</span>
                                        </div>
                                        <div className="cache-stat-row">
                                            <span className="cache-stat-label">Cache Size</span>
                                            <span className="cache-stat-value">{cacheStats.sizeKB} KB</span>
                                        </div>
                                    </div>
                                ) : (
                                    <p className="engine-note">No cached stream links.</p>
                                )}
                                {cacheClearMsg && <p className="cache-clear-msg">{cacheClearMsg}</p>}
                                <button
                                    className="btn-danger-subtle"
                                    onClick={handleClearCache}
                                    disabled={isClearingCache}
                                >
                                    {isClearingCache ? 'Clearing...' : 'Clear Stream Cache'}
                                </button>
                                <p className="engine-note">Clears buffered HLS segments. Useful if a stream is frozen or playing wrong content.</p>
                            </div>
                        </section>

                        {/* System Info */}
                        <section className="control-section">
                            <h2 className="section-title">System Info</h2>
                            <div className="control-card">
                                <div className="system-row">
                                    <h3>Delulu</h3>
                                    <span className="version-badge">v1.0.0</span>
                                </div>
                                <p className="system-tagline">Designed for high-quality streaming</p>
                            </div>
                        </section>
                    </div>
                </div>
            </div>
        </div>
    );
}
