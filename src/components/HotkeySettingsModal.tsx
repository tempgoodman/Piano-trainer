import { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Keyboard,
  Loader2,
  LogIn,
  Music2,
  Plus,
  Radio,
  RotateCcw,
  Save,
  X,
} from 'lucide-react';
import { useFirebase } from '../context/FirebaseProvider';
import { usePreferences } from '../context/PreferencesProvider';
import {
  restoreDefaultHotkeysInFirestore,
  saveUserHotkeysToFirestore,
} from '../services/firestoreHotkeys';
import { usePracticeStore } from '../store/usePracticeStore';
import {
  ALL_PIANO_MIDI_NOTES,
  DEFAULT_USER_HOTKEYS,
  formatKeyboardKey,
  formatMidiChord,
  isSameHotkeysConfig,
  normalizeMidiChord,
  RESERVED_PIANO_KEYS,
  UserHotkeysConfig,
} from '../types/hotkeys';
import { midiToNoteName } from '../types/music';

interface HotkeySettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Registers a callback while capturing MIDI piano notes so incoming MIDI keys bind instead of playing */
  onRegisterMidiCapture: (handler: ((midi: number) => void) | null) => void;
}

type HotkeyTarget = 'restart' | 'stop';

const VALID_KEY_PATTERN = /^[a-zA-Z0-9_\-]+$/;

export function HotkeySettingsModal({
  isOpen,
  onClose,
  onRegisterMidiCapture,
}: HotkeySettingsModalProps) {
  const { user, openAuthModal, resendVerificationEmail, refreshUserVerification } = useFirebase();
  const { t } = usePreferences();
  const activeHotkeys = usePracticeStore((s) => s.hotkeys);
  const setHotkeys = usePracticeStore((s) => s.setHotkeys);
  const resetHotkeysToDefault = usePracticeStore((s) => s.resetHotkeysToDefault);

  const [draft, setDraft] = useState<UserHotkeysConfig>(activeHotkeys);
  const [capturingMidiFor, setCapturingMidiFor] = useState<HotkeyTarget | null>(null);
  const [capturingKeyFor, setCapturingKeyFor] = useState<HotkeyTarget | null>(null);
  const [addNoteSelection, setAddNoteSelection] = useState<Record<HotkeyTarget, number>>({
    restart: 21,
    stop: 108,
  });

  const [isSaving, setIsSaving] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isCheckingVerify, setIsCheckingVerify] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Sync draft when modal opens or saved hotkeys change
  useEffect(() => {
    if (isOpen) {
      setDraft(activeHotkeys);
      setCapturingMidiFor(null);
      setCapturingKeyFor(null);
      setStatusMsg(null);
    }
  }, [isOpen, activeHotkeys]);

  // Register live MIDI piano note capture callback when capturing a chord
  useEffect(() => {
    if (!isOpen || !capturingMidiFor || !user) {
      onRegisterMidiCapture(null);
      return;
    }

    onRegisterMidiCapture((midi: number) => {
      if (midi < 21 || midi > 108) return;
      setDraft((prev) => {
        const field = capturingMidiFor === 'restart' ? 'restartMidiNotes' : 'stopMidiNotes';
        const current = prev[field];
        if (current.includes(midi)) return prev;
        const nextNotes = normalizeMidiChord([...current, midi]);
        return { ...prev, [field]: nextNotes };
      });
      setStatusMsg(null);
    });

    return () => {
      onRegisterMidiCapture(null);
    };
  }, [capturingMidiFor, isOpen, onRegisterMidiCapture, user]);

  // Register computer keyboard capture listener
  useEffect(() => {
    if (!isOpen || !capturingKeyFor || !user) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Ignore bare modifier keys
      if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) {
        return;
      }

      const normalizedKey = e.key.length === 1 ? e.key.toLowerCase() : e.key;

      if (RESERVED_PIANO_KEYS.has(normalizedKey)) {
        setStatusMsg({
          kind: 'err',
          text: `"${normalizedKey.toUpperCase()}" is reserved for playing virtual piano notes (A–L). Please press another key (e.g., R, Esc, F1–F12, Backspace, 1–9).`,
        });
        setCapturingKeyFor(null);
        return;
      }

      if (!VALID_KEY_PATTERN.test(normalizedKey) || normalizedKey.length > 20) {
        setStatusMsg({
          kind: 'err',
          text: 'Please choose a standard letter, number, function key (F1–F12), Esc, Enter, or Backspace.',
        });
        setCapturingKeyFor(null);
        return;
      }

      setDraft((prev) => ({
        ...prev,
        [capturingKeyFor === 'restart' ? 'restartKey' : 'stopKey']: normalizedKey,
      }));
      setCapturingKeyFor(null);
      setStatusMsg(null);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [capturingKeyFor, isOpen, user]);

  if (!isOpen) return null;

  const isDefault = isSameHotkeysConfig(draft, DEFAULT_USER_HOTKEYS);
  const hasUnsavedChanges = !isSameHotkeysConfig(draft, activeHotkeys);

  const handleStartMidiCapture = (target: HotkeyTarget) => {
    setCapturingKeyFor(null);
    setStatusMsg(null);
    if (capturingMidiFor === target) {
      // Finish capture; if user didn't press anything, keep previous chord
      setDraft((prev) => {
        const field = target === 'restart' ? 'restartMidiNotes' : 'stopMidiNotes';
        if (prev[field].length === 0) {
          return { ...prev, [field]: activeHotkeys[field] };
        }
        return prev;
      });
      setCapturingMidiFor(null);
    } else {
      setDraft((prev) => ({
        ...prev,
        [target === 'restart' ? 'restartMidiNotes' : 'stopMidiNotes']: [],
      }));
      setCapturingMidiFor(target);
    }
  };

  const handleAddNote = (target: HotkeyTarget) => {
    const midi = addNoteSelection[target];
    const field = target === 'restart' ? 'restartMidiNotes' : 'stopMidiNotes';
    setDraft((prev) => {
      if (prev[field].includes(midi) || prev[field].length >= 4) return prev;
      return { ...prev, [field]: normalizeMidiChord([...prev[field], midi]) };
    });
    setStatusMsg(null);
  };

  const handleRemoveNote = (target: HotkeyTarget, midi: number) => {
    const field = target === 'restart' ? 'restartMidiNotes' : 'stopMidiNotes';
    setDraft((prev) => {
      if (prev[field].length <= 1) return prev;
      return { ...prev, [field]: prev[field].filter((n) => n !== midi) };
    });
    setStatusMsg(null);
  };

  const validateDraft = (candidate: UserHotkeysConfig): string | null => {
    if (candidate.restartMidiNotes.length < 1 || candidate.stopMidiNotes.length < 1) {
      return 'Each MIDI hotkey must have at least 1 piano key (up to 4 keys).';
    }
    const sameMidi =
      formatMidiChord(candidate.restartMidiNotes) === formatMidiChord(candidate.stopMidiNotes);
    if (sameMidi) {
      return 'Restart and Stop MIDI chords cannot be identical.';
    }
    if (candidate.restartKey.toLowerCase() === candidate.stopKey.toLowerCase()) {
      return 'Restart and Stop keyboard shortcuts cannot use the same key.';
    }
    return null;
  };

  const handleSave = async () => {
    if (!user) return;
    setCapturingMidiFor(null);
    setCapturingKeyFor(null);

    const validationErr = validateDraft(draft);
    if (validationErr) {
      setStatusMsg({ kind: 'err', text: validationErr });
      return;
    }

    setIsSaving(true);
    setStatusMsg(null);
    try {
      const saved = await saveUserHotkeysToFirestore(user.uid, draft);
      setHotkeys(saved, !isSameHotkeysConfig(saved, DEFAULT_USER_HOTKEYS));
      setDraft(saved);
      setStatusMsg({ kind: 'ok', text: 'Custom hotkeys saved to your account!' });
    } catch (err) {
      let msg = 'Unable to save custom hotkeys.';
      if (err instanceof Error) {
        try {
          const parsed = JSON.parse(err.message) as { error?: string };
          if (parsed?.error?.toLowerCase().includes('permission')) {
            msg = 'Permission denied. Please ensure your account email is verified.';
          } else if (parsed?.error) {
            msg = parsed.error;
          }
        } catch {
          msg = err.message;
        }
      }
      setStatusMsg({ kind: 'err', text: msg });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRestoreDefaults = async () => {
    if (!user) return;
    setCapturingMidiFor(null);
    setCapturingKeyFor(null);
    setIsRestoring(true);
    setStatusMsg(null);

    try {
      await restoreDefaultHotkeysInFirestore(user.uid);
      resetHotkeysToDefault();
      setDraft(DEFAULT_USER_HOTKEYS);
      setStatusMsg({ kind: 'ok', text: 'Restored default hotkeys.' });
    } catch (err) {
      setStatusMsg({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Unable to restore default hotkeys.',
      });
    } finally {
      setIsRestoring(false);
    }
  };

  const rows: {
    target: HotkeyTarget;
    title: string;
    description: string;
    midiNotes: number[];
    keyboardKey: string;
    defaultMidi: string;
    defaultKey: string;
  }[] = [
    {
      target: 'restart',
      title: t('hotkeyModal.restartTitle'),
      description: t('hotkeyModal.restartDesc'),
      midiNotes: draft.restartMidiNotes,
      keyboardKey: draft.restartKey,
      defaultMidi: formatMidiChord(DEFAULT_USER_HOTKEYS.restartMidiNotes),
      defaultKey: formatKeyboardKey(DEFAULT_USER_HOTKEYS.restartKey),
    },
    {
      target: 'stop',
      title: t('hotkeyModal.stopTitle'),
      description: t('hotkeyModal.stopDesc'),
      midiNotes: draft.stopMidiNotes,
      keyboardKey: draft.stopKey,
      defaultMidi: formatMidiChord(DEFAULT_USER_HOTKEYS.stopMidiNotes),
      defaultKey: formatKeyboardKey(DEFAULT_USER_HOTKEYS.stopKey),
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 dark:bg-black/70 p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hotkey-modal-title"
    >
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl overflow-hidden my-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <Keyboard className="w-5 h-5 text-sky-600 dark:text-sky-400" aria-hidden="true" />
            <div>
              <h2 id="hotkey-modal-title" className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
                {t('hotkeyModal.title')}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('hotkeyModal.subtitle')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('hotkeyModal.close')}
            className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
          {/* Guest Notice */}
          {!user && (
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-lg">
              <div className="space-y-0.5">
                <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  {t('hotkeyModal.guestTitle')}
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  {t('hotkeyModal.guestDesc')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  openAuthModal('signin');
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{t('hotkeyModal.signInToCustomize')}</span>
              </button>
            </div>
          )}

          {/* Unverified Email Notice for Logged-in Email/Password Users */}
          {user && !user.emailVerified && (
            <div className="p-3.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-900 dark:text-amber-200 space-y-2">
              <p className="font-semibold">
                Verify your email ({user.email}) to save custom hotkeys to your cloud account.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isCheckingVerify}
                  onClick={async () => {
                    setIsCheckingVerify(true);
                    try {
                      const ok = await refreshUserVerification();
                      setStatusMsg({
                        kind: ok ? 'ok' : 'err',
                        text: ok
                          ? 'Email verified! You can now save custom hotkeys.'
                          : 'Email not verified yet. Please click the link in your inbox first.',
                      });
                    } finally {
                      setIsCheckingVerify(false);
                    }
                  }}
                  className="px-3 py-1.5 font-semibold text-white bg-amber-700 hover:bg-amber-800 disabled:opacity-50 rounded-md transition-colors"
                >
                  {isCheckingVerify ? t('auth.checking') : t('auth.verifiedShort')}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await resendVerificationEmail();
                      setStatusMsg({ kind: 'ok', text: 'Verification email resent!' });
                    } catch {
                      setStatusMsg({
                        kind: 'err',
                        text: 'Please wait a moment before resending.',
                      });
                    }
                  }}
                  className="px-3 py-1.5 font-semibold text-amber-900 dark:text-amber-200 bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-950/60 rounded-md transition-colors"
                >
                  {t('auth.resendEmailShort')}
                </button>
              </div>
            </div>
          )}

          {/* Action Hotkey Rows */}
          <div className="space-y-4">
            {rows.map((row) => {
              const isMidiListening = capturingMidiFor === row.target;
              const isKeyListening = capturingKeyFor === row.target;

              return (
                <div
                  key={row.target}
                  className="p-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl space-y-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{row.title}</h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{row.description}</p>
                    </div>
                    <span className="text-[11px] text-slate-400 dark:text-slate-500 font-mono-tabular">
                      {t('hotkeyModal.defaultPrefix')} {row.defaultMidi} · {row.defaultKey}
                    </span>
                  </div>

                  {/* MIDI Piano Chord Row */}
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-700/80 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                        <Music2 className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" aria-hidden="true" />
                        <span>{t('hotkeyModal.midiChordLabel')}</span>
                      </span>

                      {user && (
                        <button
                          type="button"
                          onClick={() => handleStartMidiCapture(row.target)}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md border transition-colors ${
                            isMidiListening
                              ? 'bg-sky-600 text-white border-sky-600'
                              : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700'
                          }`}
                        >
                          <Radio className="w-3 h-3" aria-hidden="true" />
                          <span>{isMidiListening ? t('hotkeyModal.doneCapturing') : t('hotkeyModal.captureOnPiano')}</span>
                        </button>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {row.midiNotes.length > 0 ? (
                        row.midiNotes.map((midi) => (
                          <span
                            key={midi}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold font-mono-tabular bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-md"
                          >
                            <span>{midiToNoteName(midi)}</span>
                            {user && row.midiNotes.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveNote(row.target, midi)}
                                aria-label={`Remove ${midiToNoteName(midi)}`}
                                className="text-slate-400 hover:text-red-600 dark:hover:text-red-400 ml-0.5"
                              >
                                <X className="w-3 h-3" aria-hidden="true" />
                              </button>
                            )}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-sky-700 dark:text-sky-400 font-medium">
                          {t('hotkeyModal.pressMidiPrompt')}
                        </span>
                      )}

                      {user && row.midiNotes.length < 4 && (
                        <div className="inline-flex items-center gap-1 ml-auto">
                          <label htmlFor={`add-note-${row.target}`} className="sr-only">
                            Add piano note for {row.title}
                          </label>
                          <select
                            id={`add-note-${row.target}`}
                            value={addNoteSelection[row.target]}
                            onChange={(e) =>
                              setAddNoteSelection((prev) => ({
                                ...prev,
                                [row.target]: Number(e.target.value),
                              }))
                            }
                            className="px-2 py-1 text-xs font-mono-tabular bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-md text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-600"
                          >
                            {ALL_PIANO_MIDI_NOTES.map((n) => (
                              <option key={n.midi} value={n.midi}>
                                {n.label}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => handleAddNote(row.target)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-md transition-colors"
                          >
                            <Plus className="w-3 h-3" aria-hidden="true" />
                            <span>{t('hotkeyModal.add')}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Computer Keyboard Shortcut Row */}
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-700/80 flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                      <Keyboard className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" aria-hidden="true" />
                      <span>{t('hotkeyModal.keyboardShortcut')}</span>
                    </span>

                    <div className="flex items-center gap-2">
                      <kbd className="px-2.5 py-1 text-xs font-semibold font-mono-tabular bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-md text-slate-900 dark:text-slate-100">
                        {isKeyListening ? t('hotkeyModal.pressAnyKey') : formatKeyboardKey(row.keyboardKey)}
                      </kbd>
                      {user && (
                        <button
                          type="button"
                          onClick={() => {
                            setCapturingMidiFor(null);
                            setStatusMsg(null);
                            setCapturingKeyFor(isKeyListening ? null : row.target);
                          }}
                          className={`px-2.5 py-1 text-xs font-semibold rounded-md border transition-colors ${
                            isKeyListening
                              ? 'bg-sky-600 text-white border-sky-600'
                              : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700'
                          }`}
                        >
                          {isKeyListening ? t('hotkeyModal.cancel') : t('hotkeyModal.changeKey')}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Virtual Piano Computer Keyboard Reference */}
          <div className="p-4 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl space-y-1">
            <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              {t('hotkeyModal.typingRefTitle')}
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              {t('hotkeyModal.typingRefBody')}
            </p>
          </div>

          {/* Status Feedback Banner */}
          {statusMsg && (
            <div
              className={`p-3 rounded-lg border text-xs font-medium flex items-start gap-2 ${
                statusMsg.kind === 'ok'
                  ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                  : 'bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
              }`}
            >
              {statusMsg.kind === 'ok' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600 dark:text-red-400" aria-hidden="true" />
              )}
              <span>{statusMsg.text}</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-200 dark:border-slate-800">
          {user ? (
            <>
              <button
                type="button"
                disabled={isRestoring || isSaving || (isDefault && !hasUnsavedChanges)}
                onClick={() => void handleRestoreDefaults()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-45 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                {isRestoring ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>{t('hotkeyModal.restoreDefault')}</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white rounded-lg transition-colors"
                >
                  {t('hotkeyModal.close')}
                </button>
                <button
                  type="button"
                  disabled={isSaving || isRestoring || !hasUnsavedChanges}
                  onClick={() => void handleSave()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-45 disabled:cursor-not-allowed rounded-lg transition-colors"
                >
                  {isSaving ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Save className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  <span>{t('hotkeyModal.save')}</span>
                </button>
              </div>
            </>
          ) : (
            <div className="w-full flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
              >
                {t('hotkeyModal.close')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
