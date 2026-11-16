import { useState } from 'react';
import { Eye, EyeOff, Loader2, RefreshCw } from 'lucide-react';
import { usePracticeStore } from '../store/usePracticeStore';
import { isBlackKey, midiToNoteName } from '../types/music';

interface VirtualPianoProps {
  onKeyDown: (midi: number, velocity?: number) => void;
  onKeyUp: (midi: number) => void;
  onRetryAudio?: () => void;
}

const START_MIDI = 48; // C3
const END_MIDI = 84;   // C6 (37 keys = 3 full octaves)

const MIDI_TO_QWERTY: Record<number, string> = {
  60: 'A',
  61: 'W',
  62: 'S',
  63: 'E',
  64: 'D',
  65: 'F',
  66: 'T',
  67: 'G',
  68: 'Y',
  69: 'H',
  70: 'U',
  71: 'J',
  72: 'K',
  73: 'O',
  74: 'L',
  75: 'P',
  76: ';',
};

export function VirtualPiano({ onKeyDown, onKeyUp, onRetryAudio }: VirtualPianoProps) {
  const [pointerHeld, setPointerHeld] = useState(false);

  const isAudioLoading = usePracticeStore((s) => s.isAudioLoading);
  const audioLoadProgress = usePracticeStore((s) => s.audioLoadProgress);
  const isAudioReady = usePracticeStore((s) => s.isAudioReady);
  const audioError = usePracticeStore((s) => s.audioError);
  const audioEngineLabel = usePracticeStore((s) => s.audioEngineLabel);

  const activeNotes = usePracticeStore((s) => s.activeNotes);
  const expectedNotes = usePracticeStore((s) => s.expectedNotes);
  const matchedMidis = usePracticeStore((s) => s.matchedMidis);
  const wrongNote = usePracticeStore((s) => s.wrongNote);
  const showKeyLabels = usePracticeStore((s) => s.showKeyLabels);
  const setShowKeyLabels = usePracticeStore((s) => s.setShowKeyLabels);
  const sustainDown = usePracticeStore((s) => s.sustainDown);
  const inputMode = usePracticeStore((s) => s.inputMode);

  // Dual-Color Compare Mode State
  const playbackMode = usePracticeStore((s) => s.playbackMode);
  const isPlaybackRunning = usePracticeStore((s) => s.isPlaybackRunning);
  const compareExpectedNotes = usePracticeStore((s) => s.compareExpectedNotes);
  const compareRecordedKeys = usePracticeStore((s) => s.compareRecordedKeys);

  const whiteKeys: number[] = [];
  const blackKeys: { midi: number; leftPercent: number }[] = [];

  for (let m = START_MIDI; m <= END_MIDI; m++) {
    if (!isBlackKey(m)) {
      whiteKeys.push(m);
    }
  }

  const totalWhite = whiteKeys.length;

  let whiteIndex = 0;
  for (let m = START_MIDI; m <= END_MIDI; m++) {
    if (!isBlackKey(m)) {
      whiteIndex++;
    } else {
      const blackWidthRatio = 0.62;
      const centerPercent = (whiteIndex / totalWhite) * 100;
      const keyWidthPercent = (100 / totalWhite) * blackWidthRatio;
      blackKeys.push({
        midi: m,
        leftPercent: centerPercent - keyWidthPercent / 2,
      });
    }
  }

  const expectedByMidi = new Map(expectedNotes.map((n) => [n.midi, n]));
  const isCompare = playbackMode === 'compare';
  const isVirtualDisabled = !isAudioReady || inputMode === 'midi' || isPlaybackRunning;

  const handlePointerStart = (midi: number) => {
    if (isVirtualDisabled) return;
    setPointerHeld(true);
    onKeyDown(midi, 96);
  };

  const handlePointerEnd = (midi: number) => {
    if (isVirtualDisabled) return;
    onKeyUp(midi);
  };

  return (
    <section
      aria-label="Virtual piano keyboard"
      className="w-full max-w-[1360px] mx-auto px-6 pb-6 pt-1"
      onPointerUp={() => setPointerHeld(false)}
      onPointerLeave={() => setPointerHeld(false)}
    >
      {/* Keyboard Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-2.5">
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
          <span className="font-semibold text-slate-800">Piano Keyboard (C3 – C6)</span>
          <span aria-hidden="true" className="text-slate-300">·</span>
          {isCompare ? (
            <>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600 inline-block" aria-hidden="true" />
                <span>Expected (Computer)</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-blue-600 inline-block" aria-hidden="true" />
                <span>Recorded (Match)</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-red-600 inline-block" aria-hidden="true" />
                <span>Recorded (Wrong Pitch)</span>
              </span>
            </>
          ) : (
            <>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-sky-600 inline-block" aria-hidden="true" />
                <span>Right Hand Target (RH)</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600 inline-block" aria-hidden="true" />
                <span>Left Hand Target (LH)</span>
              </span>
            </>
          )}
          {sustainDown && (
            <>
              <span aria-hidden="true" className="text-slate-300">·</span>
              <span className="font-semibold text-amber-700">Sustain Pedal Active</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-4">
          <span className="hidden xl:inline text-xs text-slate-500 font-mono-tabular">
            MIDI Hotkeys: A0+B0+C1 Restart · A7+B7+C8 Stop
          </span>
          <span className="hidden lg:inline text-xs text-slate-500">
            Keys A–L play C4–D5
          </span>
          <button
            type="button"
            onClick={() => setShowKeyLabels(!showKeyLabels)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors"
          >
            {showKeyLabels ? (
              <>
                <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Hide Key Names</span>
              </>
            ) : (
              <>
                <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Show Key Names</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Piano Keybed */}
      <div className="relative w-full h-44 md:h-48 bg-slate-900 p-2 rounded-xl border border-slate-300 select-none touch-none">
        {!isAudioReady && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-900/55 backdrop-blur-[1px] rounded-xl px-4">
            <div className="bg-white border border-slate-200 rounded-lg shadow-md px-5 py-3.5 flex flex-col items-center gap-2 text-center max-w-sm">
              {audioError ? (
                <>
                  <p className="text-xs font-semibold text-red-700">{audioError}</p>
                  {onRetryAudio && (
                    <button
                      type="button"
                      onClick={onRetryAudio}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-md transition-colors"
                    >
                      <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Retry Piano Audio</span>
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                    <Loader2 className="w-3.5 h-3.5 text-sky-600 animate-spin" aria-hidden="true" />
                    <span>
                      {isAudioLoading
                        ? `Loading ${audioEngineLabel}… ${audioLoadProgress}%`
                        : 'Preparing Grand Piano Audio…'}
                    </span>
                  </div>
                  <div className="w-56 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-sky-600 transition-all duration-200"
                      style={{ width: `${audioLoadProgress}%` }}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {isAudioReady && inputMode === 'midi' && !isPlaybackRunning && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-900/20 rounded-xl pointer-events-none">
            <span className="px-3 py-1.5 text-xs font-semibold bg-white text-slate-900 rounded-md shadow-sm">
              Input set to MIDI Piano Only
            </span>
          </div>
        )}

        <div className="relative w-full h-full flex">
          {/* White Keys */}
          {whiteKeys.map((midi) => {
            const name = midiToNoteName(midi);
            const isPressed = activeNotes.has(midi);
            const expected = expectedByMidi.get(midi);
            const isMatched = matchedMidis.has(midi);
            const isWrong = wrongNote?.midi === midi;
            const qwerty = MIDI_TO_QWERTY[midi];

            const compExpected = isCompare && compareExpectedNotes.has(midi);
            const compRecorded = isCompare ? compareRecordedKeys.get(midi) : undefined;

            let keySurface = 'bg-white hover:bg-slate-50 text-slate-500';
            let badgeText: string | null = null;
            let badgeClass = '';

            if (isCompare) {
              if (compRecorded === 'wrong') {
                keySurface = compExpected
                  ? 'bg-red-100 ring-2 ring-inset ring-emerald-600 text-red-900 translate-y-[2px]'
                  : 'bg-red-100 ring-2 ring-inset ring-red-600 text-red-900 translate-y-[2px]';
                badgeText = 'ERR';
                badgeClass = 'bg-red-600 text-white';
              } else if (compRecorded === 'correct' && compExpected) {
                keySurface = 'bg-blue-100 ring-2 ring-inset ring-emerald-600 text-blue-950 translate-y-[2px]';
                badgeText = 'YOU ✓';
                badgeClass = 'bg-blue-600 text-white';
              } else if (compRecorded === 'correct') {
                keySurface = 'bg-blue-100 ring-2 ring-inset ring-blue-600 text-blue-900 translate-y-[2px]';
                badgeText = 'YOU';
                badgeClass = 'bg-blue-600 text-white';
              } else if (compExpected) {
                keySurface = 'bg-emerald-50 ring-2 ring-inset ring-emerald-600 text-emerald-900';
                badgeText = 'CPU';
                badgeClass = 'bg-emerald-600 text-white';
              }
            } else if (isWrong) {
              keySurface = 'bg-red-100 border-red-500 text-red-800';
            } else if (isPressed) {
              keySurface = 'bg-sky-100 text-sky-900 translate-y-[2px]';
            } else if (expected) {
              if (isMatched) {
                keySurface = 'bg-emerald-100 text-emerald-900';
              } else if (expected.staffIndex === 1) {
                keySurface = 'bg-sky-50 ring-2 ring-inset ring-sky-600 text-sky-900';
                badgeText = 'RH';
                badgeClass = 'bg-sky-600 text-white';
              } else {
                keySurface = 'bg-emerald-50 ring-2 ring-inset ring-emerald-600 text-emerald-900';
                badgeText = 'LH';
                badgeClass = 'bg-emerald-600 text-white';
              }
            }

            return (
              <button
                key={midi}
                type="button"
                aria-label={`Piano key ${name}`}
                onPointerDown={(e) => {
                  e.preventDefault();
                  handlePointerStart(midi);
                }}
                onPointerEnter={() => {
                  if (pointerHeld) handlePointerStart(midi);
                }}
                onPointerUp={() => handlePointerEnd(midi)}
                onPointerLeave={() => {
                  if (activeNotes.has(midi)) handlePointerEnd(midi);
                }}
                className={`relative flex-1 h-full border-r last:border-r-0 border-slate-300 rounded-b-md flex flex-col justify-end items-center pb-2 transition-transform duration-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${keySurface}`}
              >
                {badgeText && (
                  <span className={`mb-1 px-1 py-0.5 text-[9px] font-bold rounded-xs ${badgeClass}`}>
                    {badgeText}
                  </span>
                )}

                {showKeyLabels && (
                  <span
                    className={`text-[11px] font-medium font-mono-tabular leading-tight ${
                      midi === 60 ? 'font-bold text-sky-700' : ''
                    }`}
                  >
                    {name}
                  </span>
                )}

                {qwerty && showKeyLabels && (
                  <span className="hidden md:inline text-[9px] text-slate-400 font-mono-tabular mt-0.5">
                    {qwerty}
                  </span>
                )}
              </button>
            );
          })}

          {/* Black Keys */}
          {blackKeys.map(({ midi, leftPercent }) => {
            const name = midiToNoteName(midi);
            const isPressed = activeNotes.has(midi);
            const expected = expectedByMidi.get(midi);
            const isMatched = matchedMidis.has(midi);
            const isWrong = wrongNote?.midi === midi;
            const blackWidthPercent = (100 / totalWhite) * 0.62;

            const compExpected = isCompare && compareExpectedNotes.has(midi);
            const compRecorded = isCompare ? compareRecordedKeys.get(midi) : undefined;

            let keySurface = 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-950';
            let badgeText: string | null = null;

            if (isCompare) {
              if (compRecorded === 'wrong') {
                keySurface = 'bg-red-600 text-white border-red-800 translate-y-[2px]';
                badgeText = 'ERR';
              } else if (compRecorded === 'correct' && compExpected) {
                keySurface = 'bg-blue-600 ring-2 ring-emerald-400 text-white border-blue-900 translate-y-[2px]';
                badgeText = '✓';
              } else if (compRecorded === 'correct') {
                keySurface = 'bg-blue-600 text-white border-blue-900 translate-y-[2px]';
                badgeText = 'YOU';
              } else if (compExpected) {
                keySurface = 'bg-emerald-600 ring-2 ring-emerald-300 text-white border-emerald-900';
                badgeText = 'CPU';
              }
            } else if (isWrong) {
              keySurface = 'bg-red-600 text-white border-red-800';
            } else if (isPressed) {
              keySurface = 'bg-sky-600 text-white translate-y-[2px] border-sky-800';
            } else if (expected) {
              if (isMatched) {
                keySurface = 'bg-emerald-600 text-white border-emerald-800';
              } else if (expected.staffIndex === 1) {
                keySurface = 'bg-sky-700 ring-2 ring-sky-300 text-white border-sky-900';
                badgeText = 'RH';
              } else {
                keySurface = 'bg-emerald-700 ring-2 ring-emerald-300 text-white border-emerald-900';
                badgeText = 'LH';
              }
            }

            return (
              <button
                key={midi}
                type="button"
                aria-label={`Piano key ${name}`}
                style={{
                  left: `${leftPercent}%`,
                  width: `${blackWidthPercent}%`,
                }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handlePointerStart(midi);
                }}
                onPointerEnter={(e) => {
                  if (pointerHeld) {
                    e.stopPropagation();
                    handlePointerStart(midi);
                  }
                }}
                onPointerUp={(e) => {
                  e.stopPropagation();
                  handlePointerEnd(midi);
                }}
                onPointerLeave={() => {
                  if (activeNotes.has(midi)) handlePointerEnd(midi);
                }}
                className={`absolute top-0 z-20 h-[62%] border rounded-b-md shadow-md flex flex-col justify-end items-center pb-1.5 transition-transform duration-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${keySurface}`}
              >
                {badgeText && <span className="text-[8px] font-bold mb-0.5">{badgeText}</span>}
                {showKeyLabels && (
                  <span className="text-[9px] font-mono-tabular opacity-90">{name.replace(/\d/, '')}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
