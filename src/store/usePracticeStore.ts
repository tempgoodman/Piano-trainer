import { create } from 'zustand';
import { SAMPLE_SCORES } from '../data/sampleScores';
import { createEmptyMeasurePerformance } from '../engines/tutor/performanceSummaryBuilder';
import { MeasurePerformance, TrainingPlan } from '../engines/tutor/TutorEngineInterface';
import {
  ExpectedNote,
  HandMode,
  InputMode,
  LoopRange,
  MidiDeviceInfo,
  PlaybackMode,
  PracticeMode,
  RecordedTrack,
  ScoreGrade,
  ScorePiece,
  ScoreStats,
} from '../types/music';
import { MetronomeStyle } from '../audio/AudioEngine';
import { DEFAULT_USER_HOTKEYS, UserHotkeysConfig } from '../types/hotkeys';
import { PracticeStatRecord, sanitizeScoreIdForFirestore } from '../types/stats';

export interface FeedbackBanner {
  grade: ScoreGrade;
  label: string;
  deltaMs: number;
  noteName: string;
  timestamp: number;
}

export type RecordedKeyQuality = 'correct' | 'wrong';

interface PracticeState {
  // Active Sheet Music
  userScores: ScorePiece[];
  scores: ScorePiece[];
  activeScore: ScorePiece;
  totalMeasures: number;
  currentMeasure: number;

  // Mutually Exclusive Practice Mode ('wait' vs 'tempo') + Smart Start State
  practiceMode: PracticeMode;
  isArmed: boolean;
  isPlaying: boolean;
  isPracticing: boolean;
  handMode: HandMode;
  inputMode: InputMode;
  showKeyLabels: boolean;
  /** Toggle whether the on-screen Virtual Piano is visible (hiding expands sheet music area) */
  showVirtualPiano: boolean;
  /** Toggle whether the OSMD guide cursor is shown on the sheet during Tempo Mode */
  showTempoGuide: boolean;
  /** Consecutive missed/wrong notes in Tempo Mode; >= 4 auto-reveals the sheet guide */
  tempoLostStreak: number;
  /** True while the sheet guide is temporarily force-shown after 4 consecutive lost notes */
  isGuideAutoRevealed: boolean;

  // Logged-in Practice Stats & Sheet Stats Mode
  practiceStats: PracticeStatRecord[];
  isStatsMode: boolean;
  statsFilterMode: PracticeMode;
  statsSelectedBpm: number | null;
  statsSelectedBar: number | null;

  // Recording & Playback / Compare State
  isRecording: boolean;
  recordedEventCount: number;
  recordedTrack: RecordedTrack | null;
  playbackMode: PlaybackMode;
  isPlaybackRunning: boolean;
  hearComputerInCompare: boolean;
  compareExpectedNotes: Set<number>;
  compareRecordedKeys: Map<number, RecordedKeyQuality>;
  compareTimingDeltaMs: number | null;

  // Tempo & Metronome
  bpm: number;
  metronomeEnabled: boolean;
  metronomeVolume: number;
  metronomeStyle: MetronomeStyle;
  activeBeat: number | null;

  // A/B Loop + Interactive Sheet Selection Stage
  loopRange: LoopRange;
  loopSelectionStage: 'pickA' | 'pickB';

  // Soundfont / Sampled Piano Audio State
  isAudioLoading: boolean;
  audioLoadProgress: number;
  isAudioReady: boolean;
  audioError: string | null;
  audioEngineLabel: string;

  // Hardware & Keyboard State
  midiSupported: boolean;
  midiDevices: MidiDeviceInfo[];
  sustainDown: boolean;
  activeNotes: Set<number>;
  expectedNotes: ExpectedNote[];
  matchedMidis: Set<number>;
  wrongNote: { midi: number; noteName: string; timestamp: number } | null;

  // Active Hotkey Bindings (Defaults for guests; customizable per logged-in user)
  hotkeys: UserHotkeysConfig;
  isCustomHotkeys: boolean;

  // Running Practice & Scoring Stats
  notesHit: number;
  notesMissed: number;
  streak: number;
  pieceCompleted: boolean;
  scoreStats: ScoreStats;
  lastSummary: ScoreStats | null;
  lastFeedback: FeedbackBanner | null;

  // AI Practice Tutor Telemetry & Active Training Playlist
  detectedNotesCount: number;
  consecutiveMissStreak: number;
  measureMetrics: Record<number, MeasurePerformance>;
  activeTrainingPlan: TrainingPlan | null;
  activeTrainingStepIndex: number | null;

  // Actions
  setUserScores: (cloudScores: ScorePiece[]) => void;
  setActiveScore: (score: ScorePiece) => void;
  addCustomScore: (score: ScorePiece) => void;
  updateScoreXml: (songId: string, musicXml: string, title?: string, measuresCount?: number) => void;
  setTotalMeasures: (count: number) => void;
  setCurrentMeasure: (measure: number) => void;
  setPracticeMode: (mode: PracticeMode) => void;
  armTempoMode: () => void;
  startPlayingTempo: () => void;
  pauseTempo: () => void;
  setIsPracticing: (active: boolean) => void;
  setHandMode: (mode: HandMode) => void;
  setInputMode: (mode: InputMode) => void;
  setShowKeyLabels: (show: boolean) => void;
  setShowVirtualPiano: (show: boolean) => void;
  setShowTempoGuide: (show: boolean) => void;
  setPracticeStats: (records: PracticeStatRecord[]) => void;
  clearPracticeStats: () => void;
  enterStatsMode: () => void;
  exitStatsMode: () => void;
  setStatsFilterMode: (mode: PracticeMode) => void;
  setStatsSelectedBpm: (bpm: number | null) => void;
  setStatsSelectedBar: (bar: number | null) => void;
  setBpm: (bpm: number) => void;
  setMetronomeEnabled: (enabled: boolean) => void;
  setMetronomeVolume: (volume: number) => void;
  setMetronomeStyle: (style: MetronomeStyle) => void;
  setActiveBeat: (beat: number | null) => void;
  setLoopRange: (patch: Partial<LoopRange>) => void;
  setLoopSelectionStage: (stage: 'pickA' | 'pickB') => void;
  clearLoop: () => void;
  setAudioLoadingState: (patch: {
    isAudioLoading?: boolean;
    audioLoadProgress?: number;
    isAudioReady?: boolean;
    audioError?: string | null;
    audioEngineLabel?: string;
  }) => void;
  setMidiSupported: (supported: boolean) => void;
  setMidiDevices: (devices: MidiDeviceInfo[]) => void;
  setSustainDown: (down: boolean) => void;
  setHotkeys: (config: UserHotkeysConfig, isCustom: boolean) => void;
  resetHotkeysToDefault: () => void;
  pressKey: (midi: number) => void;
  releaseKey: (midi: number) => void;
  setExpectedNotes: (notes: ExpectedNote[]) => void;
  markExpectedHit: (midi: number) => void;
  clearMatchedMidis: () => void;
  triggerWrongNote: (midi: number, noteName: string) => void;
  clearWrongNote: () => void;
  recordHit: () => void;
  recordMiss: () => void;
  recordScoringResult: (
    grade: ScoreGrade,
    points: number,
    label: string,
    deltaMs: number,
    noteName: string
  ) => void;
  completeRunAndArm: () => void;
  setPieceCompleted: (completed: boolean) => void;
  resetSessionStats: () => void;

  // Recording & Playback / Compare Actions
  setIsRecording: (recording: boolean) => void;
  setRecordedEventCount: (count: number) => void;
  setRecordedTrack: (track: RecordedTrack | null) => void;
  startPlaybackState: (mode: PlaybackMode) => void;
  stopPlaybackState: () => void;
  setHearComputerInCompare: (hear: boolean) => void;
  setCompareExpectedNotes: (notes: Set<number>) => void;
  setCompareRecordedKey: (midi: number, quality: RecordedKeyQuality | null) => void;
  clearCompareHighlights: () => void;
  setCompareTimingDeltaMs: (deltaMs: number | null) => void;

  // AI Practice Tutor Actions
  recordMeasureMetric: (params: {
    measureNumber: number;
    staffIndex: number;
    outcome: 'hit' | 'wrong' | 'miss';
    deltaMs?: number;
  }) => void;
  incrementDetectedNotes: () => void;
  setTrainingPlan: (plan: TrainingPlan | null) => void;
  applyTrainingStep: (stepIndex: number) => void;
}

const initialScore = SAMPLE_SCORES[0];

const EMPTY_STATS: ScoreStats = {
  perfect: 0,
  good: 0,
  miss: 0,
  wrong: 0,
  totalPoints: 0,
};

const METRONOME_VOLUME_STORAGE_KEY = 'anson_piano_metronome_volume';
const METRONOME_STYLE_STORAGE_KEY = 'anson_piano_metronome_style';

function getInitialMetronomeVolume(): number {
  if (typeof window === 'undefined') return 0.85;
  try {
    const raw = window.localStorage.getItem(METRONOME_VOLUME_STORAGE_KEY);
    if (raw !== null) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) {
        return Math.max(0, Math.min(1, parsed));
      }
    }
  } catch {
    // Ignore storage access errors
  }
  return 0.85;
}

function getInitialMetronomeStyle(): MetronomeStyle {
  if (typeof window === 'undefined') return 'classic';
  try {
    const raw = window.localStorage.getItem(METRONOME_STYLE_STORAGE_KEY);
    if (raw === 'classic' || raw === 'woodblock' || raw === 'mechanical') {
      return raw;
    }
  } catch {
    // Ignore storage access errors
  }
  return 'classic';
}

export const usePracticeStore = create<PracticeState>((set) => ({
  userScores: [],
  scores: SAMPLE_SCORES,
  activeScore: initialScore,
  totalMeasures: initialScore.measures,
  currentMeasure: 1,

  practiceMode: 'wait',
  isArmed: false,
  isPlaying: false,
  isPracticing: true,
  handMode: 'both',
  inputMode: 'both',
  showKeyLabels: true,
  showVirtualPiano: true,
  showTempoGuide: true,
  tempoLostStreak: 0,
  isGuideAutoRevealed: false,

  practiceStats: [],
  isStatsMode: false,
  statsFilterMode: 'wait',
  statsSelectedBpm: null,
  statsSelectedBar: null,

  isRecording: true, // Silent background recording active by default during practice
  recordedEventCount: 0,
  recordedTrack: null,
  playbackMode: 'none',
  isPlaybackRunning: false,
  hearComputerInCompare: false,
  compareExpectedNotes: new Set<number>(),
  compareRecordedKeys: new Map<number, RecordedKeyQuality>(),
  compareTimingDeltaMs: null,

  bpm: initialScore.bpm,
  metronomeEnabled: false,
  metronomeVolume: getInitialMetronomeVolume(),
  metronomeStyle: getInitialMetronomeStyle(),
  activeBeat: null,

  loopRange: {
    enabled: false,
    startMeasure: 1,
    endMeasure: Math.min(4, initialScore.measures),
  },
  loopSelectionStage: 'pickA',

  isAudioLoading: true,
  audioLoadProgress: 0,
  isAudioReady: false,
  audioError: null,
  audioEngineLabel: 'Acoustic Grand Piano',

  midiSupported: typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator,
  midiDevices: [],
  sustainDown: false,
  activeNotes: new Set<number>(),
  expectedNotes: [],
  matchedMidis: new Set<number>(),
  wrongNote: null,
  hotkeys: DEFAULT_USER_HOTKEYS,
  isCustomHotkeys: false,

  notesHit: 0,
  notesMissed: 0,
  streak: 0,
  pieceCompleted: false,
  scoreStats: { ...EMPTY_STATS },
  lastSummary: null,
  lastFeedback: null,
  detectedNotesCount: 0,
  consecutiveMissStreak: 0,
  measureMetrics: {},
  activeTrainingPlan: null,
  activeTrainingStepIndex: null,

  setUserScores: (cloudScores) =>
    set((state) => {
      const cloudIds = new Set(cloudScores.map((s) => s.id));
      const mergedScores = [
        ...cloudScores,
        ...SAMPLE_SCORES.filter((s) => !cloudIds.has(s.id)),
      ];

      const matchingActive = mergedScores.find((s) => s.id === state.activeScore.id);
      if (matchingActive) {
        return {
          userScores: cloudScores,
          scores: mergedScores,
          activeScore: matchingActive,
          totalMeasures: matchingActive.measures,
        };
      }

      const fallback = SAMPLE_SCORES[0];
      return {
        userScores: cloudScores,
        scores: mergedScores,
        activeScore: fallback,
        totalMeasures: fallback.measures,
        currentMeasure: 1,
        bpm: fallback.bpm,
        loopRange: {
          enabled: false,
          startMeasure: 1,
          endMeasure: Math.min(4, fallback.measures),
        },
        loopSelectionStage: 'pickA',
        matchedMidis: new Set<number>(),
        wrongNote: null,
        notesHit: 0,
        notesMissed: 0,
        streak: 0,
        pieceCompleted: false,
        scoreStats: { ...EMPTY_STATS },
        lastSummary: null,
        lastFeedback: null,
        detectedNotesCount: 0,
        consecutiveMissStreak: 0,
        tempoLostStreak: 0,
        isGuideAutoRevealed: false,
        measureMetrics: {},
        activeTrainingPlan: null,
        activeTrainingStepIndex: null,
        isArmed: state.practiceMode === 'tempo',
        isPlaying: false,
        isPracticing: state.practiceMode === 'wait',
        playbackMode: 'none',
        isPlaybackRunning: false,
        recordedTrack: null,
        recordedEventCount: 0,
        compareExpectedNotes: new Set<number>(),
        compareRecordedKeys: new Map<number, RecordedKeyQuality>(),
        compareTimingDeltaMs: null,
      };
    }),

  setActiveScore: (score) =>
    set((state) => {
      const safeScoreId = sanitizeScoreIdForFirestore(score.id);
      const tempoBpms = Array.from(
        new Set(
          state.practiceStats
            .filter((r) => r.scoreId === safeScoreId && r.mode === 'tempo')
            .map((r) => r.bpm)
        )
      ).sort((a, b) => a - b);

      return {
        activeScore: score,
        totalMeasures: score.measures,
        currentMeasure: 1,
        bpm: score.bpm,
        loopRange: {
          enabled: false,
          startMeasure: 1,
          endMeasure: Math.min(4, score.measures),
        },
        loopSelectionStage: 'pickA',
        matchedMidis: new Set<number>(),
        wrongNote: null,
        notesHit: 0,
        notesMissed: 0,
        streak: 0,
        pieceCompleted: false,
        scoreStats: { ...EMPTY_STATS },
        lastSummary: null,
        lastFeedback: null,
        detectedNotesCount: 0,
        consecutiveMissStreak: 0,
        tempoLostStreak: 0,
        isGuideAutoRevealed: false,
        measureMetrics: {},
        activeTrainingPlan: null,
        activeTrainingStepIndex: null,
        statsSelectedBar: null,
        statsSelectedBpm:
          state.statsSelectedBpm !== null && tempoBpms.includes(state.statsSelectedBpm)
            ? state.statsSelectedBpm
            : tempoBpms.includes(score.bpm)
            ? score.bpm
            : tempoBpms[0] ?? null,
        isArmed: !state.isStatsMode && state.practiceMode === 'tempo',
        isPlaying: false,
        isPracticing: !state.isStatsMode && state.practiceMode === 'wait',
        playbackMode: 'none',
        isPlaybackRunning: false,
        recordedTrack: null,
        recordedEventCount: 0,
        compareExpectedNotes: new Set<number>(),
        compareRecordedKeys: new Map<number, RecordedKeyQuality>(),
        compareTimingDeltaMs: null,
      };
    }),

  addCustomScore: (score) =>
    set((state) => ({
      userScores: score.isCloudSaved
        ? [score, ...state.userScores.filter((s) => s.id !== score.id)]
        : state.userScores,
      scores: [score, ...state.scores.filter((s) => s.id !== score.id)],
      activeScore: score,
      totalMeasures: score.measures,
      currentMeasure: 1,
      bpm: score.bpm,
      loopRange: {
        enabled: false,
        startMeasure: 1,
        endMeasure: Math.min(4, score.measures),
      },
      loopSelectionStage: 'pickA',
      matchedMidis: new Set<number>(),
      wrongNote: null,
      notesHit: 0,
      notesMissed: 0,
      streak: 0,
      pieceCompleted: false,
      scoreStats: { ...EMPTY_STATS },
      lastSummary: null,
      lastFeedback: null,
      detectedNotesCount: 0,
      consecutiveMissStreak: 0,
      tempoLostStreak: 0,
      isGuideAutoRevealed: false,
      measureMetrics: {},
      activeTrainingPlan: null,
      activeTrainingStepIndex: null,
      isArmed: state.practiceMode === 'tempo',
      isPlaying: false,
      isPracticing: state.practiceMode === 'wait',
      playbackMode: 'none',
      isPlaybackRunning: false,
      recordedTrack: null,
      recordedEventCount: 0,
      compareExpectedNotes: new Set<number>(),
      compareRecordedKeys: new Map<number, RecordedKeyQuality>(),
      compareTimingDeltaMs: null,
    })),

  updateScoreXml: (songId, musicXml, title, measuresCount) =>
    set((state) => {
      const updatePiece = (piece: ScorePiece): ScorePiece => {
        if (piece.id !== songId) return piece;
        return {
          ...piece,
          musicXml,
          title: title?.trim() || piece.title,
          measures: measuresCount ?? piece.measures,
        };
      };
      return {
        scores: state.scores.map(updatePiece),
        activeScore: updatePiece(state.activeScore),
        totalMeasures:
          state.activeScore.id === songId && measuresCount
            ? measuresCount
            : state.totalMeasures,
      };
    }),

  setTotalMeasures: (count) =>
    set((state) => ({
      totalMeasures: Math.max(1, count),
      loopRange: {
        ...state.loopRange,
        startMeasure: Math.min(state.loopRange.startMeasure, Math.max(1, count)),
        endMeasure: Math.min(Math.max(state.loopRange.endMeasure, 1), Math.max(1, count)),
      },
    })),

  setCurrentMeasure: (measure) => set({ currentMeasure: measure }),

  setPracticeMode: (mode) =>
    set(() => {
      console.info(`[Anson Practice Piano] Switched practice mode -> ${mode.toUpperCase()}`);
      return {
        practiceMode: mode,
        isArmed: mode === 'tempo',
        isPlaying: false,
        isPracticing: mode === 'wait',
        playbackMode: 'none',
        isPlaybackRunning: false,
        matchedMidis: new Set<number>(),
        wrongNote: null,
        lastFeedback: null,
        pieceCompleted: false,
        tempoLostStreak: 0,
        isGuideAutoRevealed: false,
        compareExpectedNotes: new Set<number>(),
        compareRecordedKeys: new Map<number, RecordedKeyQuality>(),
        compareTimingDeltaMs: null,
      };
    }),

  armTempoMode: () =>
    set({
      practiceMode: 'tempo',
      isArmed: true,
      isPlaying: false,
      isPracticing: false,
      playbackMode: 'none',
      isPlaybackRunning: false,
      matchedMidis: new Set<number>(),
      wrongNote: null,
      tempoLostStreak: 0,
      isGuideAutoRevealed: false,
    }),

  startPlayingTempo: () =>
    set({
      practiceMode: 'tempo',
      isArmed: false,
      isPlaying: true,
      isPracticing: true,
      pieceCompleted: false,
      lastSummary: null,
      scoreStats: { ...EMPTY_STATS },
      notesHit: 0,
      notesMissed: 0,
      streak: 0,
      wrongNote: null,
      tempoLostStreak: 0,
      isGuideAutoRevealed: false,
    }),

  pauseTempo: () =>
    set({
      isArmed: false,
      isPlaying: false,
      isPracticing: false,
    }),

  setIsPracticing: (active) =>
    set((state) => {
      if (state.practiceMode === 'tempo') {
        return active
          ? { isArmed: true, isPlaying: false, isPracticing: false }
          : { isArmed: false, isPlaying: false, isPracticing: false };
      }
      return { isPracticing: active };
    }),

  setHandMode: (mode) => set({ handMode: mode, matchedMidis: new Set<number>() }),
  setInputMode: (mode) => set({ inputMode: mode }),
  setShowKeyLabels: (show) => set({ showKeyLabels: show }),
  setShowVirtualPiano: (show) => set({ showVirtualPiano: show }),
  setShowTempoGuide: (show) => set({ showTempoGuide: show }),
  setPracticeStats: (records) =>
    set((state) => {
      const safeScoreId = sanitizeScoreIdForFirestore(state.activeScore.id);
      const tempoBpms = Array.from(
        new Set(
          records
            .filter((r) => r.scoreId === safeScoreId && r.mode === 'tempo')
            .map((r) => r.bpm)
        )
      ).sort((a, b) => a - b);

      const nextBpm =
        state.statsSelectedBpm !== null && tempoBpms.includes(state.statsSelectedBpm)
          ? state.statsSelectedBpm
          : tempoBpms.includes(state.bpm)
          ? state.bpm
          : tempoBpms[0] ?? null;

      return {
        practiceStats: records,
        statsSelectedBpm: nextBpm,
      };
    }),
  clearPracticeStats: () =>
    set((state) => ({
      practiceStats: [],
      isStatsMode: false,
      statsSelectedBpm: null,
      statsSelectedBar: null,
      isPracticing: state.practiceMode === 'wait',
      isArmed: state.practiceMode === 'tempo',
      isPlaying: false,
    })),
  enterStatsMode: () =>
    set((state) => {
      const safeScoreId = sanitizeScoreIdForFirestore(state.activeScore.id);
      const waitHasData = state.practiceStats.some(
        (r) => r.scoreId === safeScoreId && r.mode === 'wait' && Object.keys(r.bars).length > 0
      );
      const tempoRecords = state.practiceStats
        .filter((r) => r.scoreId === safeScoreId && r.mode === 'tempo' && Object.keys(r.bars).length > 0)
        .sort((a, b) => a.bpm - b.bpm);
      const tempoHasData = tempoRecords.length > 0;
      const tempoBpms = Array.from(new Set(tempoRecords.map((r) => r.bpm)));
      const defaultBpm = tempoBpms.includes(state.bpm)
        ? state.bpm
        : tempoBpms[0] ?? null;

      let defaultMode: PracticeMode = state.practiceMode;
      if (defaultMode === 'wait' && !waitHasData && tempoHasData) {
        defaultMode = 'tempo';
      } else if (defaultMode === 'tempo' && !tempoHasData && waitHasData) {
        defaultMode = 'wait';
      }

      return {
        isStatsMode: true,
        statsFilterMode: defaultMode,
        statsSelectedBpm: defaultBpm,
        statsSelectedBar: null,
        isPlaying: false,
        isArmed: false,
        isPracticing: false,
        playbackMode: 'none',
        isPlaybackRunning: false,
        matchedMidis: new Set<number>(),
        wrongNote: null,
        compareExpectedNotes: new Set<number>(),
        compareRecordedKeys: new Map<number, RecordedKeyQuality>(),
        compareTimingDeltaMs: null,
      };
    }),
  exitStatsMode: () =>
    set((state) => ({
      isStatsMode: false,
      statsSelectedBar: null,
      isPlaying: false,
      isPracticing: state.practiceMode === 'wait',
      isArmed: state.practiceMode === 'tempo',
    })),
  setStatsFilterMode: (mode) =>
    set((state) => {
      const safeScoreId = sanitizeScoreIdForFirestore(state.activeScore.id);
      const tempoBpms = Array.from(
        new Set(
          state.practiceStats
            .filter((r) => r.scoreId === safeScoreId && r.mode === 'tempo')
            .map((r) => r.bpm)
        )
      ).sort((a, b) => a - b);

      const nextBpm =
        mode === 'tempo'
          ? state.statsSelectedBpm !== null && tempoBpms.includes(state.statsSelectedBpm)
            ? state.statsSelectedBpm
            : tempoBpms.includes(state.bpm)
            ? state.bpm
            : tempoBpms[0] ?? null
          : state.statsSelectedBpm;

      return {
        statsFilterMode: mode,
        statsSelectedBpm: nextBpm,
        statsSelectedBar: null,
      };
    }),
  setStatsSelectedBpm: (bpm) => set({ statsSelectedBpm: bpm, statsSelectedBar: null }),
  setStatsSelectedBar: (bar) => set({ statsSelectedBar: bar }),
  setBpm: (bpm) => set({ bpm }),
  setMetronomeEnabled: (enabled) => set({ metronomeEnabled: enabled }),
  setMetronomeVolume: (volume) => {
    const clamped = Math.max(0, Math.min(1, Math.round(volume * 100) / 100));
    try {
      window.localStorage.setItem(METRONOME_VOLUME_STORAGE_KEY, String(clamped));
    } catch {
      // Ignore storage access errors
    }
    set({ metronomeVolume: clamped });
  },
  setMetronomeStyle: (style) => {
    try {
      window.localStorage.setItem(METRONOME_STYLE_STORAGE_KEY, style);
    } catch {
      // Ignore storage access errors
    }
    set({ metronomeStyle: style });
  },
  setActiveBeat: (beat) => set({ activeBeat: beat }),

  setLoopRange: (patch) =>
    set((state) => {
      const next = { ...state.loopRange, ...patch };
      const maxM = Math.max(1, state.totalMeasures);
      next.startMeasure = Math.max(1, Math.min(next.startMeasure, maxM));
      next.endMeasure = Math.max(next.startMeasure, Math.min(next.endMeasure, maxM));
      return { loopRange: next };
    }),

  setLoopSelectionStage: (stage) => set({ loopSelectionStage: stage }),

  clearLoop: () =>
    set((state) => ({
      loopRange: {
        enabled: false,
        startMeasure: 1,
        endMeasure: Math.min(4, state.totalMeasures),
      },
      loopSelectionStage: 'pickA',
    })),

  setAudioLoadingState: (patch) => set((state) => ({ ...state, ...patch })),
  setMidiSupported: (supported) => set({ midiSupported: supported }),
  setMidiDevices: (devices) => set({ midiDevices: devices }),
  setSustainDown: (down) => set({ sustainDown: down }),
  setHotkeys: (config, isCustom) => set({ hotkeys: config, isCustomHotkeys: isCustom }),
  resetHotkeysToDefault: () =>
    set({ hotkeys: DEFAULT_USER_HOTKEYS, isCustomHotkeys: false }),

  pressKey: (midi) =>
    set((state) => {
      const next = new Set(state.activeNotes);
      next.add(midi);
      return { activeNotes: next };
    }),

  releaseKey: (midi) =>
    set((state) => {
      const next = new Set(state.activeNotes);
      next.delete(midi);
      return { activeNotes: next };
    }),

  setExpectedNotes: (notes) => set({ expectedNotes: notes }),

  markExpectedHit: (midi) =>
    set((state) => {
      const next = new Set(state.matchedMidis);
      next.add(midi);
      return { matchedMidis: next };
    }),

  clearMatchedMidis: () => set({ matchedMidis: new Set<number>() }),

  triggerWrongNote: (midi, noteName) =>
    set({ wrongNote: { midi, noteName, timestamp: Date.now() } }),

  clearWrongNote: () => set({ wrongNote: null }),

  recordHit: () =>
    set((state) => ({
      notesHit: state.notesHit + 1,
      streak: state.streak + 1,
      wrongNote: null,
    })),

  recordMiss: () =>
    set((state) => ({
      notesMissed: state.notesMissed + 1,
      streak: 0,
    })),

  recordScoringResult: (grade, points, label, deltaMs, noteName) =>
    set((state) => {
      const nextStats = { ...state.scoreStats };
      nextStats[grade] += 1;
      nextStats.totalPoints += points;

      const isHit = grade === 'perfect' || grade === 'good';
      const nextLostStreak = isHit ? 0 : state.tempoLostStreak + 1;
      const nextGuideAutoRevealed = isHit
        ? false
        : state.isGuideAutoRevealed || nextLostStreak >= 4;

      return {
        scoreStats: nextStats,
        notesHit: isHit ? state.notesHit + 1 : state.notesHit,
        notesMissed: !isHit ? state.notesMissed + 1 : state.notesMissed,
        streak: isHit ? state.streak + 1 : 0,
        tempoLostStreak: nextLostStreak,
        isGuideAutoRevealed: nextGuideAutoRevealed,
        wrongNote: grade === 'wrong' ? { midi: 0, noteName, timestamp: Date.now() } : null,
        lastFeedback: {
          grade,
          label,
          deltaMs,
          noteName,
          timestamp: Date.now(),
        },
      };
    }),

  completeRunAndArm: () =>
    set((state) => ({
      lastSummary: { ...state.scoreStats },
      pieceCompleted: true,
      isPlaying: false,
      isArmed: state.practiceMode === 'tempo',
      isPracticing: state.practiceMode === 'wait',
      matchedMidis: new Set<number>(),
      tempoLostStreak: 0,
      isGuideAutoRevealed: false,
    })),

  setPieceCompleted: (completed) => set({ pieceCompleted: completed }),

  resetSessionStats: () =>
    set({
      notesHit: 0,
      notesMissed: 0,
      streak: 0,
      pieceCompleted: false,
      matchedMidis: new Set<number>(),
      wrongNote: null,
      currentMeasure: 1,
      scoreStats: { ...EMPTY_STATS },
      lastSummary: null,
      lastFeedback: null,
      detectedNotesCount: 0,
      consecutiveMissStreak: 0,
      tempoLostStreak: 0,
      isGuideAutoRevealed: false,
      measureMetrics: {},
    }),

  // Recording & Playback / Compare Actions
  setIsRecording: (recording) => set({ isRecording: recording }),
  setRecordedEventCount: (count) => set({ recordedEventCount: count }),
  setRecordedTrack: (track) => set({ recordedTrack: track }),

  startPlaybackState: (mode) =>
    set({
      playbackMode: mode,
      isPlaybackRunning: mode !== 'none',
      isPlaying: false,
      isArmed: false,
      isPracticing: false,
      compareExpectedNotes: new Set<number>(),
      compareRecordedKeys: new Map<number, RecordedKeyQuality>(),
      compareTimingDeltaMs: null,
    }),

  stopPlaybackState: () =>
    set((state) => ({
      playbackMode: 'none',
      isPlaybackRunning: false,
      isPracticing: state.practiceMode === 'wait',
      isArmed: state.practiceMode === 'tempo',
      compareExpectedNotes: new Set<number>(),
      compareRecordedKeys: new Map<number, RecordedKeyQuality>(),
      compareTimingDeltaMs: null,
    })),

  setHearComputerInCompare: (hear) => set({ hearComputerInCompare: hear }),

  setCompareExpectedNotes: (notes) => set({ compareExpectedNotes: notes }),

  setCompareRecordedKey: (midi, quality) =>
    set((state) => {
      const next = new Map(state.compareRecordedKeys);
      if (quality === null) {
        next.delete(midi);
      } else {
        next.set(midi, quality);
      }
      return { compareRecordedKeys: next };
    }),

  clearCompareHighlights: () =>
    set({
      compareExpectedNotes: new Set<number>(),
      compareRecordedKeys: new Map<number, RecordedKeyQuality>(),
      compareTimingDeltaMs: null,
    }),

  setCompareTimingDeltaMs: (deltaMs) => set({ compareTimingDeltaMs: deltaMs }),

  incrementDetectedNotes: () =>
    set((state) => ({ detectedNotesCount: state.detectedNotesCount + 1 })),

  recordMeasureMetric: ({ measureNumber, staffIndex, outcome, deltaMs }) =>
    set((state) => {
      const mNum = Math.max(1, measureNumber);
      const existing = state.measureMetrics[mNum] ?? createEmptyMeasurePerformance(mNum);
      const staffKey = staffIndex === 2 ? 'staff2' : 'staff1';
      const staff = existing[staffKey];

      const nextStreak = outcome === 'miss' ? state.consecutiveMissStreak + 1 : 0;
      const updatedStaff = {
        expectedNotes: staff.expectedNotes + (outcome === 'hit' || outcome === 'miss' ? 1 : 0),
        correctPitchNotes: staff.correctPitchNotes + (outcome === 'hit' ? 1 : 0),
        wrongPitches: staff.wrongPitches + (outcome === 'wrong' ? 1 : 0),
        missedNotes: staff.missedNotes + (outcome === 'miss' ? 1 : 0),
        timingDeviationsMs:
          typeof deltaMs === 'number' && outcome === 'hit'
            ? [...staff.timingDeviationsMs, deltaMs]
            : staff.timingDeviationsMs,
      };

      return {
        consecutiveMissStreak: nextStreak,
        measureMetrics: {
          ...state.measureMetrics,
          [mNum]: {
            ...existing,
            [staffKey]: updatedStaff,
            consecutiveMissedCount: Math.max(existing.consecutiveMissedCount, nextStreak),
          },
        },
      };
    }),

  setTrainingPlan: (plan) =>
    set({
      activeTrainingPlan: plan,
      activeTrainingStepIndex: plan && plan.trainingPlaylist.length > 0 ? 0 : null,
    }),

  applyTrainingStep: (stepIndex) =>
    set((state) => {
      const step = state.activeTrainingPlan?.trainingPlaylist[stepIndex];
      if (!step) return {};
      const maxM = Math.max(1, state.totalMeasures);
      const startMeasure = Math.max(1, Math.min(step.loopRange.startMeasure, maxM));
      const endMeasure = Math.max(startMeasure, Math.min(step.loopRange.endMeasure, maxM));

      return {
        activeTrainingStepIndex: stepIndex,
        practiceMode: step.mode,
        isArmed: step.mode === 'tempo',
        isPlaying: false,
        isPracticing: step.mode === 'wait',
        playbackMode: 'none',
        isPlaybackRunning: false,
        handMode: step.handMode,
        bpm: step.targetBpm,
        metronomeEnabled: step.metronomeEnabled,
        loopRange: {
          enabled: step.loopRange.enabled,
          startMeasure,
          endMeasure,
        },
        loopSelectionStage: 'pickA',
        matchedMidis: new Set<number>(),
        wrongNote: null,
        pieceCompleted: false,
        tempoLostStreak: 0,
        isGuideAutoRevealed: false,
      };
    }),
}));
