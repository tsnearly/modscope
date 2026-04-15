import React, { useState, useEffect, useRef } from 'react';
import { EntityTitle } from './ui/entity-title';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import { Separator } from './ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { RadioGroup, RadioItem } from './ui/radio';
import { Section, SectionCard } from './ui/section';

import { useTheme } from '../../hooks/useTheme';
import { useSettings } from '../hooks/useSettings';
import {
  CalculationSettings,
  UserSettings,
  StorageSettings,
  ReportSettings,
  AnalysisPreset,
  ScalingMethod,
  DEFAULT_CALCULATION_SETTINGS,
  DEFAULT_USER_SETTINGS,
  DEFAULT_STORAGE_SETTINGS,
  DEFAULT_REPORT_SETTINGS,
  PRESETS,
  THEMES,
} from '../../../shared/types/settings';

interface ConfigViewProps {
  initialConfig?: any;
}

function ConfigView({ initialConfig }: ConfigViewProps) {
  const { changeTheme } = useTheme();
  const { settings, loading: settingsLoading, updateSettings } = useSettings();
  const [localSettings, setLocalSettings] = useState<{
    settings: CalculationSettings;
    report: ReportSettings;
    display: UserSettings;
    storage: StorageSettings;
  }>(() => {
    if (initialConfig?.settings) {
      return {
        settings: {
          ...DEFAULT_CALCULATION_SETTINGS,
          ...initialConfig.settings,
        },
        report: initialConfig.report
          ? { ...DEFAULT_REPORT_SETTINGS, ...initialConfig.report }
          : DEFAULT_REPORT_SETTINGS,
        display: initialConfig.display
          ? { ...DEFAULT_USER_SETTINGS, ...initialConfig.display }
          : DEFAULT_USER_SETTINGS,
        storage: initialConfig.storage
          ? { ...DEFAULT_STORAGE_SETTINGS, ...initialConfig.storage }
          : DEFAULT_STORAGE_SETTINGS,
      };
    }
    return {
      settings: DEFAULT_CALCULATION_SETTINGS,
      report: DEFAULT_REPORT_SETTINGS,
      display: DEFAULT_USER_SETTINGS,
      storage: DEFAULT_STORAGE_SETTINGS,
    };
  });
  const [loading, setLoading] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [validationErrors, setValidationErrors] = useState<{
    retentionDays?: string;
    analysisPoolSize?: string;
  }>({});
  const hasAppliedServerSettings = useRef(false);

  useEffect(() => {
    // Only apply server-fetched settings once the fetch completes (loading=false),
    // and never again within the same mount (prevents overwriting user edits after save).
    if (!settingsLoading && settings && !hasAppliedServerSettings.current) {
      hasAppliedServerSettings.current = true;
      setLocalSettings((_prev) => ({
        settings: {
          ...DEFAULT_CALCULATION_SETTINGS,
          ...(settings.settings || {}),
        },
        report: {
          ...DEFAULT_REPORT_SETTINGS,
          ...(settings.report || {}),
        },
        display: {
          ...DEFAULT_USER_SETTINGS,
          ...(settings.display || {}),
        },
        storage: {
          ...DEFAULT_STORAGE_SETTINGS,
          ...(settings.storage || {}),
        },
      }));
    }
  }, [settingsLoading, settings]);

  const handleCalcChange = <K extends keyof CalculationSettings>(
    key: K,
    value: CalculationSettings[K]
  ) => {
    setLocalSettings((prev) => {
      if (prev?.settings?.[key] === value) {
        return prev;
      }
      const nextSettings = {
        ...(prev?.settings || DEFAULT_CALCULATION_SETTINGS),
        [key]: value,
      };

      // Only allow non-preset changes when in custom mode
      if (key !== 'id') {
        if (nextSettings.id !== 'custom') {
          return prev;
        } // silently block
        // already custom — no preset flip needed
      }
      return { ...prev, settings: nextSettings };
    });
    setIsDirty(true);
  };

  const handleReportChange = <K extends keyof ReportSettings>(
    key: K,
    value: ReportSettings[K]
  ) => {
    setLocalSettings((prev) => {
      if (prev?.report?.[key] === value) {
        return prev;
      }
      return {
        ...prev,
        report: { ...(prev?.report || DEFAULT_REPORT_SETTINGS), [key]: value },
      };
    });
    setIsDirty(true);
  };

  const handleDisplayChange = <K extends keyof UserSettings>(
    key: K,
    value: UserSettings[K]
  ) => {
    setLocalSettings((prev) => {
      if (prev?.display?.[key] === value) {
        return prev;
      }
      return {
        ...prev,
        display: { ...(prev?.display || DEFAULT_USER_SETTINGS), [key]: value },
      };
    });
    setIsDirty(true);
  };

  const handleStorageChange = <K extends keyof StorageSettings>(
    key: K,
    value: StorageSettings[K]
  ) => {
    setLocalSettings((prev) => {
      if (prev?.storage?.[key] === value) {
        return prev;
      }
      return {
        ...prev,
        storage: {
          ...(prev?.storage || DEFAULT_STORAGE_SETTINGS),
          [key]: value,
        },
      };
    });
    setIsDirty(true);
  };

  const handlePresetChange = (preset: AnalysisPreset) => {
    if (preset === 'custom') {
      handleCalcChange('id', preset);
      return;
    }

    // Apply preset defaults based on the exported PRESETS
    const presetDef = PRESETS.find((p) => p.id === preset);
    const newCalcSettings: Partial<CalculationSettings> = {
      id: preset,
      ...(presetDef?.weights || {}),
    };

    setLocalSettings((prev) => ({
      ...prev,
      settings: { ...prev.settings, ...newCalcSettings },
      report: {
        ...prev.report,
        ...(presetDef?.report || {}),
      } as ReportSettings,
    }));
    setIsDirty(true);
  };

  const handleSave = async () => {
    setLoading(true);
    const success = await updateSettings(localSettings);
    setLoading(false);
    if (success) {
      setIsDirty(false);
    }
  };

  const handleReset = () => {
    setLocalSettings({
      settings: DEFAULT_CALCULATION_SETTINGS,
      report: DEFAULT_REPORT_SETTINGS,
      display: DEFAULT_USER_SETTINGS,
      storage: DEFAULT_STORAGE_SETTINGS,
    });
    // Apply the default theme immediately — don't make user save and restart
    changeTheme((DEFAULT_USER_SETTINGS.theme as any) ?? 'modscopeflow');
    setIsDirty(true);
  };

  const isCustom = localSettings?.settings?.id === 'custom';

  return (
    <div className="config-view h-full flex flex-col bg-[var(--color-surface)] text-left">
      <EntityTitle
        icon="mono-set-up.png"
        iconColor="var(--color-text)"
        title="Configuration & Rulesets"
        subtitle="Analysis settings and presets"
        className="mb-6 p-4 bg-transparent border-b border-border"
        actions={
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={handleReset}
              disabled={loading}
              className="w-36"
              icon="lucide:rotate-ccw"
            >
              Reset Defaults
            </Button>
            <Button
              onClick={handleSave}
              disabled={!isDirty || loading}
              loading={loading}
              className="w-36"
              icon={loading ? '' : 'lucide:save'}
            >
              {loading ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        }
      />

      <div className="view-content flex-1 overflow-y-auto px-6 pb-6 w-full">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full max-w-none">
          {/* Column 1: Analysis Profile (The "How") */}
          <div className="space-y-6">
            <Section title="Analysis Profile" icon="lucide:sliders">
              <SectionCard className="mb-4">
                <form>
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-semibold text-foreground block mb-1">
                        Community Preset
                      </label>
                      <p className="text-xs text-muted-foreground mb-3">
                        Load a pre-configured analysis strategy optimized for
                        specific subreddit types.
                      </p>
                      <Select
                        value={localSettings?.settings?.id ?? 'discussion'}
                        onValueChange={(val) =>
                          handlePresetChange(val as AnalysisPreset)
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select a preset" />
                        </SelectTrigger>
                        <SelectContent>
                          {PRESETS.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="p-3 bg-primary/10 rounded-md border border-primary/30">
                      <p className="text-xs text-primary font-medium">
                        <span className="font-bold">Current Mode: </span>
                        {PRESETS.find(
                          (p) => p.id === localSettings?.settings?.id
                        )?.desc || 'Custom settings'}
                      </p>
                    </div>
                  </div>
                </form>
              </SectionCard>

              <SectionCard>
                <fieldset
                  disabled={!isCustom}
                  className={`border-0 p-0 m-0 ${!isCustom ? 'opacity-60' : ''}`}
                >
                  {!isCustom && (
                    <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-4 flex items-center gap-2">
                      <span className="font-bold">🔒</span> Controlled by preset
                      — select <strong>Custom</strong> to edit
                    </p>
                  )}
                  <form>
                    <h3 className="text-sm font-bold text-foreground mb-4 uppercase tracking-wider flex items-center gap-2">
                      <span
                        className="w-1 h-4 rounded-full"
                        style={{ backgroundColor: 'var(--color-secondary)' }}
                      ></span>
                      Scoring Factors
                    </h3>
                    <div className="space-y-3">
                      {/* Comment Weight */}
                      <div className="px-4 py-3 bg-muted/20 rounded-lg border border-border/50">
                        <div className="flex justify-between items-center mb-2">
                          <label className="text-xs font-semibold text-muted-foreground uppercase">
                            Comment Weight
                          </label>
                          <span className="text-xs font-bold px-2 py-1 rounded">
                            {localSettings?.settings?.commentWeight ?? 1}x
                          </span>
                        </div>
                        <input
                          type="range"
                          min="1"
                          max="10"
                          step="1"
                          value={localSettings?.settings?.commentWeight ?? 8}
                          onChange={(e) =>
                            handleCalcChange(
                              'commentWeight',
                              parseInt(e.target.value)
                            )
                          }
                          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600 mb-1"
                        />
                        <div className="flex justify-between text-[10px] text-muted-foreground font-medium font-mono">
                          <span>Upvotes</span>
                          <span>Balanced</span>
                          <span>Comments</span>
                        </div>
                      </div>

                      {/* Upvote Weight */}
                      <div className="px-4 py-3 bg-muted/20 rounded-lg border border-border/50">
                        <div className="flex justify-between items-center mb-2">
                          <label className="text-xs font-semibold text-muted-foreground uppercase">
                            Upvote Weight
                          </label>
                          <span className="text-xs font-bold px-2 py-1 rounded">
                            {localSettings?.settings?.upvoteWeight ?? 1}x
                          </span>
                        </div>
                        <input
                          type="range"
                          min="1"
                          max="10"
                          step="1"
                          value={localSettings?.settings?.upvoteWeight ?? 1}
                          onChange={(e) =>
                            handleCalcChange(
                              'upvoteWeight',
                              parseInt(e.target.value)
                            )
                          }
                          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600 mb-1"
                        />
                        <div className="flex justify-between text-[10px] text-muted-foreground font-medium font-mono">
                          <span>Low</span>
                          <span>Standard</span>
                          <span>Impactful</span>
                        </div>
                      </div>

                      {/* Velocity Configuration */}
                      <div className="px-4 py-3 bg-muted/20 rounded-lg border border-border/50">
                        <div className="flex justify-between items-center mb-4">
                          <label className="text-xs font-semibold text-muted-foreground uppercase">
                            Velocity Impact
                          </label>
                          <div className="flex gap-2">
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded">
                              {localSettings?.settings?.velocityHours ?? 24}h
                              Window
                            </span>
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded">
                              {localSettings?.settings?.velocityWeight ?? 1.5}x
                              Max
                            </span>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <div>
                            <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                              <span>Decay Window (Hours)</span>
                              <span>
                                {localSettings?.settings?.velocityHours ?? 24}h
                              </span>
                            </div>
                            <input
                              type="range"
                              min="3"
                              max="72"
                              step="1"
                              value={
                                localSettings?.settings?.velocityHours ?? 48
                              }
                              onChange={(e) =>
                                handleCalcChange(
                                  'velocityHours',
                                  parseInt(e.target.value)
                                )
                              }
                              className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-400"
                            />
                          </div>
                          <div>
                            <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                              <span>Engagement Multiplier</span>
                              <span>
                                {localSettings?.settings?.velocityWeight ?? 1.5}
                                x
                              </span>
                            </div>
                            <input
                              type="range"
                              min="0.5"
                              max="4.0"
                              step="0.25"
                              value={
                                localSettings?.settings?.velocityWeight ?? 1.3
                              }
                              onChange={(e) =>
                                handleCalcChange(
                                  'velocityWeight',
                                  parseFloat(e.target.value)
                                )
                              }
                              className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-400"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Creator Bonus */}
                      <div className="px-4 py-3 bg-muted/20 rounded-lg border border-border/50">
                        <div className="flex justify-between items-center mb-2">
                          <label className="text-xs font-semibold text-muted-foreground uppercase">
                            Creator Bonus
                          </label>
                          <span className="text-xs font-bold px-2 py-1 rounded">
                            +{localSettings?.settings?.creatorBonus ?? 5} pts
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="15"
                          step="1"
                          value={localSettings?.settings?.creatorBonus ?? 10}
                          onChange={(e) =>
                            handleCalcChange(
                              'creatorBonus',
                              parseInt(e.target.value)
                            )
                          }
                          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600 mb-1"
                        />
                        <div className="flex justify-between text-[10px] text-muted-foreground font-medium font-mono">
                          <span>None</span>
                          <span>Standard</span>
                          <span>High Impact</span>
                        </div>
                      </div>

                      {/* Depth Scaling */}
                      <div className="px-4 py-3 bg-muted/20 rounded-lg border border-border/50">
                        <label className="text-xs font-semibold text-muted-foreground uppercase block mb-3">
                          Engagement Decay
                        </label>
                        <RadioGroup
                          value={
                            localSettings?.settings?.depthScaling ??
                            'logarithmic'
                          }
                          onChange={(val) =>
                            handleCalcChange(
                              'depthScaling',
                              val as ScalingMethod
                            )
                          }
                          disabled={!isCustom}
                          className="space-y-2"
                        >
                          {(
                            [
                              'linear',
                              'logarithmic',
                              'exponential',
                            ] as ScalingMethod[]
                          ).map((method) => (
                            <div key={method} className="space-y-3">
                              <RadioItem
                                value={method}
                                id={`scaling-${method}`}
                                label={
                                  method.charAt(0).toUpperCase() +
                                  method.slice(1)
                                }
                              />
                              {(localSettings?.settings?.depthScaling ??
                                'logarithmic') === method && (
                                <div className="pl-6 space-y-3 border-l-2 border-primary/20 ml-2 py-1">
                                  <div>
                                    <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                                      <span>Scaling Intensity</span>
                                      <span>
                                        {(() => {
                                          const val =
                                            method === 'linear'
                                              ? localSettings?.settings
                                                  ?.depthLinear
                                              : method === 'logarithmic'
                                                ? localSettings?.settings
                                                    ?.depthLogarithmic
                                                : localSettings?.settings
                                                    ?.depthExponential;
                                          if (val === undefined) {
                                            return '0';
                                          }
                                          return method === 'exponential'
                                            ? val
                                            : Number(val).toFixed(2);
                                        })()}
                                      </span>
                                    </div>
                                    <input
                                      type="range"
                                      min={
                                        method === 'exponential' ? '5' : '0.1'
                                      }
                                      max={
                                        method === 'exponential' ? '25' : '0.5'
                                      }
                                      step={
                                        method === 'exponential' ? '1' : '0.05'
                                      }
                                      value={
                                        (method === 'linear'
                                          ? localSettings?.settings?.depthLinear
                                          : method === 'logarithmic'
                                            ? localSettings?.settings
                                                ?.depthLogarithmic
                                            : localSettings?.settings
                                                ?.depthExponential) ??
                                        (method === 'exponential' ? 5 : 0.1)
                                      }
                                      onChange={(e) =>
                                        handleCalcChange(
                                          method === 'linear'
                                            ? 'depthLinear'
                                            : method === 'logarithmic'
                                              ? 'depthLogarithmic'
                                              : 'depthExponential',
                                          method === 'exponential'
                                            ? parseInt(e.target.value)
                                            : parseFloat(e.target.value)
                                        )
                                      }
                                      className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary"
                                    />
                                  </div>
                                  <div>
                                    <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                                      <span>Maximum Depth Cap</span>
                                      <span>
                                        {localSettings?.settings?.depthMax ??
                                          20}{' '}
                                        Levels
                                      </span>
                                    </div>
                                    <input
                                      type="range"
                                      min="3"
                                      max="50"
                                      step="1"
                                      value={
                                        localSettings?.settings?.depthMax ?? 20
                                      }
                                      onChange={(e) =>
                                        handleCalcChange(
                                          'depthMax',
                                          parseInt(e.target.value)
                                        )
                                      }
                                      className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary"
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </RadioGroup>
                      </div>
                    </div>
                  </form>
                </fieldset>
              </SectionCard>
            </Section>
          </div>

          <div className="space-y-6">
            <Section title="Data Scope" icon="lucide:layers">
              <SectionCard>
                <fieldset
                  disabled={!isCustom}
                  className={`border-0 p-0 m-0 ${!isCustom ? 'opacity-60' : ''}`}
                >
                  {!isCustom && (
                    <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-4 flex items-center gap-2">
                      <span className="font-bold">🔒</span> Controlled by preset
                      — select <strong>Custom</strong> to edit
                    </p>
                  )}
                  <form>
                    <div className="space-y-3">
                      {/* Fetch Depth */}
                      <div className="px-4 py-3 bg-muted/20 rounded-lg border border-border/50">
                        <div className="flex justify-between items-center mb-2">
                          <label className="text-sm font-semibold text-foreground">
                            Scanning Depth
                          </label>
                          <span className="text-xs font-bold px-2 py-1 rounded shadow-sm border border-gray-200 bg-white">
                            {[
                              'Fast',
                              'Light',
                              'Balanced',
                              'Thorough',
                              'Complete',
                            ][(localSettings?.settings?.fetchDepth ?? 3) - 1] ||
                              'Balanced'}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-3 block">
                          Maximum depth of nested comment trees to fetch.
                        </p>
                        <input
                          type="range"
                          min="1"
                          max="5"
                          value={localSettings?.settings?.fetchDepth ?? 3}
                          onChange={(e) =>
                            handleCalcChange(
                              'fetchDepth',
                              parseInt(e.target.value)
                            )
                          }
                          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-orange-600"
                        />
                        <div className="flex justify-between text-[10px] text-muted-foreground mt-1 uppercase font-medium">
                          <span>Fast</span>
                          <span>Deep</span>
                        </div>
                      </div>

                      {/* Analysis Pool Size */}
                      <div className="px-4 py-3 bg-muted/20 rounded-lg border border-border/50">
                        <div className="flex justify-between items-center mb-2">
                          <label className="text-sm font-semibold text-foreground">
                            Analysis Pool Size
                          </label>
                        </div>
                        <p className="text-xs text-muted-foreground mb-3 block">
                          How many recent posts are included in each scan
                          analysis (10-50, rounded to nearest 5).
                        </p>
                        <div className="flex items-center gap-3">
                          <input
                            type="number"
                            min="10"
                            max="50"
                            step="5"
                            value={
                              localSettings?.settings?.analysisPoolSize ?? 25
                            }
                            onChange={(e) => {
                              const raw = parseInt(e.target.value, 10);
                              const clamped = Math.min(
                                50,
                                Math.max(10, Number.isNaN(raw) ? 25 : raw)
                              );
                              const rounded = Math.round(clamped / 5) * 5;
                              handleCalcChange('analysisPoolSize', rounded);
                              // Clear validation error when user types
                              setValidationErrors((prev) => ({
                                ...prev,
                                analysisPoolSize: '',
                              }));
                            }}
                            onBlur={() => {
                              // Validate on blur
                              const value =
                                localSettings?.settings?.analysisPoolSize ?? 25;
                              if (value < 10) {
                                setValidationErrors((prev) => ({
                                  ...prev,
                                  analysisPoolSize:
                                    'Analysis Pool Size must be at least 10',
                                }));
                              } else if (value > 50) {
                                setValidationErrors((prev) => ({
                                  ...prev,
                                  analysisPoolSize:
                                    'Analysis Pool Size cannot exceed 50',
                                }));
                              } else {
                                setValidationErrors((prev) => ({
                                  ...prev,
                                  analysisPoolSize: '',
                                }));
                              }
                            }}
                            className={`w-20 px-3 py-1.5 border rounded text-sm font-semibold ${validationErrors.analysisPoolSize ? 'border-red-500' : 'border-gray-300'}`}
                          />
                          <span className="text-sm font-semibold text-muted-foreground">
                            Posts
                          </span>
                        </div>
                        {validationErrors.analysisPoolSize && (
                          <p className="text-xs text-red-500 mt-2">
                            {validationErrors.analysisPoolSize}
                          </p>
                        )}
                      </div>

                      {/* Analysis Days */}
                      <div className="px-4 py-3 bg-muted/20 rounded-lg border border-border/50">
                        <div className="flex justify-between items-center mb-2">
                          <label className="text-sm font-semibold text-foreground">
                            Analysis Window
                          </label>
                        </div>
                        <p className="text-xs text-muted-foreground mb-3 block">
                          How far back to look for posts to include in analysis.
                        </p>
                        <div className="flex items-center gap-3">
                          <input
                            type="number"
                            min="7"
                            max="90"
                            step="1"
                            value={localSettings?.settings?.analysisDays ?? 30}
                            onChange={(e) =>
                              handleCalcChange(
                                'analysisDays',
                                parseInt(e.target.value)
                              )
                            }
                            className="w-20 px-3 py-1.5 border border-gray-300 rounded text-sm font-semibold"
                          />
                          <span className="text-sm font-semibold text-muted-foreground">
                            Days
                          </span>
                        </div>
                      </div>

                      <Separator />

                      {/* Exclusions */}
                      <div className="space-y-3">
                        <h3 className="text-sm font-bold text-foreground mb-4 uppercase tracking-wider flex items-center gap-2">
                          <span
                            className="w-1 h-4 rounded-full"
                            style={{
                              backgroundColor: 'var(--color-secondary)',
                            }}
                          ></span>
                          Filters & Exclusions
                        </h3>

                        <div className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-lg border border-gray-100">
                          <div>
                            <span className="text-sm font-medium text-gray-800 block">
                              Ignore Official Accounts
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              Exclude moderators and admin posts.
                            </span>
                          </div>
                          <Switch
                            checked={
                              localSettings?.settings?.excludeOfficial ?? false
                            }
                            onChange={(
                              e: React.ChangeEvent<HTMLInputElement>
                            ) =>
                              handleCalcChange(
                                'excludeOfficial',
                                e.target.checked
                              )
                            }
                          />
                        </div>

                        <div className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-lg border border-gray-100">
                          <div>
                            <span className="text-sm font-medium text-gray-800 block">
                              Ignore Bots
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              Exclude known bot accounts.
                            </span>
                          </div>
                          <Switch
                            checked={
                              localSettings?.settings?.excludeBots ?? false
                            }
                            onChange={(
                              e: React.ChangeEvent<HTMLInputElement>
                            ) =>
                              handleCalcChange('excludeBots', e.target.checked)
                            }
                          />
                        </div>

                        <div className="px-4 py-3 bg-gray-50 rounded-lg border border-gray-100">
                          <div className="flex justify-between items-center mb-2">
                            <label className="text-sm font-semibold text-foreground">
                              Retention (Days)
                            </label>
                          </div>
                          <p className="text-xs text-muted-foreground mb-3 block">
                            How long to keep snapshots before automatic purge
                            (30-730, rounded to nearest 30).
                          </p>
                          <div className="flex items-center gap-3">
                            <input
                              type="number"
                              min="30"
                              max="730"
                              step="30"
                              value={
                                localSettings?.storage?.retentionDays ?? 180
                              }
                              onChange={(e) => {
                                const raw = parseInt(e.target.value, 10);
                                const clamped = Math.min(
                                  730,
                                  Math.max(30, Number.isNaN(raw) ? 180 : raw)
                                );
                                const rounded = Math.round(clamped / 30) * 30;
                                handleStorageChange('retentionDays', rounded);
                                // Clear validation error when user types
                                setValidationErrors((prev) => ({
                                  ...prev,
                                  retentionDays: '',
                                }));
                              }}
                              onBlur={() => {
                                // Validate on blur
                                const value =
                                  localSettings?.storage?.retentionDays ?? 180;
                                if (value < 30) {
                                  setValidationErrors((prev) => ({
                                    ...prev,
                                    retentionDays:
                                      'Retention must be at least 30 days',
                                  }));
                                } else if (value > 730) {
                                  setValidationErrors((prev) => ({
                                    ...prev,
                                    retentionDays:
                                      'Retention cannot exceed 730 days',
                                  }));
                                } else {
                                  setValidationErrors((prev) => ({
                                    ...prev,
                                    retentionDays: '',
                                  }));
                                }
                              }}
                              className={`w-24 px-3 py-1.5 border rounded text-sm font-semibold ${validationErrors.retentionDays ? 'border-red-500' : 'border-gray-300'}`}
                            />
                            <span className="text-sm font-semibold text-muted-foreground">
                              Days
                            </span>
                          </div>
                          {validationErrors.retentionDays && (
                            <p className="text-xs text-red-500 mt-2">
                              {validationErrors.retentionDays}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </form>
                </fieldset>
              </SectionCard>
            </Section>
          </div>

          {/* Column 3: Appearance & Reports */}
          <div className="space-y-6">
            <Section
              title="Report Visualizations"
              icon="lucide:layout-dashboard"
            >
              <SectionCard>
                <form>
                  <h3 className="text-sm font-bold text-foreground mb-4 uppercase tracking-wider flex items-center gap-2">
                    <span
                      className="w-1 h-4 rounded-full"
                      style={{ backgroundColor: 'var(--color-secondary)' }}
                    ></span>
                    Enabled Modules
                  </h3>
                  <Switch
                    label="Overview Dashboard"
                    description="High-level insights & recommendations."
                    checked={localSettings?.report?.showOverview ?? true}
                    onCheckedChange={(checked) =>
                      handleReportChange('showOverview', checked === true)
                    }
                  />
                  <Separator variant="subtle" />
                  <Switch
                    label="Timing Heatmap"
                    description="Optimal prime-time posting guides."
                    checked={localSettings?.report?.showTiming ?? true}
                    onCheckedChange={(checked) =>
                      handleReportChange('showTiming', checked === true)
                    }
                  />
                  <Separator variant="subtle" />
                  <Switch
                    label="Top Performers"
                    description="Highest scoring posts leaderboard."
                    checked={localSettings?.report?.showPosts ?? true}
                    onCheckedChange={(checked) =>
                      handleReportChange('showPosts', checked === true)
                    }
                  />
                  {(localSettings?.report?.showPosts ?? true) && (
                    <div className="pl-8 pt-2 grid grid-cols-2 gap-2 border-l-2 border-primary/20 ml-4 mt-2 mb-2">
                      <div className="flex items-center space-x-2">
                        <Switch
                          id="showTopPosts"
                          checked={localSettings?.report?.showTopPosts ?? true}
                          onCheckedChange={(c) =>
                            handleReportChange('showTopPosts', !!c)
                          }
                        />
                        <label
                          htmlFor="showTopPosts"
                          className="text-[10px] font-medium leading-none"
                        >
                          Top Score
                        </label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Switch
                          id="showMostDiscussed"
                          checked={
                            localSettings?.report?.showMostDiscussed ?? true
                          }
                          onCheckedChange={(c) =>
                            handleReportChange('showMostDiscussed', !!c)
                          }
                        />
                        <label
                          htmlFor="showMostDiscussed"
                          className="text-[10px] font-medium leading-none"
                        >
                          Discussed
                        </label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Switch
                          id="showMostEngaged"
                          checked={
                            localSettings?.report?.showMostEngaged ?? true
                          }
                          onCheckedChange={(c) =>
                            handleReportChange('showMostEngaged', !!c)
                          }
                        />
                        <label
                          htmlFor="showMostEngaged"
                          className="text-[10px] font-medium leading-none"
                        >
                          Engaged
                        </label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Switch
                          id="showRising"
                          checked={localSettings?.report?.showRising ?? true}
                          onCheckedChange={(c) =>
                            handleReportChange('showRising', !!c)
                          }
                        />
                        <label
                          htmlFor="showRising"
                          className="text-[10px] font-medium leading-none"
                        >
                          Rising
                        </label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Switch
                          id="showHot"
                          checked={localSettings?.report?.showHot ?? true}
                          onCheckedChange={(c) =>
                            handleReportChange('showHot', !!c)
                          }
                        />
                        <label
                          htmlFor="showHot"
                          className="text-[10px] font-medium leading-none"
                        >
                          Hot
                        </label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Switch
                          id="showControversial"
                          checked={
                            localSettings?.report?.showControversial ?? true
                          }
                          onCheckedChange={(c) =>
                            handleReportChange('showControversial', !!c)
                          }
                        />
                        <label
                          htmlFor="showControversial"
                          className="text-[10px] font-medium leading-none"
                        >
                          Controversial
                        </label>
                      </div>
                    </div>
                  )}
                  <Switch
                    label="Top Contributors"
                    description="Most active community members."
                    checked={localSettings?.report?.showUsers ?? true}
                    onCheckedChange={(checked) =>
                      handleReportChange('showUsers', checked === true)
                    }
                  />
                  <Separator variant="subtle" />
                  <Switch
                    label="Diagnostics"
                    description="Engagement depths & breakdown stats."
                    checked={localSettings?.report?.showContent ?? true}
                    onCheckedChange={(checked) =>
                      handleReportChange('showContent', checked === true)
                    }
                  />
                  <Separator variant="subtle" />
                  <Switch
                    label="Activity"
                    description="Activity trends & engagement vs votes."
                    checked={localSettings?.report?.showActivity ?? true}
                    onCheckedChange={(checked) =>
                      handleReportChange('showActivity', checked === true)
                    }
                  />
                  <Separator variant="subtle" />
                  <Switch
                    label="Trend: Community Growth"
                    description="Historical subscriber counts with projected totals."
                    checked={
                      localSettings?.report?.showTrendSubscribers ?? true
                    }
                    onCheckedChange={(checked) =>
                      handleReportChange(
                        'showTrendSubscribers',
                        checked === true
                      )
                    }
                  />
                  <Switch
                    label="Trend: Engagement"
                    description="Average engagement score variance."
                    checked={localSettings?.report?.showTrendEngagement ?? true}
                    onCheckedChange={(checked) =>
                      handleReportChange(
                        'showTrendEngagement',
                        checked === true
                      )
                    }
                  />
                  <Switch
                    label="Trend: Content Mix"
                    description="Flair distribution over time."
                    checked={localSettings?.report?.showTrendContent ?? true}
                    onCheckedChange={(checked) =>
                      handleReportChange('showTrendContent', checked === true)
                    }
                  />
                  <Switch
                    label="Trend: Posting Activity Heatmap"
                    description="Heatmap showing shifts in active hours."
                    checked={localSettings?.report?.showTrendPosting ?? true}
                    onCheckedChange={(checked) =>
                      handleReportChange('showTrendPosting', checked === true)
                    }
                  />
                  <Switch
                    label="Trend: Best Posting Times Trend"
                    description="Optimal times for posting and changes over time.."
                    checked={
                      localSettings?.report?.showTrendBestPostTime ?? true
                    }
                    onCheckedChange={(checked) =>
                      handleReportChange(
                        'showTrendBestPostTime',
                        checked === true
                      )
                    }
                  />
                </form>
              </SectionCard>
            </Section>

            <Section title="Appearance" icon="lucide:swatch-book">
              <SectionCard>
                <form>
                  <h3 className="text-sm font-bold text-foreground mb-4 uppercase tracking-wider flex items-center gap-2">
                    <span
                      className="w-1 h-4 rounded-full"
                      style={{ backgroundColor: 'var(--color-secondary)' }}
                    ></span>
                    Interface Theme
                  </h3>
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-semibold text-foreground block mb-1">
                        Color Palette
                      </label>
                      <p className="text-xs text-muted-foreground mb-3">
                        Select the visual color scheme for the application.
                      </p>
                      <Select
                        value={localSettings?.display?.theme ?? 'modscopeflow'}
                        onValueChange={(val) => {
                          const newTheme = val as any;
                          changeTheme(newTheme);
                          handleDisplayChange('theme', newTheme);
                        }}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select theme" />
                        </SelectTrigger>
                        <SelectContent>
                          {THEMES.map((theme) => (
                            <SelectItem key={theme.id} value={theme.id}>
                              {theme.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </form>
              </SectionCard>
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ConfigView;
