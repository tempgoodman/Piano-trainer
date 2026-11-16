import { useCallback, useEffect, useRef, useState } from 'react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { audioEngine } from '../audio/AudioEngine';
import { OmrUploadModal } from '../components/OmrUploadModal';
import { PracticeControls } from '../components/PracticeControls';
import { PracticeTutorModal } from '../components/PracticeTutorModal';
import { SheetMusicViewer } from '../components/SheetMusicViewer';
import { TopBar } from '../components/TopBar';
import { VirtualPiano } from '../components/VirtualPiano';
import { useMIDIHotkeyController } from '../hooks/useMIDIHotkeyController';
import { usePianoAudio } from '../hooks/usePianoAudio';
import { usePlaybackEngine } from '../hooks/usePlaybackEngine';
import { usePracticeMode } from '../hooks/usePracticeMode';
import { useRecordingEngine } from '../hooks/useRecordingEngine';
import { useUnifiedNoteInput } from '../hooks/useUnifiedNoteInput';
import { usePracticeStore } from '../store/usePracticeStore';
import { NoteEvent } from '../types/music';

/**
 * Isolated Practice Player Page (`/`)
 * Preserves Wait Mode, Tempo Mode, Recording, Playback, Compare Mode, Web MIDI, and Virtual Keyboard
 * completely decoupled from the standalone SheetMusicEditorPage.
 */
export function PracticePlayerPage() {
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [tutorOpen, setTutorOpen] = useState(false);

  // 0. Sample-based Acoustic Grand Piano Engine (smplr SplendidGrandPiano + Gleitz fallback)
  const { playPianoNote, stopPianoNote, setSustainPedal, retryLoad } = usePianoAudio();

  const playbackMode = usePracticeStore((s) => s.playbackMode);
  const bpm = usePracticeStore((s) => s.bpm);
  const metronomeEnabled = usePracticeStore((s) => s.metronomeEnabled);
  const activeScore = usePracticeStore((s) => s.activeScore);
  const setActiveBeat = usePracticeStore((s) => s.setActiveBeat);

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

  // Route real user note events to both Silent Recorder & Practice/Scoring Engine
  const handleMusicalInput = useCallback(
    (event: NoteEvent) => {
      if (usePracticeStore.getState().isPlaybackRunning) return;
      captureNoteEvent(event);
      handleNoteEvent(event);
    },
    [captureNoteEvent, handleNoteEvent]
  );

  // 4. Hardware MIDI Hotkey Chord Interceptor (swallows Restart/Stop chords before Recorder & ScoringEngine)
  const { processNoteEventWithHotkeys } = useMIDIHotkeyController({
    onRestart: () => {
      if (usePracticeStore.getState().isPlaybackRunning) {
        stopPlayback();
      } else {
        resetToStart();
      }
    },
    onStop: () => {
      if (usePracticeStore.getState().isPlaybackRunning) {
        stopPlayback();
      }
      stopToWaitMode();
    },
    onMusicalNoteEvent: handleMusicalInput,
  });

  // 5. Unified Input Abstraction Layer (Web MIDI + Virtual Keyboard + QWERTY + Sampled Piano Audio)
  const { emitVirtualNote } = useUnifiedNoteInput({
    onNoteEvent: processNoteEventWithHotkeys,
    enableKeyboardShortcuts: !uploadOpen && !tutorOpen,
    playPianoNote,
    stopPianoNote,
    setSustainPedal,
  });

  // 6. Web Audio Metronome: plays continuously whenever enabled in Wait Mode, Tempo Mode (Armed or Playing), or Computer Auto-Play
  useEffect(() => {
    const beatsPerMeasure = Number(activeScore.timeSignature.split('/')[0]) || 4;
    audioEngine.configureMetronome(bpm, beatsPerMeasure);

    const shouldRunMetronome =
      metronomeEnabled && (playbackMode === 'none' || playbackMode === 'computer');

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
  }, [bpm, metronomeEnabled, playbackMode, activeScore.timeSignature, setActiveBeat]);

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
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-[#0F172A]">
      <TopBar onOpenUpload={() => setUploadOpen(true)} />

      <PracticeControls
        onReset={resetToStart}
        onStepNext={advanceCursor}
        onStartPlayback={startPlayback}
        onStopPlayback={stopPlayback}
        onToggleRecording={toggleRecording}
        onClearRecording={clearRecording}
        onOpenTutor={() => setTutorOpen(true)}
      />

      <main className="flex-1 flex flex-col justify-between">
        <SheetMusicViewer
          osmdRef={osmdRef}
          onScoreReady={syncCursorTargets}
          onReset={resetToStart}
          onOpenTutor={() => setTutorOpen(true)}
        />

        <VirtualPiano
          onKeyDown={handleVirtualKeyDown}
          onKeyUp={handleVirtualKeyUp}
          onRetryAudio={retryLoad}
        />
      </main>

      <OmrUploadModal isOpen={uploadOpen} onClose={() => setUploadOpen(false)} />
      <PracticeTutorModal
        isOpen={tutorOpen}
        onClose={() => setTutorOpen(false)}
        onResetCursorToSelection={resetToStart}
      />
    </div>
  );
}
