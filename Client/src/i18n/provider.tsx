'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Locale, Messages, messagesByLocale, supportedLocales } from './translations';

const LOCALE_STORAGE_KEY = 'ltecar.locale';

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  messages: Messages;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function isLocale(value: string | null | undefined): value is Locale {
  return value !== null && value !== undefined && supportedLocales.includes(value as Locale);
}

function detectPreferredLocale(): Locale {
  if (typeof window === 'undefined') {
    return 'de';
  }

  const storedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  if (isLocale(storedLocale)) {
    return storedLocale;
  }

  const browserLocales = navigator.languages?.length ? navigator.languages : [navigator.language];
  const prefersGerman = browserLocales.some(locale => locale.toLowerCase().startsWith('de'));
  return prefersGerman ? 'de' : 'en';
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<Locale>('de');

  useEffect(() => {
    setLocale(detectPreferredLocale());
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    }
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale,
    messages: messagesByLocale[locale],
  }), [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used inside a LocaleProvider');
  }
  return context;
}