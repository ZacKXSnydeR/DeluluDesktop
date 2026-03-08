import { initializeApp } from 'firebase/app';
import {
    getAuth,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    sendPasswordResetEmail,
    type UserCredential,
} from 'firebase/auth';

// Firebase configuration from environment variables
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Email/Password Sign In
export async function signInWithEmail(email: string, password: string): Promise<UserCredential> {
    try {
        const result = await signInWithEmailAndPassword(auth, email, password);
        return result;
    } catch (error) {
        console.error('Error signing in with email:', error);
        throw error;
    }
}

export async function signUpWithEmail(email: string, password: string): Promise<UserCredential> {
    try {
        console.log('[Auth] Attempting to create user...');
        const result = await createUserWithEmailAndPassword(auth, email, password);
        console.log('[Auth] User created successfully:', result.user.uid);
        return result;
    } catch (error) {
        console.error('[Auth] Error in signUpWithEmail flow:', error);
        throw error;
    }
}

// Password Reset
export async function resetPassword(email: string): Promise<void> {
    await sendPasswordResetEmail(auth, email);
}

// Sign Out
export async function signOut(): Promise<void> {
    await auth.signOut();
}

export default app;
