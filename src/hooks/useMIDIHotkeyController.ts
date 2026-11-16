import { useCallback, useEffect, useRef } from 'react';
import { NoteEvent } from '../types/music';

export interface HotkeyDefinition {
  id: 'restart' | 'stop';
  label: string;
  /** Required MIDI note numbers pressed simultaneously */
  notes: number[];
}

export const DEFAULT_MIDI_HOTKEYS: HotkeyDefinition[] = [
  {
    id: 'restart',
    label: 'Restart (A0 + B0 + C1)',
    notes: [21, 23, 24],
  },
  {
    id: 'stop',
    label: 'Stop / Wait Mode (A7 + B7 + C8)',
    notes: [105, 107, 108],
  },
];

/** Maximum millisecond stagger allowed between fingers when pressing a hotkey chord */
const CHORD_FINGER_STAGGER_MS = 350;
/** Lookahead buffer (ms) to prevent leading chord fingers from leaking into ScoringEngine */
const CHORD_DISAMBIGUATION_BUFFER_MS = 90;

interface UseMIDIHotkeyControllerOptions {
  hotkeys?: HotkeyDefinition[];
  onRestart: () => void;
  onStop: () => void;
  /** Downstream handler that receives non-hotkey musical note events */
  onMusicalNoteEvent: (event: NoteEvent) => void;
}

/**
 * Anson Practice Piano — MIDIHotkeyController (Deliverable 3)
 *
 * Maintains a real-time Map of currently pressed MIDI keys (`midi -> timestamp`),
 * detects simultaneous hardware hotkey chords with millisecond finger-stagger tolerance,
 * fires app control callbacks, and swallows hotkey events so the Scoring Engine ignores them.
 */
export function useMIDIHotkeyController({
  hotkeys = DEFAULT_MIDI_HOTKEYS,
  onRestart,
  onStop,
  onMusicalNoteEvent,
}: UseMIDIHotkeyControllerOptions) {
  // Currently held MIDI keys: midi -> noteOn timestamp
  const pressedKeysRef = useRef<Map<number, number>>(new Map());
  // Prevents re-firing a hotkey while keys remain held down
  const activeTriggeredIdsRef = useRef<Set<string>>(new Set());
  // Buffers candidate hotkey-prefix noteOn events briefly so leading fingers never leak as Wrong Notes
  const bufferedEventsRef = useRef<Map<number, { event: NoteEvent; timerId: number }>>(new Map());

  const onRestartRef = useRef(onRestart);
  onRestartRef.current = onRestart;

  const onStopRef = useRef(onStop);
  onStopRef.current = onStop;

  const onMusicalNoteEventRef = useRef(onMusicalNoteEvent);
  onMusicalNoteEventRef.current = onMusicalNoteEvent;

  // Precompute all MIDI pitches participating in any hotkey chord
  const candidateNotesSet = new Set<number>(hotkeys.flatMap((hk) => hk.notes));

  const clearPendingBuffersForNotes = useCallback((notes: number[]) => {
    for (const n of notes) {
      const pending = bufferedEventsRef.current.get(n);
      if (pending) {
        window.clearTimeout(pending.timerId);
        bufferedEventsRef.current.delete(n);
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      for (const entry of bufferedEventsRef.current.values()) {
        window.clearTimeout(entry.timerId);
      }
      bufferedEventsRef.current.clear();
    };
  }, []);

  /**
   * Evaluates whether a registered hotkey chord is currently held simultaneously
   * within the allowed finger-stagger window (`CHORD_FINGER_STAGGER_MS`).
   */
  const detectTriggeredHotkey = useCallback((): HotkeyDefinition | null => {
    const pressed = pressedKeysRef.current;

    for (const hk of hotkeys) {
      const timestamps: number[] = [];
      let allHeld = true;

      for (const note of hk.notes) {
        const ts = pressed.get(note);
        if (ts === undefined) {
          allHeld = false;
          break;
        }
        timestamps.push(ts);
      }

      if (!allHeld) continue;

      const minTs = Math.min(...timestamps);
      const maxTs = Math.max(...timestamps);

      // Ensure all fingers struck within the simultaneous chord window
      if (maxTs - minTs <= CHORD_FINGER_STAGGER_MS) {
        return hk;
      }
    }

    return null;
  }, [hotkeys]);

  /**
   * Intercepts unified NoteEvents BEFORE they reach the Scoring Engine.
   * Returns `true` if swallowed by a hotkey chord, or forwards to `onMusicalNoteEvent`.
   */
  const processNoteEventWithHotkeys = useCallback(
    (event: NoteEvent) => {
      if (event.type === 'noteOff') {
        pressedKeysRef.current.delete(event.midi);

        // Release chord latch once any key of that chord is lifted
        for (const hk of hotkeys) {
          if (hk.notes.includes(event.midi)) {
            activeTriggeredIdsRef.current.delete(hk.id);
          }
        }

        // Flush any buffered noteOn if user released before completing chord
        const pending = bufferedEventsRef.current.get(event.midi);
        if (pending) {
          window.clearTimeout(pending.timerId);
          bufferedEventsRef.current.delete(event.midi);
          onMusicalNoteEventRef.current(pending.event);
        }

        onMusicalNoteEventRef.current(event);
        return;
      }

      // noteOn: track key in pressed set
      pressedKeysRef.current.set(event.midi, event.timestamp);

      // Check immediately if a full hotkey chord is now satisfied
      const matchedHotkey = detectTriggeredHotkey();
      if (matchedHotkey) {
        clearPendingBuffersForNotes(matchedHotkey.notes);

        if (!activeTriggeredIdsRef.current.has(matchedHotkey.id)) {
          activeTriggeredIdsRef.current.add(matchedHotkey.id);
          console.info(`[Anson Practice Piano] MIDI Hotkey triggered -> ${matchedHotkey.label}`);

          if (matchedHotkey.id === 'restart') {
            onRestartRef.current();
          } else if (matchedHotkey.id === 'stop') {
            onStopRef.current();
          }
        }
        // Swallow event: never forward hotkey chord presses to ScoringEngine
        return;
      }

      // If this pitch is part of a hotkey chord, hold briefly (90ms) in case remaining fingers are on the way
      if (candidateNotesSet.has(event.midi)) {
        const existing = bufferedEventsRef.current.get(event.midi);
        if (existing) window.clearTimeout(existing.timerId);

        const timerId = window.setTimeout(() => {
          bufferedEventsRef.current.delete(event.midi);
          // Only forward if no hotkey latched in the meantime
          if (activeTriggeredIdsRef.current.size === 0) {
            onMusicalNoteEventRef.current(event);
          }
        }, CHORD_DISAMBIGUATION_BUFFER_MS);

        bufferedEventsRef.current.set(event.midi, { event, timerId });
        return;
      }

      // Normal musical note: forward immediately with 0ms latency
      onMusicalNoteEventRef.current(event);
    },
    [candidateNotesSet, clearPendingBuffersForNotes, detectTriggeredHotkey, hotkeys]
  );

  /**
   * Direct programmatic trigger helper (e.g., for testing hotkeys or toolbar shortcuts).
   */
  const triggerHotkeyAction = useCallback((id: 'restart' | 'stop') => {
    if (id === 'restart') {
      onRestartRef.current();
    } else {
      onStopRef.current();
    }
  }, []);

  return {
    processNoteEventWithHotkeys,
    triggerHotkeyAction,
  };
}
