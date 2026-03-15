import { useEffect, useState } from 'react';
import { DEFAULT_USER_SETTINGS, UserSettings } from '../../shared/types/settings';

export type Theme = 'modscopeflow' | 'clockwork' | 'frozenmist' | 'amber' | 'nocturne' | 'springtime' | 'rosemeadow';

export function useTheme() {
    const [theme, setTheme] = useState<Theme>(() => {
        const saved = localStorage.getItem('modscope_settings');
        if (saved) {
            try {
                const parsed = JSON.parse(saved) as UserSettings;
                return parsed.theme || 'modscopeflow';
            } catch (e) {
                return 'modscopeflow';
            }
        }
        return 'modscopeflow';
    });

    useEffect(() => {
        // Apply theme to document
        document.documentElement.setAttribute('data-theme', theme);
    }, [theme]);

    const changeTheme = (newTheme: Theme) => {
        setTheme(newTheme);
        // Persist immediately for smoother reload
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
    };

    return { theme, changeTheme };
}
