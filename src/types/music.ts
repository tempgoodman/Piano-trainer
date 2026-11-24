export type InputSource = 'midi' | 'virtual';

export type InputMode = 'both' | 'midi' | 'virtual';

export type HandMode = 'both' | 'right' | 'left';

export type PracticeMode = 'wait' | 'tempo';

export type PlaybackMode = 'none' | 'computer' | 'recorded' | 'compare';

export type ScoreGrade = 'perfect' | 'good' | 'wrong' | 'miss';

export type NoteEventType = 'noteOn' | 'noteOff';

export interface NoteEvent {
  midi: number;
  noteName: string;
  velocity: number;
  type: NoteEventType;
  source: InputSource;
  /** Timestamp on the shared Web Audio / performance timeline (ms) */
  timestamp: number;
}

export interface RecordedMidiEvent {
  midi: number;
  noteName: string;
  type: NoteEventType;
  velocity: number;
  /** Relative offset in ms from the first captured noteOn */
  relativeTimeMs: number;
}

export interface RecordedTrack {
  id: string;
  scoreId: string;
  scoreTitle: string;
  bpm: number;
  recordedAt: string;
  durationMs: number;
  events: RecordedMidiEvent[];
}

export interface ScheduledComputerStep {
  stepIndex: number;
  measureNumber: number;
  startTimeMs: number;
  durationMs: number;
  notes: ExpectedNote[];
}

export interface MidiDeviceInfo {
  id: string;
  name: string;
  manufacturer: string;
  state: string;
}

export interface ExpectedNote {
  midi: number;
  noteName: string;
  /** 1 = Staff 1 (Treble / Right Hand), 2 = Staff 2 (Bass / Left Hand) */
  staffIndex: number;
  isRest: boolean;
}

export interface ScoringResult {
  grade: ScoreGrade;
  deltaMs: number;
  color: string;
  label: string;
  points: number;
}

export interface ScoreStats {
  perfect: number;
  good: number;
  miss: number;
  wrong: number;
  totalPoints: number;
}

export const FEEDBACK_COLORS: Record<ScoreGrade, string> = {
  perfect: '#059669', // Green: Correct pitch & <= 150ms
  good: '#EAB308',    // Yellow: Correct pitch & 150ms..300ms (Early/Late)
  wrong: '#DC2626',   // Red: Wrong pitch played
  miss: '#94A3B8',    // Grey: Missed note (cursor passed without input)
};

export interface LoopRange {
  enabled: boolean;
  startMeasure: number;
  endMeasure: number;
}

export interface ScorePiece {
  id: string;
  title: string;
  composer: string;
  level: string;
  timeSignature: string;
  measures: number;
  bpm: number;
  musicXml: string;
  ownerId?: string;
  isCloudSaved?: boolean;
  updatedAtMs?: number;
}

export interface OMRProgressMessage {
  job_id: string;
  status: 'queued' | 'preprocessing' | 'recognizing' | 'postprocessing' | 'completed' | 'error';
  progress: number;
  message: string;
  musicxml?: string;
  error?: string;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiToNoteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const pitchClass = NOTE_NAMES[midi % 12] ?? 'C';
  return `${pitchClass}${octave}`;
}

export function isBlackKey(midi: number): boolean {
  const pc = midi % 12;
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
}
