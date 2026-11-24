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
import { usePreferences } from '../context/PreferencesProvider';
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
  const { t } = usePreferences();
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
    if (hand === 'right') return t('controls.handRight');
    if (hand === 'left') return t('controls.handLeft');
    return t('controls.handBoth');
  };

  const formatLoopLabel = (step: TrainingStep) => {
    if (!step.loopRange.enabled) return t('tutor.fullPiece');
    if (step.loopRange.startMeasure === step.loopRange.endMeasure) {
      return t('tutor.loopSingle', { measure: step.loopRange.startMeasure });
    }
    return t('tutor.loopRange', {
      start: step.loopRange.startMeasure,
      end: step.loopRange.endMeasure,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 dark:bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="practice-tutor-title"
    >
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3 min-w-0">
            <ClipboardCheck className="w-5 h-5 text-sky-600 dark:text-sky-400 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <h2
                id="practice-tutor-title"
                className="font-display text-lg font-bold text-slate-900 dark:text-slate-100 truncate"
              >
                {t('tutor.title')}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {t('tutor.subtitle', { title: activeScore.title, measures: totalMeasures })}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Practice Tutor"
            className="p-2 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Source Switcher: Current Session vs Sample Scenarios */}
        <div className="px-6 py-3 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div
            className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-lg"
            role="group"
            aria-label="Diagnostic source"
          >
            <button
              type="button"
              onClick={() => void generateFromSource('live')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                selectedSource === 'live'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {t('tutor.liveSession', { count: detectedNotesCount })}
            </button>
            {TUTOR_DIAGNOSTIC_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => void generateFromSource(preset.id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  selectedSource === preset.id
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            {isGenerating ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-600 dark:text-sky-400" aria-hidden="true" />
            ) : (
              <RotateCcw className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" aria-hidden="true" />
            )}
            <span>{t('tutor.reanalyze')}</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {isGenerating && !activeTrainingPlan ? (
            <div className="flex items-center justify-center py-12 gap-2 text-sm text-slate-500 dark:text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin text-sky-600 dark:text-sky-400" aria-hidden="true" />
              <span>{t('tutor.evaluating')}</span>
            </div>
          ) : activeTrainingPlan ? (
            <>
              {/* Coach Summary */}
              <div className="p-4 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    {activeTrainingPlan.overallDiagnosis}
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 font-mono-tabular">
                    <span>{t('tutor.score', { value: activeTrainingPlan.metricsSnapshot.overallScore })}</span>
                    <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
                    <span>{t('tutor.rhErrors', { value: activeTrainingPlan.metricsSnapshot.rightHandErrors })}</span>
                    <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
                    <span>{t('tutor.lhErrors', { value: activeTrainingPlan.metricsSnapshot.leftHandErrors })}</span>
                    <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
                    <span>
                      {t('tutor.timing', {
                        value: `${activeTrainingPlan.metricsSnapshot.averageTimingDeltaMs > 0 ? '+' : ''}${activeTrainingPlan.metricsSnapshot.averageTimingDeltaMs}`,
                      })}
                    </span>
                  </div>
                </div>
                <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                  {activeTrainingPlan.generalFeedback}
                </p>
              </div>

              {/* Actionable Training Playlist */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {t('tutor.trainingPlaylist', {
                      count: activeTrainingPlan.trainingPlaylist.length,
                      unit:
                        activeTrainingPlan.trainingPlaylist.length === 1
                          ? t('tutor.stepSingular')
                          : t('tutor.stepPlural'),
                    })}
                  </h4>
                  <span className="text-xs text-slate-500 dark:text-slate-400 font-mono-tabular">
                    {t('tutor.rulesApplied', {
                      rules: activeTrainingPlan.appliedRuleIds.map((id) => `#${id}`).join(', '),
                    })}
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
                            ? 'bg-sky-50/70 dark:bg-sky-950/40 border-sky-300 dark:border-sky-700'
                            : 'bg-white dark:bg-slate-800/50 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="space-y-1.5 flex-1 min-w-[240px]">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono-tabular">
                              <span className="font-semibold text-slate-900 dark:text-slate-100">
                                {t('tutor.stepNum', { num: step.stepNumber })}
                              </span>
                              <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
                              <span>
                                {step.mode === 'wait'
                                  ? t('controls.modeWaitFull')
                                  : t('controls.modeTempoFull')}
                              </span>
                              <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
                              <span>{formatHandLabel(step.handMode)}</span>
                              <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
                              <span>{step.targetBpm} BPM</span>
                              <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
                              <span>{formatLoopLabel(step)}</span>
                              <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
                              <span>
                                {step.metronomeEnabled
                                  ? t('tutor.metronomeOn')
                                  : t('tutor.metronomeOff')}
                              </span>
                            </div>

                            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                              {step.title}
                            </p>
                            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
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
                            <span>{isCurrent ? t('tutor.practiceActive') : t('tutor.applyPractice')}</span>
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
        <div className="px-6 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {t('tutor.footerHint')}
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
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 dark:bg-sky-600 hover:bg-slate-800 dark:hover:bg-sky-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <span>
                {activeTrainingStepIndex !== null
                  ? t('tutor.nextStep')
                  : t('tutor.startStep1')}
              </span>
              <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
