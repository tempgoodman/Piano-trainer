import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Eye, Keyboard, Loader2, RefreshCw } from 'lucide-react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { audioEngine } from '../audio/AudioEngine';
import { HotkeySettingsModal } from '../components/HotkeySettingsModal';
import { OmrUploadModal } from '../components/OmrUploadModal';
import { PracticeControls } from '../components/PracticeControls';
import { PracticeTutorModal } from '../components/PracticeTutorModal';
import { SheetMusicViewer } from '../components/SheetMusicViewer';
import { TopBar } from '../components/TopBar';
import { VirtualPiano } from '../components/VirtualPiano';
import { useFirebase } from '../context/FirebaseProvider';
import { usePreferences } from '../context/PreferencesProvider';
import { useMIDIHotkeyController } from '../hooks/useMIDIHotkeyController';
import { usePianoAudio } from '../hooks/usePianoAudio';
import { usePlaybackEngine } from '../hooks/usePlaybackEngine';
import { usePracticeMode } from '../hooks/usePracticeMode';
import { useRecordingEngine } from '../hooks/useRecordingEngine';
import { useUnifiedNoteInput } from '../hooks/useUnifiedNoteInput';
import { usePracticeStore } from '../store/usePracticeStore';
import {
  formatKeyboardKey,
  formatMidiChord,
  toMidiHotkeyDefinitions,
} from '../types/hotkeys';
import { NoteEvent } from '../types/music';

/**
 * Isolated Practice Player Page (`/`)
 * Preserves Wait Mode, Tempo Mode, Recording, Playback, Compare Mode, Web MIDI, and Virtual Keyboard
 * completely decoupled from the standalone SheetMusicEditorPage.
 */
export function PracticePlayerPage() {
  const { user, authModalMode } = useFirebase();
  const { t } = usePreferences();
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [tutorOpen, setTutorOpen] = useState(false);
  const [hotkeyModalOpen, setHotkeyModalOpen] = useState(false);
  const midiCaptureHandlerRef = useRef<((midi: number) => void) | null>(null);

  useEffect(() => {
    if (!user && uploadOpen) {
      setUploadOpen(false);
    }
  }, [user, uploadOpen]);

  // 0. Sample-based Acoustic Grand Piano Engine (smplr SplendidGrandPiano + Gleitz fallback)
  const { playPianoNote, stopPianoNote, setSustainPedal, retryLoad } = usePianoAudio();

  const playbackMode = usePracticeStore((s) => s.playbackMode);
  const bpm = usePracticeStore((s) => s.bpm);
  const metronomeEnabled = usePracticeStore((s) => s.metronomeEnabled);
  const metronomeVolume = usePracticeStore((s) => s.metronomeVolume);
  const metronomeStyle = usePracticeStore((s) => s.metronomeStyle);
  const activeScore = usePracticeStore((s) => s.activeScore);
  const setActiveBeat = usePracticeStore((s) => s.setActiveBeat);
  const hotkeys = usePracticeStore((s) => s.hotkeys);
  const isCustomHotkeys = usePracticeStore((s) => s.isCustomHotkeys);
  const showVirtualPiano = usePracticeStore((s) => s.showVirtualPiano);
  const setShowVirtualPiano = usePracticeStore((s) => s.setShowVirtualPiano);
  const isStatsMode = usePracticeStore((s) => s.isStatsMode);
  const isAudioReady = usePracticeStore((s) => s.isAudioReady);
  const isAudioLoading = usePracticeStore((s) => s.isAudioLoading);
  const audioLoadProgress = usePracticeStore((s) => s.audioLoadProgress);
  const audioError = usePracticeStore((s) => s.audioError);

  const midiHotkeyDefs = useMemo(() => toMidiHotkeyDefinitions(hotkeys), [hotkeys]);

  // 1. Mutually Exclusive Wait / Tempo Mode + Smart Start + Auto-Reset + Scoring
  const {
    syncCursorTargets,
    advanceCursor,
    resetToStart,
    stopToWaitMode,
    handleNoteEvent,
  } = usePracticeMode(osmdRef);

  // 2. Silent Recording Engine (captures user noteOn/noteOff/velocity with relative timestamps)
  const { captureNoteEvent, clearRecording, toggleRecording } = useRecordingEngine();

  // 3. Dual-Mode Playback & Compare Mode Engine (Computer Auto-Play, Recorded, Compare Dual Cursor)
  const { startPlayback, stopPlayback } = usePlaybackEngine({
    osmdRef,
    onResetPractice: resetToStart,
  });

  const triggerRestartAction = useCallback(() => {
    const state = usePracticeStore.getState();
    if (state.isStatsMode) return;
    if (state.isPlaybackRunning) {
      stopPlayback();
    } else {
      resetToStart();
    }
  }, [resetToStart, stopPlayback]);

  const triggerStopAction = useCallback(() => {
    const state = usePracticeStore.getState();
    if (state.isStatsMode) return;
    if (state.isPlaybackRunning) {
      stopPlayback();
    }
    stopToWaitMode();
  }, [stopPlayback, stopToWaitMode]);

  // Route real user note events to both Silent Recorder & Practice/Scoring Engine
  const handleMusicalInput = useCallback(
    (event: NoteEvent) => {
      const state = usePracticeStore.getState();
      if (state.isPlaybackRunning || state.isStatsMode) return;
      captureNoteEvent(event);
      handleNoteEvent(event);
    },
    [captureNoteEvent, handleNoteEvent]
  );

  // 4. Hardware MIDI Hotkey Chord Interceptor (uses default hotkeys when logged out, custom when logged in)
  const { processNoteEventWithHotkeys } = useMIDIHotkeyController({
    hotkeys: midiHotkeyDefs,
    onRestart: triggerRestartAction,
    onStop: triggerStopAction,
    onMusicalNoteEvent: handleMusicalInput,
  });

  // Intercept note events when user is actively capturing a custom MIDI hotkey chord
  const handleIncomingNoteEvent = useCallback(
    (event: NoteEvent) => {
      if (hotkeyModalOpen && midiCaptureHandlerRef.current) {
        if (event.type === 'noteOn') {
          midiCaptureHandlerRef.current(event.midi);
        }
        return;
      }
      processNoteEventWithHotkeys(event);
    },
    [hotkeyModalOpen, processNoteEventWithHotkeys]
  );

  const registerMidiCapture = useCallback((handler: ((midi: number) => void) | null) => {
    midiCaptureHandlerRef.current = handler;
  }, []);

  // 5. Unified Input Abstraction Layer (Web MIDI + Virtual Keyboard + QWERTY + Sampled Piano Audio)
  const { emitVirtualNote } = useUnifiedNoteInput({
    onNoteEvent: handleIncomingNoteEvent,
    enableKeyboardShortcuts:
      !uploadOpen && !tutorOpen && !hotkeyModalOpen && authModalMode === null && !isStatsMode,
    playPianoNote,
    stopPianoNote,
    setSustainPedal,
  });

  // 5b. Computer Keyboard Action Hotkeys (Restart & Stop / Wait Mode)
  useEffect(() => {
    if (uploadOpen || tutorOpen || hotkeyModalOpen || authModalMode !== null || isStatsMode) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const pressed = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (pressed.toLowerCase() === hotkeys.restartKey.toLowerCase()) {
        e.preventDefault();
        triggerRestartAction();
      } else if (pressed.toLowerCase() === hotkeys.stopKey.toLowerCase()) {
        e.preventDefault();
        triggerStopAction();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    authModalMode,
    hotkeyModalOpen,
    hotkeys.restartKey,
    hotkeys.stopKey,
    isStatsMode,
    triggerRestartAction,
    triggerStopAction,
    tutorOpen,
    uploadOpen,
  ]);

  // 6a. Keep metronome volume & style synced live without resetting the beat clock
  useEffect(() => {
    audioEngine.setMetronomeVolume(metronomeVolume);
  }, [metronomeVolume]);

  useEffect(() => {
    audioEngine.setMetronomeStyle(metronomeStyle);
  }, [metronomeStyle]);

  // 6b. Web Audio Metronome: plays continuously whenever enabled in Wait Mode, Tempo Mode, or Computer Auto-Play (paused in Stats Mode)
  useEffect(() => {
    const beatsPerMeasure = Number(activeScore.timeSignature.split('/')[0]) || 4;
    audioEngine.configureMetronome(bpm, beatsPerMeasure);

    const shouldRunMetronome =
      !isStatsMode &&
      metronomeEnabled &&
      (playbackMode === 'none' || playbackMode === 'computer');

    if (shouldRunMetronome) {
      audioEngine.startMetronome((beatIndex) => {
        setActiveBeat(beatIndex);
      });
    } else {
      audioEngine.stopMetronome();
      setActiveBeat(null);
    }

    return () => {
      audioEngine.stopMetronome();
    };
  }, [bpm, isStatsMode, metronomeEnabled, playbackMode, activeScore.timeSignature, setActiveBeat]);

  const handleVirtualKeyDown = useCallback(
    (midi: number, velocity = 96) => {
      emitVirtualNote(midi, 'noteOn', velocity);
    },
    [emitVirtualNote]
  );

  const handleVirtualKeyUp = useCallback(
    (midi: number) => {
      emitVirtualNote(midi, 'noteOff', 0);
    },
    [emitVirtualNote]
  );

  return (
    <div className="min-h-dvh md:h-dvh flex flex-col md:overflow-hidden bg-[#F8FAFC] dark:bg-[#0B1120] text-[#0F172A] dark:text-slate-100 transition-colors">
      <TopBar onOpenUpload={() => setUploadOpen(true)} />

      <PracticeControls
        onReset={resetToStart}
        onStepNext={advanceCursor}
        onStartPlayback={startPlayback}
        onStopPlayback={stopPlayback}
        onToggleRecording={toggleRecording}
        onClearRecording={clearRecording}
        onOpenTutor={() => setTutorOpen(true)}
        onOpenHotkeys={() => setHotkeyModalOpen(true)}
      />

      <main className="flex-1 min-h-0 flex flex-col">
        <SheetMusicViewer
          osmdRef={osmdRef}
          onScoreReady={syncCursorTargets}
          onReset={resetToStart}
          onOpenTutor={() => setTutorOpen(true)}
        />

        {showVirtualPiano ? (
          <VirtualPiano
            onKeyDown={handleVirtualKeyDown}
            onKeyUp={handleVirtualKeyUp}
            onRetryAudio={retryLoad}
            onOpenHotkeys={() => setHotkeyModalOpen(true)}
          />
        ) : (
          <footer className="w-full shrink-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-2.5 transition-colors">
            <div className="w-full flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-slate-300">
                <span className="font-mono-tabular">
                  <span className="font-sans font-medium text-slate-500 dark:text-slate-400">
                    {t('piano.hotkeysLabel')}
                  </span>{' '}
                  {t('piano.restartLabel')} {formatMidiChord(hotkeys.restartMidiNotes)} ({formatKeyboardKey(hotkeys.restartKey)})
                  <span aria-hidden="true" className="mx-1.5 text-slate-300 dark:text-slate-700">·</span>
                  {t('piano.stopLabel')} {formatMidiChord(hotkeys.stopMidiNotes)} ({formatKeyboardKey(hotkeys.stopKey)})
                </span>
                {!isAudioReady && (
                  <>
                    <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
                    {audioError ? (
                      <button
                        type="button"
                        onClick={retryLoad}
                        className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 hover:text-red-700 font-semibold"
                      >
                        <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{t('piano.retryAudio')}</span>
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                        <Loader2 className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 animate-spin" aria-hidden="true" />
                        <span>
                          {isAudioLoading
                            ? t('nav.pianoLoading', { progress: audioLoadProgress })
                            : t('piano.preparingAudio')}
                        </span>
                      </span>
                    )}
                  </>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setHotkeyModalOpen(true)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                    isCustomHotkeys
                      ? 'bg-sky-50 dark:bg-sky-950/50 text-sky-800 dark:text-sky-300 border-sky-200 dark:border-sky-800 hover:bg-sky-100'
                      : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                  }`}
                >
                  <Keyboard className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>
                    {isCustomHotkeys ? t('controls.hotkeysCustom') : t('controls.hotkeys')}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowVirtualPiano(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/50 border border-sky-200 dark:border-sky-800 hover:bg-sky-100 dark:hover:bg-sky-900/60 rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{t('piano.showVirtualPiano')}</span>
                </button>
              </div>
            </div>
          </footer>
        )}
      </main>

      <OmrUploadModal isOpen={uploadOpen} onClose={() => setUploadOpen(false)} />
      <PracticeTutorModal
        isOpen={tutorOpen}
        onClose={() => setTutorOpen(false)}
        onResetCursorToSelection={resetToStart}
      />
      <HotkeySettingsModal
        isOpen={hotkeyModalOpen}
        onClose={() => setHotkeyModalOpen(false)}
        onRegisterMidiCapture={registerMidiCapture}
      />
    </div>
  );
}
