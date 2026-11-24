import { useEffect, useMemo, useRef, useState } from 'react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import {
  AlertCircle,
  BarChart3,
  CheckCircle2,
  Clock,
  GitCompare,
  Play,
  Radio,
  Repeat,
  RotateCcw,
  X,
} from 'lucide-react';
import { useFirebase } from '../context/FirebaseProvider';
import { usePreferences } from '../context/PreferencesProvider';
import { PlaybackScheduler } from '../engines/PlaybackScheduler';
import { useOSMDInteract } from '../hooks/useOSMDInteract';
import { usePracticeStore } from '../store/usePracticeStore';
import {
  EMPTY_BAR_STATS,
  getBarAccuracyPercent,
  sanitizeScoreIdForFirestore,
} from '../types/stats';

interface SheetMusicViewerProps {
  osmdRef: React.MutableRefObject<OpenSheetMusicDisplay | null>;
  onScoreReady: () => void;
  onReset: () => void;
  onOpenTutor?: () => void;
}

export function SheetMusicViewer({
  osmdRef,
  onScoreReady,
  onReset,
  onOpenTutor,
}: SheetMusicViewerProps) {
  const { user, resendVerificationEmail, refreshUserVerification } = useFirebase();
  const { t } = usePreferences();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [verifyNotice, setVerifyNotice] = useState<string | null>(null);
  const [isCheckingVerify, setIsCheckingVerify] = useState(false);

  const activeScore = usePracticeStore((s) => s.activeScore);
  const practiceMode = usePracticeStore((s) => s.practiceMode);
  const setPracticeMode = usePracticeStore((s) => s.setPracticeMode);
  const setBpm = usePracticeStore((s) => s.setBpm);
  const showTempoGuide = usePracticeStore((s) => s.showTempoGuide);
  const isGuideAutoRevealed = usePracticeStore((s) => s.isGuideAutoRevealed);
  const playbackMode = usePracticeStore((s) => s.playbackMode);
  const compareTimingDeltaMs = usePracticeStore((s) => s.compareTimingDeltaMs);
  const isArmed = usePracticeStore((s) => s.isArmed);
  const isPlaying = usePracticeStore((s) => s.isPlaying);
  const currentMeasure = usePracticeStore((s) => s.currentMeasure);
  const totalMeasures = usePracticeStore((s) => s.totalMeasures);
  const handMode = usePracticeStore((s) => s.handMode);
  const expectedNotes = usePracticeStore((s) => s.expectedNotes);
  const matchedMidis = usePracticeStore((s) => s.matchedMidis);
  const wrongNote = usePracticeStore((s) => s.wrongNote);
  const notesHit = usePracticeStore((s) => s.notesHit);
  const notesMissed = usePracticeStore((s) => s.notesMissed);
  const streak = usePracticeStore((s) => s.streak);
  const scoreStats = usePracticeStore((s) => s.scoreStats);
  const lastSummary = usePracticeStore((s) => s.lastSummary);
  const lastFeedback = usePracticeStore((s) => s.lastFeedback);
  const loopRange = usePracticeStore((s) => s.loopRange);
  const setLoopRange = usePracticeStore((s) => s.setLoopRange);
  const loopSelectionStage = usePracticeStore((s) => s.loopSelectionStage);
  const clearLoop = usePracticeStore((s) => s.clearLoop);
  const pieceCompleted = usePracticeStore((s) => s.pieceCompleted);
  const setTotalMeasures = usePracticeStore((s) => s.setTotalMeasures);

  // Practice Stats Mode state
  const isStatsMode = usePracticeStore((s) => s.isStatsMode);
  const practiceStats = usePracticeStore((s) => s.practiceStats);
  const statsFilterMode = usePracticeStore((s) => s.statsFilterMode);
  const statsSelectedBpm = usePracticeStore((s) => s.statsSelectedBpm);
  const statsSelectedBar = usePracticeStore((s) => s.statsSelectedBar);
  const setStatsFilterMode = usePracticeStore((s) => s.setStatsFilterMode);
  const setStatsSelectedBpm = usePracticeStore((s) => s.setStatsSelectedBpm);
  const setStatsSelectedBar = usePracticeStore((s) => s.setStatsSelectedBar);
  const exitStatsMode = usePracticeStore((s) => s.exitStatsMode);

  // Interactive SVG A/B Loop & Practice Stats Overlay on OSMD Measure Bounding Boxes
  useOSMDInteract({
    osmdRef,
    containerRef,
    isReady: !isLoading && !renderError,
  });

  // Initialize and render OSMD with Dual Cursors (Primary + Ghost Cursor for Compare Mode)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    setIsLoading(true);
    setRenderError(null);
    container.innerHTML = '';

    const osmd = new OpenSheetMusicDisplay(container, {
      autoResize: true,
      backend: 'svg',
      drawTitle: true,
      drawSubtitle: false,
      drawComposer: true,
      drawPartNames: false,
      followCursor: true,
      cursorsOptions: [
        {
          type: 0,
          color: '#0284C7',
          alpha: 0.3,
          follow: true,
        },
        {
          type: 0,
          color: '#2563EB',
          alpha: 0.36,
          follow: false,
        },
      ],
    });

    osmdRef.current = osmd;

    osmd
      .load(activeScore.musicXml)
      .then(() => {
        if (cancelled) return;
        osmd.render();
        const measureCount = osmd.Sheet?.SourceMeasures?.length ?? activeScore.measures;
        setTotalMeasures(measureCount);
        osmd.cursors?.[0]?.show();
        osmd.cursors?.[1]?.hide();
        setIsLoading(false);
        onScoreReady();
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'Unable to parse MusicXML sheet.';
        setRenderError(msg);
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
      osmdRef.current = null;
      container.innerHTML = '';
    };
  }, [activeScore, onScoreReady, osmdRef, setTotalMeasures]);

  // Re-sync cursor targets whenever Hand Mode changes
  useEffect(() => {
    if (!isLoading && osmdRef.current) {
      onScoreReady();
    }
  }, [handMode, isLoading, onScoreReady, osmdRef]);

  // Derived Practice Stats for the currently displayed sheet
  const safeScoreId = useMemo(
    () => sanitizeScoreIdForFirestore(activeScore.id),
    [activeScore.id]
  );

  const distinctTempoBpms = useMemo(() => {
    return Array.from(
      new Set(
        practiceStats
          .filter((r) => r.scoreId === safeScoreId && r.mode === 'tempo')
          .map((r) => r.bpm)
      )
    ).sort((a, b) => a - b);
  }, [practiceStats, safeScoreId]);

  const waitPracticedBarsCount = useMemo(() => {
    const rec = practiceStats.find(
      (r) => r.scoreId === safeScoreId && r.mode === 'wait' && r.bpm === 0
    );
    if (!rec) return 0;
    return Object.values(rec.bars).filter(
      (b) => b.practices > 0 || b.perfect + b.good + b.wrong + b.miss > 0
    ).length;
  }, [practiceStats, safeScoreId]);

  const activeStatRecord = useMemo(() => {
    return practiceStats.find((r) => {
      if (r.scoreId !== safeScoreId || r.mode !== statsFilterMode) return false;
      if (statsFilterMode === 'wait') return r.bpm === 0;
      return statsSelectedBpm !== null && r.bpm === statsSelectedBpm;
    });
  }, [practiceStats, safeScoreId, statsFilterMode, statsSelectedBpm]);

  const statsAggregate = useMemo(() => {
    if (!activeStatRecord) {
      return {
        practicedBars: 0,
        totalBarPractices: 0,
        perfect: 0,
        good: 0,
        wrong: 0,
        miss: 0,
      };
    }
    let practicedBars = 0;
    let totalBarPractices = 0;
    let perfect = 0;
    let good = 0;
    let wrong = 0;
    let miss = 0;
    for (const bar of Object.values(activeStatRecord.bars)) {
      if (bar.practices > 0 || bar.perfect + bar.good + bar.wrong + bar.miss > 0) {
        practicedBars++;
      }
      totalBarPractices += bar.practices;
      perfect += bar.perfect;
      good += bar.good;
      wrong += bar.wrong;
      miss += bar.miss;
    }
    return { practicedBars, totalBarPractices, perfect, good, wrong, miss };
  }, [activeStatRecord]);

  const hasAnyStatsInActiveView =
    statsAggregate.totalBarPractices > 0 ||
    statsAggregate.perfect > 0 ||
    statsAggregate.good > 0 ||
    statsAggregate.wrong > 0 ||
    statsAggregate.miss > 0;

  const selectedBarStats =
    statsSelectedBar !== null
      ? activeStatRecord?.bars[String(statsSelectedBar)] ?? EMPTY_BAR_STATS
      : null;

  const handlePracticeSelectedBar = (measureNumber: number) => {
    setPracticeMode(statsFilterMode);
    if (statsFilterMode === 'tempo' && statsSelectedBpm !== null) {
      setBpm(statsSelectedBpm);
    }
    setLoopRange({
      enabled: true,
      startMeasure: measureNumber,
      endMeasure: measureNumber,
    });
    exitStatsMode();
    onReset();
  };

  const totalAttempts = notesHit + notesMissed;
  const accuracy = totalAttempts > 0 ? Math.round((notesHit / totalAttempts) * 100) : 100;

  const feedbackColorClass =
    lastFeedback?.grade === 'perfect'
      ? 'text-emerald-700 dark:text-emerald-400'
      : lastFeedback?.grade === 'good'
      ? 'text-amber-700 dark:text-amber-400'
      : lastFeedback?.grade === 'wrong'
      ? 'text-red-600 dark:text-red-400'
      : 'text-slate-600 dark:text-slate-400';

  const expectedLabel = expectedNotes.map((n) => n.noteName).join(' + ');

  return (
    <div className="flex-1 min-h-0 flex flex-col w-full px-4 sm:px-6 pt-3 pb-3">
      {/* Top Strip: Either Practice Stats Controls OR Normal Practice Telemetry */}
      {isStatsMode ? (
        <div className="mb-3 space-y-2.5 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <BarChart3 className="w-4 h-4 text-sky-600 dark:text-sky-400" aria-hidden="true" />
                <span>{t('controls.practiceStats')}</span>
              </div>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate max-w-[240px]">
                {activeScore.title}
              </span>

              {/* Mode Selector (Wait vs Tempo) */}
              <div
                className="flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg"
                role="group"
                aria-label={t('controls.practiceStats')}
              >
                <button
                  type="button"
                  onClick={() => setStatsFilterMode('wait')}
                  aria-pressed={statsFilterMode === 'wait'}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                    statsFilterMode === 'wait'
                      ? 'bg-white dark:bg-slate-700 text-sky-700 dark:text-sky-300 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  <span>{t('controls.modeWaitFull')}</span>
                  {waitPracticedBarsCount > 0 && (
                    <span className="font-mono-tabular text-[10px] px-1 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300">
                      {waitPracticedBarsCount}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setStatsFilterMode('tempo')}
                  aria-pressed={statsFilterMode === 'tempo'}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                    statsFilterMode === 'tempo'
                      ? 'bg-white dark:bg-slate-700 text-sky-700 dark:text-sky-300 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  <span>{t('controls.modeTempoFull')}</span>
                  {distinctTempoBpms.length > 0 && (
                    <span className="font-mono-tabular text-[10px] px-1 py-0.5 rounded bg-sky-100 dark:bg-sky-950/70 text-sky-700 dark:text-sky-300">
                      {distinctTempoBpms.length}
                    </span>
                  )}
                </button>
              </div>

              {/* Distinct Tempos Selector */}
              {statsFilterMode === 'tempo' && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    {t('stats.tempoLabel')}
                  </span>
                  {distinctTempoBpms.length === 0 ? (
                    <span className="text-xs text-slate-500 dark:text-slate-400 italic">
                      {t('stats.noRecordedTempos')}
                    </span>
                  ) : distinctTempoBpms.length <= 6 ? (
                    distinctTempoBpms.map((tempoVal) => (
                      <button
                        key={tempoVal}
                        type="button"
                        onClick={() => setStatsSelectedBpm(tempoVal)}
                        aria-pressed={statsSelectedBpm === tempoVal}
                        className={`px-2.5 py-1 text-xs font-semibold font-mono-tabular rounded-md border transition-colors whitespace-nowrap ${
                          statsSelectedBpm === tempoVal
                            ? 'bg-sky-600 text-white border-sky-600'
                            : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                        }`}
                      >
                        {tempoVal} BPM
                      </button>
                    ))
                  ) : (
                    <select
                      aria-label={t('stats.tempoLabel')}
                      value={statsSelectedBpm ?? ''}
                      onChange={(e) => setStatsSelectedBpm(Number(e.target.value))}
                      className="px-2.5 py-1 text-xs font-semibold font-mono-tabular text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-sky-600"
                    >
                      {distinctTempoBpms.map((tempoVal) => (
                        <option key={tempoVal} value={tempoVal}>
                          {tempoVal} BPM
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={exitStatsMode}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 dark:bg-sky-600 hover:bg-slate-800 dark:hover:bg-sky-700 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{t('stats.exitToPractice')}</span>
            </button>
          </div>

          {/* Unverified Email Warning (Firestore writes require email_verified == true) */}
          {user && !user.emailVerified && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-900 dark:text-amber-200">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" aria-hidden="true" />
                <span>{verifyNotice ?? t('stats.verifyRequired')}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isCheckingVerify}
                  onClick={async () => {
                    setIsCheckingVerify(true);
                    try {
                      await resendVerificationEmail();
                      setVerifyNotice(t('stats.verificationSent'));
                    } catch {
                      // Ignore resend cooldown
                    } finally {
                      setIsCheckingVerify(false);
                    }
                  }}
                  className="px-2.5 py-1 font-semibold bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-700 rounded-md hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors disabled:opacity-50"
                >
                  {t('auth.resendEmailShort')}
                </button>
                <button
                  type="button"
                  disabled={isCheckingVerify}
                  onClick={async () => {
                    setIsCheckingVerify(true);
                    try {
                      await refreshUserVerification();
                    } finally {
                      setIsCheckingVerify(false);
                    }
                  }}
                  className="px-2.5 py-1 font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-md transition-colors disabled:opacity-50"
                >
                  {isCheckingVerify ? t('auth.checking') : t('auth.verifiedShort')}
                </button>
              </div>
            </div>
          )}

          {/* Summary Readout & Legend */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600 dark:text-slate-300">
            <div className="flex flex-wrap items-center gap-3 font-mono-tabular">
              {hasAnyStatsInActiveView ? (
                <>
                  <span className="font-sans font-medium text-slate-700 dark:text-slate-200">
                    {t('stats.barsPracticed', {
                      practiced: statsAggregate.practicedBars,
                      total: totalMeasures,
                    })}
                  </span>
                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
                  {statsFilterMode === 'tempo' ? (
                    <>
                      <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                        {t('sheet.perfect')} {statsAggregate.perfect}
                      </span>
                      <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
                      <span className="text-amber-700 dark:text-amber-400 font-semibold">
                        {t('sheet.good')} {statsAggregate.good}
                      </span>
                      <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
                      <span className="text-red-600 dark:text-red-400 font-semibold">
                        {t('sheet.wrong')} {statsAggregate.wrong}
                      </span>
                      <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
                      <span className="text-slate-500 dark:text-slate-400">
                        {t('sheet.miss')} {statsAggregate.miss}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                        {t('stats.barCompletions', { count: statsAggregate.totalBarPractices })}
                      </span>
                      <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
                      <span className="text-red-600 dark:text-red-400">
                        {t('sheet.wrong')} {statsAggregate.wrong}
                      </span>
                    </>
                  )}
                </>
              ) : (
                <span className="font-sans text-slate-500 dark:text-slate-400">
                  {statsFilterMode === 'wait'
                    ? t('stats.emptyWait')
                    : distinctTempoBpms.length === 0
                    ? t('stats.emptyTempo')
                    : t('stats.selectTempoHint')}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500/30 border border-emerald-600/60 inline-block" aria-hidden="true" />
                <span>90%+</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-xs bg-sky-500/30 border border-sky-600/60 inline-block" aria-hidden="true" />
                <span>70–89%</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-xs bg-amber-500/30 border border-amber-600/60 inline-block" aria-hidden="true" />
                <span>&lt;70%</span>
              </span>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
              <span>{t('stats.clickBarHint')}</span>
            </div>
          </div>

          {/* Compact Interactive Per-Bar Overview Strip */}
          {hasAnyStatsInActiveView && totalMeasures > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
              {Array.from({ length: totalMeasures }, (_, idx) => {
                const mNum = idx + 1;
                const bar = activeStatRecord?.bars[String(mNum)];
                const hasActivity = Boolean(
                  bar && (bar.practices > 0 || bar.perfect + bar.good + bar.wrong + bar.miss > 0)
                );
                const acc = bar && hasActivity ? getBarAccuracyPercent(bar) : null;
                const isSelected = statsSelectedBar === mNum;

                const toneClass = isSelected
                  ? 'bg-sky-600 text-white border-sky-600'
                  : !hasActivity
                  ? 'bg-slate-50 dark:bg-slate-800/70 text-slate-400 dark:text-slate-500 border-slate-200 dark:border-slate-700 hover:border-slate-300'
                  : acc === null || acc >= 90
                  ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100'
                  : acc >= 70
                  ? 'bg-sky-50 dark:bg-sky-950/50 text-sky-800 dark:text-sky-300 border-sky-200 dark:border-sky-800 hover:bg-sky-100'
                  : 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800 hover:bg-amber-100';

                return (
                  <button
                    key={mNum}
                    type="button"
                    onClick={() => setStatsSelectedBar(isSelected ? null : mNum)}
                    aria-pressed={isSelected}
                    className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold font-mono-tabular rounded-md border transition-colors whitespace-nowrap shrink-0 ${toneClass}`}
                  >
                    <span>M{mNum}</span>
                    <span className="opacity-85">
                      {hasActivity && bar ? `${bar.practices}×` : '0×'}
                    </span>
                    {statsFilterMode === 'tempo' && acc !== null && (
                      <span className="opacity-75">{acc}%</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Selected Bar Detail Inspector */}
          {statsSelectedBar !== null && selectedBarStats && (
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-sky-50/70 dark:bg-sky-950/50 border border-sky-200 dark:border-sky-800 rounded-lg text-xs">
              <div className="flex flex-wrap items-center gap-3 text-slate-800 dark:text-slate-100">
                <span className="font-semibold text-sky-900 dark:text-sky-300 font-mono-tabular">
                  {t('stats.barLabel', { bar: statsSelectedBar })}
                </span>
                <span aria-hidden="true" className="text-sky-300 dark:text-sky-700">·</span>
                <span className="font-mono-tabular font-semibold">
                  {t('stats.practicedTimes', {
                    count: selectedBarStats.practices,
                    unit:
                      selectedBarStats.practices === 1
                        ? t('stats.timeSingular')
                        : t('stats.timePlural'),
                  })}
                </span>
                {statsFilterMode === 'tempo' ? (
                  <>
                    {statsSelectedBpm !== null && (
                      <>
                        <span aria-hidden="true" className="text-sky-300 dark:text-sky-700">·</span>
                        <span className="font-mono-tabular text-slate-600 dark:text-slate-300">
                          {statsSelectedBpm} BPM
                        </span>
                      </>
                    )}
                    <span aria-hidden="true" className="text-sky-300 dark:text-sky-700">·</span>
                    <span className="font-mono-tabular text-emerald-700 dark:text-emerald-400 font-semibold">
                      {t('sheet.perfect')} {selectedBarStats.perfect}
                    </span>
                    <span className="font-mono-tabular text-amber-700 dark:text-amber-400 font-semibold">
                      {t('sheet.good')} {selectedBarStats.good}
                    </span>
                    <span className="font-mono-tabular text-red-600 dark:text-red-400 font-semibold">
                      {t('sheet.wrong')} {selectedBarStats.wrong}
                    </span>
                    <span className="font-mono-tabular text-slate-500 dark:text-slate-400">
                      {t('sheet.miss')} {selectedBarStats.miss}
                    </span>
                    {getBarAccuracyPercent(selectedBarStats) !== null && (
                      <>
                        <span aria-hidden="true" className="text-sky-300 dark:text-sky-700">·</span>
                        <span className="font-mono-tabular font-semibold text-slate-900 dark:text-white">
                          {t('sheet.accuracy', {
                            value: getBarAccuracyPercent(selectedBarStats) ?? 0,
                          })}
                        </span>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <span aria-hidden="true" className="text-sky-300 dark:text-sky-700">·</span>
                    <span className="font-mono-tabular text-emerald-700 dark:text-emerald-400 font-semibold">
                      {t('stats.notesMatched')} {selectedBarStats.perfect}
                    </span>
                    <span className="font-mono-tabular text-red-600 dark:text-red-400 font-semibold">
                      {t('sheet.wrong')} {selectedBarStats.wrong}
                    </span>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handlePracticeSelectedBar(statsSelectedBar)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-md transition-colors whitespace-nowrap"
                >
                  <Repeat className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{t('stats.practiceBar', { bar: statsSelectedBar })}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setStatsSelectedBar(null)}
                  aria-label={t('stats.closeBarDetail')}
                  className="p-1 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 rounded-md"
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Unboxed Practice / Playback Telemetry Strip */
        <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-200 dark:border-slate-800 mb-3">
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600 dark:text-slate-400">
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              {activeScore.title}
            </span>
            <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
            <span>{activeScore.composer}</span>
            <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
            <span className="font-mono-tabular">
              {t('sheet.measureOf', { current: currentMeasure, total: totalMeasures })}
            </span>
            <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
            {loopRange.enabled ? (
              <span className="inline-flex items-center gap-2 font-medium text-amber-700 dark:text-amber-400 font-mono-tabular">
                <span>
                  {loopSelectionStage === 'pickB'
                    ? t('sheet.pointAPrompt', { start: loopRange.startMeasure })
                    : t('sheet.loopingRange', {
                        start: loopRange.startMeasure,
                        end: loopRange.endMeasure,
                      })}
                </span>
                <button
                  type="button"
                  onClick={clearLoop}
                  className="text-xs underline text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                >
                  {t('controls.clear')}
                </button>
              </span>
            ) : (
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {t('sheet.clickToLoop')}
              </span>
            )}
          </div>

          {/* Live Mode / Compare / Expected Note Readout */}
          <div className="flex flex-wrap items-center gap-5 text-sm">
            {playbackMode === 'compare' ? (
              <div className="flex flex-wrap items-center gap-4 text-xs font-medium">
                <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-semibold">
                  <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600 inline-block" aria-hidden="true" />
                  <span>{t('sheet.computerPerfect')}</span>
                </span>
                <span className="inline-flex items-center gap-1.5 text-blue-700 dark:text-blue-400 font-semibold">
                  <span className="w-2.5 h-2.5 rounded-xs bg-blue-600 inline-block" aria-hidden="true" />
                  <span>{t('sheet.yourGhostCursor')}</span>
                </span>
                <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
                <span className="inline-flex items-center gap-1.5 font-mono-tabular font-semibold text-slate-900 dark:text-slate-100">
                  <GitCompare className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                  <span>
                    {compareTimingDeltaMs !== null
                      ? PlaybackScheduler.formatDeltaLabel(compareTimingDeltaMs)
                      : t('sheet.synchronized')}
                  </span>
                </span>
              </div>
            ) : playbackMode === 'computer' ? (
              <span className="inline-flex items-center gap-1.5 font-semibold text-sky-700 dark:text-sky-400">
                <Play className="w-4 h-4" aria-hidden="true" />
                <span>{t('sheet.playingComputerAuto')}</span>
              </span>
            ) : playbackMode === 'recorded' ? (
              <span className="inline-flex items-center gap-1.5 font-semibold text-blue-700 dark:text-blue-400">
                <Play className="w-4 h-4" aria-hidden="true" />
                <span>{t('sheet.playingYourTrack')}</span>
              </span>
            ) : practiceMode === 'tempo' ? (
              <>
                {isArmed && !isPlaying ? (
                  <span className="inline-flex items-center gap-1.5 font-semibold text-sky-700 dark:text-sky-400">
                    <Radio className="w-4 h-4" aria-hidden="true" />
                    <span>
                      {t('sheet.armedPlayNote', {
                        note: expectedLabel || t('sheet.firstNote'),
                      })}
                    </span>
                  </span>
                ) : lastFeedback ? (
                  <span className={`inline-flex items-center gap-1.5 font-semibold ${feedbackColorClass}`}>
                    {lastFeedback.grade === 'wrong' ? (
                      <AlertCircle className="w-4 h-4" aria-hidden="true" />
                    ) : lastFeedback.grade === 'good' ? (
                      <Clock className="w-4 h-4" aria-hidden="true" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                    )}
                    <span>
                      {lastFeedback.noteName}: {lastFeedback.label}
                    </span>
                  </span>
                ) : (
                  <span className="text-slate-500 dark:text-slate-400">
                    {t('sheet.clickArmTempo')}
                  </span>
                )}

                {isGuideAutoRevealed && !showTempoGuide && (
                  <span className="text-xs font-semibold text-amber-700 dark:text-amber-400 whitespace-nowrap">
                    {t('sheet.guideAutoShown')}
                  </span>
                )}

                <div className="flex items-center gap-3 text-xs text-slate-600 dark:text-slate-400 font-mono-tabular">
                  <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                    {t('sheet.perfect')} {scoreStats.perfect}
                  </span>
                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
                  <span className="text-amber-700 dark:text-amber-400 font-semibold">
                    {t('sheet.good')} {scoreStats.good}
                  </span>
                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
                  <span className="text-slate-500 dark:text-slate-400">
                    {t('sheet.miss')} {scoreStats.miss}
                  </span>
                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
                  <span className="text-red-600 dark:text-red-400">
                    {t('sheet.wrong')} {scoreStats.wrong}
                  </span>
                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {scoreStats.totalPoints} {t('sheet.pts')}
                  </span>
                </div>
              </>
            ) : (
              <>
                {wrongNote ? (
                  <span className="inline-flex items-center gap-1.5 font-semibold text-red-600 dark:text-red-400">
                    <AlertCircle className="w-4 h-4" aria-hidden="true" />
                    <span>{t('sheet.playedWrong', { note: wrongNote.noteName })}</span>
                  </span>
                ) : expectedNotes.length > 0 ? (
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    {t('sheet.playNext')}{' '}
                    <span className="font-semibold font-mono-tabular text-sky-700 dark:text-sky-400">
                      {expectedNotes
                        .map((n) =>
                          matchedMidis.has(n.midi)
                            ? `${n.noteName} ✓`
                            : `${n.noteName} (${
                                n.staffIndex === 1
                                  ? t('controls.handRhShort')
                                  : t('controls.handLhShort')
                              })`
                        )
                        .join(' + ')}
                    </span>
                  </span>
                ) : (
                  <span className="text-slate-500 dark:text-slate-400">
                    {t('controls.ready')}
                  </span>
                )}

                <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 font-mono-tabular">
                  <span>{t('sheet.accuracy', { value: accuracy })}</span>
                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
                  <span>{t('sheet.streak', { value: streak })}</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Sheet Music Canvas — dynamically fills all available browser width & height */}
      <div
        className="relative flex-1 min-h-[260px] bg-white dark:bg-[#EAEFF4] border border-slate-200 dark:border-slate-700 rounded-xl p-4 md:p-6 overflow-y-auto shadow-xs transition-colors text-slate-900"
      >
        {isLoading && (
          <div className="flex items-center justify-center py-16 text-sm text-slate-500">
            {t('sheet.rendering')}
          </div>
        )}

        {renderError && (
          <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
            <AlertCircle className="w-6 h-6 text-red-600" aria-hidden="true" />
            <p className="text-sm font-medium text-slate-900">{t('sheet.loadError')}</p>
            <p className="text-xs text-slate-500 max-w-md">{renderError}</p>
          </div>
        )}

        {!isStatsMode && pieceCompleted && playbackMode === 'none' && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4 px-5 py-3.5 bg-emerald-50 border border-emerald-200 rounded-lg">
            <div className="flex items-center gap-2.5 text-emerald-900">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold">
                  {practiceMode === 'tempo' && lastSummary
                    ? t('sheet.passCompleteTempo', { points: lastSummary.totalPoints })
                    : t('sheet.pieceComplete')}
                </p>
                <p className="text-xs text-emerald-700 font-mono-tabular">
                  {practiceMode === 'tempo' && lastSummary
                    ? `${t('sheet.perfect')} ${lastSummary.perfect} · ${t('sheet.good')} ${lastSummary.good} · ${t('sheet.miss')} ${lastSummary.miss} · ${t('sheet.wrong')} ${lastSummary.wrong} · ${t('sheet.playToRestart', { note: expectedLabel || t('sheet.firstNote') })}`
                    : t('sheet.playToContinue', {
                        note: expectedLabel || t('sheet.firstNote'),
                      })}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {onOpenTutor && (
                <button
                  type="button"
                  onClick={onOpenTutor}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-emerald-900 bg-white border border-emerald-300 hover:bg-emerald-100 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <span>{t('sheet.reviewWithTutor')}</span>
                </button>
              )}
              <button
                type="button"
                onClick={onReset}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{t('sheet.resetStats')}</span>
              </button>
            </div>
          </div>
        )}

        {/* OSMD Mount Container */}
        <div
          ref={containerRef}
          className="osmd-container w-full select-none"
          aria-label={activeScore.title}
        />
      </div>
    </div>
  );
}
