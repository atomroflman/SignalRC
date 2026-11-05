'use client';

import { useI18n } from '@/i18n/provider';
import { Locale } from '@/i18n/translations';
import { pillBase } from './status-pill';

const languageOrder: Locale[] = ['de', 'en'];

type LanguageSwitcherProps = {
  className?: string;
  showLabel?: boolean;
};

export default function LanguageSwitcher({ className = '', showLabel = false }: LanguageSwitcherProps) {
  const { locale, setLocale, messages } = useI18n();

  return (
    <div className={`${pillBase} gap-0.5 px-1 ${className}`.trim()}>
      {showLabel && <span className="pl-2 pr-1 text-slate-400">{messages.languageSwitcher.label}</span>}
      {languageOrder.map((nextLocale) => {
        const isActive = locale === nextLocale;
        const label = nextLocale === 'de' ? messages.languageSwitcher.german : messages.languageSwitcher.english;

        return (
          <button
            key={nextLocale}
            type="button"
            onClick={() => setLocale(nextLocale)}
            className={`h-6 rounded-full px-2 font-semibold transition ${isActive ? 'bg-white/15 text-white' : 'text-slate-400 hover:bg-white/10 hover:text-white'}`}
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