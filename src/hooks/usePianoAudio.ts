import { useCallback, useEffect } from 'react';
import { audioEngine } from '../audio/AudioEngine';
import { usePracticeStore } from '../store/usePracticeStore';

/**
 * Deliverable 1: `usePianoAudio` React Hook
 * Initializes the `smplr` sample-based Acoustic Grand Piano engine,
 * streams loading progress into global state (`isAudioLoading`, `audioLoadProgress`, `isAudioReady`),
 * and exposes clean `playPianoNote` / `stopPianoNote` / `setSustainPedal` wrappers.
 */
export function usePianoAudio() {
  const isAudioLoading = usePracticeStore((s) => s.isAudioLoading);
  const audioLoadProgress = usePracticeStore((s) => s.audioLoadProgress);
  const isAudioReady = usePracticeStore((s) => s.isAudioReady);
  const audioError = usePracticeStore((s) => s.audioError);
  const audioEngineLabel = usePracticeStore((s) => s.audioEngineLabel);
  const setAudioLoadingState = usePracticeStore((s) => s.setAudioLoadingState);

  const loadSamples = useCallback(async () => {
    if (audioEngine.getIsLoaded()) {
      setAudioLoadingState({
        isAudioLoading: false,
        audioLoadProgress: 100,
        isAudioReady: true,
        audioError: null,
        audioEngineLabel: audioEngine.getEngineLabel(),
      });
      return;
    }

    setAudioLoadingState({
      isAudioLoading: true,
      audioLoadProgress: Math.max(5, audioEngine.getLoadProgress()),
      isAudioReady: false,
      audioError: null,
      audioEngineLabel: audioEngine.getEngineLabel(),
    });

    try {
      const activeLabel = await audioEngine.loadPianoSamples({
        onProgress: (progressPercent, engineLabel) => {
          setAudioLoadingState({
            isAudioLoading: progressPercent < 100,
            audioLoadProgress: progressPercent,
            isAudioReady: progressPercent >= 100,
            audioError: null,
            audioEngineLabel: engineLabel,
          });
        },
      });

      setAudioLoadingState({
        isAudioLoading: false,
        audioLoadProgress: 100,
        isAudioReady: true,
        audioError: null,
        audioEngineLabel: activeLabel,
      });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Failed to load Acoustic Grand Piano samples.';
      setAudioLoadingState({
        isAudioLoading: false,
        audioLoadProgress: 0,
        isAudioReady: false,
        audioError: msg,
      });
    }
  }, [setAudioLoadingState]);

  useEffect(() => {
    void loadSamples();
  }, [loadSamples]);

  const playPianoNote = useCallback((pitch: number, velocity = 96) => {
    if (!usePracticeStore.getState().isAudioReady) return;
    audioEngine.playPianoNote(pitch, velocity);
  }, []);

  const stopPianoNote = useCallback((pitch: number) => {
    audioEngine.stopPianoNote(pitch);
  }, []);

  const setSustainPedal = useCallback((isDown: boolean) => {
    audioEngine.setSustainPedal(isDown);
  }, []);

  const stopAllNotes = useCallback(() => {
    audioEngine.stopAllNotes();
  }, []);

  return {
    isAudioLoading,
    audioLoadProgress,
    isAudioReady,
    audioError,
    audioEngineLabel,
    playPianoNote,
    stopPianoNote,
    setSustainPedal,
    stopAllNotes,
    retryLoad: loadSamples,
  };
}
