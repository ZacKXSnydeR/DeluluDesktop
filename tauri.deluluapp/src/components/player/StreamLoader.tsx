/**
 * Premium Stream Loader
 * 
 * Apple-style loading experience with:
 * - Rotating subtitle messages (no tech terms)
 * - Gradient ring spinner (calm animation)
 * - Phase-based progress illusion
 * - Blurred movie poster background
 * - Cinematic transition to playback
 */

import { useEffect, useState } from 'react';
import './StreamLoader.css';

interface StreamLoaderProps {
    posterUrl?: string;
    title?: string;
    onCancel?: () => void;
}

// Rotating subtitle messages - no tech terms
const SUBTITLE_MESSAGES = [
    "Optimizing playback for best quality…",
    "Securing the video source…",
    "Verifying stream integrity…",
    "Optimizing for smooth playback…",
    "Almost ready…",
    "Preparing your experience…",
    "Enhancing stream quality…",
    "Just a moment…",
];

// Phase stages for visual progress
const PHASES = [
    { label: "Locating source", progress: 15 },
    { label: "Unlocking stream", progress: 35 },
    { label: "Optimizing quality", progress: 60 },
    { label: "Finalizing playback", progress: 85 },
    { label: "Almost there", progress: 95 },
];

export function StreamLoader({ posterUrl, title, onCancel }: StreamLoaderProps) {
    const [subtitleIndex, setSubtitleIndex] = useState(0);
    const [phaseIndex, setPhaseIndex] = useState(0);
    const [isSubtitleVisible, setIsSubtitleVisible] = useState(true);

    // Rotate subtitles every 1.5s with fade animation
    useEffect(() => {
        const interval = setInterval(() => {
            setIsSubtitleVisible(false);

            setTimeout(() => {
                setSubtitleIndex((prev) => (prev + 1) % SUBTITLE_MESSAGES.length);
                setIsSubtitleVisible(true);
            }, 300);
        }, 1500);

        return () => clearInterval(interval);
    }, []);

    // Progress through phases every 2s
    useEffect(() => {
        const interval = setInterval(() => {
            setPhaseIndex((prev) => {
                if (prev < PHASES.length - 1) return prev + 1;
                return prev; // Stay at last phase
            });
        }, 2000);

        return () => clearInterval(interval);
    }, []);

    const currentPhase = PHASES[phaseIndex];

    return (
        <div className="stream-loader">
            {/* Blurred poster background */}
            {posterUrl && (
                <div
                    className="stream-loader-bg"
                    style={{ backgroundImage: `url(${posterUrl})` }}
                />
            )}

            {/* Film grain overlay */}
            <div className="stream-loader-grain" />

            {/* Vignette overlay */}
            <div className="stream-loader-vignette" />

            {/* Content */}
            <div className="stream-loader-content">
                {/* Gradient ring spinner */}
                <div className="stream-loader-ring">
                    <svg viewBox="0 0 100 100" className="stream-loader-svg">
                        {/* Background ring */}
                        <circle
                            cx="50"
                            cy="50"
                            r="42"
                            fill="none"
                            stroke="rgba(255, 255, 255, 0.08)"
                            strokeWidth="4"
                        />
                        {/* Progress ring with gradient */}
                        <circle
                            cx="50"
                            cy="50"
                            r="42"
                            fill="none"
                            stroke="url(#gradient)"
                            strokeWidth="4"
                            strokeLinecap="round"
                            strokeDasharray="264"
                            strokeDashoffset={264 - (264 * currentPhase.progress) / 100}
                            className="stream-loader-progress"
                        />
                        {/* Gradient definition */}
                        <defs>
                            <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                <stop offset="0%" stopColor="#6366f1" />
                                <stop offset="50%" stopColor="#a855f7" />
                                <stop offset="100%" stopColor="#ec4899" />
                            </linearGradient>
                        </defs>
                    </svg>

                    {/* Inner glow pulse */}
                    <div className="stream-loader-glow" />
                </div>

                {/* Primary text - confident */}
                <h2 className="stream-loader-title">
                    Preparing your stream
                </h2>

                {/* Secondary text - rotating with fade */}
                <p className={`stream-loader-subtitle ${isSubtitleVisible ? 'visible' : ''}`}>
                    {SUBTITLE_MESSAGES[subtitleIndex]}
                </p>

                {/* Phase indicator (subtle) */}
                <div className="stream-loader-phases">
                    {PHASES.map((phase, index) => (
                        <div
                            key={phase.label}
                            className={`stream-loader-phase-dot ${index <= phaseIndex ? 'active' : ''}`}
                        />
                    ))}
                </div>

                {/* Movie title (if available) */}
                {title && (
                    <p className="stream-loader-movie-title">{title}</p>
                )}

                {/* Cancel button - soft, secondary */}
                {onCancel && (
                    <button className="stream-loader-cancel" onClick={onCancel}>
                        Cancel
                    </button>
                )}
            </div>
        </div>
    );
}
