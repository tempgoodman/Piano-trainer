import {
  ChevronDown,
  FileEdit,
  Loader2,
  LogIn,
  Upload,
  UserPlus,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useFirebase } from '../context/FirebaseProvider';
import { usePreferences } from '../context/PreferencesProvider';
import { usePracticeStore } from '../store/usePracticeStore';
import { BrandLogo } from './BrandLogo';
import { HeaderPreferencesMenu } from './HeaderPreferencesMenu';

interface TopBarProps {
  onOpenUpload: () => void;
}

export function TopBar({ onOpenUpload }: TopBarProps) {
  const { user, authReady, isLoadingScores, openAuthModal } = useFirebase();
  const { t } = usePreferences();

  const userScores = usePracticeStore((s) => s.userScores);
  const scores = usePracticeStore((s) => s.scores);
  const activeScore = usePracticeStore((s) => s.activeScore);
  const setActiveScore = usePracticeStore((s) => s.setActiveScore);
  const isAudioLoading = usePracticeStore((s) => s.isAudioLoading);
  const audioLoadProgress = usePracticeStore((s) => s.audioLoadProgress);

  const builtInScores = scores.filter((s) => !s.isCloudSaved);

  return (
    <header className="w-full shrink-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-2.5 transition-colors">
      <div className="w-full flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 sm:gap-5">
        {/* Zone 1: Upper-Left Brand Logo */}
        <Link
          to="/"
          aria-label={t('nav.homeAria')}
          className="inline-flex items-center shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-sky-600 dark:focus-visible:ring-offset-slate-900"
        >
          <BrandLogo size="sm" />
        </Link>

        {/* Zone 2: Song Selection Dropdown */}
        <div className="flex-1 min-w-[190px] max-w-[400px] order-3 sm:order-2 w-full sm:w-auto">
          <label htmlFor="song-select-dropdown" className="sr-only">
            {t('nav.selectSheet')}
          </label>
          <div className="relative">
            <select
              id="song-select-dropdown"
              value={activeScore.id}
              onChange={(e) => {
                const found = scores.find((s) => s.id === e.target.value);
                if (found) setActiveScore(found);
              }}
              className="w-full appearance-none pl-3.5 pr-9 py-2 text-sm font-medium bg-slate-50 hover:bg-slate-100/80 dark:bg-slate-800 dark:hover:bg-slate-700/80 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-sky-600 focus:border-sky-600 truncate"
            >
              {user && userScores.length > 0 && (
                <optgroup label={t('nav.myUploadedSheets')}>
                  {userScores.map((piece) => (
                    <option key={piece.id} value={piece.id}>
                      {piece.title} — {piece.composer}
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
                {builtInScores.map((piece) => (
                  <option key={piece.id} value={piece.id}>
                    {piece.title} — {piece.composer}
                  </option>
                ))}
              </optgroup>
            </select>
            <ChevronDown
              className="w-4 h-4 text-slate-500 dark:text-slate-400 pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
              aria-hidden="true"
            />
          </div>
        </div>

        {/* Zone 3: Edit Score, Auth / Upload, and Unified Menu / Avatar Popover */}
        <div className="flex items-center gap-2 shrink-0 order-2 sm:order-3">
          {isAudioLoading && (
            <span className="hidden lg:inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 font-mono-tabular whitespace-nowrap">
              <Loader2 className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 animate-spin" aria-hidden="true" />
              <span>{t('nav.pianoLoading', { progress: audioLoadProgress })}</span>
            </span>
          )}

          {user && isLoadingScores && (
            <span className="hidden lg:inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
              <Loader2 className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 animate-spin" aria-hidden="true" />
              <span>{t('nav.syncing')}</span>
            </span>
          )}

          <Link
            to={`/editor/${encodeURIComponent(activeScore.id)}`}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-sky-600 dark:focus-visible:ring-offset-slate-900"
            title={t('nav.editScoreTitle', { title: activeScore.title })}
          >
            <FileEdit className="w-4 h-4 text-slate-600 dark:text-slate-300" aria-hidden="true" />
            <span className="hidden md:inline">{t('nav.editScore')}</span>
          </Link>

          {!authReady ? (
            <span className="inline-flex items-center px-3 py-2 text-xs text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            </span>
          ) : user ? (
            <button
              type="button"
              onClick={onOpenUpload}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 active:bg-sky-800 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-sky-600 dark:focus-visible:ring-offset-slate-900"
            >
              <Upload className="w-4 h-4" aria-hidden="true" />
              <span>{t('nav.uploadSheet')}</span>
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => openAuthModal('signin')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-sky-600 dark:focus-visible:ring-offset-slate-900"
              >
                <LogIn className="w-4 h-4 text-slate-600 dark:text-slate-300" aria-hidden="true" />
                <span>{t('nav.signIn')}</span>
              </button>

              <button
                type="button"
                onClick={() => openAuthModal('register')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 active:bg-sky-800 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-sky-600 dark:focus-visible:ring-offset-slate-900"
              >
                <UserPlus className="w-4 h-4" aria-hidden="true" />
                <span>{t('nav.register')}</span>
              </button>
            </>
          )}

          {/* Far-Right Burger Menu (Logged Out) or Avatar Menu (Logged In) */}
          <HeaderPreferencesMenu />
        </div>
      </div>
    </header>
  );
}
