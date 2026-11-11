import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_USER_SETTINGS,
  UserSettings,
} from '../../shared/types/settings.types';

export type Theme =
  | 'modscopeflow'
  | 'clockwork'
  | 'frozenmist'
  | 'amber'
  | 'nocturne'
  | 'springtime'
  | 'rosemeadow'
  | 'upvoted';

let currentTheme: Theme = (() => {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('modscope_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as UserSettings;
        if (parsed.theme) return parsed.theme as Theme;
      } catch (e) {
        // ignore
      }
    }
  }
  return 'modscopeflow';
})();

const listeners = new Set<(theme: Theme) => void>();

function applyThemeToDom(theme: Theme) {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

if (typeof document !== 'undefined') {
  applyThemeToDom(currentTheme);
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(currentTheme);

  useEffect(() => {
    const listener = (newTheme: Theme) => {
      setTheme(newTheme);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const changeTheme = useCallback(
    (newTheme: Theme, options?: { persist?: boolean }) => {
      currentTheme = newTheme;
      applyThemeToDom(newTheme);

      const shouldPersist = options?.persist ?? true;
      if (shouldPersist) {
        const saved = localStorage.getItem('modscope_settings');
        let settings: UserSettings;
        if (saved) {
          try {
            settings = JSON.parse(saved);
            settings.theme = newTheme;
          } catch (e) {
            settings = { ...DEFAULT_USER_SETTINGS, theme: newTheme };
          }
        } else {
          settings = { ...DEFAULT_USER_SETTINGS, theme: newTheme };
        }
        localStorage.setItem('modscope_settings', JSON.stringify(settings));
      }

      listeners.forEach((listener) => listener(newTheme));
    },
    []
  );

  return { theme, changeTheme };
}
