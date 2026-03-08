import { useState } from 'react';
import { useNavigate, useSearchParams, Navigate } from 'react-router-dom';
import { signInWithEmail, signUpWithEmail } from '../../config/firebase';
import { mapFirebaseAuthError } from '../../utils/authErrors';
import { useAuth } from '../../context/AuthContext';
import { Loader2, ArrowLeft, Minus, Square, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import './AuthPage.css';
type AuthMode = 'signin' | 'signup';

const DISPOSABLE_DOMAINS = [
    'temp-mail.org', '10minutemail.com', 'mailinator.com', 'guerrillamail.com',
    'yopmail.com', 'tempmail.com', 'throwawaymail.com', 'maildrop.cc', 'tempmail.net'
];

export function AuthPage() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const redirectUrl = searchParams.get('redirect') || '/';
    const { isAuthenticated, isLoading: authLoading } = useAuth();

    // All hooks must be declared before any early return
    const [mode, setMode] = useState<AuthMode>('signin');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [rememberMe, setRememberMe] = useState(true);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    // Already logged in — redirect away from auth page
    if (!authLoading && isAuthenticated) {
        return <Navigate to={redirectUrl} replace />;
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (!email || !password) {
            setError('Please fill in all fields');
            return;
        }

        if (mode === 'signup' && password !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        if (password.length < 6) {
            setError('Password must be at least 6 characters');
            return;
        }

        setIsLoading(true);
        const normalizedEmail = email.trim().toLowerCase();

        if (mode === 'signup') {
            const domain = normalizedEmail.split('@')[1];
            if (domain && DISPOSABLE_DOMAINS.includes(domain)) {
                setError('Please use a permanent, valid email address. Disposable emails are not allowed.');
                setIsLoading(false);
                return;
            }
        }

        try {
            if (mode === 'signin') {
                await signInWithEmail(normalizedEmail, password);
            } else {
                await signUpWithEmail(normalizedEmail, password);
            }
            navigate(redirectUrl);
        } catch (err: any) {
            console.error('[Auth] Full error:', err);
            console.error('[Auth] Error code:', err?.code);
            console.error('[Auth] Error message:', err?.message);
            const errorCode = err?.code || '';
            if (errorCode === 'auth/network-request-failed') {
                // Firebase can't reach Google servers — could be Tauri CSP or actual network issue
                setError('Unable to connect to authentication server. This may be a temporary issue — please try again in a moment.');
            } else {
                setError(mapFirebaseAuthError(errorCode));
            }
        } finally {
            setIsLoading(false);
        }
    };


    return (
        <div className="auth-page">

            {/* Background */}
            <div className="auth-bg">
                <img src="/signinup.jpg" alt="Background" />
                <div className="auth-bg-overlay" />
            </div>

            {/* Header with back button + window controls */}
            <header className="auth-header" data-tauri-drag-region>
                <button className="auth-back-btn" onClick={() => navigate(-1)}>
                    <ArrowLeft size={20} />
                </button>
                <h1 className="auth-logo" onClick={() => navigate('/')}>DELULU</h1>

                <div className="auth-header-spacer" data-tauri-drag-region />

                <div className="auth-window-controls">
                    <button
                        className="auth-win-btn"
                        onClick={() => getCurrentWindow().minimize()}
                        aria-label="Minimize"
                    >
                        <Minus size={14} />
                    </button>
                    <button
                        className="auth-win-btn"
                        onClick={() => getCurrentWindow().toggleMaximize()}
                        aria-label="Maximize"
                    >
                        <Square size={11} />
                    </button>
                    <button
                        className="auth-win-btn auth-win-close"
                        onClick={() => getCurrentWindow().close()}
                        aria-label="Close"
                    >
                        <X size={14} />
                    </button>
                </div>
            </header>

            {/* Form Container */}
            <div className="auth-container">
                <div className="auth-form-wrapper">
                    <h2 className="auth-title">
                        {mode === 'signin' ? 'Sign In' : 'Sign Up'}
                    </h2>

                    {error && (
                        <div className="auth-error">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="auth-form">
                        <div className="auth-input-group">
                            <input
                                type="email"
                                placeholder="Email or phone number"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="auth-input"
                                disabled={isLoading}
                            />
                        </div>

                        <div className="auth-input-group">
                            <input
                                type="password"
                                placeholder="Password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="auth-input"
                                disabled={isLoading}
                            />
                        </div>

                        {mode === 'signup' && (
                            <div className="auth-input-group">
                                <input
                                    type="password"
                                    placeholder="Confirm Password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    className="auth-input"
                                    disabled={isLoading}
                                />
                            </div>
                        )}

                        <button
                            type="submit"
                            className="auth-submit-btn"
                            disabled={isLoading}
                        >
                            {isLoading ? (
                                <Loader2 size={20} className="spin" />
                            ) : (
                                mode === 'signin' ? 'Sign In' : 'Sign Up'
                            )}
                        </button>

                        {mode === 'signin' && (
                            <div className="auth-options">
                                <label className="auth-remember">
                                    <input
                                        type="checkbox"
                                        checked={rememberMe}
                                        onChange={(e) => setRememberMe(e.target.checked)}
                                    />
                                    <span>Remember me</span>
                                </label>
                                <a href="#" className="auth-help-link">Need help?</a>
                            </div>
                        )}
                    </form>


                    {/* Switch Mode */}
                    <p className="auth-switch">
                        {mode === 'signin' ? (
                            <>
                                New to Delulu?{' '}
                                <button
                                    type="button"
                                    className="auth-switch-btn"
                                    onClick={() => setMode('signup')}
                                >
                                    Sign up now
                                </button>
                            </>
                        ) : (
                            <>
                                Already have an account?{' '}
                                <button
                                    type="button"
                                    className="auth-switch-btn"
                                    onClick={() => setMode('signin')}
                                >
                                    Sign in
                                </button>
                            </>
                        )}
                    </p>

                </div>
            </div>
        </div>
    );
}
