import { HandMode, PracticeMode } from '../../types/music';

/**
 * Staff-level performance breakdown within a single measure.
 * Staff 1 = Treble (Right Hand), Staff 2 = Bass (Left Hand).
 */
export interface StaffMeasureMetrics {
  /** Total expected notes in this staff for the measure */
  expectedNotes: number;
  /** Notes played with matching pitch (including slightly early/late) */
  correctPitchNotes: number;
  /** Count of wrong-pitch keystrokes attributed to this staff */
  wrongPitches: number;
  /** Count of expected notes missed (cursor passed without valid noteOn) */
  missedNotes: number;
  /** Signed timing offsets in milliseconds (negative = early/rushing, positive = late/dragging) */
  timingDeviationsMs: number[];
}

/**
 * Measure-by-measure performance record separated by Staff 1 (Right) and Staff 2 (Left).
 */
export interface MeasurePerformance {
  measureNumber: number;
  staff1: StaffMeasureMetrics;
  staff2: StaffMeasureMetrics;
  /** Highest streak of consecutive missed notes observed in or starting at this measure */
  consecutiveMissedCount: number;
}

/**
 * Input contract consumed by any ITutorEngine strategy.
 */
export interface PerformanceSummary {
  songId: string;
  songTitle: string;
  /** Overall accuracy/performance score on a 0–100 scale */
  overallScore: number;
  /** BPM used during the evaluated practice run */
  currentBpm: number;
  /** Target/written BPM of the piece */
  targetBpm: number;
  /** Total measure count in the score */
  totalMeasures: number;
  /** Total incoming musical notes detected during the run */
  detectedNotesCount: number;
  /** Measure-by-measure breakdown separated by Staff 1 (Right) and Staff 2 (Left) */
  measures: MeasurePerformance[];
}

/**
 * A single auto-playable practice drill step inside a TrainingPlan.
 * Maps 1-to-1 to Anson Practice Piano's player store controls.
 */
export interface TrainingStep {
  id: string;
  stepNumber: number;
  ruleId: number;
  ruleName: string;
  title: string;
  instruction: string;
  mode: PracticeMode;
  handMode: HandMode;
  targetBpm: number;
  metronomeEnabled: boolean;
  loopRange: {
    enabled: boolean;
    startMeasure: number;
    endMeasure: number;
  };
  focusTag: string;
}

export type TutorEngineType = 'RULE' | 'LLM';

/**
 * Output contract returned by any ITutorEngine strategy.
 * Structured so the React UI can inspect feedback and auto-apply each step in trainingPlaylist.
 */
export interface TrainingPlan {
  engineType: TutorEngineType;
  generatedAt: string;
  overallDiagnosis: string;
  generalFeedback: string;
  appliedRuleIds: number[];
  metricsSnapshot: {
    overallScore: number;
    errorRatePercent: number;
    rightHandErrors: number;
    leftHandErrors: number;
    averageTimingDeltaMs: number;
  };
  trainingPlaylist: TrainingStep[];
}

/**
 * Strategy Pattern interface for all Practice Tutor implementations
 * (e.g., RuleBasedTutorEngine, LLMTutorEngine).
 */
export interface ITutorEngine {
  readonly engineType: TutorEngineType;
  generatePlan(performanceData: PerformanceSummary): Promise<TrainingPlan>;
}
