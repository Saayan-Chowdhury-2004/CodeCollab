import { create } from 'zustand';
import { monaco } from '../monaco-setup';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

interface ThemeState {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
  toggleTheme: () => void;
}

const STORAGE_KEY = 'cc-theme';

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'system') return getSystemTheme();
  return preference;
}

function applyTheme(theme: ResolvedTheme) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
  try {
    monaco.editor.setTheme(theme === 'dark' ? 'codecollab-dark' : 'codecollab-light');
  } catch (_e) {
    // Monaco might not be fully initialized yet
  }
}

function getStoredPreference(): ThemePreference {
  if (typeof localStorage === 'undefined') return 'system';
  const val = localStorage.getItem(STORAGE_KEY);
  if (val === 'light' || val === 'dark' || val === 'system') {
    return val;
  }
  return 'system';
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const initialPreference = getStoredPreference();
  const initialResolved = resolveTheme(initialPreference);

  // Apply immediately on store initialization
  applyTheme(initialResolved);

  if (typeof window !== 'undefined') {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', () => {
      if (get().preference === 'system') {
        const nextResolved = getSystemTheme();
        set({ resolvedTheme: nextResolved });
        applyTheme(nextResolved);
      }
    });
  }

  return {
    preference: initialPreference,
    resolvedTheme: initialResolved,
    setPreference: (preference: ThemePreference) => {
      try {
        localStorage.setItem(STORAGE_KEY, preference);
      } catch (_e) {
        // Storage access might be restricted
      }
      const nextResolved = resolveTheme(preference);
      applyTheme(nextResolved);
      set({ preference, resolvedTheme: nextResolved });
    },
    toggleTheme: () => {
      const current = get().resolvedTheme;
      const next: ThemePreference = current === 'dark' ? 'light' : 'dark';
      get().setPreference(next);
    },
  };
});

