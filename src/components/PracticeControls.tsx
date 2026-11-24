import { useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  ChevronDown,
  Circle,
  ClipboardCheck,
  Disc3,
  Eye,
  EyeOff,
  Gauge,
  GitCompare,
  Keyboard,
  Minus,
  Pause,
  Play,
  Plus,
  Radio,
  Repeat,
  RotateCcw,
  SkipForward,
  SlidersHorizontal,
  Square,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import { useFirebase } from '../context/FirebaseProvider';
import { usePreferences } from '../context/PreferencesProvider';
import { usePracticeStore } from '../store/usePracticeStore';
import { formatKeyboardKey, formatMidiChord } from '../types/hotkeys';
import { HandMode, InputMode, PlaybackMode, PracticeMode } from '../types/music';

interface PracticeControlsProps {
  onReset: () => void;
  onStepNext: () => void;
  onStartPlayback: (mode: Exclude<PlaybackMode, 'none'>) => void;
  onStopPlayback: () => void;
  onToggleRecording: () => void;
  onClearRecording: () => void;
  onOpenTutor: () => void;
  onOpenHotkeys: () => void;
}

type ControlPopover = 'setup' | 'tempo' | 'playback' | null;

export function PracticeControls({
  onReset,
  onStepNext,
  onStartPlayback,
  onStopPlayback,
  onToggleRecording,
  onClearRecording,
  onOpenTutor,
  onOpenHotkeys,
}: PracticeControlsProps) {
  const [openPopover, setOpenPopover] = useState<ControlPopover>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const { user } = useFirebase();
  const { t } = usePreferences();

  const isAudioReady = usePracticeStore((s) => s.isAudioReady);
  const practiceMode = usePracticeStore((s) => s.practiceMode);
  const setPracticeMode = usePracticeStore((s) => s.setPracticeMode);
  const isArmed = usePracticeStore((s) => s.isArmed);
  const isPlaying = usePracticeStore((s) => s.isPlaying);
  const isPracticing = usePracticeStore((s) => s.isPracticing);
  const setIsPracticing = usePracticeStore((s) => s.setIsPracticing);
  const armTempoMode = usePracticeStore((s) => s.armTempoMode);
  const pauseTempo = usePracticeStore((s) => s.pauseTempo);
  const showVirtualPiano = usePracticeStore((s) => s.showVirtualPiano);
  const setShowVirtualPiano = usePracticeStore((s) => s.setShowVirtualPiano);
  const showTempoGuide = usePracticeStore((s) => s.showTempoGuide);
  const setShowTempoGuide = usePracticeStore((s) => s.setShowTempoGuide);
  const isGuideAutoRevealed = usePracticeStore((s) => s.isGuideAutoRevealed);
  const isStatsMode = usePracticeStore((s) => s.isStatsMode);
  const enterStatsMode = usePracticeStore((s) => s.enterStatsMode);
  const exitStatsMode = usePracticeStore((s) => s.exitStatsMode);

  const isRecording = usePracticeStore((s) => s.isRecording);
  const recordedEventCount = usePracticeStore((s) => s.recordedEventCount);
  const recordedTrack = usePracticeStore((s) => s.recordedTrack);
  const playbackMode = usePracticeStore((s) => s.playbackMode);
  const isPlaybackRunning = usePracticeStore((s) => s.isPlaybackRunning);
  const hearComputerInCompare = usePracticeStore((s) => s.hearComputerInCompare);
  const setHearComputerInCompare = usePracticeStore((s) => s.setHearComputerInCompare);

  const handMode = usePracticeStore((s) => s.handMode);
  const setHandMode = usePracticeStore((s) => s.setHandMode);

  const inputMode = usePracticeStore((s) => s.inputMode);
  const setInputMode = usePracticeStore((s) => s.setInputMode);

  const bpm = usePracticeStore((s) => s.bpm);
  const setBpm = usePracticeStore((s) => s.setBpm);
  const metronomeEnabled = usePracticeStore((s) => s.metronomeEnabled);
  const setMetronomeEnabled = usePracticeStore((s) => s.setMetronomeEnabled);
  const activeBeat = usePracticeStore((s) => s.activeBeat);

  const loopRange = usePracticeStore((s) => s.loopRange);
  const setLoopRange = usePracticeStore((s) => s.setLoopRange);
  const clearLoop = usePracticeStore((s) => s.clearLoop);
  const totalMeasures = usePracticeStore((s) => s.totalMeasures);

  const midiDevices = usePracticeStore((s) => s.midiDevices);
  const midiSupported = usePracticeStore((s) => s.midiSupported);

  const activeTrainingPlan = usePracticeStore((s) => s.activeTrainingPlan);
  const activeTrainingStepIndex = usePracticeStore((s) => s.activeTrainingStepIndex);
  const hotkeys = usePracticeStore((s) => s.hotkeys);
  const isCustomHotkeys = usePracticeStore((s) => s.isCustomHotkeys);

  // Close active popover on click-outside or Escape
  useEffect(() => {
    if (!openPopover) return;

    const handlePointerDown = (e: PointerEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setOpenPopover(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenPopover(null);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openPopover]);

  const togglePopover = (key: Exclude<ControlPopover, null>) => {
    setOpenPopover((prev) => (prev === key ? null : key));
  };

  const modeOptions: { id: PracticeMode; label: string }[] = [
    { id: 'wait', label: t('controls.modeWait') },
    { id: 'tempo', label: t('controls.modeTempo') },
  ];

  const handOptions: { id: HandMode; label: string }[] = [
    { id: 'both', label: t('controls.handBoth') },
    { id: 'right', label: t('controls.handRight') },
    { id: 'left', label: t('controls.handLeft') },
  ];

  const inputOptions: { id: InputMode; label: string }[] = [
    { id: 'both', label: t('controls.inputBoth') },
    { id: 'midi', label: t('controls.inputMidi') },
    { id: 'virtual', label: t('controls.inputVirtual') },
  ];

  const midiLabel =
    midiDevices.length > 0
      ? t('controls.midiConnected', { name: midiDevices[0].name })
      : midiSupported
      ? t('controls.midiReady')
      : t('controls.midiVirtualOnly');

  const handlePrimaryTransportClick = () => {
    if (isPlaybackRunning) {
      onStopPlayback();
      return;
    }
    if (practiceMode === 'tempo') {
      if (isPlaying) {
        pauseTempo();
      } else {
        armTempoMode();
      }
      return;
    }
    setIsPracticing(!isPracticing);
  };

  const hasRecording = Boolean(recordedTrack && recordedTrack.events.length > 0);
  const capturedNotes = Math.ceil(recordedEventCount / 2);

  const setupSummary = (() => {
    const parts: string[] = [];
    if (handMode === 'right') parts.push(t('controls.handRhShort'));
    if (handMode === 'left') parts.push(t('controls.handLhShort'));
    if (!showVirtualPiano) parts.push(t('controls.keysOff'));
    if (practiceMode === 'tempo') {
      if (isGuideAutoRevealed) parts.push(t('controls.guideAuto'));
      else if (!showTempoGuide) parts.push(t('controls.guideOff'));
    }
    return parts.length > 0
      ? `${t('controls.setupShort')} · ${parts.join(' / ')}`
      : t('controls.practiceSetup');
  })();

  const tempoLoopSummary = loopRange.enabled
    ? `${bpm} BPM · M${loopRange.startMeasure}–${loopRange.endMeasure}`
    : `${bpm} BPM`;

  const playbackSummary =
    playbackMode === 'computer'
      ? t('controls.playingComputer')
      : playbackMode === 'recorded'
      ? t('controls.playingRecorded')
      : playbackMode === 'compare'
      ? t('controls.comparing')
      : t('controls.playbackRec');

  return (
    <section
      aria-label={t('controls.aria')}
      className="w-full bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-2.5 transition-colors"
    >
      <div
        ref={toolbarRef}
        className="max-w-[1360px] mx-auto flex flex-wrap items-center justify-between gap-3"
      >
        {/* Group 1: Core Practice Transport */}
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg"
            role="group"
            aria-label={t('controls.aria')}
          >
            {modeOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                disabled={isStatsMode || isPlaybackRunning || (opt.id === 'tempo' && !isAudioReady)}
                onClick={() => {
                  if (practiceMode !== opt.id) {
                    setPracticeMode(opt.id);
                    onReset();
                  }
                }}
                aria-pressed={practiceMode === opt.id}
                title={
                  isStatsMode
                    ? t('controls.exitStatsFirst')
                    : opt.id === 'tempo' && !isAudioReady
                    ? t('controls.waitingPiano')
                    : opt.id === 'wait'
                    ? t('controls.modeWaitFull')
                    : t('controls.modeTempoFull')
                }
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${
                  practiceMode === opt.id
                    ? 'bg-white dark:bg-slate-700 text-sky-700 dark:text-sky-300 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={isStatsMode || (!isAudioReady && practiceMode === 'tempo')}
            onClick={handlePrimaryTransportClick}
            title={isStatsMode ? t('controls.exitStatsFirst') : undefined}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${
              isPlaybackRunning
                ? 'bg-red-600 text-white hover:bg-red-700'
                : practiceMode === 'tempo'
                ? isPlaying
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                  : isArmed
                  ? 'bg-sky-600 text-white hover:bg-sky-700'
                  : 'bg-slate-900 dark:bg-sky-600 text-white hover:bg-slate-800 dark:hover:bg-sky-700'
                : isPracticing
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'bg-slate-900 dark:bg-sky-600 text-white hover:bg-slate-800 dark:hover:bg-sky-700'
            }`}
          >
            {isPlaybackRunning ? (
              <>
                <Square className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{t('controls.stopPlayback')}</span>
              </>
            ) : practiceMode === 'tempo' ? (
              isPlaying ? (
                <>
                  <Pause className="w-4 h-4" aria-hidden="true" />
                  <span>{t('controls.pauseTempo')}</span>
                </>
              ) : isArmed ? (
                <>
                  <Radio className="w-4 h-4" aria-hidden="true" />
                  <span>{t('controls.armedPlayFirst')}</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" aria-hidden="true" />
                  <span>{t('controls.armTempo')}</span>
                </>
              )
            ) : isPracticing ? (
              <>
                <Pause className="w-4 h-4" aria-hidden="true" />
                <span>{t('controls.practicing')}</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4" aria-hidden="true" />
                <span>{t('controls.resumeWait')}</span>
              </>
            )}
          </button>

          <button
            type="button"
            disabled={isStatsMode}
            onClick={isPlaybackRunning ? onStopPlayback : onReset}
            title={isStatsMode ? t('controls.exitStatsFirst') : t('controls.resetTitle')}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{t('controls.reset')}</span>
          </button>

          {practiceMode === 'wait' && !isPlaybackRunning && !isStatsMode && (
            <button
              type="button"
              onClick={onStepNext}
              title={t('controls.nextBeatTitle')}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
            >
              <SkipForward className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">{t('controls.nextBeat')}</span>
            </button>
          )}
        </div>

        {/* Group 2: Functionally Grouped Popover Menus + Stats + Tutor */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Popover A: Practice Setup */}
          <div className="relative">
            <button
              type="button"
              onClick={() => togglePopover('setup')}
              aria-expanded={openPopover === 'setup'}
              aria-haspopup="dialog"
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${
                openPopover === 'setup'
                  ? 'bg-slate-900 dark:bg-sky-600 text-white border-slate-900 dark:border-sky-600'
                  : isGuideAutoRevealed
                  ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-950/70'
                  : handMode !== 'both' || inputMode !== 'both' || !showTempoGuide || !showVirtualPiano
                  ? 'bg-sky-50 dark:bg-sky-950/50 text-sky-800 dark:text-sky-300 border-sky-200 dark:border-sky-800 hover:bg-sky-100 dark:hover:bg-sky-950/70'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{setupSummary}</span>
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform ${
                  openPopover === 'setup' ? 'rotate-180' : ''
                }`}
                aria-hidden="true"
              />
            </button>

            {openPopover === 'setup' && (
              <div
                role="dialog"
                aria-label={t('controls.practiceSetup')}
                className="absolute right-0 mt-2 w-[330px] max-w-[calc(100vw-2rem)] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg p-4 space-y-4 z-40"
              >
                {/* Hand Separation */}
                <div className="space-y-1.5">
                  <span className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
                    {t('controls.hands')}
                  </span>
                  <div
                    className="grid grid-cols-3 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg"
                    role="group"
                    aria-label={t('controls.hands')}
                  >
                    {handOptions.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={isPlaybackRunning}
                        onClick={() => setHandMode(opt.id)}
                        aria-pressed={handMode === opt.id}
                        className={`px-2 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap disabled:opacity-50 ${
                          handMode === opt.id
                            ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Input Source */}
                <div className="space-y-1.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                      {t('controls.inputSource')}
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[175px]">
                      {midiLabel}
                    </span>
                  </div>
                  <div
                    className="grid grid-cols-3 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg"
                    role="group"
                    aria-label={t('controls.inputSource')}
                  >
                    {inputOptions.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setInputMode(opt.id)}
                        aria-pressed={inputMode === opt.id}
                        className={`px-2 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                          inputMode === opt.id
                            ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Virtual Piano Visibility Toggle */}
                <div className="space-y-1.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
                        {t('controls.virtualPianoKeys')}
                      </span>
                      <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                        {t('controls.virtualPianoDesc')}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowVirtualPiano(!showVirtualPiano)}
                      aria-pressed={showVirtualPiano}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                        showVirtualPiano
                          ? 'bg-sky-50 dark:bg-sky-950/50 text-sky-800 dark:text-sky-300 border-sky-200 dark:border-sky-800 hover:bg-sky-100'
                          : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                      }`}
                    >
                      {showVirtualPiano ? (
                        <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                      ) : (
                        <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                      )}
                      <span>{showVirtualPiano ? t('controls.shown') : t('controls.hidden')}</span>
                    </button>
                  </div>
                </div>

                {/* Tempo Sheet Guide Toggle */}
                <div className="space-y-1.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
                        {t('controls.tempoGuide')}
                      </span>
                      <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                        {t('controls.tempoGuideDesc')}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowTempoGuide(!showTempoGuide)}
                      aria-pressed={showTempoGuide}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                        showTempoGuide
                          ? 'bg-sky-50 dark:bg-sky-950/50 text-sky-800 dark:text-sky-300 border-sky-200 dark:border-sky-800 hover:bg-sky-100'
                          : isGuideAutoRevealed
                          ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-700'
                          : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                      }`}
                    >
                      {showTempoGuide || isGuideAutoRevealed ? (
                        <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                      ) : (
                        <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                      )}
                      <span>
                        {showTempoGuide
                          ? t('controls.on')
                          : isGuideAutoRevealed
                          ? t('controls.auto')
                          : t('controls.off')}
                      </span>
                    </button>
                  </div>
                </div>

                {/* Hotkeys Summary & Configuration */}
                <div className="space-y-1.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
                        {t('controls.hotkeys')}{' '}
                        {isCustomHotkeys ? t('controls.customTag') : t('controls.defaultTag')}
                      </span>
                      <span className="block text-[11px] text-slate-500 dark:text-slate-400 font-mono-tabular truncate">
                        {formatMidiChord(hotkeys.restartMidiNotes)} ({formatKeyboardKey(hotkeys.restartKey)}) ·{' '}
                        {formatMidiChord(hotkeys.stopMidiNotes)} ({formatKeyboardKey(hotkeys.stopKey)})
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setOpenPopover(null);
                        onOpenHotkeys();
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      <Keyboard className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{t('controls.hotkeys')}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Popover B: Tempo, Metronome & A/B Loop */}
          <div className="relative">
            <button
              type="button"
              onClick={() => togglePopover('tempo')}
              aria-expanded={openPopover === 'tempo'}
              aria-haspopup="dialog"
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold font-mono-tabular rounded-lg border transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${
                openPopover === 'tempo'
                  ? 'bg-slate-900 dark:bg-sky-600 text-white border-slate-900 dark:border-sky-600'
                  : loopRange.enabled
                  ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-700 hover:bg-amber-100'
                  : metronomeEnabled
                  ? 'bg-sky-50 dark:bg-sky-950/50 text-sky-800 dark:text-sky-300 border-sky-200 dark:border-sky-800 hover:bg-sky-100'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              <Gauge className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{tempoLoopSummary}</span>
              {metronomeEnabled && (playbackMode === 'none' || playbackMode === 'computer') && (
                <span
                  aria-label={t('controls.metronome')}
                  className={`w-1.5 h-1.5 rounded-full ${
                    activeBeat === 0
                      ? 'bg-sky-600 dark:bg-sky-400 scale-125'
                      : activeBeat !== null
                      ? 'bg-sky-400'
                      : 'bg-sky-300'
                  }`}
                />
              )}
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform ${
                  openPopover === 'tempo' ? 'rotate-180' : ''
                }`}
                aria-hidden="true"
              />
            </button>

            {openPopover === 'tempo' && (
              <div
                role="dialog"
                aria-label={t('controls.tempo')}
                className="absolute right-0 mt-2 w-[320px] max-w-[calc(100vw-2rem)] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg p-4 space-y-4 z-40"
              >
                {/* Tempo BPM */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="tempo-slider"
                      className="text-xs font-semibold text-slate-700 dark:text-slate-200"
                    >
                      {t('controls.tempo')}
                    </label>
                    <span className="text-xs font-bold font-mono-tabular text-slate-900 dark:text-white">
                      {bpm} BPM
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setBpm(Math.max(40, bpm - 4))}
                      aria-label={t('controls.decreaseTempo')}
                      className="p-1.5 text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md transition-colors"
                    >
                      <Minus className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                    <input
                      id="tempo-slider"
                      type="range"
                      min={40}
                      max={180}
                      step={2}
                      value={bpm}
                      onChange={(e) => setBpm(Number(e.target.value))}
                      className="flex-1 accent-sky-600 cursor-pointer"
                    />
                    <button
                      type="button"
                      onClick={() => setBpm(Math.min(180, bpm + 4))}
                      aria-label={t('controls.increaseTempo')}
                      className="p-1.5 text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {/* Metronome */}
                <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-2.5">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                      {t('controls.metronome')}
                    </span>
                    {metronomeEnabled && (playbackMode === 'none' || playbackMode === 'computer') && (
                      <div className="flex items-center gap-1" aria-label={t('controls.metronome')}>
                        {[0, 1, 2, 3].map((b) => (
                          <span
                            key={b}
                            className={`w-2 h-2 rounded-full transition-transform ${
                              activeBeat === b
                                ? b === 0
                                  ? 'bg-sky-600 dark:bg-sky-400 scale-125'
                                  : 'bg-sky-400 scale-110'
                                : 'bg-slate-200 dark:bg-slate-700'
                            }`}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setMetronomeEnabled(!metronomeEnabled)}
                    aria-pressed={metronomeEnabled}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap ${
                      metronomeEnabled
                        ? 'bg-sky-600 text-white border-sky-600'
                        : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                    }`}
                  >
                    <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{metronomeEnabled ? t('controls.on') : t('controls.off')}</span>
                  </button>
                </div>

                {/* A/B Measure Loop */}
                <div className="space-y-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                      {t('controls.abLoop')}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (loopRange.enabled) {
                          clearLoop();
                        } else {
                          setLoopRange({ enabled: true });
                        }
                      }}
                      aria-pressed={loopRange.enabled}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap ${
                        loopRange.enabled
                          ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-700'
                          : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                      }`}
                    >
                      <Repeat className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{loopRange.enabled ? t('controls.loopOn') : t('controls.loopOff')}</span>
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-2 text-xs text-slate-700 dark:text-slate-300 font-mono-tabular">
                    <div className="flex items-center gap-1.5">
                      <label htmlFor="loop-start" className="text-slate-500 dark:text-slate-400">
                        {t('controls.measure')}
                      </label>
                      <input
                        id="loop-start"
                        type="number"
                        min={1}
                        max={loopRange.endMeasure}
                        value={loopRange.startMeasure}
                        onChange={(e) => setLoopRange({ startMeasure: Number(e.target.value) || 1 })}
                        className="w-14 px-2 py-1 text-center bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-600"
                      />
                      <span className="text-slate-400">{t('controls.to')}</span>
                      <label htmlFor="loop-end" className="sr-only">
                        {t('controls.measure')}
                      </label>
                      <input
                        id="loop-end"
                        type="number"
                        min={loopRange.startMeasure}
                        max={totalMeasures}
                        value={loopRange.endMeasure}
                        onChange={(e) =>
                          setLoopRange({ endMeasure: Number(e.target.value) || totalMeasures })
                        }
                        className="w-14 px-2 py-1 text-center bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-600"
                      />
                    </div>
                    {loopRange.enabled && (
                      <button
                        type="button"
                        onClick={clearLoop}
                        className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                      >
                        {t('controls.clear')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Popover C: Playback, Compare & Recording */}
          <div className="relative">
            <button
              type="button"
              disabled={isStatsMode}
              onClick={() => togglePopover('playback')}
              aria-expanded={openPopover === 'playback'}
              aria-haspopup="dialog"
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${
                openPopover === 'playback'
                  ? 'bg-slate-900 dark:bg-sky-600 text-white border-slate-900 dark:border-sky-600'
                  : isPlaybackRunning
                  ? 'bg-sky-600 text-white border-sky-600'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              <Disc3 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{playbackSummary}</span>
              {!isPlaybackRunning && hasRecording && (
                <span className="font-mono-tabular text-[11px] text-slate-500 dark:text-slate-400">
                  ({capturedNotes})
                </span>
              )}
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform ${
                  openPopover === 'playback' ? 'rotate-180' : ''
                }`}
                aria-hidden="true"
              />
            </button>

            {openPopover === 'playback' && (
              <div
                role="dialog"
                aria-label={t('controls.playbackRec')}
                className="absolute right-0 mt-2 w-[310px] max-w-[calc(100vw-2rem)] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg p-4 space-y-4 z-40"
              >
                {/* Playback & Compare Actions */}
                <div className="space-y-2">
                  <span className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
                    {t('controls.listenCompare')}
                  </span>
                  <div className="grid grid-cols-1 gap-2">
                    <button
                      type="button"
                      disabled={!isAudioReady}
                      onClick={() => {
                        if (playbackMode === 'computer') {
                          onStopPlayback();
                        } else {
                          onStartPlayback('computer');
                          setOpenPopover(null);
                        }
                      }}
                      aria-pressed={playbackMode === 'computer'}
                      className={`w-full inline-flex items-center justify-between px-3 py-2 text-xs font-semibold rounded-lg border transition-colors disabled:opacity-45 disabled:cursor-not-allowed ${
                        playbackMode === 'computer'
                          ? 'bg-sky-600 text-white border-sky-600'
                          : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                      }`}
                    >
                      <span className="inline-flex items-center gap-2">
                        <Play className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{t('controls.playByComputer')}</span>
                      </span>
                      {playbackMode === 'computer' && <span>{t('controls.stop')}</span>}
                    </button>

                    <button
                      type="button"
                      disabled={!isAudioReady || !hasRecording}
                      onClick={() => {
                        if (playbackMode === 'recorded') {
                          onStopPlayback();
                        } else {
                          onStartPlayback('recorded');
                          setOpenPopover(null);
                        }
                      }}
                      aria-pressed={playbackMode === 'recorded'}
                      className={`w-full inline-flex items-center justify-between px-3 py-2 text-xs font-semibold rounded-lg border transition-colors disabled:opacity-45 disabled:cursor-not-allowed ${
                        playbackMode === 'recorded'
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                      }`}
                    >
                      <span className="inline-flex items-center gap-2">
                        <Play className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{t('controls.playRecorded')}</span>
                      </span>
                      {!hasRecording && (
                        <span className="text-[11px] font-normal">{t('controls.noTakeYet')}</span>
                      )}
                    </button>

                    <button
                      type="button"
                      disabled={!isAudioReady || !hasRecording}
                      onClick={() => {
                        if (playbackMode === 'compare') {
                          onStopPlayback();
                        } else {
                          onStartPlayback('compare');
                          setOpenPopover(null);
                        }
                      }}
                      aria-pressed={playbackMode === 'compare'}
                      className={`w-full inline-flex items-center justify-between px-3 py-2 text-xs font-semibold rounded-lg border transition-colors disabled:opacity-45 disabled:cursor-not-allowed ${
                        playbackMode === 'compare'
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                      }`}
                    >
                      <span className="inline-flex items-center gap-2">
                        <GitCompare className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{t('controls.compareMode')}</span>
                      </span>
                      {playbackMode === 'compare' && <span>{t('controls.active')}</span>}
                    </button>

                    {playbackMode === 'compare' && (
                      <button
                        type="button"
                        onClick={() => setHearComputerInCompare(!hearComputerInCompare)}
                        aria-pressed={hearComputerInCompare}
                        className={`w-full px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                          hearComputerInCompare
                            ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                            : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                        }`}
                      >
                        {hearComputerInCompare
                          ? t('controls.compareGuideOn')
                          : t('controls.compareGuideOff')}
                      </button>
                    )}
                  </div>
                </div>

                {/* Silent Background Recording */}
                <div className="space-y-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
                        {t('controls.autoRecording')}
                      </span>
                      <span className="block text-[11px] text-slate-500 dark:text-slate-400 font-mono-tabular">
                        {capturedNotes > 0
                          ? t('controls.notesCaptured', { count: capturedNotes })
                          : t('controls.playToRecord')}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={onToggleRecording}
                      aria-pressed={isRecording}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap ${
                        isRecording
                          ? 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800'
                          : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                      }`}
                    >
                      <Circle
                        className={`w-2.5 h-2.5 ${
                          isRecording ? 'fill-red-600 text-red-600' : 'text-slate-400'
                        }`}
                        aria-hidden="true"
                      />
                      <span>{isRecording ? t('controls.ready') : t('controls.paused')}</span>
                    </button>
                  </div>

                  {hasRecording && !isPlaybackRunning && (
                    <button
                      type="button"
                      onClick={onClearRecording}
                      className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-red-700 dark:hover:text-red-300 bg-slate-50 dark:bg-slate-800 hover:bg-red-50 dark:hover:bg-red-950/40 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{t('controls.clearRecording')}</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Direct Action: Practice Stats (Logged-in users only) */}
          {user && (
            <button
              type="button"
              onClick={() => {
                setOpenPopover(null);
                if (isStatsMode) {
                  exitStatsMode();
                } else {
                  if (isPlaybackRunning) {
                    onStopPlayback();
                  }
                  enterStatsMode();
                }
              }}
              aria-pressed={isStatsMode}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${
                isStatsMode
                  ? 'bg-slate-900 dark:bg-sky-600 text-white border-slate-900 dark:border-sky-600 hover:bg-slate-800 dark:hover:bg-sky-700'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              {isStatsMode ? (
                <>
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{t('controls.exitStats')}</span>
                </>
              ) : (
                <>
                  <BarChart3 className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" aria-hidden="true" />
                  <span>{t('controls.practiceStats')}</span>
                </>
              )}
            </button>
          )}

          {/* Direct Action: Practice Tutor */}
          <button
            type="button"
            onClick={() => {
              setOpenPopover(null);
              onOpenTutor();
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${
              activeTrainingPlan
                ? 'bg-sky-50 dark:bg-sky-950/50 text-sky-800 dark:text-sky-300 border-sky-200 dark:border-sky-800 hover:bg-sky-100'
                : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
            }`}
          >
            <ClipboardCheck className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" aria-hidden="true" />
            <span>
              {activeTrainingPlan && activeTrainingStepIndex !== null
                ? t('controls.tutorProgress', {
                    current: activeTrainingStepIndex + 1,
                    total: activeTrainingPlan.trainingPlaylist.length,
                  })
                : t('controls.practiceTutor')}
            </span>
          </button>
        </div>
      </div>
    </section>
  );
}
