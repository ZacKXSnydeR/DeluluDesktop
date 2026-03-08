import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import type { VidLinkStreamResult } from '../services/vidlink';

interface MiniPlayerSource {
    mediaType: 'movie' | 'tv';
    tmdbId: number;
    season?: number;
    episode?: number;
    posterPath?: string;
    genre?: string;
}

interface MiniPlayerState {
    isActive: boolean;
    streamUrl: string | null;
    title: string | null;
    hash: string | null;
    fileIndex: number;
    currentTime: number;
    source: MiniPlayerSource | null;
    streamData: Pick<VidLinkStreamResult, 'headers' | 'subtitles'> | null;
}

interface ActivateMiniPlayerPayload {
    url: string;
    title: string;
    hash: string;
    fileIndex: number;
    currentTime: number;
    source: MiniPlayerSource;
    streamData?: Pick<VidLinkStreamResult, 'headers' | 'subtitles'>;
}

interface MiniPlayerContextType {
    miniPlayer: MiniPlayerState;
    activateMiniPlayer: (payload: ActivateMiniPlayerPayload) => void;
    deactivateMiniPlayer: () => void;
    updateCurrentTime: (time: number) => void;
}

const MiniPlayerContext = createContext<MiniPlayerContextType | null>(null);

export function MiniPlayerProvider({ children }: { children: ReactNode }) {
    const [miniPlayer, setMiniPlayer] = useState<MiniPlayerState>({
        isActive: false,
        streamUrl: null,
        title: null,
        hash: null,
        fileIndex: 0,
        currentTime: 0,
        source: null,
        streamData: null,
    });

    const activateMiniPlayer = (payload: ActivateMiniPlayerPayload) => {
        setMiniPlayer({
            isActive: true,
            streamUrl: payload.url,
            title: payload.title,
            hash: payload.hash,
            fileIndex: payload.fileIndex,
            currentTime: payload.currentTime,
            source: payload.source,
            streamData: payload.streamData || null,
        });
    };

    const deactivateMiniPlayer = () => {
        setMiniPlayer({
            isActive: false,
            streamUrl: null,
            title: null,
            hash: null,
            fileIndex: 0,
            currentTime: 0,
            source: null,
            streamData: null,
        });
    };

    const updateCurrentTime = (time: number) => {
        setMiniPlayer((prev) => ({ ...prev, currentTime: time }));
    };

    return (
        <MiniPlayerContext.Provider
            value={{ miniPlayer, activateMiniPlayer, deactivateMiniPlayer, updateCurrentTime }}
        >
            {children}
        </MiniPlayerContext.Provider>
    );
}

export function useMiniPlayer() {
    const context = useContext(MiniPlayerContext);
    if (!context) {
        throw new Error('useMiniPlayer must be used within MiniPlayerProvider');
    }
    return context;
}
