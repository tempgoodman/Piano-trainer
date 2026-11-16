import {
  ITutorEngine,
  MeasurePerformance,
  PerformanceSummary,
  TrainingPlan,
  TrainingStep,
} from './TutorEngineInterface';

interface AggregatedMetrics {
  totalExpected: number;
  totalWrongRh: number;
  totalWrongLh: number;
  totalMissedRh: number;
  totalMissedLh: number;
  totalErrorsRh: number;
  totalErrorsLh: number;
  totalPitchErrors: number;
  totalMissed: number;
  totalErrors: number;
  errorRate: number;
  pitchErrorRate: number;
  allTimingDeltas: number[];
  averageTimingDeltaMs: number;
  averageAbsTimingDeltaMs: number;
  significantRhythmErrorRatio: number;
}

interface WorstMeasureInfo {
  measureNumber: number;
  totalErrors: number;
  rhErrors: number;
  lhErrors: number;
  errorShare: number;
}

interface TransitionStumbleInfo {
  startMeasure: number;
  endMeasure: number;
  combinedErrors: number;
}

const MIN_BPM = 40;
const MAX_BPM = 200;

function clampBpm(bpm: number): number {
  return Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(bpm)));
}

function clampMeasure(measure: number, totalMeasures: number): number {
  return Math.max(1, Math.min(Math.max(1, totalMeasures), Math.round(measure)));
}

/**
 * Computes score-wide totals for Right Hand (Staff 1), Left Hand (Staff 2),
 * pitch errors, missed notes, and signed timing deviations.
 */
function computeAggregatedMetrics(measures: MeasurePerformance[]): AggregatedMetrics {
  let totalExpected = 0;
  let totalWrongRh = 0;
  let totalWrongLh = 0;
  let totalMissedRh = 0;
  let totalMissedLh = 0;
  const allTimingDeltas: number[] = [];

  for (const m of measures) {
    totalExpected += m.staff1.expectedNotes + m.staff2.expectedNotes;
    totalWrongRh += m.staff1.wrongPitches;
    totalWrongLh += m.staff2.wrongPitches;
    totalMissedRh += m.staff1.missedNotes;
    totalMissedLh += m.staff2.missedNotes;
    allTimingDeltas.push(...m.staff1.timingDeviationsMs, ...m.staff2.timingDeviationsMs);
  }

  const totalErrorsRh = totalWrongRh + totalMissedRh;
  const totalErrorsLh = totalWrongLh + totalMissedLh;
  const totalPitchErrors = totalWrongRh + totalWrongLh;
  const totalMissed = totalMissedRh + totalMissedLh;
  const totalErrors = totalPitchErrors + totalMissed;
  const denominator = Math.max(1, totalExpected);

  const averageTimingDeltaMs =
    allTimingDeltas.length > 0
      ? Math.round(allTimingDeltas.reduce((acc, v) => acc + v, 0) / allTimingDeltas.length)
      : 0;

  const averageAbsTimingDeltaMs =
    allTimingDeltas.length > 0
      ? Math.round(allTimingDeltas.reduce((acc, v) => acc + Math.abs(v), 0) / allTimingDeltas.length)
      : 0;

  const offBeatCount = allTimingDeltas.filter((d) => Math.abs(d) > 150).length;
  const significantRhythmErrorRatio =
    allTimingDeltas.length > 0 ? offBeatCount / allTimingDeltas.length : 0;

  return {
    totalExpected,
    totalWrongRh,
    totalWrongLh,
    totalMissedRh,
    totalMissedLh,
    totalErrorsRh,
    totalErrorsLh,
    totalPitchErrors,
    totalMissed,
    totalErrors,
    errorRate: totalErrors / denominator,
    pitchErrorRate: totalPitchErrors / denominator,
    allTimingDeltas,
    averageTimingDeltaMs,
    averageAbsTimingDeltaMs,
    significantRhythmErrorRatio,
  };
}

/**
 * Helper: Identifies the single measure with the highest error density.
 */
export function findWorstMeasure(
  measures: MeasurePerformance[],
  totalErrors: number
): WorstMeasureInfo | null {
  if (measures.length === 0) return null;

  let worst: MeasurePerformance | null = null;
  let worstCount = 0;

  for (const m of measures) {
    const rh = m.staff1.wrongPitches + m.staff1.missedNotes;
    const lh = m.staff2.wrongPitches + m.staff2.missedNotes;
    const sum = rh + lh;
    if (sum > worstCount) {
      worstCount = sum;
      worst = m;
    }
  }

  if (!worst || worstCount === 0) return null;

  const rhErrors = worst.staff1.wrongPitches + worst.staff1.missedNotes;
  const lhErrors = worst.staff2.wrongPitches + worst.staff2.missedNotes;

  return {
    measureNumber: worst.measureNumber,
    totalErrors: worstCount,
    rhErrors,
    lhErrors,
    errorShare: totalErrors > 0 ? worstCount / totalErrors : 0,
  };
}

/**
 * Helper: Rule 4 detector — checks whether the student consistently strikes notes early.
 */
export function detectRushing(deltas: number[]): { isRushing: boolean; meanDeltaMs: number } {
  if (deltas.length < 4) return { isRushing: false, meanDeltaMs: 0 };
  const mean = deltas.reduce((acc, v) => acc + v, 0) / deltas.length;
  const earlyRatio = deltas.filter((d) => d < -40).length / deltas.length;
  return {
    isRushing: mean <= -45 && earlyRatio >= 0.5,
    meanDeltaMs: Math.round(mean),
  };
}

/**
 * Helper: Rule 5 detector — checks whether the student consistently falls behind the beat.
 */
export function detectDragging(deltas: number[]): { isDragging: boolean; meanDeltaMs: number } {
  if (deltas.length < 4) return { isDragging: false, meanDeltaMs: 0 };
  const mean = deltas.reduce((acc, v) => acc + v, 0) / deltas.length;
  const lateRatio = deltas.filter((d) => d > 40).length / deltas.length;
  return {
    isDragging: mean >= 45 && lateRatio >= 0.5,
    meanDeltaMs: Math.round(mean),
  };
}

/**
 * Helper: Rule 8 detector — finds adjacent measure boundaries (e.g., M4 -> M5) with clustered errors.
 */
export function detectTransitionStumble(measures: MeasurePerformance[]): TransitionStumbleInfo | null {
  if (measures.length < 2) return null;
  const sorted = [...measures].sort((a, b) => a.measureNumber - b.measureNumber);

  let best: TransitionStumbleInfo | null = null;
  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    if (next.measureNumber !== cur.measureNumber + 1) continue;

    const curErr =
      cur.staff1.wrongPitches + cur.staff1.missedNotes + cur.staff2.wrongPitches + cur.staff2.missedNotes;
    const nextErr =
      next.staff1.wrongPitches +
      next.staff1.missedNotes +
      next.staff2.wrongPitches +
      next.staff2.missedNotes;

    if (curErr >= 2 && nextErr >= 2) {
      const combined = curErr + nextErr;
      if (!best || combined > best.combinedErrors) {
        best = {
          startMeasure: cur.measureNumber,
          endMeasure: next.measureNumber,
          combinedErrors: combined,
        };
      }
    }
  }

  return best;
}

/**
 * Helper: Rule 9 detector — checks whether errors concentrate in the final 20% of the score.
 */
export function detectEndOfPieceFatigue(
  measures: MeasurePerformance[],
  totalMeasures: number,
  totalErrors: number
): { hasFatigue: boolean; tailStartMeasure: number } {
  if (totalMeasures < 4 || totalErrors < 3) {
    return { hasFatigue: false, tailStartMeasure: totalMeasures };
  }

  const tailCount = Math.max(1, Math.ceil(totalMeasures * 0.2));
  const tailStartMeasure = Math.max(1, totalMeasures - tailCount + 1);

  let tailErrors = 0;
  for (const m of measures) {
    if (m.measureNumber >= tailStartMeasure) {
      tailErrors +=
        m.staff1.wrongPitches + m.staff1.missedNotes + m.staff2.wrongPitches + m.staff2.missedNotes;
    }
  }

  return {
    hasFatigue: tailErrors / Math.max(1, totalErrors) >= 0.55,
    tailStartMeasure,
  };
}

/**
 * Helper: Rule 10 detector — finds where the student stopped playing (>= 3 consecutive missed notes).
 */
export function detectConsecutiveMissedSection(
  measures: MeasurePerformance[]
): { firstMissedMeasure: number; maxStreak: number } | null {
  const sorted = [...measures].sort((a, b) => a.measureNumber - b.measureNumber);
  for (const m of sorted) {
    if (m.consecutiveMissedCount >= 3) {
      return {
        firstMissedMeasure: m.measureNumber,
        maxStreak: m.consecutiveMissedCount,
      };
    }
  }
  return null;
}

/**
 * Concrete Strategy implementing 15 deterministic piano pedagogy rules.
 */
export class RuleBasedTutorEngine implements ITutorEngine {
  public readonly engineType = 'RULE' as const;

  public async generatePlan(performanceData: PerformanceSummary): Promise<TrainingPlan> {
    const totalMeasures = Math.max(1, performanceData.totalMeasures || performanceData.measures.length || 1);
    const currentBpm = clampBpm(performanceData.currentBpm || performanceData.targetBpm || 80);
    const metrics = computeAggregatedMetrics(performanceData.measures);
    const appliedRuleIds: number[] = [];
    const steps: Omit<TrainingStep, 'id' | 'stepNumber'>[] = [];
    const feedbackParts: string[] = [];

    const pushStep = (step: Omit<TrainingStep, 'id' | 'stepNumber'>) => {
      if (!appliedRuleIds.includes(step.ruleId)) {
        appliedRuleIds.push(step.ruleId);
      }
      steps.push(step);
    };

    const buildMetricsSnapshot = () => ({
      overallScore: Math.round(performanceData.overallScore),
      errorRatePercent: Math.round(metrics.errorRate * 100),
      rightHandErrors: metrics.totalErrorsRh,
      leftHandErrors: metrics.totalErrorsLh,
      averageTimingDeltaMs: metrics.averageTimingDeltaMs,
    });

    // -----------------------------------------------------------------------
    // RULE 15: Empty Performance (No notes detected)
    // -----------------------------------------------------------------------
    if (performanceData.detectedNotesCount === 0) {
      pushStep({
        ruleId: 15,
        ruleName: 'Empty Performance Check',
        title: 'Verify Keyboard Input in Wait Mode',
        instruction:
          'No incoming notes were detected. Check your USB MIDI cable, confirm input source is set to Both or MIDI Piano, and test playing Measure 1 in Wait Mode.',
        mode: 'wait',
        handMode: 'both',
        targetBpm: currentBpm,
        metronomeEnabled: false,
        loopRange: {
          enabled: false,
          startMeasure: 1,
          endMeasure: totalMeasures,
        },
        focusTag: 'Setup Check',
      });

      return this.finalizePlan(
        performanceData,
        'No notes detected during practice pass',
        'No piano keystrokes were captured. Verify your MIDI keyboard connection or click keys on the Virtual Piano, then start in Wait Mode.',
        appliedRuleIds,
        steps,
        buildMetricsSnapshot()
      );
    }

    const rushing = detectRushing(metrics.allTimingDeltas);
    const dragging = detectDragging(metrics.allTimingDeltas);

    // -----------------------------------------------------------------------
    // RULE 13: 100% Perfect Run (Challenge Mode)
    // -----------------------------------------------------------------------
    if (
      metrics.totalErrors === 0 &&
      performanceData.overallScore >= 99 &&
      !rushing.isRushing &&
      !dragging.isDragging &&
      metrics.significantRhythmErrorRatio < 0.1
    ) {
      const challengeBpm = clampBpm(currentBpm * 1.1);
      pushStep({
        ruleId: 13,
        ruleName: '100% Perfect Run — Challenge Mode',
        title: `Full Run Mastery Challenge (${challengeBpm} BPM)`,
        instruction: `Flawless pitches and steady pulse! Push your fluency by playing the entire piece at ${challengeBpm} BPM (110% tempo) with the metronome.`,
        mode: 'tempo',
        handMode: 'both',
        targetBpm: challengeBpm,
        metronomeEnabled: true,
        loopRange: {
          enabled: false,
          startMeasure: 1,
          endMeasure: totalMeasures,
        },
        focusTag: '110% Challenge',
      });

      return this.finalizePlan(
        performanceData,
        'Clean 100% pass — ready to raise tempo',
        `Outstanding accuracy (${Math.round(performanceData.overallScore)}%). Every pitch and beat landed cleanly. Let's step tempo up by 10% to ${challengeBpm} BPM.`,
        appliedRuleIds,
        steps,
        buildMetricsSnapshot()
      );
    }

    // -----------------------------------------------------------------------
    // RULE 14: Too Many Errors Everywhere (> 30% overall error)
    // -----------------------------------------------------------------------
    if (metrics.errorRate > 0.3) {
      const midpoint = clampMeasure(Math.ceil(totalMeasures / 2), totalMeasures);
      pushStep({
        ruleId: 14,
        ruleName: 'Section Halving Safety Reset',
        title: `First-Half Foundation Loop (M1–M${midpoint})`,
        instruction: `Over ${Math.round(metrics.errorRate * 100)}% of notes had pitch or missed-note errors. Break the piece in half and master Measures 1–${midpoint} calmly in Wait Mode first.`,
        mode: 'wait',
        handMode: 'both',
        targetBpm: clampBpm(currentBpm * 0.75),
        metronomeEnabled: false,
        loopRange: {
          enabled: true,
          startMeasure: 1,
          endMeasure: midpoint,
        },
        focusTag: 'First Half Chunk',
      });
      feedbackParts.push(
        `The full piece had too many simultaneous errors (${Math.round(metrics.errorRate * 100)}%). Splitting into Measures 1–${midpoint} in Wait Mode removes time pressure so muscle memory can settle.`
      );
    }

    // -----------------------------------------------------------------------
    // RULE 10: Consecutive Missed Notes (User stopped playing — section too fast)
    // -----------------------------------------------------------------------
    const consecutiveMiss = detectConsecutiveMissedSection(performanceData.measures);
    if (consecutiveMiss) {
      const slowerBpm = clampBpm(currentBpm * 0.7);
      const loopStart = clampMeasure(consecutiveMiss.firstMissedMeasure, totalMeasures);
      pushStep({
        ruleId: 10,
        ruleName: 'Consecutive Missed Notes Recovery',
        title: `Recover From M${loopStart} at 70% Tempo (${slowerBpm} BPM)`,
        instruction: `You paused for ${consecutiveMiss.maxStreak} consecutive notes starting at Measure ${loopStart}, indicating the tempo outpaced your reading. Loop M${loopStart}–M${totalMeasures} at ${slowerBpm} BPM.`,
        mode: 'tempo',
        handMode: 'both',
        targetBpm: slowerBpm,
        metronomeEnabled: true,
        loopRange: {
          enabled: true,
          startMeasure: loopStart,
          endMeasure: totalMeasures,
        },
        focusTag: '-30% Recovery Loop',
      });
      feedbackParts.push(
        `Multiple consecutive missed notes appeared at Measure ${loopStart}. Dropping tempo by 30% to ${slowerBpm} BPM will keep continuity intact.`
      );
    }

    // -----------------------------------------------------------------------
    // RULE 7 & RULE 8 & RULE 9: Targeted Chunking & Measure Loops
    // -----------------------------------------------------------------------
    const worstMeasure = findWorstMeasure(performanceData.measures, metrics.totalErrors);
    const transitionStumble = detectTransitionStumble(performanceData.measures);
    const endFatigue = detectEndOfPieceFatigue(
      performanceData.measures,
      totalMeasures,
      metrics.totalErrors
    );

    // Rule 7: Single Stubborn Measure (high error density in 1 bar)
    if (
      worstMeasure &&
      (worstMeasure.totalErrors >= 3 && (worstMeasure.errorShare >= 0.4 || performanceData.measures.length <= 2))
    ) {
      const mNum = clampMeasure(worstMeasure.measureNumber, totalMeasures);
      pushStep({
        ruleId: 7,
        ruleName: 'Single Stubborn Measure Micro-Loop',
        title: `Micro-Loop Measure ${mNum} in Wait Mode`,
        instruction: `Measure ${mNum} accounted for ${worstMeasure.totalErrors} errors (${Math.round(worstMeasure.errorShare * 100)}% of total). Isolate and repeat Measure ${mNum} slowly until 3 clean passes in a row.`,
        mode: 'wait',
        handMode: 'both',
        targetBpm: currentBpm,
        metronomeEnabled: false,
        loopRange: {
          enabled: true,
          startMeasure: mNum,
          endMeasure: mNum,
        },
        focusTag: `M${mNum} Micro-Loop`,
      });
      feedbackParts.push(`Measure ${mNum} is the main bottleneck and deserves a 1-bar micro-loop.`);
    }

    // Rule 8: Transition Stumble (Boundary of 2 adjacent measures, e.g., M4 and M5)
    if (transitionStumble) {
      const transBpm = clampBpm(currentBpm * 0.7);
      pushStep({
        ruleId: 8,
        ruleName: 'Measure Transition Stumble',
        title: `Smooth M${transitionStumble.startMeasure}→M${transitionStumble.endMeasure} Barline (${transBpm} BPM)`,
        instruction: `Errors clustered across the barline between Measures ${transitionStumble.startMeasure} and ${transitionStumble.endMeasure}. Loop M${transitionStumble.startMeasure}–M${transitionStumble.endMeasure} at 70% tempo (${transBpm} BPM) looking ahead to the downbeat.`,
        mode: 'tempo',
        handMode: 'both',
        targetBpm: transBpm,
        metronomeEnabled: true,
        loopRange: {
          enabled: true,
          startMeasure: clampMeasure(transitionStumble.startMeasure, totalMeasures),
          endMeasure: clampMeasure(transitionStumble.endMeasure, totalMeasures),
        },
        focusTag: `M${transitionStumble.startMeasure}–M${transitionStumble.endMeasure} Seam`,
      });
      feedbackParts.push(
        `The transition from Measure ${transitionStumble.startMeasure} into Measure ${transitionStumble.endMeasure} broke flow.`
      );
    }

    // Rule 9: End-of-Piece Fatigue (Errors concentrated in the last 20% of the song)
    if (endFatigue.hasFatigue) {
      pushStep({
        ruleId: 9,
        ruleName: 'End-of-Piece Fatigue Drill',
        title: `Closing Phrase Loop (M${endFatigue.tailStartMeasure}–M${totalMeasures})`,
        instruction: `Over half of your errors occurred in the final 20% of the piece (Measures ${endFatigue.tailStartMeasure}–${totalMeasures}). Practice the ending fresh so it feels as secure as the opening.`,
        mode: 'tempo',
        handMode: 'both',
        targetBpm: clampBpm(currentBpm * 0.85),
        metronomeEnabled: true,
        loopRange: {
          enabled: true,
          startMeasure: endFatigue.tailStartMeasure,
          endMeasure: totalMeasures,
        },
        focusTag: 'Final 20% Loop',
      });
      feedbackParts.push(
        `Focus slipped in the closing 20% (Measures ${endFatigue.tailStartMeasure}–${totalMeasures}); drilling the ending first builds stamina.`
      );
    }

    // -----------------------------------------------------------------------
    // HAND ISOLATION & SCAFFOLDING RULES (Rules 1, 2, 3, 11)
    // -----------------------------------------------------------------------
    const highLhMeasure = performanceData.measures.find((m) => m.staff2.wrongPitches > 3);
    const highRhMeasure = performanceData.measures.find((m) => m.staff1.wrongPitches > 3);
    const hasBothHandsPitchErrors =
      (metrics.totalWrongRh >= 2 && metrics.totalWrongLh >= 2) ||
      (Boolean(highRhMeasure) && Boolean(highLhMeasure));
    const hasPerfectLeftMessyRight =
      metrics.totalErrorsLh === 0 &&
      metrics.totalWrongRh >= 2 &&
      metrics.totalExpected > 0;

    const focusStart = worstMeasure ? clampMeasure(worstMeasure.measureNumber, totalMeasures) : 1;
    const focusEnd = worstMeasure
      ? clampMeasure(Math.min(totalMeasures, worstMeasure.measureNumber + 1), totalMeasures)
      : totalMeasures;

    if (hasPerfectLeftMessyRight) {
      // RULE 11: Perfect Left, Messy Right -> 2 Steps (RH Wait Mode, Both Hands Slow Tempo)
      const slowTempo = clampBpm(currentBpm * 0.8);
      pushStep({
        ruleId: 11,
        ruleName: 'Scaffolding: Perfect Left, Messy Right',
        title: 'Step 1: Right Hand Melody Accuracy (Wait Mode)',
        instruction:
          'Your Left Hand accompaniment was spotless, while the Right Hand missed pitches. Isolate the Right Hand in Wait Mode to lock in melody fingerings.',
        mode: 'wait',
        handMode: 'right',
        targetBpm: currentBpm,
        metronomeEnabled: false,
        loopRange: {
          enabled: totalMeasures > 4,
          startMeasure: focusStart,
          endMeasure: totalMeasures > 4 ? focusEnd : totalMeasures,
        },
        focusTag: 'RH Wait Isolate',
      });
      pushStep({
        ruleId: 11,
        ruleName: 'Scaffolding: Perfect Left, Messy Right',
        title: `Step 2: Reunite Both Hands Slowly (${slowTempo} BPM)`,
        instruction: `Bring your secure Left Hand back together with the Right Hand in Tempo Mode at a relaxed ${slowTempo} BPM.`,
        mode: 'tempo',
        handMode: 'both',
        targetBpm: slowTempo,
        metronomeEnabled: true,
        loopRange: {
          enabled: false,
          startMeasure: 1,
          endMeasure: totalMeasures,
        },
        focusTag: 'Hands Together Slow',
      });
      feedbackParts.push('Left Hand was accurate; targeted Right Hand scaffolding will clean up the melody.');
    } else if (hasBothHandsPitchErrors) {
      // RULE 3: Both Hands Pitch Errors -> 3 Steps (RH Slow, LH Slow, Both Hands Slow)
      const slowBpm = clampBpm(currentBpm * 0.75);
      pushStep({
        ruleId: 3,
        ruleName: 'Hands-Separate Three-Step Rebuild',
        title: `Step 1: Right Hand Only — Slow (${slowBpm} BPM)`,
        instruction: `Both hands need pitch reinforcement. Practice the Right Hand staff alone at ${slowBpm} BPM in Wait Mode before combining.`,
        mode: 'wait',
        handMode: 'right',
        targetBpm: slowBpm,
        metronomeEnabled: false,
        loopRange: {
          enabled: false,
          startMeasure: 1,
          endMeasure: totalMeasures,
        },
        focusTag: '1/3 RH Slow',
      });
      pushStep({
        ruleId: 3,
        ruleName: 'Hands-Separate Three-Step Rebuild',
        title: `Step 2: Left Hand Only — Slow (${slowBpm} BPM)`,
        instruction: `Now isolate the Left Hand staff at ${slowBpm} BPM in Wait Mode, listening for steady bass notes and chord shapes.`,
        mode: 'wait',
        handMode: 'left',
        targetBpm: slowBpm,
        metronomeEnabled: false,
        loopRange: {
          enabled: false,
          startMeasure: 1,
          endMeasure: totalMeasures,
        },
        focusTag: '2/3 LH Slow',
      });
      pushStep({
        ruleId: 3,
        ruleName: 'Hands-Separate Three-Step Rebuild',
        title: `Step 3: Both Hands Together — Slow Tempo (${slowBpm} BPM)`,
        instruction: `Combine both hands at ${slowBpm} BPM in Tempo Mode with the metronome guiding vertical alignment.`,
        mode: 'tempo',
        handMode: 'both',
        targetBpm: slowBpm,
        metronomeEnabled: true,
        loopRange: {
          enabled: false,
          startMeasure: 1,
          endMeasure: totalMeasures,
        },
        focusTag: '3/3 Combined Slow',
      });
      feedbackParts.push('Pitch slips appeared in both staves — use a classic 3-step RH → LH → Both Hands rebuild.');
    } else {
      // RULE 1: High Left-Hand Pitch Errors (> 3 in a measure or clearly dominant LH errors)
      if (highLhMeasure || (metrics.totalWrongLh >= 3 && metrics.totalWrongLh > metrics.totalWrongRh * 1.5)) {
        const targetMeasure = highLhMeasure?.measureNumber ?? focusStart;
        pushStep({
          ruleId: 1,
          ruleName: 'Left-Hand Pitch Isolation',
          title: `Isolate Left Hand in Wait Mode (M${targetMeasure})`,
          instruction: `Left Hand pitch errors spiked${highLhMeasure ? ` (${highLhMeasure.staff2.wrongPitches} wrong pitches in Measure ${targetMeasure})` : ''}. Isolate Staff 2 (Left Hand) in Wait Mode to secure bass harmony.`,
          mode: 'wait',
          handMode: 'left',
          targetBpm: currentBpm,
          metronomeEnabled: false,
          loopRange: {
            enabled: Boolean(highLhMeasure),
            startMeasure: clampMeasure(targetMeasure, totalMeasures),
            endMeasure: clampMeasure(Math.min(totalMeasures, targetMeasure + 1), totalMeasures),
          },
          focusTag: 'LH Wait Isolate',
        });
        feedbackParts.push('Left Hand notes need focused Wait Mode attention before playing hands together.');
      }

      // RULE 2: High Right-Hand Pitch Errors
      if (highRhMeasure || (metrics.totalWrongRh >= 3 && metrics.totalWrongRh > metrics.totalWrongLh * 1.5)) {
        const targetMeasure = highRhMeasure?.measureNumber ?? focusStart;
        pushStep({
          ruleId: 2,
          ruleName: 'Right-Hand Pitch Isolation',
          title: `Isolate Right Hand in Wait Mode (M${targetMeasure})`,
          instruction: `Right Hand pitch errors stood out${highRhMeasure ? ` (${highRhMeasure.staff1.wrongPitches} wrong pitches in Measure ${targetMeasure})` : ''}. Practice Staff 1 (Right Hand) alone in Wait Mode.`,
          mode: 'wait',
          handMode: 'right',
          targetBpm: currentBpm,
          metronomeEnabled: false,
          loopRange: {
            enabled: Boolean(highRhMeasure),
            startMeasure: clampMeasure(targetMeasure, totalMeasures),
            endMeasure: clampMeasure(Math.min(totalMeasures, targetMeasure + 1), totalMeasures),
          },
          focusTag: 'RH Wait Isolate',
        });
        feedbackParts.push('Right Hand melody pitches need hands-separate verification in Wait Mode.');
      }
    }

    // -----------------------------------------------------------------------
    // TIMING & RHYTHM RULES (Rules 4, 5, 6)
    // -----------------------------------------------------------------------
    if (rushing.isRushing) {
      // RULE 4: Constant Rushing (Early timing) -> Drop BPM by 15%
      const adjustedBpm = clampBpm(currentBpm * 0.85);
      pushStep({
        ruleId: 4,
        ruleName: 'Rushing Correction (-15% Tempo)',
        title: `Steady Pulse — Drop 15% to ${adjustedBpm} BPM`,
        instruction: `Your average timing was ${Math.abs(rushing.meanDeltaMs)}ms early (rushing). Slow down 15% to ${adjustedBpm} BPM in Tempo Mode and wait for each metronome click.`,
        mode: 'tempo',
        handMode: 'both',
        targetBpm: adjustedBpm,
        metronomeEnabled: true,
        loopRange: {
          enabled: false,
          startMeasure: 1,
          endMeasure: totalMeasures,
        },
        focusTag: '-15% Anti-Rush',
      });
      feedbackParts.push(
        `You tended to rush ahead of the beat (avg ${rushing.meanDeltaMs}ms). Dropping 15% to ${adjustedBpm} BPM with the metronome restores control.`
      );
    } else if (dragging.isDragging) {
      // RULE 5: Constant Dragging (Late timing) -> Drop BPM by 20%
      const adjustedBpm = clampBpm(currentBpm * 0.8);
      pushStep({
        ruleId: 5,
        ruleName: 'Dragging Correction (-20% Tempo)',
        title: `Relax Tempo — Drop 20% to ${adjustedBpm} BPM`,
        instruction: `Notes landed an average of +${dragging.meanDeltaMs}ms behind the beat (dragging). Drop tempo 20% to ${adjustedBpm} BPM so you can read ahead comfortably.`,
        mode: 'tempo',
        handMode: 'both',
        targetBpm: adjustedBpm,
        metronomeEnabled: true,
        loopRange: {
          enabled: false,
          startMeasure: 1,
          endMeasure: totalMeasures,
        },
        focusTag: '-20% Catch-Up',
      });
      feedbackParts.push(
        `Timing dragged slightly behind the beat (avg +${dragging.meanDeltaMs}ms). Taking 20% off the tempo (${adjustedBpm} BPM) builds forward reading ease.`
      );
    } else if (
      metrics.totalPitchErrors === 0 &&
      (metrics.significantRhythmErrorRatio >= 0.25 || metrics.averageAbsTimingDeltaMs > 110)
    ) {
      // RULE 6: Rhythm Errors but Perfect Pitch -> Current BPM + Metronome Focus
      pushStep({
        ruleId: 6,
        ruleName: 'Rhythm Lock with Metronome',
        title: `Metronome Rhythm Lock at ${currentBpm} BPM`,
        instruction: `Every pitch was correct, but beat alignment drifted (avg ±${metrics.averageAbsTimingDeltaMs}ms). Keep ${currentBpm} BPM in Tempo Mode with the Metronome on and count subdivisions aloud.`,
        mode: 'tempo',
        handMode: 'both',
        targetBpm: currentBpm,
        metronomeEnabled: true,
        loopRange: {
          enabled: false,
          startMeasure: 1,
          endMeasure: totalMeasures,
        },
        focusTag: 'Metronome Focus',
      });
      feedbackParts.push(
        `Pitch accuracy is 100%, so focus exclusively on locking rhythms to the metronome at ${currentBpm} BPM.`
      );
    }

    // -----------------------------------------------------------------------
    // RULE 12: Minor Scattered Errors (< 5% error rate) — Polish Step
    // -----------------------------------------------------------------------
    if (metrics.errorRate > 0 && metrics.errorRate < 0.05 && steps.length === 0) {
      const polishBpm = clampBpm(currentBpm * 0.9);
      pushStep({
        ruleId: 12,
        ruleName: 'Minor Scattered Errors Polish',
        title: `Full Run Consolidation at 90% (${polishBpm} BPM)`,
        instruction: `Only minor scattered slips (${(metrics.errorRate * 100).toFixed(1)}% error rate). Run the full piece once in Tempo Mode at 90% speed (${polishBpm} BPM) to lock in effortless consistency.`,
        mode: 'tempo',
        handMode: 'both',
        targetBpm: polishBpm,
        metronomeEnabled: true,
        loopRange: {
          enabled: false,
          startMeasure: 1,
          endMeasure: totalMeasures,
        },
        focusTag: '90% Polish Run',
      });
      feedbackParts.push(
        `Very close to mastery (${(metrics.errorRate * 100).toFixed(1)}% error rate). A clean 90% tempo run will polish out those minor slips.`
      );
    }

    // Safety fallback if subtle errors fell between thresholds without triggering a specialized step
    if (steps.length === 0) {
      const polishBpm = clampBpm(currentBpm * 0.9);
      pushStep({
        ruleId: 12,
        ruleName: 'Controlled Tempo Consolidation',
        title: `Full Piece Tempo Consolidation (${polishBpm} BPM)`,
        instruction: `Practice the full piece in Tempo Mode at ${polishBpm} BPM with the metronome enabled to reinforce evenness across all measures.`,
        mode: 'tempo',
        handMode: 'both',
        targetBpm: polishBpm,
        metronomeEnabled: true,
        loopRange: {
          enabled: false,
          startMeasure: 1,
          endMeasure: totalMeasures,
        },
        focusTag: '90% Consolidation',
      });
      feedbackParts.push(`A controlled run at ${polishBpm} BPM will solidify consistency.`);
    }

    const diagnosis = this.buildHeadlineDiagnosis(appliedRuleIds, metrics);
    const generalFeedback =
      feedbackParts.length > 0
        ? feedbackParts.join(' ')
        : 'Follow the targeted practice playlist below step by step.';

    return this.finalizePlan(
      performanceData,
      diagnosis,
      generalFeedback,
      appliedRuleIds,
      steps,
      buildMetricsSnapshot()
    );
  }

  private buildHeadlineDiagnosis(ruleIds: number[], metrics: AggregatedMetrics): string {
    if (ruleIds.includes(14)) return 'High overall error density — split score in half';
    if (ruleIds.includes(10)) return 'Continuity pause detected — slow recovery section';
    if (ruleIds.includes(11)) return 'Strong Left Hand, Right Hand melody needs isolation';
    if (ruleIds.includes(3)) return 'Both hands need slow hands-separate reinforcement';
    if (ruleIds.includes(1)) return 'Left Hand pitch slips need Wait Mode isolation';
    if (ruleIds.includes(2)) return 'Right Hand pitch slips need Wait Mode isolation';
    if (ruleIds.includes(4)) return 'Rushing ahead of the beat — stabilize with slower metronome';
    if (ruleIds.includes(5)) return 'Dragging behind the beat — ease tempo by 20%';
    if (ruleIds.includes(6)) return 'Accurate pitches — tighten rhythm alignment with metronome';
    if (ruleIds.includes(8)) return 'Measure transition stumble — drill barline seam';
    if (ruleIds.includes(7)) return 'Single stubborn measure — apply 1-bar micro-loop';
    if (ruleIds.includes(9)) return 'End-of-piece fatigue — drill final 20% fresh';
    if (metrics.errorRate < 0.05) return 'Minor scattered slips — 90% tempo polish run';
    return 'Targeted practice plan ready';
  }

  private finalizePlan(
    performanceData: PerformanceSummary,
    overallDiagnosis: string,
    generalFeedback: string,
    appliedRuleIds: number[],
    rawSteps: Omit<TrainingStep, 'id' | 'stepNumber'>[],
    metricsSnapshot: TrainingPlan['metricsSnapshot']
  ): TrainingPlan {
    const trainingPlaylist: TrainingStep[] = rawSteps.map((step, index) => ({
      ...step,
      id: `${performanceData.songId}-step-${index + 1}-r${step.ruleId}`,
      stepNumber: index + 1,
    }));

    return {
      engineType: this.engineType,
      generatedAt: new Date().toISOString(),
      overallDiagnosis,
      generalFeedback,
      appliedRuleIds,
      metricsSnapshot,
      trainingPlaylist,
    };
  }
}
