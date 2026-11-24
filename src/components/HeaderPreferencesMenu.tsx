import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Globe, LogOut, Menu, Moon, Sun } from 'lucide-react';
import { useFirebase } from '../context/FirebaseProvider';
import { usePreferences } from '../context/PreferencesProvider';
import { LOCALE_OPTIONS } from '../i18n/translations';

interface HeaderPreferencesMenuProps {
  /** Compact variant for secondary headers like SheetMusicEditorPage */
  compact?: boolean;
}

/**
 * Option 3 unified corner menu:
 * - Logged out: compact Burger Menu (`☰`) housing Appearance (Light/Dark) and Language.
 * - Logged in: Avatar Menu housing User Profile, Appearance (Light/Dark), Language, and Sign Out.
 */
export function HeaderPreferencesMenu({ compact = false }: HeaderPreferencesMenuProps) {
  const { user, signOutUser } = useFirebase();
  const { theme, setTheme, locale, setLocale, t } = usePreferences();

  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const userLabel =
    user?.displayName?.trim() ||
    (user?.email ? user.email.split('@')[0] : null) ||
    t('nav.signedIn');

  const userInitial = userLabel.charAt(0).toUpperCase() || 'U';

  return (
    <div ref={menuRef} className="relative shrink-0">
      {user ? (
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-expanded={isOpen}
          aria-haspopup="menu"
          aria-label={t('nav.accountMenu')}
          title={user.email ?? userLabel}
          className={`inline-flex items-center gap-1.5 rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${
            compact ? 'pl-1.5 pr-2 py-1' : 'pl-1.5 pr-2.5 py-1.5'
          } ${
            isOpen
              ? 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600'
              : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
          }`}
        >
          {user.photoURL ? (
            <img
              src={user.photoURL}
              alt=""
              referrerPolicy="no-referrer"
              className="w-6 h-6 rounded-full object-cover shrink-0 border border-slate-200 dark:border-slate-600"
            />
          ) : (
            <span className="w-6 h-6 rounded-full bg-sky-600 text-white text-xs font-bold inline-flex items-center justify-center shrink-0">
              {userInitial}
            </span>
          )}
          {!compact && (
            <span className="hidden xl:inline text-xs font-semibold text-slate-700 dark:text-slate-200 max-w-[100px] truncate">
              {userLabel}
            </span>
          )}
          <ChevronDown
            className={`w-3.5 h-3.5 text-slate-500 dark:text-slate-400 transition-transform ${
              isOpen ? 'rotate-180' : ''
            }`}
            aria-hidden="true"
          />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-expanded={isOpen}
          aria-haspopup="menu"
          aria-label={t('nav.menu')}
          title={t('nav.menu')}
          className={`inline-flex items-center justify-center rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${
            compact ? 'p-1.5' : 'p-2'
          } ${
            isOpen
              ? 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white'
              : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
          }`}
        >
          <Menu className="w-4 h-4" aria-hidden="true" />
        </button>
      )}

      {isOpen && (
        <div
          role="menu"
          aria-label={user ? t('nav.accountMenu') : t('nav.menu')}
          className="absolute right-0 top-full mt-2 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg overflow-hidden z-50"
        >
          {/* Signed-in User Header */}
          {user && (
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50">
              <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                {userLabel}
              </p>
              {user.email && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                  {user.email}
                </p>
              )}
            </div>
          )}

          {/* Preferences Section */}
          <div className="p-3.5 space-y-3.5">
            {/* Appearance (Light / Dark) */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {t('nav.appearance')}
              </div>
              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={theme === 'light'}
                  onClick={() => setTheme('light')}
                  className={`inline-flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    theme === 'light'
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Sun className="w-3.5 h-3.5 text-amber-500" aria-hidden="true" />
                  <span>{t('nav.themeLight')}</span>
                </button>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={theme === 'dark'}
                  onClick={() => setTheme('dark')}
                  className={`inline-flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    theme === 'dark'
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Moon className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400" aria-hidden="true" />
                  <span>{t('nav.themeDark')}</span>
                </button>
              </div>
            </div>

            {/* Language Selector */}
            <div className="space-y-1.5">
              <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <Globe className="w-3 h-3" aria-hidden="true" />
                <span>{t('nav.language')}</span>
              </div>
              <div className="space-y-1">
                {LOCALE_OPTIONS.map((opt) => {
                  const active = locale === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      onClick={() => setLocale(opt.id)}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                        active
                          ? 'bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span>{opt.label}</span>
                      {active && <Check className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Sign Out (Logged-in only) */}
          {user && (
            <div className="p-2 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setIsOpen(false);
                  void signOutUser();
                }}
                className="w-full flex items-center gap-2 px-2.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{t('nav.signOut')}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
