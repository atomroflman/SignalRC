'use client';

import { useI18n } from '@/i18n/provider';
import { Locale } from '@/i18n/translations';

const languageOrder: Locale[] = ['de', 'en'];

type LanguageSwitcherProps = {
  className?: string;
  showLabel?: boolean;
};

export default function LanguageSwitcher({ className = '', showLabel = false }: LanguageSwitcherProps) {
  const { locale, setLocale, messages } = useI18n();

  return (
    <div className={`inline-flex items-center gap-1 rounded-full border border-white/10 bg-slate-900/70 p-0.5 text-[10px] shadow-[0_8px_18px_rgba(0,0,0,0.18)] backdrop-blur-sm ${className}`.trim()}>
      {showLabel && <span className="pl-2 pr-1 text-slate-400">{messages.languageSwitcher.label}</span>}
      {languageOrder.map((nextLocale) => {
        const isActive = locale === nextLocale;
        const label = nextLocale === 'de' ? messages.languageSwitcher.german : messages.languageSwitcher.english;

        return (
          <button
            key={nextLocale}
            type="button"
            onClick={() => setLocale(nextLocale)}
            className={`rounded-full px-2 py-0.5 font-semibold transition ${isActive ? 'bg-sky-400 text-slate-950' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}
            aria-pressed={isActive}
            aria-label={label}
            title={label}
          >
            {messages.languageSwitcher[nextLocale]}
          </button>
        );
      })}
    </div>
  );
}