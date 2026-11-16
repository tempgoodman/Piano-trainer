import { Note, OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { audioEngine } from '../audio/AudioEngine';
import {
  ExpectedNote,
  HandMode,
  LoopRange,
  midiToNoteName,
  PlaybackMode,
  RecordedMidiEvent,
  RecordedTrack,
  ScheduledComputerStep,
} from '../types/music';

export interface SyntheticMidiPacket {
  timeMs: number;
  midi: number;
  velocity: number;
  type: 'noteOn' | 'noteOff';
  stepIndex: number;
}

export interface ComputerTimeline {
  steps: ScheduledComputerStep[];
  midiEvents: SyntheticMidiPacket[];
  totalDurationMs: number;
}

/**
 * Walks a cloned OSMD MusicPartManagerIterator from startMeasure to endMeasure
 * (without mutating or scrolling the visual DOM cursor) and builds a deterministic
 * BPM-locked Computer Timeline with exact step timestamps and synthetic MIDI packets.
 */
export function buildComputerTimeline(
  osmd: OpenSheetMusicDisplay,
  bpm: number,
  handMode: HandMode,
  loopRange: LoopRange
): ComputerTimeline {
  const steps: ScheduledComputerStep[] = [];
  const midiEvents: SyntheticMidiPacket[] = [];

  if (!osmd?.cursor) {
    return { steps, midiEvents, totalDurationMs: 0 };
  }

  const startMeasure = loopRange.enabled ? loopRange.startMeasure : 1;
  const endMeasure = loopRange.enabled ? loopRange.endMeasure : Number.MAX_SAFE_INTEGER;

  // Clone iterator from reset position so DOM cursor stays undisturbed
  osmd.cursor.reset();
  const iter = osmd.cursor.Iterator.clone();
  const skipInvisible = osmd.cursor.SkipInvisibleNotes;

  const advanceIter = (it: typeof iter) => {
    if (skipInvisible) {
      it.moveToNextVisibleVoiceEntry(false);
    } else {
      it.moveToNext();
    }
  };

  if (startMeasure > 1) {
    let safetyJump = 0;
    while (!iter.EndReached && safetyJump < 2000) {
      const m = typeof iter.CurrentMeasureIndex === 'number' ? iter.CurrentMeasureIndex + 1 : 1;
      if (m >= startMeasure) break;
      advanceIter(iter);
      safetyJump++;
    }
  }

  const quarterMs = 60000 / Math.max(30, bpm);
  const wholeNoteToMs = (whole: number) => whole * 4 * quarterMs;

  let originWhole: number | null = null;
  let safety = 0;

  while (!iter.EndReached && safety < 2000) {
    const measureNumber =
      typeof iter.CurrentMeasureIndex === 'number' ? iter.CurrentMeasureIndex + 1 : 1;
    if (measureNumber > endMeasure) break;

    const currentWhole = iter.CurrentEnrolledTimestamp?.RealValue ?? 0;
    if (originWhole === null) originWhole = currentWhole;

    const startTimeMs = wholeNoteToMs(currentWhole - originWhole);

    // Peek next position to determine step duration
    const peek = iter.clone();
    advanceIter(peek);

    // Extract notes at current iterator position
    const voiceEntries = iter.CurrentVisibleVoiceEntries();
    const rawNotes: Note[] = [];
    for (const ve of voiceEntries) {
      for (const n of ve.Notes) {
        rawNotes.push(n);
      }
    }

    let stepWholeDur = 0.25;
    if (!peek.EndReached) {
      const delta = (peek.CurrentEnrolledTimestamp?.RealValue ?? currentWhole) - currentWhole;
      if (delta > 0) stepWholeDur = delta;
    } else {
      const lens = rawNotes.map((n) => n.Length?.RealValue ?? 0.25).filter((v) => v > 0);
      if (lens.length > 0) stepWholeDur = Math.min(...lens);
    }

    const durationMs = wholeNoteToMs(stepWholeDur);
    const seen = new Set<string>();
    const expected: ExpectedNote[] = [];
    const filteredRaw: Note[] = [];

    for (const rawNote of rawNotes) {
      if (rawNote.isRest()) continue;
      if (rawNote.NoteTie && rawNote.NoteTie.StartNote !== rawNote) continue;

      const staffIndex =
        rawNote.ParentStaff?.Id ??
        (rawNote.ParentStaff?.idInMusicSheet !== undefined
          ? rawNote.ParentStaff.idInMusicSheet + 1
          : 1);

      if (handMode === 'right' && staffIndex !== 1) continue;
      if (handMode === 'left' && staffIndex !== 2) continue;

      const midi = rawNote.halfTone + 12;
      const key = `${midi}-${staffIndex}`;
      filteredRaw.push(rawNote);

      if (!seen.has(key)) {
        seen.add(key);
        expected.push({
          midi,
          noteName: midiToNoteName(midi),
          staffIndex,
          isRest: false,
        });
      }
    }

    const stepIndex = steps.length;
    steps.push({
      stepIndex,
      measureNumber,
      startTimeMs,
      durationMs,
      notes: expected,
    });

    for (const rawNote of filteredRaw) {
      const midi = rawNote.halfTone + 12;
      const noteLenWhole = rawNote.Length?.RealValue ?? stepWholeDur;
      const noteDurMs = Math.max(80, wholeNoteToMs(noteLenWhole) * 0.9);

      midiEvents.push({
        timeMs: startTimeMs,
        midi,
        velocity: 88,
        type: 'noteOn',
        stepIndex,
      });
      midiEvents.push({
        timeMs: startTimeMs + noteDurMs,
        midi,
        velocity: 0,
        type: 'noteOff',
        stepIndex,
      });
    }

    advanceIter(iter);
    safety++;
  }

  midiEvents.sort((a, b) => a.timeMs - b.timeMs);

  const lastStep = steps[steps.length - 1];
  const totalDurationMs = lastStep ? lastStep.startTimeMs + lastStep.durationMs : 0;

  return { steps, midiEvents, totalDurationMs };
}

export interface PlaybackSchedulerCallbacks {
  onComputerStep: (step: ScheduledComputerStep) => void;
  onComputerNote: (packet: SyntheticMidiPacket) => void;
  onRecordedNote: (
    event: RecordedMidiEvent,
    expectedStep: ScheduledComputerStep | null,
    isCorrectPitch: boolean,
    timingDeltaMs: number | null
  ) => void;
  /** Moves the visual recorded/ghost cursor ONTO `stepIndex` (the note currently being played) */
  onGhostCursorMoveTo: (stepIndex: number) => void;
  onComplete: () => void;
}

/**
 * Anson Practice Piano — Drift-Free Playback Scheduler
 *
 * Keeps Computer Auto-Play, Recorded Playback, and Compare Mode synchronized on a single
 * monotonic clock (`audioEngine.getNowMs()`), ensuring note[0] renders at step[0] without
 * premature jump-ahead to step[1].
 */
export class PlaybackScheduler {
  private rafId: number | null = null;
  private startClockMs = 0;
  private mode: PlaybackMode = 'none';

  private computerTimeline: ComputerTimeline = { steps: [], midiEvents: [], totalDurationMs: 0 };
  private recordedEvents: RecordedMidiEvent[] = [];

  private nextComputerStepIdx = 0;
  private nextComputerMidiIdx = 0;
  private nextRecordedIdx = 0;

  // Tracks which score step the next recorded noteOn is evaluated against
  private ghostStepIdx = 0;
  private ghostMatchedMidis = new Set<number>();

  private callbacks: PlaybackSchedulerCallbacks;

  constructor(callbacks: PlaybackSchedulerCallbacks) {
    this.callbacks = callbacks;
  }

  public start(
    mode: PlaybackMode,
    computerTimeline: ComputerTimeline,
    recordedTrack: RecordedTrack | null
  ): void {
    this.stop();
    if (mode === 'none') return;

    this.mode = mode;
    this.computerTimeline = computerTimeline;
    this.recordedEvents = recordedTrack
      ? [...recordedTrack.events].sort((a, b) => a.relativeTimeMs - b.relativeTimeMs)
      : [];

    this.nextComputerStepIdx = 0;
    this.nextComputerMidiIdx = 0;
    this.nextRecordedIdx = 0;
    this.ghostStepIdx = 0;
    this.ghostMatchedMidis.clear();

    this.startClockMs = audioEngine.ensureActive();
    console.info(`[Anson Practice Piano] PlaybackScheduler started -> ${mode.toUpperCase()}`);

    const loop = () => {
      if (this.mode === 'none') return;

      const elapsedMs = audioEngine.getNowMs() - this.startClockMs;

      // 1. Computer Timeline ('computer' and 'compare')
      if (this.mode === 'computer' || this.mode === 'compare') {
        while (
          this.nextComputerStepIdx < this.computerTimeline.steps.length &&
          elapsedMs >= this.computerTimeline.steps[this.nextComputerStepIdx].startTimeMs
        ) {
          this.callbacks.onComputerStep(this.computerTimeline.steps[this.nextComputerStepIdx]);
          this.nextComputerStepIdx++;
        }

        while (
          this.nextComputerMidiIdx < this.computerTimeline.midiEvents.length &&
          elapsedMs >= this.computerTimeline.midiEvents[this.nextComputerMidiIdx].timeMs
        ) {
          this.callbacks.onComputerNote(this.computerTimeline.midiEvents[this.nextComputerMidiIdx]);
          this.nextComputerMidiIdx++;
        }
      }

      // 2. User Recorded Track ('recorded' and 'compare')
      if (this.mode === 'recorded' || this.mode === 'compare') {
        while (
          this.nextRecordedIdx < this.recordedEvents.length &&
          elapsedMs >= this.recordedEvents[this.nextRecordedIdx].relativeTimeMs
        ) {
          const ev = this.recordedEvents[this.nextRecordedIdx];
          this.dispatchRecordedEvaluation(ev);
          this.nextRecordedIdx++;
        }
      }

      // 3. Completion Detection
      const computerDone =
        this.mode === 'recorded' ||
        (this.nextComputerMidiIdx >= this.computerTimeline.midiEvents.length &&
          elapsedMs >= this.computerTimeline.totalDurationMs + 150);

      const recordedDone =
        this.mode === 'computer' ||
        (this.nextRecordedIdx >= this.recordedEvents.length &&
          elapsedMs >= (this.recordedEvents[this.recordedEvents.length - 1]?.relativeTimeMs ?? 0) + 350);

      if (computerDone && recordedDone) {
        this.stop();
        this.callbacks.onComplete();
        return;
      }

      this.rafId = requestAnimationFrame(loop);
    };

    this.rafId = requestAnimationFrame(loop);
  }

  private dispatchRecordedEvaluation(ev: RecordedMidiEvent): void {
    // Advance past rest-only steps before matching the next noteOn
    while (
      this.ghostStepIdx < this.computerTimeline.steps.length &&
      this.computerTimeline.steps[this.ghostStepIdx].notes.length === 0
    ) {
      this.ghostStepIdx++;
    }

    const currentStep = this.computerTimeline.steps[this.ghostStepIdx] ?? null;

    if (ev.type === 'noteOff') {
      this.callbacks.onRecordedNote(ev, currentStep, true, null);
      return;
    }

    if (!currentStep) {
      this.callbacks.onRecordedNote(ev, null, false, null);
      return;
    }

    // Move Ghost/Recorded cursor ONTO currentStep as this note begins sounding
    this.callbacks.onGhostCursorMoveTo(currentStep.stepIndex);

    const expectedMidis = new Set(currentStep.notes.map((n) => n.midi));
    const isMatch = expectedMidis.has(ev.midi);
    const deltaMs = Math.round(ev.relativeTimeMs - currentStep.startTimeMs);

    this.callbacks.onRecordedNote(ev, currentStep, isMatch, deltaMs);

    if (isMatch) {
      this.ghostMatchedMidis.add(ev.midi);
      const allMatched = Array.from(expectedMidis).every((m) => this.ghostMatchedMidis.has(m));
      if (allMatched) {
        // Prepare next step index for the *next* noteOn, WITHOUT moving visual cursor ahead early!
        this.ghostMatchedMidis.clear();
        this.ghostStepIdx++;
      }
    }
  }

  public stop(): void {
    this.mode = 'none';
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    for (let m = 21; m <= 108; m++) {
      audioEngine.stopNote(m);
    }
  }

  public static formatDeltaLabel(deltaMs: number): string {
    if (Math.abs(deltaMs) <= 60) return `On Beat (${deltaMs >= 0 ? '+' : ''}${deltaMs}ms)`;
    if (deltaMs < 0) return `Rushing (${deltaMs}ms)`;
    return `Dragging (+${deltaMs}ms)`;
  }

  public static noteLabel(midi: number): string {
    return midiToNoteName(midi);
  }
}
