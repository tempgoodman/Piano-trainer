import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Download,
  Loader2,
  MousePointerClick,
  Redo2,
  Save,
  Undo2,
} from 'lucide-react';
import { NoteEditorToolbar } from '../components/editor/NoteEditorToolbar';
import { HeaderPreferencesMenu } from '../components/HeaderPreferencesMenu';
import { useFirebase } from '../context/FirebaseProvider';
import { usePreferences } from '../context/PreferencesProvider';
import { useOSMDEditor } from '../hooks/useOSMDEditor';
import {
  getUserScoreById,
  makeValidScoreId,
  saveUserScoreToFirestore,
  updateUserScoreInFirestore,
} from '../services/firestoreScores';
import { usePracticeStore } from '../store/usePracticeStore';
import { ScorePiece } from '../types/music';
import { EditorAccidental, EditorNoteType, MusicXMLParser } from '../utils/MusicXMLParser';

interface BackendScoreResponse {
  songId: string;
  title?: string;
  composer?: string;
  musicxml: string;
}

/**
 * Deliverable 1 & 4: Standalone WYSIWYG `SheetMusicEditorPage` (`/editor/:songId`)
 * Completely isolated from Web MIDI, AudioEngine, Practice Modes, and Playback hooks.
 * Flow: UI Click -> Mutate XML DOM -> Serialize New XML -> Debounced OSMD.load() -> OSMD.render()
 */
export function SheetMusicEditorPage() {
  const { songId = 'ode-to-joy' } = useParams<{ songId: string }>();
  const navigate = useNavigate();
  const { user } = useFirebase();
  const { t } = usePreferences();

  const userScores = usePracticeStore((s) => s.userScores);
  const scores = usePracticeStore((s) => s.scores);
  const updateScoreXml = usePracticeStore((s) => s.updateScoreXml);
  const addCustomScore = usePracticeStore((s) => s.addCustomScore);

  const sheetContainerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(960);

  const [xmlString, setXmlString] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);

  const [scoreTitle, setScoreTitle] = useState('Loading Score…');
  const [scoreComposer, setScoreComposer] = useState('');
  const [isLoadingScore, setIsLoadingScore] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [saveBanner, setSaveBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Track container width for floating popover clamping
  useEffect(() => {
    const el = sheetContainerRef.current;
    if (!el) return;
    const updateWidth = () => setContainerWidth(el.clientWidth || 960);
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fetch raw MusicXML from backend API, falling back seamlessly to repertoire store
  useEffect(() => {
    let cancelled = false;
    setIsLoadingScore(true);
    setLoadError(null);
    setSaveBanner(null);
    setUndoStack([]);
    setRedoStack([]);
    setHasUnsavedChanges(false);

    const loadScore = async () => {
      const localMatch = usePracticeStore.getState().scores.find((s) => s.id === songId);
      if (localMatch?.isCloudSaved) {
        if (!cancelled) {
          setXmlString(localMatch.musicXml);
          setScoreTitle(localMatch.title);
          setScoreComposer(localMatch.composer);
          setIsLoadingScore(false);
        }
        return;
      }

      if (user) {
        try {
          const cloudMatch = await getUserScoreById(songId);
          if (!cancelled && cloudMatch) {
            setXmlString(cloudMatch.musicXml);
            setScoreTitle(cloudMatch.title);
            setScoreComposer(cloudMatch.composer);
            setIsLoadingScore(false);
            return;
          }
        } catch {
          // Score may be a built-in score not stored in Firestore
        }
      }

      try {
        const res = await fetch(`/api/scores/${encodeURIComponent(songId)}`);
        const contentType = res.headers.get('content-type') || '';
        const text = await res.text();

        if (res.ok && contentType.includes('application/json')) {
          const payload = JSON.parse(text) as BackendScoreResponse;
          if (!cancelled && payload?.musicxml) {
            setXmlString(payload.musicxml);
            const meta = new MusicXMLParser(payload.musicxml).getScoreMetadata();
            setScoreTitle(payload.title || meta.title);
            setScoreComposer(payload.composer || meta.composer);
            setIsLoadingScore(false);
            return;
          }
        }
      } catch {
        // Backend unreachable or score only exists in local repertoire store
      }

      if (cancelled) return;

      if (localMatch) {
        setXmlString(localMatch.musicXml);
        setScoreTitle(localMatch.title);
        setScoreComposer(localMatch.composer);
        setIsLoadingScore(false);
        return;
      }

      setLoadError(`Could not find score "${songId}".`);
      setIsLoadingScore(false);
    };

    void loadScore();
    return () => {
      cancelled = true;
    };
  }, [songId, user]);

  // Isolated OSMD Editor Hook (debounced OSMD.load + OSMD.render + click mapping)
  const {
    selectedNoteId,
    selectedNoteMetadata,
    isRendering,
    renderError,
    clearSelection,
  } = useOSMDEditor({
    containerRef: sheetContainerRef,
    xmlString,
    debounceMs: 160,
  });

  const scoreMeasureCount = useMemo(() => {
    if (!xmlString) return 0;
    try {
      return new MusicXMLParser(xmlString).getScoreMetadata().measureCount;
    } catch {
      return 0;
    }
  }, [xmlString]);

  // Core Update Loop: Mutate XML DOM -> Serialize String -> Update State (triggers debounced OSMD render)
  const applyXmlMutation = useCallback(
    (mutator: (parser: MusicXMLParser) => void) => {
      if (!xmlString) return;
      try {
        const parser = new MusicXMLParser(xmlString);
        mutator(parser);
        const nextXml = parser.toXmlString();
        if (nextXml === xmlString) return;

        setUndoStack((prev) => [...prev.slice(-39), xmlString]);
        setRedoStack([]);
        setXmlString(nextXml);
        setHasUnsavedChanges(true);
        setSaveBanner(null);
      } catch (err) {
        setSaveBanner({
          kind: 'err',
          text: err instanceof Error ? err.message : 'Unable to apply XML edit.',
        });
      }
    },
    [xmlString]
  );

  const handlePitchStep = useCallback(
    (delta: 1 | -1) => {
      if (!selectedNoteId) return;
      applyXmlMutation((parser) => {
        parser.transposeDiatonic(selectedNoteId, delta);
      });
    },
    [applyXmlMutation, selectedNoteId]
  );

  const handleSetAccidental = useCallback(
    (accidental: EditorAccidental) => {
      if (!selectedNoteId) return;
      applyXmlMutation((parser) => {
        parser.setAccidental(selectedNoteId, accidental);
      });
    },
    [applyXmlMutation, selectedNoteId]
  );

  const handleSetDuration = useCallback(
    (noteType: EditorNoteType, dotted: boolean) => {
      if (!selectedNoteId) return;
      applyXmlMutation((parser) => {
        parser.setDuration(selectedNoteId, noteType, dotted);
      });
    },
    [applyXmlMutation, selectedNoteId]
  );

  const handleConvertToRest = useCallback(() => {
    if (!selectedNoteId) return;
    applyXmlMutation((parser) => {
      parser.convertToRest(selectedNoteId);
    });
  }, [applyXmlMutation, selectedNoteId]);

  const handleDeleteNote = useCallback(() => {
    if (!selectedNoteId) return;
    const targetId = selectedNoteId;
    clearSelection();
    applyXmlMutation((parser) => {
      parser.removeNote(targetId);
    });
  }, [applyXmlMutation, clearSelection, selectedNoteId]);

  const handleTitleChange = (nextTitle: string) => {
    setScoreTitle(nextTitle);
    applyXmlMutation((parser) => {
      parser.updateTitle(nextTitle);
    });
  };

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0 || !xmlString) return;
    const previousXml = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [...prev, xmlString]);
    setXmlString(previousXml);
    setHasUnsavedChanges(true);
  }, [undoStack, xmlString]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0 || !xmlString) return;
    const nextXml = redoStack[redoStack.length - 1];
    setRedoStack((prev) => prev.slice(0, -1));
    setUndoStack((prev) => [...prev, xmlString]);
    setXmlString(nextXml);
    setHasUnsavedChanges(true);
  }, [redoStack, xmlString]);

  // Keyboard shortcuts for crisp WYSIWYG editing
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }

      if (!selectedNoteId) return;

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        handlePitchStep(1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        handlePitchStep(-1);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        handleDeleteNote();
      } else if (e.key === 'Escape') {
        clearSelection();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [clearSelection, handleDeleteNote, handlePitchStep, handleRedo, handleUndo, selectedNoteId]);

  const handleSaveToBackend = async () => {
    if (!xmlString) return;
    setIsSaving(true);
    setSaveBanner(null);

    const existing = usePracticeStore.getState().scores.find((s) => s.id === songId);

    // If signed in, persist directly to the user's private Firestore library
    if (user) {
      try {
        const updatedPiece: ScorePiece = {
          id: existing?.isCloudSaved ? existing.id : makeValidScoreId('edited'),
          ownerId: user.uid,
          title: scoreTitle.trim() || existing?.title || 'Untitled Score',
          composer: scoreComposer.trim() || existing?.composer || 'Custom Edit',
          level: existing?.level || 'Custom',
          timeSignature: existing?.timeSignature || '4/4',
          measures: Math.max(1, scoreMeasureCount || existing?.measures || 1),
          bpm: existing?.bpm || 80,
          musicXml: xmlString,
          isCloudSaved: true,
        };

        if (existing?.isCloudSaved && existing.ownerId === user.uid) {
          await updateUserScoreInFirestore(user.uid, existing.id, updatedPiece);
          updateScoreXml(existing.id, xmlString, updatedPiece.title, updatedPiece.measures);
          setHasUnsavedChanges(false);
          setSaveBanner({
            kind: 'ok',
            text: 'Saved to your private cloud library!',
          });
        } else {
          const savedCopy = await saveUserScoreToFirestore(user.uid, updatedPiece);
          addCustomScore(savedCopy);
          setHasUnsavedChanges(false);
          setSaveBanner({
            kind: 'ok',
            text: 'Saved as a private copy in your cloud library!',
          });
          navigate(`/editor/${encodeURIComponent(savedCopy.id)}`, { replace: true });
        }
        setIsSaving(false);
        return;
      } catch (err) {
        setSaveBanner({
          kind: 'err',
          text: err instanceof Error ? err.message : 'Unable to save to your cloud library.',
        });
        setIsSaving(false);
        return;
      }
    }

    // Signed-out fallback: sync local studio session + optional backend endpoint
    updateScoreXml(songId, xmlString, scoreTitle, scoreMeasureCount);

    try {
      const res = await fetch(`/api/scores/${encodeURIComponent(songId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: scoreTitle,
          composer: scoreComposer,
          musicxml: xmlString,
        }),
      });

      const contentType = res.headers.get('content-type') || '';
      const rawText = await res.text();
      if (!res.ok || !contentType.includes('application/json')) {
        setHasUnsavedChanges(false);
        setSaveBanner({
          kind: 'ok',
          text: 'Saved to current session (sign in to save permanently to cloud).',
        });
        setIsSaving(false);
        return;
      }

      const parsed = JSON.parse(rawText) as { ok?: boolean; error?: string };
      if (!parsed.ok) {
        throw new Error(parsed.error || 'Failed to save MusicXML.');
      }

      setHasUnsavedChanges(false);
      setSaveBanner({
        kind: 'ok',
        text: 'Score saved! Ready in Practice Player.',
      });
    } catch (err) {
      setSaveBanner({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Unable to save changes to backend.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDownloadXml = () => {
    if (!xmlString) return;
    const blob = new Blob([xmlString], { type: 'application/vnd.recordare.musicxml+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(scoreTitle || songId).toLowerCase().replace(/[^a-z0-9]+/g, '-')}.musicxml`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] dark:bg-[#0B1120] text-[#0F172A] dark:text-slate-100 transition-colors">
      {/* Isolated Editor Header */}
      <header className="w-full shrink-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-3.5 transition-colors">
        <div className="w-full flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              <span>{t('editor.backToPractice')}</span>
            </Link>
            <div className="flex items-center gap-2.5">
              <span className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap">
                {t('editor.title')}
              </span>
              <span className="hidden sm:inline text-xs font-medium text-slate-400 dark:text-slate-600">·</span>
              <span className="hidden sm:inline text-xs font-medium text-slate-500 dark:text-slate-400">
                {t('editor.subtitle')}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="editor-song-select" className="sr-only">
              {t('nav.selectSheet')}
            </label>
            <select
              id="editor-song-select"
              value={songId}
              onChange={(e) => navigate(`/editor/${encodeURIComponent(e.target.value)}`)}
              className="px-3 py-1.5 text-xs font-semibold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-600"
            >
              {user && userScores.length > 0 && (
                <optgroup label={t('nav.myUploadedSheets')}>
                  {userScores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup
                label={
                  user && userScores.length > 0
                    ? t('nav.builtInLibrary')
                    : t('nav.practiceLibrary')
                }
              >
                {scores
                  .filter((s) => !s.isCloudSaved)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
              </optgroup>
            </select>

            <button
              type="button"
              onClick={handleUndo}
              disabled={undoStack.length === 0}
              title={`${t('editor.undo')} (Ctrl+Z)`}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{t('editor.undo')}</span>
            </button>

            <button
              type="button"
              onClick={handleRedo}
              disabled={redoStack.length === 0}
              title={`${t('editor.redo')} (Ctrl+Y)`}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              <Redo2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{t('editor.redo')}</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadXml}
              disabled={!xmlString}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-45 rounded-lg transition-colors"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{t('editor.exportXml')}</span>
            </button>

            <button
              type="button"
              onClick={handleSaveToBackend}
              disabled={!xmlString || isSaving}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-lg transition-colors"
            >
              {isSaving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span>{hasUnsavedChanges ? t('editor.saveChanges') : t('editor.saveScore')}</span>
            </button>

            <HeaderPreferencesMenu compact />
          </div>
        </div>
      </header>

      {/* Score Metadata & Live Engraving Status Strip */}
      <section className="w-full shrink-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-2.5 transition-colors">
        <div className="w-full flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="score-title-input" className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {t('editor.titleLabel')}
            </label>
            <input
              id="score-title-input"
              type="text"
              value={scoreTitle}
              onChange={(e) => handleTitleChange(e.target.value)}
              disabled={!xmlString}
              className="px-2.5 py-1 text-sm font-semibold text-slate-900 dark:text-slate-100 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-sky-600 w-64"
            />
            <span className="text-xs text-slate-500 dark:text-slate-400 font-mono-tabular">
              {t('editor.measuresCount', { count: scoreMeasureCount })}
            </span>
            {isRendering && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-700 dark:text-sky-400">
                <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                <span>{t('editor.updating')}</span>
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
            {saveBanner ? (
              <span
                className={`inline-flex items-center gap-1.5 font-semibold ${
                  saveBanner.kind === 'ok'
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-red-600 dark:text-red-400'
                }`}
              >
                {saveBanner.kind === 'ok' ? (
                  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>{saveBanner.text}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <MousePointerClick className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" aria-hidden="true" />
                <span>{t('editor.shortcutsHint')}</span>
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Main Standalone Editor Canvas */}
      <main className="flex-1 w-full px-4 sm:px-6 py-5 flex flex-col gap-4">
        <div className="relative flex-1 bg-white dark:bg-[#EAEFF4] border border-slate-200 dark:border-slate-700 text-slate-900 rounded-xl p-5 md:p-7 min-h-[480px] shadow-xs overflow-visible">
          {isLoadingScore && (
            <div className="flex items-center justify-center py-24 text-sm text-slate-600 gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-sky-600" aria-hidden="true" />
              <span>{t('editor.loadingScore')}</span>
            </div>
          )}

          {(loadError || renderError) && (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
              <AlertCircle className="w-6 h-6 text-red-600" aria-hidden="true" />
              <p className="text-sm font-semibold text-slate-900">
                {loadError || t('sheet.loadError')}
              </p>
              {renderError && <p className="text-xs text-slate-600">{renderError}</p>}
            </div>
          )}

          {/* Contextual Floating Note Toolbar */}
          {selectedNoteMetadata && !isLoadingScore && !loadError && (
            <NoteEditorToolbar
              note={selectedNoteMetadata}
              containerWidth={containerWidth}
              onPitchStep={handlePitchStep}
              onSetAccidental={handleSetAccidental}
              onSetDuration={handleSetDuration}
              onConvertToRest={handleConvertToRest}
              onDeleteNote={handleDeleteNote}
              onClose={clearSelection}
            />
          )}

          {/* Isolated OSMD Editor SVG Container */}
          <div
            ref={sheetContainerRef}
            className="osmd-editor-container w-full select-none"
            aria-label="Interactive MusicXML score editor"
          />
        </div>
      </main>
    </div>
  );
}
