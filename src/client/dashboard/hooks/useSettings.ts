import { useState, useEffect } from 'react';
import {
  CalculationSettings,
  UserSettings,
  StorageSettings,
  ReportSettings,
  DEFAULT_CALCULATION_SETTINGS,
  DEFAULT_USER_SETTINGS,
  DEFAULT_STORAGE_SETTINGS,
  DEFAULT_REPORT_SETTINGS,
} from '../../../shared/types/settings';
import { useTheme } from '../../hooks/useTheme';

export function useSettings() {
  const [settings, setSettings] = useState<{
    settings: CalculationSettings;
    display: UserSettings;
    storage: StorageSettings;
    report: ReportSettings;
  }>({
    settings: DEFAULT_CALCULATION_SETTINGS,
    display: DEFAULT_USER_SETTINGS,
    storage: DEFAULT_STORAGE_SETTINGS,
    report: DEFAULT_REPORT_SETTINGS,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { changeTheme } = useTheme();

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await fetch('/api/settings');
        if (!response.ok) {
          throw new Error('Failed to fetch settings');
        }
        const data = await response.json();

        // Backend returns { settings, display, storage, report }
        const fetchedSettings = {
          settings: data.settings || DEFAULT_CALCULATION_SETTINGS,
          display: data.display || DEFAULT_USER_SETTINGS,
          storage: data.storage || DEFAULT_STORAGE_SETTINGS,
          report: data.report || DEFAULT_REPORT_SETTINGS,
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

  const updateSettings = async (newSettings: {
    settings?: CalculationSettings;
    display?: UserSettings;
    storage?: StorageSettings;
    report?: ReportSettings;
  }) => {
    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings),
      });
      if (!response.ok) {
        throw new Error('Failed to save settings');
      }

      setSettings((prev) => ({
        settings: newSettings.settings || prev.settings,
        display: newSettings.display || prev.display,
        storage: newSettings.storage || prev.storage,
        report: newSettings.report || prev.report,
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
