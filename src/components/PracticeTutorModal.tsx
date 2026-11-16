import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Loader2,
  Play,
  RotateCcw,
  X,
} from 'lucide-react';
import {
  buildLivePerformanceSummary,
  TUTOR_DIAGNOSTIC_PRESETS,
} from '../engines/tutor/performanceSummaryBuilder';
import { TrainingPlan, TrainingStep } from '../engines/tutor/TutorEngineInterface';
import { getTrainingPlan } from '../engines/tutor/TutorFactory';
import { usePracticeStore } from '../store/usePracticeStore';

interface PracticeTutorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onResetCursorToSelection: () => void;
}

export function PracticeTutorModal({
  isOpen,
  onClose,
  onResetCursorToSelection,
}: PracticeTutorModalProps) {
  const activeScore = usePracticeStore((s) => s.activeScore);
  const totalMeasures = usePracticeStore((s) => s.totalMeasures);
  const bpm = usePracticeStore((s) => s.bpm);
  const scoreStats = usePracticeStore((s) => s.scoreStats);
  const notesHit = usePracticeStore((s) => s.notesHit);
  const notesMissed = usePracticeStore((s) => s.notesMissed);
  const detectedNotesCount = usePracticeStore((s) => s.detectedNotesCount);
  const measureMetrics = usePracticeStore((s) => s.measureMetrics);

  const activeTrainingPlan = usePracticeStore((s) => s.activeTrainingPlan);
  const activeTrainingStepIndex = usePracticeStore((s) => s.activeTrainingStepIndex);
  const setTrainingPlan = usePracticeStore((s) => s.setTrainingPlan);
  const applyTrainingStep = usePracticeStore((s) => s.applyTrainingStep);

  const [selectedSource, setSelectedSource] = useState<string>('live');
  const [isGenerating, setIsGenerating] = useState(false);

  const generateFromSource = useCallback(
    async (sourceId: string) => {
      setSelectedSource(sourceId);
      setIsGenerating(true);

      try {
        const summary =
          sourceId === 'live'
            ? buildLivePerformanceSummary({
                score: activeScore,
                totalMeasures,
                currentBpm: bpm,
                scoreStats,
                notesHit,
                notesMissed,
                detectedNotesCount,
                measureMap: measureMetrics,
              })
            : (
                TUTOR_DIAGNOSTIC_PRESETS.find((p) => p.id === sourceId) ??
                TUTOR_DIAGNOSTIC_PRESETS[0]
              ).build(activeScore, totalMeasures, bpm);

        const plan: TrainingPlan = await getTrainingPlan(summary, 'RULE');
        setTrainingPlan(plan);
      } finally {
        setIsGenerating(false);
      }
    },
    [
      activeScore,
      bpm,
      detectedNotesCount,
      measureMetrics,
      notesHit,
      notesMissed,
      scoreStats,
      setTrainingPlan,
      totalMeasures,
    ]
  );

  // Auto-generate when opened if no plan is active yet
  useEffect(() => {
    if (!isOpen) return;
    if (!activeTrainingPlan) {
      void generateFromSource(selectedSource);
    }
  }, [activeTrainingPlan, generateFromSource, isOpen, selectedSource]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleApplyStep = (index: number, closeAfterApply: boolean) => {
    applyTrainingStep(index);
    // Snap OSMD cursor and colors to the configured start measure / loop window
    window.requestAnimationFrame(() => {
      onResetCursorToSelection();
    });
    if (closeAfterApply) {
      onClose();
    }
  };

  const formatHandLabel = (hand: TrainingStep['handMode']) => {
    if (hand === 'right') return 'Right Hand';
    if (hand === 'left') return 'Left Hand';
    return 'Both Hands';
  };

  const formatLoopLabel = (step: TrainingStep) => {
    if (!step.loopRange.enabled) return 'Full Piece';
    if (step.loopRange.startMeasure === step.loopRange.endMeasure) {
      return `Loop M${step.loopRange.startMeasure}`;
    }
    return `Loop M${step.loopRange.startMeasure}–M${step.loopRange.endMeasure}`;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="practice-tutor-title"
    >
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3 min-w-0">
            <ClipboardCheck className="w-5 h-5 text-sky-600 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <h2
                id="practice-tutor-title"
                className="font-display text-lg font-bold text-slate-900 truncate"
              >
                Practice Tutor
              </h2>
              <p className="text-xs text-slate-500 truncate">
                {activeScore.title} · {totalMeasures} measures · Rule-Based Pedagogy Coach
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Practice Tutor"
            className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Source Switcher: Current Session vs Sample Scenarios */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div
            className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg"
            role="group"
            aria-label="Diagnostic source"
          >
            <button
              type="button"
              onClick={() => void generateFromSource('live')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                selectedSource === 'live'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              My Live Session ({detectedNotesCount} notes)
            </button>
            {TUTOR_DIAGNOSTIC_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => void generateFromSource(preset.id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  selectedSource === preset.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void generateFromSource(selectedSource)}
            disabled={isGenerating}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            {isGenerating ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-600" aria-hidden="true" />
            ) : (
              <RotateCcw className="w-3.5 h-3.5 text-slate-600" aria-hidden="true" />
            )}
            <span>Re-Analyze</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {isGenerating && !activeTrainingPlan ? (
            <div className="flex items-center justify-center py-12 gap-2 text-sm text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin text-sky-600" aria-hidden="true" />
              <span>Evaluating measure and hand performance…</span>
            </div>
          ) : activeTrainingPlan ? (
            <>
              {/* Coach Summary */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-base font-semibold text-slate-900">
                    {activeTrainingPlan.overallDiagnosis}
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-slate-600 font-mono-tabular">
                    <span>Score {activeTrainingPlan.metricsSnapshot.overallScore}%</span>
                    <span aria-hidden="true" className="text-slate-300">·</span>
                    <span>RH Errors {activeTrainingPlan.metricsSnapshot.rightHandErrors}</span>
                    <span aria-hidden="true" className="text-slate-300">·</span>
                    <span>LH Errors {activeTrainingPlan.metricsSnapshot.leftHandErrors}</span>
                    <span aria-hidden="true" className="text-slate-300">·</span>
                    <span>
                      Timing {activeTrainingPlan.metricsSnapshot.averageTimingDeltaMs > 0 ? '+' : ''}
                      {activeTrainingPlan.metricsSnapshot.averageTimingDeltaMs}ms
                    </span>
                  </div>
                </div>
                <p className="text-sm leading-relaxed text-slate-700">
                  {activeTrainingPlan.generalFeedback}
                </p>
              </div>

              {/* Actionable Training Playlist */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-900">
                    Training Playlist ({activeTrainingPlan.trainingPlaylist.length}{' '}
                    {activeTrainingPlan.trainingPlaylist.length === 1 ? 'Step' : 'Steps'})
                  </h4>
                  <span className="text-xs text-slate-500 font-mono-tabular">
                    Rules applied: {activeTrainingPlan.appliedRuleIds.map((id) => `#${id}`).join(', ')}
                  </span>
                </div>

                <div className="space-y-3">
                  {activeTrainingPlan.trainingPlaylist.map((step, index) => {
                    const isCurrent = activeTrainingStepIndex === index;
                    return (
                      <div
                        key={step.id}
                        className={`p-4 border rounded-xl transition-colors ${
                          isCurrent
                            ? 'bg-sky-50/70 border-sky-300'
                            : 'bg-white border-slate-200'
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="space-y-1.5 flex-1 min-w-[240px]">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-mono-tabular">
                              <span className="font-semibold text-slate-900">
                                Step {step.stepNumber}
                              </span>
                              <span aria-hidden="true" className="text-slate-300">·</span>
                              <span>{step.mode === 'wait' ? 'Wait Mode' : 'Tempo Mode'}</span>
                              <span aria-hidden="true" className="text-slate-300">·</span>
                              <span>{formatHandLabel(step.handMode)}</span>
                              <span aria-hidden="true" className="text-slate-300">·</span>
                              <span>{step.targetBpm} BPM</span>
                              <span aria-hidden="true" className="text-slate-300">·</span>
                              <span>{formatLoopLabel(step)}</span>
                              <span aria-hidden="true" className="text-slate-300">·</span>
                              <span>{step.metronomeEnabled ? 'Metronome On' : 'Metronome Off'}</span>
                            </div>

                            <p className="text-sm font-semibold text-slate-900">{step.title}</p>
                            <p className="text-xs leading-relaxed text-slate-600">
                              {step.instruction}
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleApplyStep(index, true)}
                            className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${
                              isCurrent
                                ? 'bg-sky-700 text-white hover:bg-sky-800'
                                : 'bg-sky-600 text-white hover:bg-sky-700'
                            }`}
                          >
                            {isCurrent ? (
                              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                            ) : (
                              <Play className="w-3.5 h-3.5" aria-hidden="true" />
                            )}
                            <span>{isCurrent ? 'Practice Active' : 'Apply & Practice'}</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-slate-500">
            Applying a step configures Mode, Hand Isolation, BPM, Metronome, and A/B Loop automatically.
          </span>
          {activeTrainingPlan && activeTrainingPlan.trainingPlaylist.length > 0 && (
            <button
              type="button"
              onClick={() =>
                handleApplyStep(
                  activeTrainingStepIndex !== null
                    ? (activeTrainingStepIndex + 1) % activeTrainingPlan.trainingPlaylist.length
                    : 0,
                  true
                )
              }
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <span>
                {activeTrainingStepIndex !== null
                  ? 'Start Next Playlist Step'
                  : 'Start Step 1'}
              </span>
              <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
