import { useEffect, useRef, useState } from 'react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { AlertCircle, CheckCircle2, Clock, GitCompare, Play, Radio, RotateCcw } from 'lucide-react';
import { PlaybackScheduler } from '../engines/PlaybackScheduler';
import { useOSMDInteract } from '../hooks/useOSMDInteract';
import { usePracticeStore } from '../store/usePracticeStore';

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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const activeScore = usePracticeStore((s) => s.activeScore);
  const practiceMode = usePracticeStore((s) => s.practiceMode);
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
  const loopSelectionStage = usePracticeStore((s) => s.loopSelectionStage);
  const clearLoop = usePracticeStore((s) => s.clearLoop);
  const pieceCompleted = usePracticeStore((s) => s.pieceCompleted);
  const setTotalMeasures = usePracticeStore((s) => s.setTotalMeasures);

  // Interactive SVG A/B Loop Click Selection on OSMD Measure Bounding Boxes
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
        // Cursor 0: Primary Practice Cursor (Sky Blue) / Computer Perfect Cursor (Green in Compare)
        {
          type: 0,
          color: '#0284C7',
          alpha: 0.3,
          follow: true,
        },
        // Cursor 1: Ghost Cursor (Blue in Compare Mode for User's Recorded Track)
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

  const totalAttempts = notesHit + notesMissed;
  const accuracy = totalAttempts > 0 ? Math.round((notesHit / totalAttempts) * 100) : 100;

  const feedbackColorClass =
    lastFeedback?.grade === 'perfect'
      ? 'text-emerald-700'
      : lastFeedback?.grade === 'good'
      ? 'text-amber-700'
      : lastFeedback?.grade === 'wrong'
      ? 'text-red-600'
      : 'text-slate-600';

  const expectedLabel = expectedNotes.map((n) => n.noteName).join(' + ');

  return (
    <div className="w-full max-w-[1360px] mx-auto px-6 pt-5 pb-3">
      {/* Unboxed Practice / Playback Telemetry Strip */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-200 mb-4">
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
          <span className="font-semibold text-slate-900">{activeScore.title}</span>
          <span aria-hidden="true" className="text-slate-300">·</span>
          <span>{activeScore.composer}</span>
          <span aria-hidden="true" className="text-slate-300">·</span>
          <span className="font-mono-tabular">
            Measure {currentMeasure} of {totalMeasures}
          </span>
          <span aria-hidden="true" className="text-slate-300">·</span>
          {loopRange.enabled ? (
            <span className="inline-flex items-center gap-2 font-medium text-amber-700 font-mono-tabular">
              <span>
                {loopSelectionStage === 'pickB'
                  ? `Point A: M${loopRange.startMeasure} (click sheet for Point B)`
                  : `Looping M${loopRange.startMeasure}–M${loopRange.endMeasure}`}
              </span>
              <button
                type="button"
                onClick={clearLoop}
                className="text-xs underline text-slate-500 hover:text-slate-800"
              >
                Clear
              </button>
            </span>
          ) : (
            <span className="text-xs text-slate-500">
              Click any measure on sheet to set A/B Loop
            </span>
          )}
        </div>

        {/* Live Mode / Compare / Expected Note Readout */}
        <div className="flex flex-wrap items-center gap-5 text-sm">
          {playbackMode === 'compare' ? (
            <div className="flex flex-wrap items-center gap-4 text-xs font-medium">
              <span className="inline-flex items-center gap-1.5 text-emerald-700 font-semibold">
                <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600 inline-block" aria-hidden="true" />
                <span>Computer Perfect</span>
              </span>
              <span className="inline-flex items-center gap-1.5 text-blue-700 font-semibold">
                <span className="w-2.5 h-2.5 rounded-xs bg-blue-600 inline-block" aria-hidden="true" />
                <span>Your Ghost Cursor</span>
              </span>
              <span aria-hidden="true" className="text-slate-300">·</span>
              <span className="inline-flex items-center gap-1.5 font-mono-tabular font-semibold text-slate-900">
                <GitCompare className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
                <span>
                  {compareTimingDeltaMs !== null
                    ? PlaybackScheduler.formatDeltaLabel(compareTimingDeltaMs)
                    : 'Synchronized'}
                </span>
              </span>
            </div>
          ) : playbackMode === 'computer' ? (
            <span className="inline-flex items-center gap-1.5 font-semibold text-sky-700">
              <Play className="w-4 h-4" aria-hidden="true" />
              <span>Playing Computer Auto-Play</span>
            </span>
          ) : playbackMode === 'recorded' ? (
            <span className="inline-flex items-center gap-1.5 font-semibold text-blue-700">
              <Play className="w-4 h-4" aria-hidden="true" />
              <span>Playing Your Recorded Track</span>
            </span>
          ) : practiceMode === 'tempo' ? (
            <>
              {isArmed && !isPlaying ? (
                <span className="inline-flex items-center gap-1.5 font-semibold text-sky-700">
                  <Radio className="w-4 h-4" aria-hidden="true" />
                  <span>
                    Armed — Play {expectedLabel || 'first note'} to start
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
                <span className="text-slate-500">Click Arm Tempo to begin</span>
              )}

              <div className="flex items-center gap-3 text-xs text-slate-600 font-mono-tabular">
                <span className="text-emerald-700 font-semibold">Perfect {scoreStats.perfect}</span>
                <span aria-hidden="true" className="text-slate-300">·</span>
                <span className="text-amber-700 font-semibold">Good {scoreStats.good}</span>
                <span aria-hidden="true" className="text-slate-300">·</span>
                <span className="text-slate-500">Miss {scoreStats.miss}</span>
                <span aria-hidden="true" className="text-slate-300">·</span>
                <span className="text-red-600">Wrong {scoreStats.wrong}</span>
                <span aria-hidden="true" className="text-slate-300">·</span>
                <span className="font-semibold text-slate-900">{scoreStats.totalPoints} pts</span>
              </div>
            </>
          ) : (
            <>
              {wrongNote ? (
                <span className="inline-flex items-center gap-1.5 font-semibold text-red-600">
                  <AlertCircle className="w-4 h-4" aria-hidden="true" />
                  <span>Played {wrongNote.noteName} — try highlighted key</span>
                </span>
              ) : expectedNotes.length > 0 ? (
                <span className="font-medium text-slate-700">
                  Play next:{' '}
                  <span className="font-semibold font-mono-tabular text-sky-700">
                    {expectedNotes
                      .map((n) =>
                        matchedMidis.has(n.midi)
                          ? `${n.noteName} ✓`
                          : `${n.noteName} (${n.staffIndex === 1 ? 'RH' : 'LH'})`
                      )
                      .join(' + ')}
                  </span>
                </span>
              ) : (
                <span className="text-slate-500">Ready</span>
              )}

              <div className="flex items-center gap-3 text-xs text-slate-500 font-mono-tabular">
                <span>Accuracy {accuracy}%</span>
                <span aria-hidden="true" className="text-slate-300">·</span>
                <span>Streak {streak}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Sheet Music Canvas */}
      <div className="relative bg-white border border-slate-200 rounded-xl p-4 md:p-6 min-h-[290px] max-h-[420px] overflow-y-auto shadow-xs">
        {isLoading && (
          <div className="flex items-center justify-center py-16 text-sm text-slate-500">
            Rendering sheet music…
          </div>
        )}

        {renderError && (
          <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
            <AlertCircle className="w-6 h-6 text-red-600" aria-hidden="true" />
            <p className="text-sm font-medium text-slate-900">Could not load MusicXML</p>
            <p className="text-xs text-slate-500 max-w-md">{renderError}</p>
          </div>
        )}

        {pieceCompleted && playbackMode === 'none' && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4 px-5 py-3.5 bg-emerald-50 border border-emerald-200 rounded-lg">
            <div className="flex items-center gap-2.5 text-emerald-900">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold">
                  {practiceMode === 'tempo' && lastSummary
                    ? `Pass Complete (${lastSummary.totalPoints} Points) — Armed for Next Playthrough`
                    : 'Piece Complete — Ready for Next Playthrough'}
                </p>
                <p className="text-xs text-emerald-700 font-mono-tabular">
                  {practiceMode === 'tempo' && lastSummary
                    ? `Perfect ${lastSummary.perfect} · Good ${lastSummary.good} · Miss ${lastSummary.miss} · Wrong ${lastSummary.wrong} · Play ${expectedLabel || 'first note'} to restart`
                    : `Play ${expectedLabel || 'first note'} to continue`}
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
                  <span>Review with Tutor</span>
                </button>
              )}
              <button
                type="button"
                onClick={onReset}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Reset Stats</span>
              </button>
            </div>
          </div>
        )}

        {/* OSMD Mount Container */}
        <div
          ref={containerRef}
          className="osmd-container w-full select-none"
          aria-label={`Sheet music for ${activeScore.title}`}
        />
      </div>
    </div>
  );
}
