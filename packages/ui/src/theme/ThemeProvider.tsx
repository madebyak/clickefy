import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { accents, defaultAccent, type AccentKey } from '../tokens/accents';
import { darkColors, lightColors } from '../tokens/colors';
import { duration, easing, spring } from '../tokens/motion';
import { radius } from '../tokens/radius';
import { spacing } from '../tokens/spacing';
import { fontFamily, typography } from '../tokens/typography';
import type { ResolvedScheme, ThemeContextValue, ThemeMode } from './types';

const STORAGE_KEYS = {
  mode: 'clickfy:theme:mode',
  accent: 'clickfy:theme:accent',
} as const;

const ThemeContext = createContext<ThemeContextValue | null>(null);

interface ThemeProviderProps {
  children: ReactNode;
  /** Initial preference if nothing is persisted yet. Defaults to 'system'. */
  defaultMode?: ThemeMode;
  /** Initial accent if nothing is persisted yet. Defaults to violet. */
  defaultAccentKey?: AccentKey;
}

export function ThemeProvider({
  children,
  defaultMode = 'system',
  defaultAccentKey = defaultAccent,
}: ThemeProviderProps) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>(defaultMode);
  const [accentKey, setAccentKeyState] = useState<AccentKey>(defaultAccentKey);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate persisted preferences once on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [storedMode, storedAccent] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.mode),
          AsyncStorage.getItem(STORAGE_KEYS.accent),
        ]);
        if (cancelled) return;
        if (storedMode === 'light' || storedMode === 'dark' || storedMode === 'system') {
          setModeState(storedMode);
        }
        if (storedAccent && storedAccent in accents) {
          setAccentKeyState(storedAccent as AccentKey);
        }
      } catch {
        // Storage failures are non-fatal — fall back to defaults.
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    void AsyncStorage.setItem(STORAGE_KEYS.mode, next).catch(() => {});
  }, []);

  const setAccent = useCallback((next: AccentKey) => {
    setAccentKeyState(next);
    void AsyncStorage.setItem(STORAGE_KEYS.accent, next).catch(() => {});
  }, []);

  const scheme: ResolvedScheme = useMemo(() => {
    if (mode === 'system') return systemScheme === 'dark' ? 'dark' : 'light';
    return mode;
  }, [mode, systemScheme]);

  const toggleScheme = useCallback(() => {
    setMode(scheme === 'dark' ? 'light' : 'dark');
  }, [scheme, setMode]);

  const value = useMemo<ThemeContextValue>(() => {
    return {
      scheme,
      colors: scheme === 'dark' ? darkColors : lightColors,
      accent: accents[accentKey],
      spacing,
      radius,
      typography,
      fontFamily,
      duration,
      easing,
      spring,
      mode,
      accentKey,
      setMode,
      toggleScheme,
      setAccent,
    };
  }, [scheme, accentKey, mode, setMode, toggleScheme, setAccent]);

  // Render children even before hydration to avoid a flash. Worst case: one
  // brief frame in default theme before persisted preference loads.
  void hydrated;

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Hook — returns the active theme + setters. Must be called inside ThemeProvider. */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used inside <ThemeProvider>');
  }
  return ctx;
}

/** Lightweight hook — returns just the resolved scheme ('light' | 'dark'). */
export function useScheme(): ResolvedScheme {
  return useTheme().scheme;
}
