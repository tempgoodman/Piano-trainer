import {
  Circle,
  ClipboardCheck,
  GitCompare,
  Pause,
  Play,
  Radio,
  Repeat,
  RotateCcw,
  SkipForward,
  Square,
  Trash2,
  Volume2,
} from 'lucide-react';
import { usePracticeStore } from '../store/usePracticeStore';
import { HandMode, InputMode, PlaybackMode, PracticeMode } from '../types/music';

interface PracticeControlsProps {
  onReset: () => void;
  onStepNext: () => void;
  onStartPlayback: (mode: Exclude<PlaybackMode, 'none'>) => void;
  onStopPlayback: () => void;
  onToggleRecording: () => void;
  onClearRecording: () => void;
  onOpenTutor: () => void;
}

export function PracticeControls({
  onReset,
  onStepNext,
  onStartPlayback,
  onStopPlayback,
  onToggleRecording,
  onClearRecording,
  onOpenTutor,
}: PracticeControlsProps) {
  const isAudioReady = usePracticeStore((s) => s.isAudioReady);
  const practiceMode = usePracticeStore((s) => s.practiceMode);
  const setPracticeMode = usePracticeStore((s) => s.setPracticeMode);
  const isArmed = usePracticeStore((s) => s.isArmed);
  const isPlaying = usePracticeStore((s) => s.isPlaying);
  const isPracticing = usePracticeStore((s) => s.isPracticing);
  const setIsPracticing = usePracticeStore((s) => s.setIsPracticing);
  const armTempoMode = usePracticeStore((s) => s.armTempoMode);
  const pauseTempo = usePracticeStore((s) => s.pauseTempo);

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

  const scores = usePracticeStore((s) => s.scores);
  const activeScore = usePracticeStore((s) => s.activeScore);
  const setActiveScore = usePracticeStore((s) => s.setActiveScore);
  const activeTrainingPlan = usePracticeStore((s) => s.activeTrainingPlan);
  const activeTrainingStepIndex = usePracticeStore((s) => s.activeTrainingStepIndex);

  const modeOptions: { id: PracticeMode; label: string }[] = [
    { id: 'wait', label: 'Wait Mode' },
    { id: 'tempo', label: 'Tempo Mode' },
  ];

  const handOptions: { id: HandMode; label: string }[] = [
    { id: 'both', label: 'Both Hands' },
    { id: 'right', label: 'Right Hand' },
    { id: 'left', label: 'Left Hand' },
  ];

  const inputOptions: { id: InputMode; label: string }[] = [
    { id: 'both', label: 'Both Inputs' },
    { id: 'midi', label: 'MIDI Piano' },
    { id: 'virtual', label: 'Virtual Keys' },
  ];

  const midiLabel =
    midiDevices.length > 0
      ? `MIDI: ${midiDevices[0].name}`
      : midiSupported
      ? 'MIDI ready'
      : 'Virtual mode';

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

  return (
    <section
      aria-label="Practice controls"
      className="w-full bg-white border-b border-slate-200 px-6 py-3"
    >
      <div className="max-w-[1360px] mx-auto space-y-2.5">
        {/* Row 1: Mode, Transport, Hand Separation, Input Source, Loop, Tempo */}
        <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2.5">
          {/* Mobile Piece Picker */}
          <div className="md:hidden w-full">
            <label htmlFor="mobile-piece-select" className="sr-only">
              Select Piece
            </label>
            <select
              id="mobile-piece-select"
              value={activeScore.id}
              onChange={(e) => {
                const found = scores.find((s) => s.id === e.target.value);
                if (found) setActiveScore(found);
              }}
              className="w-full px-3 py-2 text-sm font-medium bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
            >
              {scores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} — {s.composer}
                </option>
              ))}
            </select>
          </div>

          {/* Mutually Exclusive Mode Selector + Smart Start Transport */}
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg"
              role="group"
              aria-label="Practice mode"
            >
              {modeOptions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  disabled={isPlaybackRunning || (opt.id === 'tempo' && !isAudioReady)}
                  onClick={() => {
                    if (practiceMode !== opt.id) {
                      setPracticeMode(opt.id);
                      onReset();
                    }
                  }}
                  aria-pressed={practiceMode === opt.id}
                  title={opt.id === 'tempo' && !isAudioReady ? 'Waiting for Grand Piano samples to load' : undefined}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${
                    practiceMode === opt.id
                      ? 'bg-white text-sky-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              disabled={!isAudioReady && practiceMode === 'tempo'}
              onClick={handlePrimaryTransportClick}
              className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${
                isPlaybackRunning
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : practiceMode === 'tempo'
                  ? isPlaying
                    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                    : isArmed
                    ? 'bg-sky-600 text-white hover:bg-sky-700'
                    : 'bg-slate-900 text-white hover:bg-slate-800'
                  : isPracticing
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                  : 'bg-slate-900 text-white hover:bg-slate-800'
              }`}
            >
              {isPlaybackRunning ? (
                <>
                  <Square className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Stop Playback</span>
                </>
              ) : practiceMode === 'tempo' ? (
                isPlaying ? (
                  <>
                    <Pause className="w-4 h-4" aria-hidden="true" />
                    <span>Pause Tempo</span>
                  </>
                ) : isArmed ? (
                  <>
                    <Radio className="w-4 h-4" aria-hidden="true" />
                    <span>Armed (Play 1st Note)</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" aria-hidden="true" />
                    <span>Arm Tempo</span>
                  </>
                )
              ) : isPracticing ? (
                <>
                  <Pause className="w-4 h-4" aria-hidden="true" />
                  <span>Practicing</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" aria-hidden="true" />
                  <span>Resume Wait</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={isPlaybackRunning ? onStopPlayback : onReset}
              title="Restart from beginning (or Point A)"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
            >
              <RotateCcw className="w-4 h-4" aria-hidden="true" />
              <span>Reset</span>
            </button>

            {practiceMode === 'wait' && !isPlaybackRunning && (
              <button
                type="button"
                onClick={onStepNext}
                title="Skip to next beat"
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
              >
                <SkipForward className="w-4 h-4" aria-hidden="true" />
                <span>Next Beat</span>
              </button>
            )}
          </div>

          {/* Hand Separation Practice */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg" role="group" aria-label="Hand separation">
            {handOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                disabled={isPlaybackRunning}
                onClick={() => setHandMode(opt.id)}
                aria-pressed={handMode === opt.id}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${
                  handMode === opt.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Input Source Toggle */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg" role="group" aria-label="Input source">
              {inputOptions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setInputMode(opt.id)}
                  aria-pressed={inputMode === opt.id}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${
                    inputMode === opt.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <span className="hidden xl:inline text-xs text-slate-500 whitespace-nowrap">
              {midiLabel}
            </span>
          </div>

          {/* A/B Measure Loop */}
          <div className="flex items-center gap-2">
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
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${
                loopRange.enabled
                  ? 'bg-amber-50 text-amber-800 border-amber-300'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Repeat className="w-3.5 h-3.5" aria-hidden="true" />
              <span>A/B Loop</span>
            </button>

            <div className="flex items-center gap-1.5 text-xs text-slate-700 font-mono-tabular">
              <label htmlFor="loop-start" className="text-slate-500">
                M
              </label>
              <input
                id="loop-start"
                type="number"
                min={1}
                max={loopRange.endMeasure}
                value={loopRange.startMeasure}
                onChange={(e) => setLoopRange({ startMeasure: Number(e.target.value) || 1 })}
                className="w-12 px-1.5 py-1 text-center bg-slate-50 border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus-visible:ring-sky-600"
              />
              <span className="text-slate-400">to</span>
              <label htmlFor="loop-end" className="sr-only">
                End Measure
              </label>
              <input
                id="loop-end"
                type="number"
                min={loopRange.startMeasure}
                max={totalMeasures}
                value={loopRange.endMeasure}
                onChange={(e) => setLoopRange({ endMeasure: Number(e.target.value) || totalMeasures })}
                className="w-12 px-1.5 py-1 text-center bg-slate-50 border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus-visible:ring-sky-600"
              />
            </div>
          </div>

          {/* Metronome & Tempo Control */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMetronomeEnabled(!metronomeEnabled)}
              aria-pressed={metronomeEnabled}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${
                metronomeEnabled
                  ? 'bg-sky-600 text-white border-sky-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Metronome</span>
            </button>

            {metronomeEnabled && (playbackMode === 'none' || playbackMode === 'computer') && (
              <div className="flex items-center gap-1" aria-label="Metronome beat indicator">
                {[0, 1, 2, 3].map((b) => (
                  <span
                    key={b}
                    className={`w-2 h-2 rounded-full transition-transform ${
                      activeBeat === b
                        ? b === 0
                          ? 'bg-sky-600 scale-125'
                          : 'bg-sky-400 scale-110'
                        : 'bg-slate-200'
                    }`}
                  />
                ))}
              </div>
            )}

            <div className="flex items-center gap-2">
              <label htmlFor="tempo-slider" className="text-xs font-medium text-slate-600 whitespace-nowrap">
                Tempo:
              </label>
              <input
                id="tempo-slider"
                type="range"
                min={40}
                max={180}
                step={2}
                value={bpm}
                onChange={(e) => setBpm(Number(e.target.value))}
                className="w-24 accent-sky-600 cursor-pointer"
              />
              <span className="text-xs font-semibold font-mono-tabular text-slate-900 w-16 whitespace-nowrap">
                {bpm} BPM
              </span>
            </div>
          </div>
        </div>

        {/* Row 2: Recording Engine & Dual-Mode Playback / Compare Studio */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={onToggleRecording}
              aria-pressed={isRecording}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${
                isRecording
                  ? 'bg-red-50 text-red-700 border-red-200'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Circle
                className={`w-2.5 h-2.5 ${isRecording ? 'fill-red-600 text-red-600' : 'text-slate-400'}`}
                aria-hidden="true"
              />
              <span>{isRecording ? 'Recording Ready' : 'Recording Paused'}</span>
            </button>

            <span className="text-xs text-slate-500 font-mono-tabular">
              {recordedEventCount > 0
                ? `${Math.ceil(recordedEventCount / 2)} notes captured`
                : 'Play keys to record automatically'}
            </span>

            {hasRecording && !isPlaybackRunning && (
              <button
                type="button"
                onClick={onClearRecording}
                title="Clear recorded track"
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Clear Rec</span>
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!isAudioReady}
              onClick={() =>
                playbackMode === 'computer' ? onStopPlayback() : onStartPlayback('computer')
              }
              aria-pressed={playbackMode === 'computer'}
              title={!isAudioReady ? 'Waiting for Grand Piano samples to load' : undefined}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${
                playbackMode === 'computer'
                  ? 'bg-sky-600 text-white border-sky-600'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Play className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Play by Computer</span>
            </button>

            <button
              type="button"
              disabled={!isAudioReady || !hasRecording}
              onClick={() =>
                playbackMode === 'recorded' ? onStopPlayback() : onStartPlayback('recorded')
              }
              aria-pressed={playbackMode === 'recorded'}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${
                playbackMode === 'recorded'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Play className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Play Recorded</span>
            </button>

            <button
              type="button"
              disabled={!isAudioReady || !hasRecording}
              onClick={() =>
                playbackMode === 'compare' ? onStopPlayback() : onStartPlayback('compare')
              }
              aria-pressed={playbackMode === 'compare'}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${
                playbackMode === 'compare'
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <GitCompare className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Compare Mode</span>
            </button>

            {playbackMode === 'compare' && (
              <button
                type="button"
                onClick={() => setHearComputerInCompare(!hearComputerInCompare)}
                aria-pressed={hearComputerInCompare}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                  hearComputerInCompare
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {hearComputerInCompare ? 'Guide Audio: On' : 'Guide Audio: Off'}
              </button>
            )}

            <button
              type="button"
              onClick={onOpenTutor}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${
                activeTrainingPlan
                  ? 'bg-sky-50 text-sky-800 border-sky-200 hover:bg-sky-100'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <ClipboardCheck className="w-3.5 h-3.5 text-sky-600" aria-hidden="true" />
              <span>
                {activeTrainingPlan && activeTrainingStepIndex !== null
                  ? `Practice Tutor (${activeTrainingStepIndex + 1}/${activeTrainingPlan.trainingPlaylist.length})`
                  : 'Practice Tutor'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
