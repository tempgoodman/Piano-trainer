import { useCallback, useEffect, useRef } from 'react';
import { Note, OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { audioEngine } from '../audio/AudioEngine';
import {
  evaluateChordInput,
  GOOD_WINDOW_MS,
} from '../engines/ScoringEngine';
import { auth } from '../firebase';
import { recordBarPracticeStatsToFirestore } from '../services/firestoreStats';
import { usePracticeStore } from '../store/usePracticeStore';
import {
  ExpectedNote,
  HandMode,
  midiToNoteName,
  NoteEvent,
  PlaybackMode,
  PracticeMode,
  ScoreGrade,
} from '../types/music';
import { BarStatsDeltaMap } from '../types/stats';
import {
  colorNoteList,
  colorNotesAtCursor,
  resetAllOSMDNoteColors,
} from '../utils/osmdColoring';

interface BarAccumulator {
  perfect: number;
  good: number;
  wrong: number;
  miss: number;
  touched: boolean;
}

interface PendingBeatWindow {
  measureNumber: number;
  notes: Note[];
  expectedMidis: Set<number>;
  matchedMidis: Set<number>;
  expectedTimeMs: number;
  deadlineMs: number;
}

export function extractExpectedNotes(
  osmd: OpenSheetMusicDisplay | null,
  handMode: HandMode
): { expected: ExpectedNote[]; rawNotes: Note[] } {
  if (!osmd?.cursor || osmd.cursor.Iterator?.EndReached) {
    return { expected: [], rawNotes: [] };
  }

  const cursorNotes = osmd.cursor.NotesUnderCursor();
  const seen = new Set<string>();
  const expected: ExpectedNote[] = [];
  const rawNotes: Note[] = [];

  for (const note of cursorNotes) {
    if (note.isRest()) continue;
    if (note.NoteTie && note.NoteTie.StartNote !== note) continue;

    const staffIndex =
      note.ParentStaff?.Id ??
      (note.ParentStaff?.idInMusicSheet !== undefined ? note.ParentStaff.idInMusicSheet + 1 : 1);

    if (handMode === 'right' && staffIndex !== 1) continue;
    if (handMode === 'left' && staffIndex !== 2) continue;

    const midi = note.halfTone + 12;
    const key = `${midi}-${staffIndex}`;
    rawNotes.push(note);

    if (seen.has(key)) continue;
    seen.add(key);

    expected.push({
      midi,
      noteName: midiToNoteName(midi),
      staffIndex,
      isRest: false,
    });
  }

  return { expected, rawNotes };
}

export function getCursorMeasureNumber(osmd: OpenSheetMusicDisplay | null): number {
  const iter = osmd?.cursor?.Iterator;
  if (!iter) return 1;
  return typeof iter.CurrentMeasureIndex === 'number' ? iter.CurrentMeasureIndex + 1 : 1;
}

export function jumpCursorToMeasure(
  osmd: OpenSheetMusicDisplay | null,
  targetMeasure: number
): void {
  if (!osmd?.cursor) return;
  osmd.cursor.reset();
  let safety = 0;
  while (!osmd.cursor.Iterator.EndReached && safety < 2000) {
    if (getCursorMeasureNumber(osmd) >= targetMeasure) break;
    osmd.cursor.next();
    safety++;
  }
  osmd.cursor.update();
}

function getStepDurationWholeNotes(osmd: OpenSheetMusicDisplay): number {
  const iter = osmd.cursor.Iterator;
  const currentWhole = iter.CurrentEnrolledTimestamp?.RealValue ?? 0;

  const peek = iter.clone();
  if (osmd.cursor.SkipInvisibleNotes) {
    peek.moveToNextVisibleVoiceEntry(false);
  } else {
    peek.moveToNext();
  }

  if (!peek.EndReached) {
    const nextWhole = peek.CurrentEnrolledTimestamp?.RealValue ?? currentWhole;
    const delta = nextWhole - currentWhole;
    if (delta > 0) return delta;
  }

  const notes = osmd.cursor.NotesUnderCursor();
  const lengths = notes.map((n) => n.Length?.RealValue ?? 0.25).filter((v) => v > 0);
  return lengths.length > 0 ? Math.min(...lengths) : 0.25;
}

export function computeShouldShowSheetGuide(state: {
  practiceMode: PracticeMode;
  playbackMode: PlaybackMode;
  showTempoGuide: boolean;
  isGuideAutoRevealed: boolean;
  isStatsMode?: boolean;
}): boolean {
  if (state.isStatsMode) return false;
  if (state.playbackMode !== 'none') return true;
  if (state.practiceMode !== 'tempo') return true;
  return state.showTempoGuide || state.isGuideAutoRevealed;
}

/**
 * Toggles ONLY the visual guide bar (`cursorElement`) on the OSMD sheet.
 * Keeps OSMD's cursor logically active so `followCursor` scrolling and SVG notehead coloring
 * (green/yellow/red/grey results) continue working identically whether the guide is hidden or shown.
 */
export function syncSheetGuideVisibility(
  osmd: OpenSheetMusicDisplay | null,
  shouldShow: boolean
): void {
  const primaryCursor = osmd?.cursors?.[0] ?? osmd?.cursor;
  if (!primaryCursor) return;

  if (primaryCursor.Hidden) {
    primaryCursor.show();
  }
  const el = primaryCursor.cursorElement;
  if (el) {
    el.style.transition = 'opacity 140ms ease';
    el.style.opacity = shouldShow ? '1' : '0';
    el.style.visibility = shouldShow ? 'visible' : 'hidden';
    el.style.pointerEvents = 'none';
  }
}

/**
 * Anson Practice Piano — Unified Practice Mode Hook (Deliverable 2: Smart Start & Auto-Reset)
 *
 * - Wait Mode: Cursor pauses indefinitely for pitch match.
 * - Tempo Mode (Smart Start): Arms at Measure 1 or Point A; Web Audio clock + rAF + Metronome
 *   start ONLY when the user plays the first required note.
 * - Auto-Reset: Reaching Point B (A/B Loop) or End of Song automatically resets cursor back to
 *   Point A / Measure 1 and re-enters the Armed state for seamless repetition.
 */
export function usePracticeMode(osmdRef: React.MutableRefObject<OpenSheetMusicDisplay | null>) {
  const wrongTimerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  // Playback timing anchors (shared Web Audio timeline in ms)
  const smartStartAnchorMsRef = useRef<number | null>(null);
  const smartStartMatchedFirstNoteRef = useRef<number | null>(null);
  const stepExpectedTimeMsRef = useRef<number>(0);
  const nextStepTimeMsRef = useRef<number>(0);
  const stepDurationWholeRef = useRef<number>(0.25);
  const currentBeatRawNotesRef = useRef<Note[]>([]);
  const pendingGraceBeatsRef = useRef<PendingBeatWindow[]>([]);
  const barSessionRef = useRef<Record<number, BarAccumulator>>({});
  const completedTempoMeasuresRef = useRef<Set<number>>(new Set());
  const lastTrackedMeasureRef = useRef<number>(1);

  const activeScoreId = usePracticeStore((s) => s.activeScore.id);
  const practiceMode = usePracticeStore((s) => s.practiceMode);
  const playbackMode = usePracticeStore((s) => s.playbackMode);
  const showTempoGuide = usePracticeStore((s) => s.showTempoGuide);
  const isGuideAutoRevealed = usePracticeStore((s) => s.isGuideAutoRevealed);
  const isStatsMode = usePracticeStore((s) => s.isStatsMode);
  const isArmed = usePracticeStore((s) => s.isArmed);
  const isPlaying = usePracticeStore((s) => s.isPlaying);
  const bpm = usePracticeStore((s) => s.bpm);
  const loopEnabled = usePracticeStore((s) => s.loopRange.enabled);
  const loopStart = usePracticeStore((s) => s.loopRange.startMeasure);
  const loopEnd = usePracticeStore((s) => s.loopRange.endMeasure);

  // Clear any transient per-bar accumulators when switching sheets
  useEffect(() => {
    barSessionRef.current = {};
    completedTempoMeasuresRef.current.clear();
    lastTrackedMeasureRef.current = 1;
  }, [activeScoreId]);

  const recordBarEvent = useCallback((measureNumber: number, grade: ScoreGrade) => {
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.emailVerified) return;
    const mNum = Math.max(1, measureNumber);
    const existing = barSessionRef.current[mNum] ?? {
      perfect: 0,
      good: 0,
      wrong: 0,
      miss: 0,
      touched: false,
    };
    existing[grade] += 1;
    existing.touched = true;
    barSessionRef.current[mNum] = existing;
  }, []);

  const flushBarsToCloud = useCallback(
    (measuresToFlush: number[], mode: PracticeMode, tempoBpm: number, incrementRun = false) => {
      const currentUser = auth.currentUser;
      if (!currentUser || !currentUser.emailVerified) {
        for (const m of measuresToFlush) {
          delete barSessionRef.current[m];
          completedTempoMeasuresRef.current.delete(m);
        }
        return;
      }

      const barDeltas: BarStatsDeltaMap = {};
      for (const mNum of measuresToFlush) {
        const acc = barSessionRef.current[mNum];
        completedTempoMeasuresRef.current.delete(mNum);
        if (!acc || !acc.touched) continue;

        if (mode === 'wait') {
          if (acc.perfect > 0 || acc.wrong > 0) {
            barDeltas[mNum] = {
              practices: acc.perfect > 0 ? 1 : 0,
              perfect: acc.perfect,
              good: 0,
              wrong: acc.wrong,
              miss: 0,
            };
          }
        } else {
          const totalGraded = acc.perfect + acc.good + acc.wrong + acc.miss;
          if (totalGraded > 0) {
            barDeltas[mNum] = {
              practices: 1,
              perfect: acc.perfect,
              good: acc.good,
              wrong: acc.wrong,
              miss: acc.miss,
            };
          }
        }
        delete barSessionRef.current[mNum];
      }

      if (Object.keys(barDeltas).length === 0 && !incrementRun) return;

      const scoreId = usePracticeStore.getState().activeScore.id;
      void recordBarPracticeStatsToFirestore({
        uid: currentUser.uid,
        scoreId,
        mode,
        bpm: tempoBpm,
        barDeltas,
        incrementRun,
      });
    },
    []
  );

  const wholeNotesToMs = useCallback((wholeNotes: number, currentBpm: number) => {
    const quarterMs = 60000 / Math.max(30, currentBpm);
    return wholeNotes * 4 * quarterMs;
  }, []);

  const skipRestsAtCursor = useCallback((osmd: OpenSheetMusicDisplay) => {
    const state = usePracticeStore.getState();
    let { expected, rawNotes } = extractExpectedNotes(osmd, state.handMode);
    let safety = 0;

    while (expected.length === 0 && !osmd.cursor.Iterator.EndReached && safety < 128) {
      osmd.cursor.next();
      const nextMeasure = getCursorMeasureNumber(osmd);
      if (state.loopRange.enabled && (osmd.cursor.Iterator.EndReached || nextMeasure > state.loopRange.endMeasure)) {
        jumpCursorToMeasure(osmd, state.loopRange.startMeasure);
      } else if (osmd.cursor.Iterator.EndReached) {
        break;
      }
      const extracted = extractExpectedNotes(osmd, state.handMode);
      expected = extracted.expected;
      rawNotes = extracted.rawNotes;
      safety++;
    }

    return { expected, rawNotes };
  }, []);

  /**
   * Synchronizes cursor position, expected notes, and handles Auto-Reset at Point B / Song End.
   */
  const syncCursorTargets = useCallback(() => {
    const osmd = osmdRef.current;
    if (!osmd?.cursor) return;

    const state = usePracticeStore.getState();
    const endReached = osmd.cursor.Iterator?.EndReached ?? false;
    const currentMeasure = getCursorMeasureNumber(osmd);
    const prevMeasure = lastTrackedMeasureRef.current;

    // Check Point B (A/B Loop end) OR Song Completion
    const passedLoopEnd = state.loopRange.enabled && (endReached || currentMeasure > state.loopRange.endMeasure);
    const finishedWholeSong = !state.loopRange.enabled && endReached;

    // Flush completed bar stats when leaving a measure or completing a pass
    if (!state.isStatsMode && state.playbackMode === 'none') {
      if (passedLoopEnd || finishedWholeSong) {
        if (state.practiceMode === 'tempo') {
          // Resolve any remaining pending grace beats as misses before flushing final bar stats
          for (const beat of pendingGraceBeatsRef.current) {
            const missedNotes = beat.notes.filter((n) => !beat.matchedMidis.has(n.halfTone + 12));
            for (let i = 0; i < missedNotes.length; i++) {
              recordBarEvent(beat.measureNumber, 'miss');
            }
          }
        }
        const allTouchedMeasures = Object.keys(barSessionRef.current).map(Number);
        if (allTouchedMeasures.length > 0) {
          flushBarsToCloud(allTouchedMeasures, state.practiceMode, state.bpm, true);
        }
      } else if (currentMeasure !== prevMeasure) {
        if (state.practiceMode === 'wait') {
          flushBarsToCloud([prevMeasure], 'wait', 0, false);
        } else if (state.practiceMode === 'tempo' && state.isPlaying) {
          const hasGracePending = pendingGraceBeatsRef.current.some(
            (b) => b.measureNumber === prevMeasure
          );
          if (hasGracePending) {
            completedTempoMeasuresRef.current.add(prevMeasure);
          } else {
            flushBarsToCloud([prevMeasure], 'tempo', state.bpm, false);
          }
        }
      }
    }

    if (passedLoopEnd || finishedWholeSong) {
      const targetStart = state.loopRange.enabled ? state.loopRange.startMeasure : 1;
      console.info(
        `[Anson Practice Piano] ${
          passedLoopEnd ? 'Loop Point B reached' : 'Piece completed'
        } — auto-resetting to Measure ${targetStart} and arming.`
      );

      pendingGraceBeatsRef.current = [];
      completedTempoMeasuresRef.current.clear();
      jumpCursorToMeasure(osmd, targetStart);

      if (state.practiceMode === 'tempo') {
        state.completeRunAndArm();
        resetAllOSMDNoteColors(osmd);
      } else {
        // Wait Mode: snap back to start, record completion if whole song
        if (finishedWholeSong) {
          state.completeRunAndArm();
          audioEngine.playFeedbackCue('success');
        }
        resetAllOSMDNoteColors(osmd);
      }
    }

    // Extract notes at current cursor (skip rests when in Wait Mode OR when Armed so first note is playable)
    const shouldSkipRests = state.practiceMode === 'wait' || usePracticeStore.getState().isArmed;
    let extracted = extractExpectedNotes(osmd, state.handMode);
    if (shouldSkipRests && extracted.expected.length === 0) {
      extracted = skipRestsAtCursor(osmd);
    }

    currentBeatRawNotesRef.current = extracted.rawNotes;
    stepDurationWholeRef.current = getStepDurationWholeNotes(osmd);

    const latestState = usePracticeStore.getState();
    const resolvedMeasure = getCursorMeasureNumber(osmd);
    lastTrackedMeasureRef.current = resolvedMeasure;
    syncSheetGuideVisibility(osmd, computeShouldShowSheetGuide(latestState));
    latestState.setCurrentMeasure(resolvedMeasure);
    latestState.setExpectedNotes(extracted.expected);
    latestState.clearMatchedMidis();
  }, [flushBarsToCloud, osmdRef, recordBarEvent, skipRestsAtCursor]);

  const advanceCursor = useCallback(() => {
    const osmd = osmdRef.current;
    if (!osmd?.cursor) return;
    osmd.cursor.next();
    syncCursorTargets();
  }, [osmdRef, syncCursorTargets]);

  /**
   * Resets cursor to Measure 1 (or Point A if looping), clears all note colors,
   * and enters the Armed state (in Tempo Mode) or ready state (in Wait Mode).
   */
  const resetToStart = useCallback(() => {
    const osmd = osmdRef.current;
    const state = usePracticeStore.getState();

    pendingGraceBeatsRef.current = [];
    barSessionRef.current = {};
    completedTempoMeasuresRef.current.clear();
    smartStartAnchorMsRef.current = null;
    smartStartMatchedFirstNoteRef.current = null;
    state.resetSessionStats();

    if (state.isStatsMode) {
      return;
    }

    if (state.practiceMode === 'tempo') {
      state.armTempoMode();
    } else {
      state.setIsPracticing(true);
    }

    if (osmd) {
      resetAllOSMDNoteColors(osmd);
      if (osmd.cursor) {
        if (state.loopRange.enabled) {
          jumpCursorToMeasure(osmd, state.loopRange.startMeasure);
        } else {
          osmd.cursor.reset();
        }
        syncCursorTargets();
      }
    }
  }, [osmdRef, syncCursorTargets]);

  /**
   * Hotkey 2 ("Rest / Stop"): Stops active Tempo playback and switches to Wait Mode.
   */
  const stopToWaitMode = useCallback(() => {
    const state = usePracticeStore.getState();
    if (completedTempoMeasuresRef.current.size > 0) {
      flushBarsToCloud(Array.from(completedTempoMeasuresRef.current), 'tempo', state.bpm, false);
    }
    pendingGraceBeatsRef.current = [];
    barSessionRef.current = {};
    completedTempoMeasuresRef.current.clear();
    smartStartAnchorMsRef.current = null;
    state.setPracticeMode('wait');
    if (osmdRef.current) {
      syncCursorTargets();
    }
  }, [flushBarsToCloud, osmdRef, syncCursorTargets]);

  // Snap cursor into A/B loop window whenever loop range is clicked/adjusted
  useEffect(() => {
    const osmd = osmdRef.current;
    if (!loopEnabled || !osmd?.cursor) return;
    const cur = getCursorMeasureNumber(osmd);
    if (cur < loopStart || cur > loopEnd) {
      jumpCursorToMeasure(osmd, loopStart);
      syncCursorTargets();
    }
  }, [loopEnabled, loopStart, loopEnd, osmdRef, syncCursorTargets]);

  // Re-evaluate live BPM adjustments mid-playback in Tempo Mode
  useEffect(() => {
    if (practiceMode === 'tempo' && isPlaying) {
      const stepMs = wholeNotesToMs(stepDurationWholeRef.current, bpm);
      nextStepTimeMsRef.current = stepExpectedTimeMsRef.current + stepMs;
    }
  }, [bpm, practiceMode, isPlaying, wholeNotesToMs]);

  // Immediately update OSMD sheet guide visibility when toggle, mode, Stats Mode, or 4-note lost recovery changes
  useEffect(() => {
    syncSheetGuideVisibility(
      osmdRef.current,
      computeShouldShowSheetGuide({
        practiceMode,
        playbackMode,
        showTempoGuide,
        isGuideAutoRevealed,
        isStatsMode,
      })
    );
  }, [practiceMode, playbackMode, showTempoGuide, isGuideAutoRevealed, isStatsMode, osmdRef]);

  const flushExpiredGraceBeats = useCallback(
    (nowMs: number) => {
      const osmd = osmdRef.current;
      const remaining: PendingBeatWindow[] = [];

      for (const beat of pendingGraceBeatsRef.current) {
        if (nowMs > beat.deadlineMs) {
          const missedNotes = beat.notes.filter(
            (n) => !beat.matchedMidis.has(n.halfTone + 12)
          );
          if (missedNotes.length > 0) {
            colorNoteList(osmd, missedNotes, 'miss');
            for (const missed of missedNotes) {
              const staffIndex =
                missed.ParentStaff?.Id ??
                (missed.ParentStaff?.idInMusicSheet !== undefined
                  ? missed.ParentStaff.idInMusicSheet + 1
                  : 1);
              const store = usePracticeStore.getState();
              store.recordScoringResult(
                'miss',
                0,
                'Missed',
                0,
                midiToNoteName(missed.halfTone + 12)
              );
              store.recordMeasureMetric({
                measureNumber: beat.measureNumber,
                staffIndex,
                outcome: 'miss',
              });
              recordBarEvent(beat.measureNumber, 'miss');
            }
          }
        } else {
          remaining.push(beat);
        }
      }

      pendingGraceBeatsRef.current = remaining;

      // Flush any completed Tempo measures whose grace windows have now fully settled
      if (completedTempoMeasuresRef.current.size > 0) {
        const readyToFlush: number[] = [];
        for (const mNum of completedTempoMeasuresRef.current) {
          const stillPending = remaining.some((b) => b.measureNumber === mNum);
          if (!stillPending) {
            readyToFlush.push(mNum);
          }
        }
        if (readyToFlush.length > 0) {
          const curBpm = usePracticeStore.getState().bpm;
          flushBarsToCloud(readyToFlush, 'tempo', curBpm, false);
        }
      }
    },
    [flushBarsToCloud, osmdRef, recordBarEvent]
  );

  /**
   * Tempo Mode Continuous Playback Loop (Runs ONLY when isPlaying === true, NEVER while isArmed).
   */
  useEffect(() => {
    if (practiceMode !== 'tempo' || !isPlaying) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    const osmd = osmdRef.current;
    if (!osmd?.cursor) return;

    const startClockMs = smartStartAnchorMsRef.current ?? audioEngine.ensureActive();
    smartStartAnchorMsRef.current = null;

    console.info(
      `[Anson Practice Piano] Tempo Mode playback active at ${usePracticeStore.getState().bpm} BPM`
    );

    stepExpectedTimeMsRef.current = startClockMs;
    nextStepTimeMsRef.current =
      startClockMs + wholeNotesToMs(stepDurationWholeRef.current, usePracticeStore.getState().bpm);

    // If Smart Start already scored the triggering first note, preserve its matched mark on beat 0
    if (smartStartMatchedFirstNoteRef.current !== null) {
      usePracticeStore.getState().markExpectedHit(smartStartMatchedFirstNoteRef.current);
      smartStartMatchedFirstNoteRef.current = null;
    }

    const tick = () => {
      const state = usePracticeStore.getState();
      if (state.practiceMode !== 'tempo' || !state.isPlaying || !osmdRef.current?.cursor) {
        return;
      }

      const nowMs = audioEngine.getNowMs();
      flushExpiredGraceBeats(nowMs);

      while (nowMs >= nextStepTimeMsRef.current && usePracticeStore.getState().isPlaying) {
        const curState = usePracticeStore.getState();
        if (currentBeatRawNotesRef.current.length > 0) {
          const expectedMidis = new Set(curState.expectedNotes.map((n) => n.midi));
          const matchedSnapshot = new Set(curState.matchedMidis);
          const hasUnmatched = Array.from(expectedMidis).some((m) => !matchedSnapshot.has(m));

          if (hasUnmatched) {
            pendingGraceBeatsRef.current.push({
              measureNumber: curState.currentMeasure,
              notes: currentBeatRawNotesRef.current,
              expectedMidis,
              matchedMidis: matchedSnapshot,
              expectedTimeMs: stepExpectedTimeMsRef.current,
              deadlineMs: stepExpectedTimeMsRef.current + GOOD_WINDOW_MS,
            });
          }
        }

        const beatStartMs = nextStepTimeMsRef.current;
        osmdRef.current.cursor.next();
        syncCursorTargets();

        // syncCursorTargets auto-arms and stops playback at Point B / Song End
        if (!usePracticeStore.getState().isPlaying) {
          flushExpiredGraceBeats(nowMs + GOOD_WINDOW_MS + 1);
          return;
        }

        stepExpectedTimeMsRef.current = beatStartMs;
        const nextStepDurationMs = wholeNotesToMs(
          stepDurationWholeRef.current,
          usePracticeStore.getState().bpm
        );
        nextStepTimeMsRef.current = beatStartMs + nextStepDurationMs;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [practiceMode, isPlaying, osmdRef, syncCursorTargets, wholeNotesToMs, flushExpiredGraceBeats]);

  /**
   * Unified Musical Note Handler (Downstream of MIDIHotkeyController):
   * - Wait Mode: Pause indefinitely until pitch matches.
   * - Tempo Mode (Armed): First matching note disarms, anchors Audio clock, and triggers playback.
   * - Tempo Mode (Playing): Evaluates pitch & +/-300ms timing and colors noteheads live.
   */
  const handleNoteEvent = useCallback(
    (event: NoteEvent) => {
      if (event.type !== 'noteOn') return;

      const state = usePracticeStore.getState();
      // User must exit Practice Stats mode before practicing again
      if (state.isStatsMode) return;
      const osmd = osmdRef.current;
      const inferStaffFromMidi = (midi: number, expectedList: ExpectedNote[]): number => {
        const directMatch = expectedList.find((n) => n.midi === midi);
        if (directMatch) return directMatch.staffIndex;
        if (expectedList.length === 1) return expectedList[0].staffIndex;
        return midi < 60 ? 2 : 1;
      };

      // -----------------------------------------------------------
      // MODE A: WAIT MODE (Pause indefinitely; timing ignored)
      // -----------------------------------------------------------
      if (state.practiceMode === 'wait') {
        if (!state.isPracticing) return;
        const expected = state.expectedNotes;
        if (expected.length === 0) return;

        state.incrementDetectedNotes();
        const expectedMidis = new Set(expected.map((n) => n.midi));
        if (expectedMidis.has(event.midi)) {
          if (state.pieceCompleted) state.setPieceCompleted(false);
          colorNotesAtCursor(osmd, 'perfect', {
            targetMidi: event.midi,
            handMode: state.handMode,
          });
          state.markExpectedHit(event.midi);
          state.recordHit();
          state.recordMeasureMetric({
            measureNumber: state.currentMeasure,
            staffIndex: inferStaffFromMidi(event.midi, expected),
            outcome: 'hit',
            deltaMs: 0,
          });
          recordBarEvent(state.currentMeasure, 'perfect');

          const updatedMatched = new Set(usePracticeStore.getState().matchedMidis);
          updatedMatched.add(event.midi);

          if (Array.from(expectedMidis).every((m) => updatedMatched.has(m))) {
            advanceCursor();
          }
        } else {
          state.recordMiss();
          state.recordMeasureMetric({
            measureNumber: state.currentMeasure,
            staffIndex: inferStaffFromMidi(event.midi, expected),
            outcome: 'wrong',
          });
          recordBarEvent(state.currentMeasure, 'wrong');
          state.triggerWrongNote(event.midi, event.noteName);
          if (wrongTimerRef.current) window.clearTimeout(wrongTimerRef.current);
          wrongTimerRef.current = window.setTimeout(() => {
            usePracticeStore.getState().clearWrongNote();
          }, 900);
        }
        return;
      }

      // -----------------------------------------------------------
      // MODE B1: TEMPO MODE — SMART START (Armed, waiting for 1st note)
      // -----------------------------------------------------------
      if (state.isArmed && !state.isPlaying) {
        if (!state.isAudioReady) return;
        const expected = state.expectedNotes;
        const expectedMidis = new Set(expected.map((n) => n.midi));

        if (expectedMidis.has(event.midi)) {
          // Lock Web Audio clock anchor to the exact moment the first note is played
          const anchorMs = audioEngine.ensureActive();
          smartStartAnchorMsRef.current = anchorMs;
          smartStartMatchedFirstNoteRef.current = event.midi;

          resetAllOSMDNoteColors(osmd);
          barSessionRef.current = {};
          completedTempoMeasuresRef.current.clear();
          state.startPlayingTempo();
          state.incrementDetectedNotes();
          colorNotesAtCursor(osmd, 'perfect', {
            targetMidi: event.midi,
            handMode: state.handMode,
          });
          state.recordScoringResult('perfect', 100, 'Perfect (Smart Start)', 0, event.noteName);
          state.recordMeasureMetric({
            measureNumber: state.currentMeasure,
            staffIndex: inferStaffFromMidi(event.midi, expected),
            outcome: 'hit',
            deltaMs: 0,
          });
          recordBarEvent(state.currentMeasure, 'perfect');
        } else {
          // Stay Armed until user strikes the first expected note
          state.triggerWrongNote(event.midi, event.noteName);
          if (wrongTimerRef.current) window.clearTimeout(wrongTimerRef.current);
          wrongTimerRef.current = window.setTimeout(() => {
            usePracticeStore.getState().clearWrongNote();
          }, 900);
        }
        return;
      }

      // -----------------------------------------------------------
      // MODE B2: TEMPO MODE — ACTIVE PLAYBACK SCORING
      // -----------------------------------------------------------
      if (!state.isPlaying) return;

      state.incrementDetectedNotes();
      const inputTime = event.timestamp;

      for (const graceBeat of pendingGraceBeatsRef.current) {
        if (
          inputTime <= graceBeat.deadlineMs &&
          graceBeat.expectedMidis.has(event.midi) &&
          !graceBeat.matchedMidis.has(event.midi)
        ) {
          const { result } = evaluateChordInput(
            event.midi,
            inputTime,
            Array.from(graceBeat.expectedMidis),
            graceBeat.expectedTimeMs
          );
          graceBeat.matchedMidis.add(event.midi);
          const matchingNotes = graceBeat.notes.filter((n) => n.halfTone + 12 === event.midi);
          colorNoteList(osmd, matchingNotes, result.grade);
          state.recordScoringResult(
            result.grade,
            result.points,
            result.label,
            result.deltaMs,
            event.noteName
          );
          const matchedNote = matchingNotes[0];
          const staffIndex =
            matchedNote?.ParentStaff?.Id ??
            (matchedNote?.ParentStaff?.idInMusicSheet !== undefined
              ? matchedNote.ParentStaff.idInMusicSheet + 1
              : inferStaffFromMidi(event.midi, state.expectedNotes));
          state.recordMeasureMetric({
            measureNumber: graceBeat.measureNumber,
            staffIndex,
            outcome: result.grade === 'perfect' || result.grade === 'good' ? 'hit' : 'miss',
            deltaMs: result.deltaMs,
          });
          recordBarEvent(graceBeat.measureNumber, result.grade);
          return;
        }
      }

      const expected = state.expectedNotes;
      if (expected.length === 0) {
        state.recordScoringResult('wrong', 0, 'Wrong Note (Rest)', 0, event.noteName);
        state.recordMeasureMetric({
          measureNumber: state.currentMeasure,
          staffIndex: event.midi < 60 ? 2 : 1,
          outcome: 'wrong',
        });
        recordBarEvent(state.currentMeasure, 'wrong');
        return;
      }

      const expectedMidis = expected.map((n) => n.midi);
      const { matchedPitch, result } = evaluateChordInput(
        event.midi,
        inputTime,
        expectedMidis,
        stepExpectedTimeMsRef.current
      );

      if (matchedPitch !== null && (result.grade === 'perfect' || result.grade === 'good')) {
        state.markExpectedHit(matchedPitch);
        colorNotesAtCursor(osmd, result.grade, {
          targetMidi: matchedPitch,
          handMode: state.handMode,
        });
      } else if (result.grade === 'wrong') {
        colorNotesAtCursor(osmd, 'wrong', { handMode: state.handMode });
      } else {
        colorNotesAtCursor(osmd, 'miss', {
          targetMidi: event.midi,
          handMode: state.handMode,
        });
      }

      state.recordScoringResult(
        result.grade,
        result.points,
        result.label,
        result.deltaMs,
        event.noteName
      );
      state.recordMeasureMetric({
        measureNumber: state.currentMeasure,
        staffIndex: inferStaffFromMidi(matchedPitch ?? event.midi, expected),
        outcome:
          result.grade === 'perfect' || result.grade === 'good'
            ? 'hit'
            : result.grade === 'wrong'
            ? 'wrong'
            : 'miss',
        deltaMs: result.deltaMs,
      });
      recordBarEvent(state.currentMeasure, result.grade);
    },
    [advanceCursor, osmdRef, recordBarEvent]
  );

  return {
    practiceMode,
    isArmed,
    isPlaying,
    bpm,
    syncCursorTargets,
    advanceCursor,
    resetToStart,
    stopToWaitMode,
    handleNoteEvent,
  };
}
