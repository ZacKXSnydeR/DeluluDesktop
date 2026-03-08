import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

/**
 * Route guard — blocks access to all app routes unless authenticated.
 * 
 * While Firebase is still checking auth state (isLoading), renders nothing
 * to prevent a flash of the login page on hard refresh.
 * 
 * If not authenticated, redirects to /auth with the current path as ?redirect=
 * so the user returns where they were after logging in.
 */
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
    const { isAuthenticated, isLoading } = useAuth();
    const location = useLocation();

    // Firebase is still resolving auth state — don't flash anything
    if (isLoading) {
        return null;
    }

    if (!isAuthenticated) {
        // Encode current path so AuthPage can redirect back after login
        const redirectPath = location.pathname + location.search;
        return <Navigate to={`/auth?redirect=${encodeURIComponent(redirectPath)}`} replace />;
    }

    return <>{children}</>;
}
