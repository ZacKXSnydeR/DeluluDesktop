export function mapFirebaseAuthError(code?: string): string {
    switch (code) {
        case 'auth/user-not-found':
            return 'No account found with this email.';
        case 'auth/wrong-password':
        case 'auth/invalid-credential':
            return 'Email or password is incorrect.';
        case 'auth/email-already-in-use':
            return 'An account with this email already exists.';
        case 'auth/invalid-email':
            return 'Please enter a valid email address.';
        case 'auth/too-many-requests':
            return 'Too many attempts. Please wait a few minutes and try again.';
        case 'auth/network-request-failed':
            return 'Network issue detected. Check your internet and try again.';
        case 'auth/popup-closed-by-user':
            return 'Google sign-in popup was closed before completion.';
        case 'auth/popup-blocked':
            return 'Popup was blocked. Please allow popups and try again.';
        case 'auth/cancelled-popup-request':
            return 'Another sign-in request is already running. Please retry.';
        default:
            return 'Authentication failed. Please try again.';
    }
}
