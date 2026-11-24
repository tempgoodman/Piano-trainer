import { useCallback, useEffect, useRef } from 'react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { audioEngine } from '../audio/AudioEngine';
import { buildComputerTimeline, PlaybackScheduler } from '../engines/PlaybackScheduler';
import { usePracticeStore } from '../store/usePracticeStore';
import { PlaybackMode } from '../types/music';
import { resetAllOSMDNoteColors } from '../utils/osmdColoring';
import { jumpCursorToMeasure, syncSheetGuideVisibility } from './usePracticeMode';

interface UsePlaybackEngineOptions {
  osmdRef: React.MutableRefObject<OpenSheetMusicDisplay | null>;
  onResetPractice: () => void;
}

/**
 * React controller around `PlaybackScheduler` supporting:
 * - Play by Computer (Auto-Play)
 * - Play Recorded (User's captured MIDI/Virtual performance)
 * - Compare Mode (Dual OSMD Cursors + Dual-Color Virtual Keyboard)
 */
export function usePlaybackEngine({ osmdRef, onResetPractice }: UsePlaybackEngineOptions) {
  const schedulerRef = useRef<PlaybackScheduler | null>(null);
  const primaryCursorIndexRef = useRef<number>(0);
  const ghostCursorIndexRef = useRef<number>(0);

  const stopPlayback = useCallback(() => {
    schedulerRef.current?.stop();
    audioEngine.stopAllNotes();
    const osmd = osmdRef.current;

    if (osmd) {
      if (osmd.cursors?.[0]) {
        osmd.cursors[0].CursorOptions.color = '#0284C7';
        osmd.cursors[0].show();
      }
      if (osmd.cursors?.[1]) {
        osmd.cursors[1].hide();
      }
    }

    const active = Array.from(usePracticeStore.getState().activeNotes);
    active.forEach((m) => usePracticeStore.getState().releaseKey(m));

    usePracticeStore.getState().stopPlaybackState();
    onResetPractice();
  }, [osmdRef, onResetPractice]);

  const startPlayback = useCallback(
    (mode: Exclude<PlaybackMode, 'none'>) => {
      const osmd = osmdRef.current;
      const state = usePracticeStore.getState();

      if (!osmd?.cursor || !state.isAudioReady) return;
      if ((mode === 'recorded' || mode === 'compare') && !state.recordedTrack) {
        console.warn('[Anson Practice Piano] No recorded track available yet.');
        return;
      }

      schedulerRef.current?.stop();
      resetAllOSMDNoteColors(osmd);

      const startMeasure = state.loopRange.enabled ? state.loopRange.startMeasure : 1;
      const timeline = buildComputerTimeline(osmd, state.bpm, state.handMode, state.loopRange);

      const greenCursor = osmd.cursors?.[0] ?? osmd.cursor;
      const ghostCursor = osmd.cursors?.[1];

      greenCursor.CursorOptions.color = mode === 'computer' ? '#0284C7' : '#059669';
      if (startMeasure > 1) {
        jumpCursorToMeasure(osmd, startMeasure);
      } else {
        greenCursor.reset();
      }
      greenCursor.show();
      syncSheetGuideVisibility(osmd, true);
      primaryCursorIndexRef.current = 0;

      if (ghostCursor) {
        if (mode === 'compare') {
          ghostCursor.CursorOptions.color = '#2563EB';
          ghostCursor.reset();
          if (startMeasure > 1) {
            let safety = 0;
            while (!ghostCursor.Iterator.EndReached && safety < 2000) {
              if ((ghostCursor.Iterator.CurrentMeasureIndex ?? 0) + 1 >= startMeasure) break;
              ghostCursor.next();
              safety++;
            }
          }
          ghostCursor.show();
        } else {
          ghostCursor.hide();
        }
      }
      ghostCursorIndexRef.current = 0;

      state.startPlaybackState(mode);

      const scheduler = new PlaybackScheduler({
        onComputerStep: (step) => {
          const store = usePracticeStore.getState();
          while (primaryCursorIndexRef.current < step.stepIndex) {
            greenCursor.next();
            primaryCursorIndexRef.current++;
          }
          greenCursor.show();
          store.setCurrentMeasure(step.measureNumber);
          store.setExpectedNotes(step.notes);

          if (mode === 'compare') {
            store.setCompareExpectedNotes(new Set(step.notes.map((n) => n.midi)));
          }
        },

        onComputerNote: (packet) => {
          const store = usePracticeStore.getState();
          const shouldHear = mode === 'computer' || (mode === 'compare' && store.hearComputerInCompare);

          if (packet.type === 'noteOn') {
            if (shouldHear) audioEngine.playPianoNote(packet.midi, packet.velocity);
            if (mode === 'computer') store.pressKey(packet.midi);
          } else {
            if (shouldHear) audioEngine.stopPianoNote(packet.midi);
            if (mode === 'computer') store.releaseKey(packet.midi);
          }
        },

        onRecordedNote: (ev, expectedStep, isCorrectPitch, timingDeltaMs) => {
          const store = usePracticeStore.getState();

          if (ev.type === 'noteOn') {
            audioEngine.playPianoNote(ev.midi, ev.velocity);

            if (mode === 'recorded') {
              store.pressKey(ev.midi);
              if (expectedStep) {
                store.setCurrentMeasure(expectedStep.measureNumber);
              }
            } else if (mode === 'compare') {
              store.setCompareRecordedKey(ev.midi, isCorrectPitch ? 'correct' : 'wrong');
              if (timingDeltaMs !== null) {
                store.setCompareTimingDeltaMs(timingDeltaMs);
              }
            }
          } else {
            audioEngine.stopPianoNote(ev.midi);
            if (mode === 'recorded') {
              store.releaseKey(ev.midi);
            } else if (mode === 'compare') {
              store.setCompareRecordedKey(ev.midi, null);
            }
          }
        },

        onGhostCursorMoveTo: (targetStepIdx) => {
          if (mode === 'compare' && ghostCursor) {
            while (ghostCursorIndexRef.current < targetStepIdx) {
              ghostCursor.next();
              ghostCursorIndexRef.current++;
            }
            ghostCursor.show();
          } else if (mode === 'recorded') {
            while (primaryCursorIndexRef.current < targetStepIdx) {
              greenCursor.next();
              primaryCursorIndexRef.current++;
            }
            greenCursor.show();
          }
        },

        onComplete: () => {
          stopPlayback();
        },
      });

      schedulerRef.current = scheduler;
      scheduler.start(mode, timeline, state.recordedTrack);
    },
    [osmdRef, stopPlayback]
  );

  useEffect(() => {
    return () => {
      schedulerRef.current?.stop();
    };
  }, []);

  return {
    startPlayback,
    stopPlayback,
  };
}
