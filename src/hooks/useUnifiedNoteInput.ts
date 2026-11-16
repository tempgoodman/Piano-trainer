import { useCallback, useEffect, useRef } from 'react';
import { audioEngine } from '../audio/AudioEngine';
import { usePracticeStore } from '../store/usePracticeStore';
import { InputSource, MidiDeviceInfo, midiToNoteName, NoteEvent } from '../types/music';

/**
 * QWERTY-to-MIDI mapping for effortless desktop keyboard testing (Middle C4 = 60 to E5 = 76).
 */
const COMPUTER_KEY_TO_MIDI: Record<string, number> = {
  a: 60, // C4
  w: 61, // C#4
  s: 62, // D4
  e: 63, // D#4
  d: 64, // E4
  f: 65, // F4
  t: 66, // F#4
  g: 67, // G4
  y: 68, // G#4
  h: 69, // A4
  u: 70, // A#4
  j: 71, // B4
  k: 72, // C5
  o: 73, // C#5
  l: 74, // D5
  p: 75, // D#5
  ';': 76, // E5
};

interface UseUnifiedNoteInputOptions {
  onNoteEvent: (event: NoteEvent) => void;
  enableKeyboardShortcuts?: boolean;
  playPianoNote?: (midi: number, velocity: number) => void;
  stopPianoNote?: (midi: number) => void;
  setSustainPedal?: (isDown: boolean) => void;
}

/**
 * Input Abstraction Layer (Deliverable 2):
 * Unifies native Web MIDI API events (digital piano hardware like Yamaha YDP-145)
 * and Virtual On-Screen Keyboard interactions into a single normalized NoteEvent stream.
 */
export function useUnifiedNoteInput({
  onNoteEvent,
  enableKeyboardShortcuts = true,
  playPianoNote,
  stopPianoNote,
  setSustainPedal,
}: UseUnifiedNoteInputOptions) {
  const inputMode = usePracticeStore((s) => s.inputMode);
  const setMidiSupported = usePracticeStore((s) => s.setMidiSupported);
  const setMidiDevices = usePracticeStore((s) => s.setMidiDevices);
  const setSustainDown = usePracticeStore((s) => s.setSustainDown);
  const pressKey = usePracticeStore((s) => s.pressKey);
  const releaseKey = usePracticeStore((s) => s.releaseKey);

  // Keep latest callback refs to avoid tearing down MIDI listeners on state updates
  const onNoteEventRef = useRef(onNoteEvent);
  onNoteEventRef.current = onNoteEvent;

  const playNoteRef = useRef(playPianoNote ?? ((m: number, v: number) => audioEngine.playPianoNote(m, v)));
  playNoteRef.current = playPianoNote ?? ((m: number, v: number) => audioEngine.playPianoNote(m, v));

  const stopNoteRef = useRef(stopPianoNote ?? ((m: number) => audioEngine.stopPianoNote(m)));
  stopNoteRef.current = stopPianoNote ?? ((m: number) => audioEngine.stopPianoNote(m));

  const sustainRef = useRef(setSustainPedal ?? ((down: boolean) => audioEngine.setSustainPedal(down)));
  sustainRef.current = setSustainPedal ?? ((down: boolean) => audioEngine.setSustainPedal(down));

  const inputModeRef = useRef(inputMode);
  inputModeRef.current = inputMode;

  const dispatchUnifiedEvent = useCallback(
    (midi: number, type: 'noteOn' | 'noteOff', velocity: number, source: InputSource) => {
      const storeState = usePracticeStore.getState();
      const mode = inputModeRef.current;

      // Enforce user-selected input source filter
      if (mode === 'midi' && source !== 'midi') return;
      if (mode === 'virtual' && source !== 'virtual') return;

      // Block virtual keyboard clicks & audio until the Soundfont is fully loaded
      if (source === 'virtual' && !storeState.isAudioReady) return;

      const event: NoteEvent = {
        midi,
        noteName: midiToNoteName(midi),
        velocity,
        type,
        source,
        timestamp: audioEngine.getNowMs(),
      };

      // Update key highlight state & Sampled Grand Piano audio engine
      if (type === 'noteOn') {
        pressKey(midi);
        if (storeState.isAudioReady) {
          playNoteRef.current(midi, velocity);
        }
      } else {
        releaseKey(midi);
        stopNoteRef.current(midi);
      }

      onNoteEventRef.current(event);
    },
    [pressKey, releaseKey]
  );

  // Public emitter for Virtual On-Screen Keyboard clicks/touches
  const emitVirtualNote = useCallback(
    (midi: number, type: 'noteOn' | 'noteOff', velocity = 96) => {
      dispatchUnifiedEvent(midi, type, velocity, 'virtual');
    },
    [dispatchUnifiedEvent]
  );

  // Native Web MIDI API Integration
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('requestMIDIAccess' in navigator)) {
      setMidiSupported(false);
      return;
    }

    setMidiSupported(true);
    let midiAccess: MIDIAccess | null = null;
    let cancelled = false;

    const handleMidiMessage = (message: MIDIMessageEvent) => {
      const data = message.data;
      if (!data || data.length < 2) return;

      const status = data[0] & 0xf0;
      const data1 = data[1];
      const data2 = data.length > 2 ? data[2] : 0;

      // Note On (0x90) with velocity > 0
      if (status === 0x90 && data2 > 0) {
        dispatchUnifiedEvent(data1, 'noteOn', data2, 'midi');
        return;
      }

      // Note Off (0x80) or Note On with velocity 0
      if (status === 0x80 || (status === 0x90 && data2 === 0)) {
        dispatchUnifiedEvent(data1, 'noteOff', 0, 'midi');
        return;
      }

      // Control Change (0xB0): Sustain Pedal (CC #64)
      if (status === 0xb0 && data1 === 64) {
        const isDown = data2 >= 64;
        setSustainDown(isDown);
        sustainRef.current(isDown);
      }
    };

    const syncDevices = (access: MIDIAccess) => {
      const devices: MidiDeviceInfo[] = [];
      access.inputs.forEach((input) => {
        devices.push({
          id: input.id,
          name: input.name || 'USB MIDI Piano',
          manufacturer: input.manufacturer || 'Generic MIDI',
          state: input.state,
        });
        input.onmidimessage = handleMidiMessage;
      });
      setMidiDevices(devices);
    };

    navigator
      .requestMIDIAccess({ sysex: false })
      .then((access) => {
        if (cancelled) return;
        midiAccess = access;
        syncDevices(access);
        access.onstatechange = () => syncDevices(access);
      })
      .catch(() => {
        // Permission denied or unavailable in headless browser; virtual keyboard remains active
        if (!cancelled) setMidiDevices([]);
      });

    return () => {
      cancelled = true;
      if (midiAccess) {
        midiAccess.onstatechange = null;
        midiAccess.inputs.forEach((input) => {
          input.onmidimessage = null;
        });
      }
    };
  }, [dispatchUnifiedEvent, setMidiDevices, setMidiSupported, setSustainDown]);

  // Computer Keyboard Shortcut Mapping for quick virtual practice
  useEffect(() => {
    if (!enableKeyboardShortcuts) return;
    const heldKeys = new Set<string>();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }
      const key = e.key.toLowerCase();
      const midi = COMPUTER_KEY_TO_MIDI[key];
      if (midi !== undefined && !heldKeys.has(key)) {
        heldKeys.add(key);
        emitVirtualNote(midi, 'noteOn', 94);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const midi = COMPUTER_KEY_TO_MIDI[key];
      if (midi !== undefined && heldKeys.has(key)) {
        heldKeys.delete(key);
        emitVirtualNote(midi, 'noteOff', 0);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [emitVirtualNote, enableKeyboardShortcuts]);

  return { emitVirtualNote };
}
