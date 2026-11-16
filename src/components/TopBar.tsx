import { FileEdit, Loader2, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import { usePracticeStore } from '../store/usePracticeStore';

interface TopBarProps {
  onOpenUpload: () => void;
}

export function TopBar({ onOpenUpload }: TopBarProps) {
  const scores = usePracticeStore((s) => s.scores);
  const activeScore = usePracticeStore((s) => s.activeScore);
  const setActiveScore = usePracticeStore((s) => s.setActiveScore);
  const isAudioLoading = usePracticeStore((s) => s.isAudioLoading);
  const audioLoadProgress = usePracticeStore((s) => s.audioLoadProgress);

  return (
    <header className="w-full bg-white border-b border-slate-200 px-6 py-3.5">
      <div className="max-w-[1360px] mx-auto flex items-center justify-between gap-8">
        {/* Zone 1: Single-line Brand Wordmark */}
        <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
          Anson Practice Piano
        </span>

        {/* Zone 2: Clean single-line piece navigation */}
        <nav
          aria-label="Practice repertoire"
          className="hidden md:flex items-center gap-6 overflow-x-auto"
        >
          {scores.slice(0, 5).map((piece) => {
            const isActive = piece.id === activeScore.id;
            const shortLabel =
              piece.title.length > 18 ? `${piece.title.slice(0, 17)}…` : piece.title;
            return (
              <button
                key={piece.id}
                type="button"
                onClick={() => setActiveScore(piece)}
                className={`text-sm font-medium whitespace-nowrap shrink-0 pb-0.5 border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 rounded-xs ${
                  isActive
                    ? 'text-sky-700 border-sky-600'
                    : 'text-slate-600 border-transparent hover:text-slate-900 hover:border-slate-300'
                }`}
                title={`${piece.title} — ${piece.composer}`}
              >
                {shortLabel}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Audio readiness readout + Editor Launch + Upload Sheet */}
        <div className="flex items-center gap-3 shrink-0">
          {isAudioLoading && (
            <span className="hidden sm:inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 font-mono-tabular whitespace-nowrap">
              <Loader2 className="w-3.5 h-3.5 text-sky-600 animate-spin" aria-hidden="true" />
              <span>Grand Piano {audioLoadProgress}%</span>
            </span>
          )}
          <Link
            to={`/editor/${encodeURIComponent(activeScore.id)}`}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-sky-600"
            title={`Edit "${activeScore.title}" in WYSIWYG Sheet Music Editor`}
          >
            <FileEdit className="w-4 h-4 text-slate-600" aria-hidden="true" />
            <span>Edit Score</span>
          </Link>
          <button
            type="button"
            onClick={onOpenUpload}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 active:bg-sky-800 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-sky-600"
          >
            <Upload className="w-4 h-4" aria-hidden="true" />
            <span>Upload Sheet</span>
          </button>
        </div>
      </div>
    </header>
  );
}
