import { useCallback, useEffect, useRef } from 'react';
import { usePracticeStore } from '../store/usePracticeStore';
import { NoteEvent, RecordedMidiEvent, RecordedTrack } from '../types/music';

/**
 * Anson Practice Piano — Recording Engine Hook (Deliverable 1)
 *
 * Silently captures all incoming user MIDI / Virtual Keyboard events (`noteOn`, `noteOff`, `velocity`)
 * with exact relative timestamps anchored at the first struck `noteOn` (0ms).
 * Ignores synthetic playback events so recordings always reflect pure user performance.
 */
export function useRecordingEngine() {
  const startTimestampRef = useRef<number | null>(null);
  const bufferRef = useRef<RecordedMidiEvent[]>([]);

  const activeScoreId = usePracticeStore((s) => s.activeScore.id);
  const isRecording = usePracticeStore((s) => s.isRecording);
  const recordedTrack = usePracticeStore((s) => s.recordedTrack);
  const recordedEventCount = usePracticeStore((s) => s.recordedEventCount);

  useEffect(() => {
    startTimestampRef.current = null;
    bufferRef.current = [];
  }, [activeScoreId]);

  const commitTrack = useCallback(() => {
    const events = bufferRef.current;
    if (events.length === 0) return null;

    const state = usePracticeStore.getState();
    const lastEvent = events[events.length - 1];

    const track: RecordedTrack = {
      id: `rec-${Date.now()}`,
      scoreId: state.activeScore.id,
      scoreTitle: state.activeScore.title,
      bpm: state.bpm,
      recordedAt: new Date().toISOString(),
      durationMs: Math.max(0, lastEvent.relativeTimeMs),
      events: [...events],
    };

    state.setRecordedTrack(track);
    return track;
  }, []);

  /**
   * Captures a single NoteEvent silently when recording is armed and playback is not running.
   */
  const captureNoteEvent = useCallback(
    (event: NoteEvent) => {
      const state = usePracticeStore.getState();
      if (!state.isRecording || state.isPlaybackRunning) return;

      // Ignore stray noteOff events before the first noteOn anchors t = 0ms
      if (startTimestampRef.current === null) {
        if (event.type !== 'noteOn') return;
        startTimestampRef.current = event.timestamp;
        console.info('[Anson Practice Piano] Recording Engine anchored t=0ms on first noteOn');
      }

      const relativeTimeMs = Math.max(
        0,
        Math.round((event.timestamp - startTimestampRef.current) * 10) / 10
      );

      bufferRef.current.push({
        midi: event.midi,
        noteName: event.noteName,
        type: event.type,
        velocity: event.velocity,
        relativeTimeMs,
      });

      state.setRecordedEventCount(bufferRef.current.length);

      // Update saved RecordedTrack snapshot after note releases or every few notes so UI stays fresh
      if (event.type === 'noteOff' || bufferRef.current.length % 4 === 1) {
        commitTrack();
      }
    },
    [commitTrack]
  );

  const clearRecording = useCallback(() => {
    startTimestampRef.current = null;
    bufferRef.current = [];
    const state = usePracticeStore.getState();
    state.setRecordedEventCount(0);
    state.setRecordedTrack(null);
    console.info('[Anson Practice Piano] Recorded track cleared.');
  }, []);

  const toggleRecording = useCallback(() => {
    const state = usePracticeStore.getState();
    const next = !state.isRecording;
    state.setIsRecording(next);
    if (!next) {
      commitTrack();
    }
  }, [commitTrack]);

  return {
    isRecording,
    recordedTrack,
    recordedEventCount,
    captureNoteEvent,
    commitTrack,
    clearRecording,
    toggleRecording,
  };
}
