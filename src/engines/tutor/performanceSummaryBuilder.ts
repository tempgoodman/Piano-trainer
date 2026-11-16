import {
  MeasurePerformance,
  PerformanceSummary,
  StaffMeasureMetrics,
} from './TutorEngineInterface';
import { ScorePiece, ScoreStats } from '../../types/music';

function createEmptyStaffMetrics(): StaffMeasureMetrics {
  return {
    expectedNotes: 0,
    correctPitchNotes: 0,
    wrongPitches: 0,
    missedNotes: 0,
    timingDeviationsMs: [],
  };
}

export function createEmptyMeasurePerformance(measureNumber: number): MeasurePerformance {
  return {
    measureNumber,
    staff1: createEmptyStaffMetrics(),
    staff2: createEmptyStaffMetrics(),
    consecutiveMissedCount: 0,
  };
}

export interface LiveSessionTelemetryInput {
  score: ScorePiece;
  totalMeasures: number;
  currentBpm: number;
  scoreStats: ScoreStats;
  notesHit: number;
  notesMissed: number;
  detectedNotesCount: number;
  measureMap: Record<number, MeasurePerformance>;
}

/**
 * Builds a complete `PerformanceSummary` from live session measure/staff metrics.
 */
export function buildLivePerformanceSummary(input: LiveSessionTelemetryInput): PerformanceSummary {
  const totalMeasures = Math.max(1, input.totalMeasures || input.score.measures || 1);
  const measures: MeasurePerformance[] = [];

  for (let m = 1; m <= totalMeasures; m++) {
    const existing = input.measureMap[m];
    measures.push(
      existing
        ? {
            measureNumber: m,
            staff1: {
              ...existing.staff1,
              timingDeviationsMs: [...existing.staff1.timingDeviationsMs],
            },
            staff2: {
              ...existing.staff2,
              timingDeviationsMs: [...existing.staff2.timingDeviationsMs],
            },
            consecutiveMissedCount: existing.consecutiveMissedCount,
          }
        : createEmptyMeasurePerformance(m)
    );
  }

  const totalEvaluated =
    input.scoreStats.perfect +
    input.scoreStats.good +
    input.scoreStats.miss +
    input.scoreStats.wrong;

  let overallScore = 0;
  if (input.detectedNotesCount === 0) {
    overallScore = 0;
  } else if (totalEvaluated > 0) {
    const weightedPoints = input.scoreStats.perfect * 100 + input.scoreStats.good * 70;
    overallScore = Math.max(0, Math.min(100, Math.round(weightedPoints / totalEvaluated)));
  } else {
    const attempts = input.notesHit + input.notesMissed;
    overallScore = attempts > 0 ? Math.round((input.notesHit / attempts) * 100) : 100;
  }

  return {
    songId: input.score.id,
    songTitle: input.score.title,
    overallScore,
    currentBpm: input.currentBpm,
    targetBpm: input.score.bpm,
    totalMeasures,
    detectedNotesCount: input.detectedNotesCount,
    measures,
  };
}

export interface DiagnosticPreset {
  id: string;
  label: string;
  build: (score: ScorePiece, totalMeasures: number, currentBpm: number) => PerformanceSummary;
}

function makeBaselineMeasures(totalMeasures: number): MeasurePerformance[] {
  return Array.from({ length: totalMeasures }, (_, idx) => ({
    measureNumber: idx + 1,
    staff1: {
      expectedNotes: 4,
      correctPitchNotes: 4,
      wrongPitches: 0,
      missedNotes: 0,
      timingDeviationsMs: [12, -8, 18, -14],
    },
    staff2: {
      expectedNotes: 2,
      correctPitchNotes: 2,
      wrongPitches: 0,
      missedNotes: 0,
      timingDeviationsMs: [10, -12],
    },
    consecutiveMissedCount: 0,
  }));
}

/**
 * Sample diagnostic scenarios so teachers/students can test any pedagogical rule immediately.
 */
export const TUTOR_DIAGNOSTIC_PRESETS: DiagnosticPreset[] = [
  {
    id: 'messy-lh',
    label: 'High Left-Hand Errors',
    build: (score, totalMeasures, currentBpm) => {
      const mCount = Math.max(4, totalMeasures);
      const measures = makeBaselineMeasures(mCount);
      measures[1].staff2.wrongPitches = 4;
      measures[1].staff2.correctPitchNotes = 0;
      measures[2].staff2.wrongPitches = 2;
      return {
        songId: score.id,
        songTitle: score.title,
        overallScore: 76,
        currentBpm,
        targetBpm: score.bpm,
        totalMeasures: mCount,
        detectedNotesCount: mCount * 6,
        measures,
      };
    },
  },
  {
    id: 'rushing',
    label: 'Constant Rushing',
    build: (score, totalMeasures, currentBpm) => {
      const mCount = Math.max(4, totalMeasures);
      const measures = makeBaselineMeasures(mCount).map((m) => ({
        ...m,
        staff1: {
          ...m.staff1,
          timingDeviationsMs: [-110, -95, -140, -125],
        },
        staff2: {
          ...m.staff2,
          timingDeviationsMs: [-90, -115],
        },
      }));
      return {
        songId: score.id,
        songTitle: score.title,
        overallScore: 81,
        currentBpm,
        targetBpm: score.bpm,
        totalMeasures: mCount,
        detectedNotesCount: mCount * 6,
        measures,
      };
    },
  },
  {
    id: 'transition-stumble',
    label: 'Measure Seam Stumble',
    build: (score, totalMeasures, currentBpm) => {
      const mCount = Math.max(6, totalMeasures);
      const measures = makeBaselineMeasures(mCount);
      const mA = Math.min(3, mCount - 2);
      measures[mA].staff1.wrongPitches = 2;
      measures[mA].staff2.missedNotes = 1;
      measures[mA + 1].staff1.wrongPitches = 2;
      measures[mA + 1].staff2.wrongPitches = 1;
      return {
        songId: score.id,
        songTitle: score.title,
        overallScore: 82,
        currentBpm,
        targetBpm: score.bpm,
        totalMeasures: mCount,
        detectedNotesCount: mCount * 6,
        measures,
      };
    },
  },
  {
    id: 'perfect-run',
    label: '100% Perfect Run',
    build: (score, totalMeasures, currentBpm) => {
      const mCount = Math.max(4, totalMeasures);
      const measures = makeBaselineMeasures(mCount);
      return {
        songId: score.id,
        songTitle: score.title,
        overallScore: 100,
        currentBpm,
        targetBpm: score.bpm,
        totalMeasures: mCount,
        detectedNotesCount: mCount * 6,
        measures,
      };
    },
  },
];
