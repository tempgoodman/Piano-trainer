import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { Eye, EyeOff, Keyboard, Loader2, RefreshCw } from 'lucide-react';
import { usePreferences } from '../context/PreferencesProvider';
import { usePracticeStore } from '../store/usePracticeStore';
import { formatKeyboardKey, formatMidiChord } from '../types/hotkeys';
import { isBlackKey, midiToNoteName } from '../types/music';

interface VirtualPianoProps {
  onKeyDown: (midi: number, velocity?: number) => void;
  onKeyUp: (midi: number) => void;
  onRetryAudio?: () => void;
  onOpenHotkeys?: () => void;
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

export function VirtualPiano({
  onKeyDown,
  onKeyUp,
  onRetryAudio,
  onOpenHotkeys,
}: VirtualPianoProps) {
  const { t } = usePreferences();
  // Tracks active pointerId -> currently pressed MIDI note (or null if dragging outside a key)
  const activePointerNotesRef = useRef<Map<number, number | null>>(new Map());

  const onKeyDownRef = useRef(onKeyDown);
  onKeyDownRef.current = onKeyDown;
  const onKeyUpRef = useRef(onKeyUp);
  onKeyUpRef.current = onKeyUp;

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
  const setShowVirtualPiano = usePracticeStore((s) => s.setShowVirtualPiano);
  const isStatsMode = usePracticeStore((s) => s.isStatsMode);
  const sustainDown = usePracticeStore((s) => s.sustainDown);
  const inputMode = usePracticeStore((s) => s.inputMode);
  const hotkeys = usePracticeStore((s) => s.hotkeys);
  const isCustomHotkeys = usePracticeStore((s) => s.isCustomHotkeys);

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
  const isVirtualDisabled =
    !isAudioReady || inputMode === 'midi' || isPlaybackRunning || isStatsMode;

  const isMidiHeldByOtherPointer = useCallback((midi: number, excludePointerId: number): boolean => {
    for (const [pid, heldMidi] of activePointerNotesRef.current.entries()) {
      if (pid !== excludePointerId && heldMidi === midi) {
        return true;
      }
    }
    return false;
  }, []);

  const releasePointer = useCallback(
    (pointerId: number, fallbackMidi?: number) => {
      const hadPointer = activePointerNotesRef.current.has(pointerId);
      const heldMidi = activePointerNotesRef.current.get(pointerId) ?? null;
      activePointerNotesRef.current.delete(pointerId);

      const midiToRelease = heldMidi ?? (hadPointer ? null : fallbackMidi ?? null);
      if (midiToRelease !== null && !isMidiHeldByOtherPointer(midiToRelease, pointerId)) {
        onKeyUpRef.current(midiToRelease);
      }
    },
    [isMidiHeldByOtherPointer]
  );

  const releaseAllPointers = useCallback(() => {
    const midis = new Set<number>();
    for (const heldMidi of activePointerNotesRef.current.values()) {
      if (heldMidi !== null) midis.add(heldMidi);
    }
    activePointerNotesRef.current.clear();
    for (const midi of midis) {
      onKeyUpRef.current(midi);
    }
  }, []);

  // Global release guard: guarantees mouse-up / touch-cancel / window blur ALWAYS releases held keys
  useEffect(() => {
    const handleGlobalPointerEnd = (e: PointerEvent) => {
      if (activePointerNotesRef.current.has(e.pointerId)) {
        releasePointer(e.pointerId);
      }
    };

    window.addEventListener('pointerup', handleGlobalPointerEnd);
    window.addEventListener('pointercancel', handleGlobalPointerEnd);
    window.addEventListener('blur', releaseAllPointers);

    return () => {
      window.removeEventListener('pointerup', handleGlobalPointerEnd);
      window.removeEventListener('pointercancel', handleGlobalPointerEnd);
      window.removeEventListener('blur', releaseAllPointers);
      releaseAllPointers();
    };
  }, [releaseAllPointers, releasePointer]);

  // If virtual input becomes disabled mid-press (e.g., playback starts), release any held virtual keys
  useEffect(() => {
    if (isVirtualDisabled && activePointerNotesRef.current.size > 0) {
      releaseAllPointers();
    }
  }, [isVirtualDisabled, releaseAllPointers]);

  const handlePointerStart = (e: ReactPointerEvent<HTMLButtonElement>, midi: number) => {
    if (isVirtualDisabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const prevMidi = activePointerNotesRef.current.get(e.pointerId) ?? null;
    if (prevMidi === midi) return;

    if (prevMidi !== null && !isMidiHeldByOtherPointer(prevMidi, e.pointerId)) {
      onKeyUpRef.current(prevMidi);
    }

    activePointerNotesRef.current.set(e.pointerId, midi);
    onKeyDownRef.current(midi, 96);
  };

  const handlePointerEnter = (e: ReactPointerEvent<HTMLButtonElement>, midi: number) => {
    if (isVirtualDisabled) return;
    if (!activePointerNotesRef.current.has(e.pointerId)) return;

    // For mouse glissando, verify primary button is physically still held down
    if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) {
      releasePointer(e.pointerId);
      return;
    }

    const prevMidi = activePointerNotesRef.current.get(e.pointerId) ?? null;
    if (prevMidi === midi) return;

    if (prevMidi !== null && !isMidiHeldByOtherPointer(prevMidi, e.pointerId)) {
      onKeyUpRef.current(prevMidi);
    }

    activePointerNotesRef.current.set(e.pointerId, midi);
    onKeyDownRef.current(midi, 96);
  };

  const handlePointerEnd = (e: ReactPointerEvent<HTMLButtonElement>, midi: number) => {
    releasePointer(e.pointerId, activeNotes.has(midi) ? midi : undefined);
  };

  const handlePointerLeave = (e: ReactPointerEvent<HTMLButtonElement>, midi: number) => {
    const heldMidi = activePointerNotesRef.current.get(e.pointerId);
    if (heldMidi !== midi) return;

    if (!isMidiHeldByOtherPointer(midi, e.pointerId)) {
      onKeyUpRef.current(midi);
    }

    // Keep pointer tracked for glissando only while primary button is still physically pressed
    if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) {
      activePointerNotesRef.current.delete(e.pointerId);
    } else {
      activePointerNotesRef.current.set(e.pointerId, null);
    }
  };

  return (
    <section
      aria-label="Virtual piano keyboard"
      className="w-full shrink-0 px-4 sm:px-6 pb-4 pt-1"
    >
      {/* Keyboard Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-2.5">
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 dark:text-slate-400">
          <span className="font-semibold text-slate-800 dark:text-slate-100">
            {t('piano.header')}
          </span>
          <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
          {isCompare ? (
            <>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600 inline-block" aria-hidden="true" />
                <span>{t('piano.expectedComputer')}</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-blue-600 inline-block" aria-hidden="true" />
                <span>{t('piano.recordedMatch')}</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-red-600 inline-block" aria-hidden="true" />
                <span>{t('piano.recordedWrong')}</span>
              </span>
            </>
          ) : (
            <>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-sky-600 inline-block" aria-hidden="true" />
                <span>{t('piano.rhTarget')}</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600 inline-block" aria-hidden="true" />
                <span>{t('piano.lhTarget')}</span>
              </span>
            </>
          )}
          {sustainDown && (
            <>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
              <span className="font-semibold text-amber-700 dark:text-amber-400">
                {t('piano.sustainActive')}
              </span>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-slate-600 dark:text-slate-300 font-mono-tabular">
            <span className="font-sans font-medium text-slate-500 dark:text-slate-400">
              {t('piano.hotkeysLabel')}
            </span>{' '}
            {t('piano.restartLabel')} {formatMidiChord(hotkeys.restartMidiNotes)} ({formatKeyboardKey(hotkeys.restartKey)})
            <span aria-hidden="true" className="mx-1.5 text-slate-300 dark:text-slate-700">·</span>
            {t('piano.stopLabel')} {formatMidiChord(hotkeys.stopMidiNotes)} ({formatKeyboardKey(hotkeys.stopKey)})
          </span>

          {onOpenHotkeys && (
            <button
              type="button"
              onClick={onOpenHotkeys}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md border transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${
                isCustomHotkeys
                  ? 'bg-sky-50 dark:bg-sky-950/50 text-sky-800 dark:text-sky-300 border-sky-200 dark:border-sky-800 hover:bg-sky-100'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              <Keyboard className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                {isCustomHotkeys ? t('controls.hotkeysCustom') : t('controls.hotkeys')}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowKeyLabels(!showKeyLabels)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            {showKeyLabels ? (
              <>
                <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{t('piano.hideKeyNames')}</span>
              </>
            ) : (
              <>
                <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{t('piano.showKeyNames')}</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => setShowVirtualPiano(false)}
            title={t('piano.hideKeysTitle')}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-md transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
          >
            <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{t('piano.hideKeys')}</span>
          </button>
        </div>
      </div>

      {/* Piano Keybed */}
      <div className="relative w-full h-44 md:h-48 bg-slate-900 dark:bg-black p-2 rounded-xl border border-slate-300 dark:border-slate-700 select-none touch-none">
        {!isAudioReady && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-900/55 backdrop-blur-[1px] rounded-xl px-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md px-5 py-3.5 flex flex-col items-center gap-2 text-center max-w-sm">
              {audioError ? (
                <>
                  <p className="text-xs font-semibold text-red-700 dark:text-red-400">{audioError}</p>
                  {onRetryAudio && (
                    <button
                      type="button"
                      onClick={onRetryAudio}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-md transition-colors"
                    >
                      <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{t('piano.retryAudio')}</span>
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
                    <Loader2 className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 animate-spin" aria-hidden="true" />
                    <span>
                      {isAudioLoading
                        ? t('piano.loadingEngine', {
                            label: audioEngineLabel,
                            progress: audioLoadProgress,
                          })
                        : t('piano.preparingAudio')}
                    </span>
                  </div>
                  <div className="w-56 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
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
            <span className="px-3 py-1.5 text-xs font-semibold bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-md shadow-sm">
              {t('piano.midiOnlyNotice')}
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
                  handlePointerStart(e, midi);
                }}
                onPointerEnter={(e) => handlePointerEnter(e, midi)}
                onPointerUp={(e) => handlePointerEnd(e, midi)}
                onPointerCancel={(e) => handlePointerEnd(e, midi)}
                onPointerLeave={(e) => handlePointerLeave(e, midi)}
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
                  handlePointerStart(e, midi);
                }}
                onPointerEnter={(e) => {
                  e.stopPropagation();
                  handlePointerEnter(e, midi);
                }}
                onPointerUp={(e) => handlePointerEnd(e, midi)}
                onPointerCancel={(e) => handlePointerEnd(e, midi)}
                onPointerLeave={(e) => handlePointerLeave(e, midi)}
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
