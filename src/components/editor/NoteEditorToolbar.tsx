import { ArrowDown, ArrowUp, Eraser, Trash2, X } from 'lucide-react';
import { usePreferences } from '../../context/PreferencesProvider';
import { SelectedNoteMetadata } from '../../hooks/useOSMDEditor';
import { EditorAccidental, EditorNoteType } from '../../utils/MusicXMLParser';

interface NoteEditorToolbarProps {
  note: SelectedNoteMetadata;
  containerWidth: number;
  onPitchStep: (delta: 1 | -1) => void;
  onSetAccidental: (accidental: EditorAccidental) => void;
  onSetDuration: (noteType: EditorNoteType, dotted: boolean) => void;
  onConvertToRest: () => void;
  onDeleteNote: () => void;
  onClose: () => void;
}

const DURATION_OPTIONS: { id: EditorNoteType; label: string; title: string }[] = [
  { id: 'whole', label: '1', title: 'Whole Note' },
  { id: 'half', label: '1/2', title: 'Half Note' },
  { id: 'quarter', label: '1/4', title: 'Quarter Note' },
  { id: 'eighth', label: '1/8', title: 'Eighth Note' },
  { id: '16th', label: '1/16', title: 'Sixteenth Note' },
];

export function NoteEditorToolbar({
  note,
  containerWidth,
  onPitchStep,
  onSetAccidental,
  onSetDuration,
  onConvertToRest,
  onDeleteNote,
  onClose,
}: NoteEditorToolbarProps) {
  const { t } = usePreferences();

  const accidentalOptions: { id: EditorAccidental; label: string; title: string }[] = [
    { id: 'sharp', label: '♯', title: 'Sharp' },
    { id: 'flat', label: '♭', title: 'Flat' },
    { id: 'natural', label: '♮', title: 'Natural' },
    { id: 'none', label: t('editor.clearAccidental'), title: 'Remove Accidental' },
  ];

  const anchor = note.anchorRect;
  const toolbarWidth = 420;

  const rawLeft = anchor ? anchor.left - toolbarWidth / 2 : 24;
  const maxLeft = Math.max(16, containerWidth - toolbarWidth - 16);
  const left = Math.max(16, Math.min(rawLeft, maxLeft));

  const placeBelow = !anchor || anchor.top < 118;
  const top = anchor
    ? placeBelow
      ? anchor.top + anchor.height + 14
      : Math.max(12, anchor.top - 108)
    : 16;

  return (
    <div
      role="toolbar"
      aria-label="Edit selected note"
      onClick={(e) => e.stopPropagation()}
      style={{ left: `${left}px`, top: `${top}px`, width: `${Math.min(toolbarWidth, Math.max(280, containerWidth - 32))}px` }}
      className="absolute z-30 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl shadow-lg p-3 space-y-2.5 text-slate-900 dark:text-slate-100"
    >
      {/* Header Row */}
      <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300 font-mono-tabular">
          <span className="font-semibold text-sky-700 dark:text-sky-400">{note.displayLabel}</span>
          <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
          <span>M{note.measureNumber}</span>
          <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
          <span>{note.staffNumber === 1 ? t('editor.trebleRh') : t('editor.bassLh')}</span>
          <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
          <span className="capitalize">{note.noteType}{note.dotted ? '.' : ''}</span>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Deselect note"
          className="p-1 text-slate-400 hover:text-slate-800 dark:hover:text-white rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Controls Row 1: Pitch & Accidentals */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1" role="group" aria-label="Pitch step">
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mr-1">
            {t('editor.pitch')}
          </span>
          <button
            type="button"
            onClick={() => onPitchStep(1)}
            title="Pitch Up (Arrow Up)"
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-sky-100 dark:hover:bg-sky-900/60 hover:text-sky-800 dark:hover:text-sky-200 text-slate-800 dark:text-slate-100 rounded-md transition-colors"
          >
            <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{t('editor.up')}</span>
          </button>
          <button
            type="button"
            onClick={() => onPitchStep(-1)}
            title="Pitch Down (Arrow Down)"
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-sky-100 dark:hover:bg-sky-900/60 hover:text-sky-800 dark:hover:text-sky-200 text-slate-800 dark:text-slate-100 rounded-md transition-colors"
          >
            <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{t('editor.down')}</span>
          </button>
        </div>

        <div className="flex items-center gap-1" role="group" aria-label="Accidental">
          {accidentalOptions.map((acc) => {
            const isActive = !note.isRest && note.accidental === acc.id;
            return (
              <button
                key={acc.id}
                type="button"
                disabled={note.isRest}
                onClick={() => onSetAccidental(acc.id)}
                title={acc.title}
                aria-pressed={isActive}
                className={`px-2 py-1 text-xs font-semibold rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  isActive
                    ? 'bg-sky-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {acc.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Controls Row 2: Duration & Rest / Delete */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1" role="group" aria-label="Duration">
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mr-1">
            {t('editor.value')}
          </span>
          {DURATION_OPTIONS.map((dur) => {
            const isActive = note.noteType === dur.id;
            return (
              <button
                key={dur.id}
                type="button"
                onClick={() => onSetDuration(dur.id, note.dotted)}
                title={dur.title}
                aria-pressed={isActive}
                className={`px-2 py-1 text-xs font-semibold font-mono-tabular rounded-md transition-colors ${
                  isActive
                    ? 'bg-sky-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {dur.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => onSetDuration(note.noteType, !note.dotted)}
            title="Toggle Dotted Note"
            aria-pressed={note.dotted}
            className={`px-2 py-1 text-xs font-bold font-mono-tabular rounded-md transition-colors ${
              note.dotted
                ? 'bg-sky-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            {t('editor.dot')}
          </button>
        </div>

        <div className="flex items-center gap-1">
          {!note.isRest && (
            <button
              type="button"
              onClick={onConvertToRest}
              title="Convert note to rest (keeps measure rhythm)"
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/50 hover:bg-amber-100 dark:hover:bg-amber-950/80 border border-amber-200 dark:border-amber-800 rounded-md transition-colors"
            >
              <Eraser className="w-3 h-3" aria-hidden="true" />
              <span>{t('editor.rest')}</span>
            </button>
          )}
          <button
            type="button"
            onClick={onDeleteNote}
            title="Remove note element from measure (Delete)"
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/50 hover:bg-red-100 dark:hover:bg-red-950/80 border border-red-200 dark:border-red-800 rounded-md transition-colors"
          >
            <Trash2 className="w-3 h-3" aria-hidden="true" />
            <span>{t('editor.delete')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
