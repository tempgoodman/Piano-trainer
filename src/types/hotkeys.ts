import { HotkeyDefinition } from '../hooks/useMIDIHotkeyController';
import { midiToNoteName } from './music';

export interface UserHotkeysConfig {
  /** 1 to 4 MIDI note numbers (21..108) pressed simultaneously to Restart */
  restartMidiNotes: number[];
  /** 1 to 4 MIDI note numbers (21..108) pressed simultaneously to Stop / Wait Mode */
  stopMidiNotes: number[];
  /** Computer keyboard key (e.g., 'r', 'F2') for Restart */
  restartKey: string;
  /** Computer keyboard key (e.g., 'Escape', 'Backspace') for Stop / Wait Mode */
  stopKey: string;
}

export const DEFAULT_USER_HOTKEYS: UserHotkeysConfig = {
  restartMidiNotes: [21, 23, 24], // A0 + B0 + C1
  stopMidiNotes: [105, 107, 108], // A7 + B7 + C8
  restartKey: 'r',
  stopKey: 'Escape',
};

/** Keys used to play virtual piano notes (C4–E5) so users cannot accidentally break piano typing */
export const RESERVED_PIANO_KEYS = new Set([
  'a',
  'w',
  's',
  'e',
  'd',
  'f',
  't',
  'g',
  'y',
  'h',
  'u',
  'j',
  'k',
  'o',
  'l',
  'p',
  ';',
]);

export const ALL_PIANO_MIDI_NOTES: { midi: number; label: string }[] = Array.from(
  { length: 88 },
  (_, idx) => {
    const midi = 21 + idx; // A0 (21) to C8 (108)
    return { midi, label: midiToNoteName(midi) };
  }
);

export function formatMidiChord(notes: number[]): string {
  return [...notes]
    .sort((a, b) => a - b)
    .map((m) => midiToNoteName(m))
    .join(' + ');
}

export function formatKeyboardKey(key: string): string {
  if (!key) return 'Unset';
  if (key === 'Escape') return 'Esc';
  if (key === 'Backspace') return 'Backspace';
  if (key === 'Delete') return 'Del';
  if (key === 'Enter') return 'Enter';
  if (key.length === 1) return key.toUpperCase();
  return key;
}

export function toMidiHotkeyDefinitions(config: UserHotkeysConfig): HotkeyDefinition[] {
  return [
    {
      id: 'restart',
      label: `Restart (${formatMidiChord(config.restartMidiNotes)})`,
      notes: config.restartMidiNotes,
    },
    {
      id: 'stop',
      label: `Stop / Wait Mode (${formatMidiChord(config.stopMidiNotes)})`,
      notes: config.stopMidiNotes,
    },
  ];
}

export function normalizeMidiChord(notes: number[]): number[] {
  const unique = Array.from(
    new Set(
      notes
        .map((n) => Math.round(n))
        .filter((n) => Number.isInteger(n) && n >= 21 && n <= 108)
    )
  ).sort((a, b) => a - b);
  return unique.slice(0, 4);
}

export function isSameHotkeysConfig(a: UserHotkeysConfig, b: UserHotkeysConfig): boolean {
  const sameArr = (x: number[], y: number[]) =>
    x.length === y.length && x.every((v, i) => v === y[i]);
  return (
    sameArr(normalizeMidiChord(a.restartMidiNotes), normalizeMidiChord(b.restartMidiNotes)) &&
    sameArr(normalizeMidiChord(a.stopMidiNotes), normalizeMidiChord(b.stopMidiNotes)) &&
    a.restartKey.toLowerCase() === b.restartKey.toLowerCase() &&
    a.stopKey.toLowerCase() === b.stopKey.toLowerCase()
  );
}
