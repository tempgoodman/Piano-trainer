import { FEEDBACK_COLORS, ScoreGrade, ScoringResult } from '../types/music';

/**
 * Anson Practice Piano — Timing & Pitch Scoring Engine
 *
 * Timing tolerance windows (in milliseconds):
 * - |delta| <= 150ms -> Perfect (Green)
 * - |delta| <= 300ms -> Good / Early or Late (Yellow)
 * - |delta| >  300ms -> Miss (Grey)
 * - Pitch mismatch   -> Wrong Note (Red)
 */
export const PERFECT_WINDOW_MS = 150;
export const GOOD_WINDOW_MS = 300;

export function evaluateNoteInput(
  inputPitch: number,
  inputTime: number,
  expectedPitch: number,
  expectedTime: number
): ScoringResult {
  const deltaMs = Math.round(inputTime - expectedTime);

  // 1. Pitch check takes precedence
  if (inputPitch !== expectedPitch) {
    return {
      grade: 'wrong',
      deltaMs,
      color: FEEDBACK_COLORS.wrong,
      label: 'Wrong Pitch',
      points: 0,
    };
  }

  // 2. Timing evaluation for matching pitch
  const absDelta = Math.abs(deltaMs);

  if (absDelta <= PERFECT_WINDOW_MS) {
    return {
      grade: 'perfect',
      deltaMs,
      color: FEEDBACK_COLORS.perfect,
      label: 'Perfect',
      points: 100,
    };
  }

  if (absDelta <= GOOD_WINDOW_MS) {
    const timingHint = deltaMs < 0 ? 'Early' : 'Late';
    return {
      grade: 'good',
      deltaMs,
      color: FEEDBACK_COLORS.good,
      label: `Good (${timingHint} ${absDelta}ms)`,
      points: 50,
    };
  }

  return {
    grade: 'miss',
    deltaMs,
    color: FEEDBACK_COLORS.miss,
    label: deltaMs < 0 ? 'Too Early' : 'Too Late',
    points: 0,
  };
}

/**
 * Evaluates an incoming note against a chord / set of expected MIDI pitches at a cursor beat.
 * Returns the matched pitch and its ScoringResult, or a 'wrong' result if none match.
 */
export function evaluateChordInput(
  inputPitch: number,
  inputTime: number,
  expectedPitches: number[],
  expectedTime: number
): { matchedPitch: number | null; result: ScoringResult } {
  if (expectedPitches.includes(inputPitch)) {
    return {
      matchedPitch: inputPitch,
      result: evaluateNoteInput(inputPitch, inputTime, inputPitch, expectedTime),
    };
  }

  const referencePitch = expectedPitches[0] ?? inputPitch;
  return {
    matchedPitch: null,
    result: evaluateNoteInput(inputPitch, inputTime, referencePitch, expectedTime),
  };
}

export function gradeToLabel(grade: ScoreGrade): string {
  switch (grade) {
    case 'perfect':
      return 'Perfect';
    case 'good':
      return 'Good';
    case 'wrong':
      return 'Wrong Note';
    case 'miss':
      return 'Missed';
  }
}
