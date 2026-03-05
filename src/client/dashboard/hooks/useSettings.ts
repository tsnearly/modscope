import { useState, useEffect } from 'react';
import { CalculationSettings, UserSettings, DEFAULT_CALCULATION_SETTINGS, DEFAULT_USER_SETTINGS } from '../../../shared/types/settings';
import { useTheme } from '../../hooks/useTheme';

export function useSettings() {
    const [settings, setSettings] = useState<{ settings: CalculationSettings, display: UserSettings }>({
        settings: DEFAULT_CALCULATION_SETTINGS,
        display: DEFAULT_USER_SETTINGS
    });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const { changeTheme } = useTheme();

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const response = await fetch('/api/settings');
                if (!response.ok) throw new Error('Failed to fetch settings');
                const data = await response.json();

                // Backend returns { settings, display }
                const fetchedSettings = {
                    settings: data.settings || DEFAULT_CALCULATION_SETTINGS,
                    display: data.display || DEFAULT_USER_SETTINGS
                };
                setSettings(fetchedSettings);

                // Ensure the theme matches the stored setting
                if (fetchedSettings.display?.theme) {
                    changeTheme(fetchedSettings.display.theme);
                }
            } catch (err) {
                console.error('Failed to fetch settings:', err);
                setError(err instanceof Error ? err.message : 'Unknown error');
            } finally {
                setLoading(false);
            }
        };

        fetchSettings();
    }, []);

    const updateSettings = async (newSettings: { settings?: CalculationSettings, display?: UserSettings }) => {
        try {
            const response = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newSettings),
            });
            if (!response.ok) throw new Error('Failed to save settings');

            setSettings(prev => ({
                settings: newSettings.settings || prev.settings,
                display: newSettings.display || prev.display
            }));

            // Sync theme if it changed
            if (newSettings.display?.theme) {
                changeTheme(newSettings.display.theme);
            }

            return true;
        } catch (err) {
            console.error('Failed to save settings:', err);
            setError(err instanceof Error ? err.message : 'Failed to save');
            return false;
        }
    };

    return { settings, loading, error, updateSettings };
}
