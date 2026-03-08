/**
 * Trailer Modal Component
 * 
 * Opens YouTube trailer in system's default browser
 * Uses Tauri's shell plugin for system browser
 */

import { useEffect } from 'react';
import { open } from '@tauri-apps/plugin-shell';
import './TrailerModal.css';

interface TrailerModalProps {
    youtubeKey: string;
    title: string;
    onClose: () => void;
}

export function TrailerModal({ youtubeKey, onClose }: TrailerModalProps) {
    // Open in system browser immediately
    useEffect(() => {
        const youtubeUrl = `https://www.youtube.com/watch?v=${youtubeKey}`;

        // Use Tauri's shell plugin to open in system browser
        open(youtubeUrl).catch(() => {
            // Fallback
            window.open(youtubeUrl, '_blank');
        });

        // Close modal immediately
        onClose();
    }, [youtubeKey, onClose]);

    // Brief loading state while opening browser
    return (
        <div className="trailer-modal-backdrop">
            <div className="trailer-modal-loading">
                <p>Opening trailer in your browser...</p>
            </div>
        </div>
    );
}
