import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { Button } from '../design-system/index.js';

export const APP_LOCALES = ['zh-TW', 'en'] as const;
export type AppLocale = (typeof APP_LOCALES)[number];

const STORAGE_KEY = 'bini-pms-locale';

interface LocaleContextValue {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  text: (zhTw: string, en: string) => string;
}

const fallbackValue: LocaleContextValue = {
  locale: 'zh-TW',
  setLocale: () => undefined,
  text: (zhTw) => zhTw,
};

const LocaleContext = createContext<LocaleContextValue>(fallbackValue);

function storedLocale(): AppLocale {
  if (typeof window === 'undefined') return 'zh-TW';
  try {
    const stored = window.localStorage?.getItem(STORAGE_KEY);
    return stored === 'en' ? 'en' : 'zh-TW';
  } catch {
    return 'zh-TW';
  }
}

export function LocaleProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: AppLocale }) {
  const [locale, setLocale] = useState<AppLocale>(() => initialLocale ?? storedLocale());

  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      window.localStorage?.setItem(STORAGE_KEY, locale);
    } catch {
      // Language selection remains usable when storage is blocked or unavailable.
    }
  }, [locale]);

  const value = useMemo<LocaleContextValue>(() => ({
    locale,
    setLocale,
    text: (zhTw, en) => locale === 'zh-TW' ? zhTw : en,
  }), [locale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}

export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { locale, setLocale, text } = useLocale();
  return (
    <div aria-label={text('語言切換', 'Language')} className={`bds-language-switch ${className}`.trim()} role="group">
      <Button aria-pressed={locale === 'zh-TW'} onClick={() => setLocale('zh-TW')} size="sm" variant="ghost">中</Button>
      <Button aria-pressed={locale === 'en'} onClick={() => setLocale('en')} size="sm" variant="ghost">EN</Button>
    </div>
  );
}
