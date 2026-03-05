import React, { useState, useEffect } from 'react';
import { EntityTitle } from './ui/entity-title';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import { Separator } from './ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { RadioGroup, RadioItem } from './ui/radio';
import { Section, SectionCard } from './ui/section';

import { useTheme } from '../../hooks/useTheme';
import { useSettings } from '../hooks/useSettings';
import { CalculationSettings, UserSettings, AnalysisPreset, ScalingMethod, DEFAULT_CALCULATION_SETTINGS, DEFAULT_USER_SETTINGS, PRESETS, THEMES } from '../../../shared/types/settings';

interface ConfigViewProps {
    initialConfig?: any;
}

function ConfigView({ initialConfig }: ConfigViewProps) {
    const { changeTheme } = useTheme();
    const { settings, updateSettings } = useSettings();
    const [localSettings, setLocalSettings] = useState<{ settings: CalculationSettings, display: UserSettings }>(() => {
        if (initialConfig?.settings && initialConfig?.display) return initialConfig;
        return { settings: DEFAULT_CALCULATION_SETTINGS, display: DEFAULT_USER_SETTINGS };
    });
    const [loading, setLoading] = useState(false);
    const [isDirty, setIsDirty] = useState(false);

    useEffect(() => {
        if (settings) {
            // Apply defensive merging to ensure new fields are present
            setLocalSettings(_prev => {
                const merged = {
                    settings: {
                        ...DEFAULT_CALCULATION_SETTINGS,
                        ...(settings.settings || {})
                    },
                    display: {
                        ...DEFAULT_USER_SETTINGS,
                        ...(settings.display || {})
                    }
                };
                return merged;
            });
        }
    }, [settings]);

    const handleCalcChange = <K extends keyof CalculationSettings>(key: K, value: CalculationSettings[K]) => {
        setLocalSettings(prev => {
            if (prev?.settings?.[key] === value) return prev;
            const nextSettings = { ...(prev?.settings || DEFAULT_CALCULATION_SETTINGS), [key]: value };

            // Only allow non-preset changes when in custom mode
            if (key !== 'preset') {
                if (nextSettings.preset !== 'custom') return prev; // silently block
                // already custom — no preset flip needed
            }
            return { ...prev, settings: nextSettings };
        });
        setIsDirty(true);
    };


    const handleDisplayChange = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
        setLocalSettings(prev => {
            if (prev?.display?.[key] === value) return prev;
            return { ...prev, display: { ...(prev?.display || DEFAULT_USER_SETTINGS), [key]: value } };
        });
        setIsDirty(true);
    };

    const handlePresetChange = (preset: AnalysisPreset) => {
        if (preset === 'custom') {
            handleCalcChange('preset', preset);
            return;
        }

        // Apply preset defaults based on the exported PRESETS
        const presetDef = PRESETS.find(p => p.id === preset);
        const newCalcSettings: Partial<CalculationSettings> = {
            preset,
            ...(presetDef?.weights || {})
        };

        setLocalSettings(prev => ({
            ...prev,
            settings: { ...prev.settings, ...newCalcSettings }
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
        setLocalSettings({ settings: DEFAULT_CALCULATION_SETTINGS, display: DEFAULT_USER_SETTINGS });
        // Apply the default theme immediately — don't make user save and restart
        changeTheme(DEFAULT_USER_SETTINGS.theme as any ?? 'modscopeflow');
        setIsDirty(true);
    };


    const isCustom = localSettings?.settings?.preset === 'custom';

    return (
        <div className="config-view h-full flex flex-col bg-muted text-left">
            <EntityTitle
                icon="mono-set-up.png"
                title="Configuration & Rulesets"
                subtitle="Analysis settings and presets"
                className="mb-6 p-4 bg-card border-b border-border"
                actions={
                    <div className="flex gap-3">
                        <Button variant="outline" onClick={handleReset} disabled={loading} className="w-36" icon="lucide:rotate-ccw">
                            Reset Defaults
                        </Button>
                        <Button onClick={handleSave} disabled={!isDirty || loading} loading={loading} className="w-36" icon={loading ? '' : 'lucide:save'}>
                            {loading ? 'Saving...' : 'Save Changes'}
                        </Button>
                    </div>
                }
            />

            <div className="view-content flex-1 overflow-y-auto px-6 pb-6 w-full">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full max-w-none">

                    {/* Column 1: Analysis Profile (The "How") */}
                    <div className="space-y-6">
                        <Section title="Analysis Profile" icon="lucide:sliders" >
                            <SectionCard className="mb-4">
                                <form>
                                    <div className="space-y-4">
                                        <div>
                                            <label className="text-sm font-semibold text-gray-900 block mb-1">Community Preset</label>
                                            <p className="text-xs text-gray-500 mb-3">Load a pre-configured analysis strategy optimized for specific subreddit types.</p>
                                            <Select
                                                value={localSettings?.settings?.preset ?? 'discussion'}
                                                onValueChange={(val) => handlePresetChange(val as AnalysisPreset)}
                                            >
                                                <SelectTrigger className="w-full">
                                                    <SelectValue placeholder="Select a preset" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {PRESETS.map(p => (
                                                        <SelectItem key={p.id} value={p.id}>
                                                            {p.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="p-3 bg-primary/10 rounded-md border border-primary/30">
                                            <p className="text-xs text-primary-foreground font-medium" style={{ color: 'var(--color-text)' }}>
                                                <span className="font-bold">Current Mode: </span>
                                                {PRESETS.find(p => p.id === (localSettings?.settings?.preset))?.desc || 'Custom settings'}
                                            </p>
                                        </div>
                                    </div>
                                </form>
                            </SectionCard>

                            <SectionCard>
                                <fieldset disabled={!isCustom} className={`border-0 p-0 m-0 ${!isCustom ? 'opacity-60' : ''}`}>
                                    {!isCustom && (
                                        <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-4 flex items-center gap-2">
                                            <span className="font-bold">🔒</span> Controlled by preset — select <strong>Custom</strong> to edit
                                        </p>
                                    )}
                                    <form>
                                        <h3 className="text-sm font-bold text-gray-900 mb-4 uppercase tracking-wider flex items-center gap-2">
                                            <span className="w-1 h-4 rounded-full" style={{ backgroundColor: 'var(--color-secondary)' }}></span>
                                            Scoring Factors
                                        </h3>
                                        <div className="space-y-6">
                                            {/* Comment Weight */}
                                            <div className="px-6 py-4 bg-gray-50 rounded-lg border border-gray-100">
                                                <div className="flex justify-between items-center mb-2">
                                                    <label className="text-xs font-semibold text-gray-700 uppercase">Comment Weight</label>
                                                    <span className="text-xs font-bold px-2 py-1 rounded">{localSettings?.settings?.commentWeight ?? 1}x</span>
                                                </div>
                                                <input
                                                    type="range"
                                                    min="0.1" max="10" step="0.1"
                                                    value={localSettings?.settings?.commentWeight ?? 1}
                                                    onChange={(e) => handleCalcChange('commentWeight', parseFloat(e.target.value))}
                                                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600 mb-1"
                                                />
                                                <div className="flex justify-between text-[10px] text-gray-400 font-medium font-mono">
                                                    <span>Upvotes</span>
                                                    <span>Balanced</span>
                                                    <span>Comments</span>
                                                </div>
                                            </div>

                                            {/* Upvote Weight */}
                                            <div className="px-6 py-4 bg-gray-50 rounded-lg border border-gray-100">
                                                <div className="flex justify-between items-center mb-2">
                                                    <label className="text-xs font-semibold text-gray-700 uppercase">Upvote Weight</label>
                                                    <span className="text-xs font-bold px-2 py-1 rounded">{localSettings?.settings?.upvoteWeight ?? 1}x</span>
                                                </div>
                                                <input
                                                    type="range"
                                                    min="0.1" max="10" step="0.1"
                                                    value={localSettings?.settings?.upvoteWeight ?? 1}
                                                    onChange={(e) => handleCalcChange('upvoteWeight', parseFloat(e.target.value))}
                                                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600 mb-1"
                                                />
                                                <div className="flex justify-between text-[10px] text-gray-400 font-medium font-mono">
                                                    <span>Low</span>
                                                    <span>Standard</span>
                                                    <span>Impactful</span>
                                                </div>
                                            </div>

                                            {/* Velocity Configuration */}
                                            <div className="px-6 py-4 bg-gray-50 rounded-lg border border-gray-100">
                                                <div className="flex justify-between items-center mb-4">
                                                    <label className="text-xs font-semibold text-gray-700 uppercase">Velocity Impact</label>
                                                    <div className="flex gap-2">
                                                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded">{localSettings?.settings?.velocityHours ?? 24}h Window</span>
                                                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded">{localSettings?.settings?.velocityWeight ?? 1.5}x Max</span>
                                                    </div>
                                                </div>

                                                <div className="space-y-4">
                                                    <div>
                                                        <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                                                            <span>Decay Window (Hours)</span>
                                                            <span>{localSettings?.settings?.velocityHours ?? 24}h</span>
                                                        </div>
                                                        <input
                                                            type="range"
                                                            min="1" max="48" step="1"
                                                            value={localSettings?.settings?.velocityHours ?? 24}
                                                            onChange={(e) => handleCalcChange('velocityHours', parseInt(e.target.value))}
                                                            className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-400"
                                                        />
                                                    </div>
                                                    <div>
                                                        <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                                                            <span>Engagement Multiplier</span>
                                                            <span>{localSettings?.settings?.velocityWeight ?? 1.5}x</span>
                                                        </div>
                                                        <input
                                                            type="range"
                                                            min="1" max="3" step="0.1"
                                                            value={localSettings?.settings?.velocityWeight ?? 1.5}
                                                            onChange={(e) => handleCalcChange('velocityWeight', parseFloat(e.target.value))}
                                                            className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-400"
                                                        />
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Creator Bonus */}
                                            <div className="px-6 py-4 bg-gray-50 rounded-lg border border-gray-100">
                                                <div className="flex justify-between items-center mb-2">
                                                    <label className="text-xs font-semibold text-gray-700 uppercase">Creator Bonus</label>
                                                    <span className="text-xs font-bold px-2 py-1 rounded">+{localSettings?.settings?.creatorBonus ?? 5} pts</span>
                                                </div>
                                                <input
                                                    type="range"
                                                    min="0" max="10" step="1"
                                                    value={localSettings?.settings?.creatorBonus ?? 5}
                                                    onChange={(e) => handleCalcChange('creatorBonus', parseInt(e.target.value))}
                                                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600 mb-1"
                                                />
                                                <div className="flex justify-between text-[10px] text-gray-400 font-medium font-mono">
                                                    <span>None</span>
                                                    <span>Standard</span>
                                                    <span>High Impact</span>
                                                </div>
                                            </div>

                                            {/* Depth Scaling */}
                                            <div className="px-6 py-4 bg-gray-50 rounded-lg border border-gray-100">
                                                <label className="text-xs font-semibold text-gray-700 uppercase block mb-3">Engagement Decay</label>
                                                <RadioGroup
                                                    value={localSettings?.settings?.depthScaling ?? 'logarithmic'}
                                                    onChange={(val) => handleCalcChange('depthScaling', val as ScalingMethod)}
                                                    disabled={!isCustom}
                                                    className="space-y-2"
                                                >
                                                    {(['linear', 'logarithmic', 'exponential'] as ScalingMethod[]).map(method => (
                                                        <div key={method} className="space-y-3">
                                                            <RadioItem
                                                                value={method}
                                                                id={`scaling-${method}`}
                                                                label={method.charAt(0).toUpperCase() + method.slice(1)}
                                                            />
                                                            {(localSettings?.settings?.depthScaling ?? 'logarithmic') === method && (
                                                                <div className="pl-6 space-y-3 border-l-2 border-primary/20 ml-2 py-1">
                                                                    <div>
                                                                        <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                                                                            <span>Scaling Intensity</span>
                                                                            <span>{(() => {
                                                                                const val = method === 'linear' ? localSettings?.settings?.depthLinear :
                                                                                    method === 'logarithmic' ? localSettings?.settings?.depthLogarithmic :
                                                                                        localSettings?.settings?.depthExponential;
                                                                                if (val === undefined) return '0';
                                                                                if (method === 'logarithmic') return (val / 10).toFixed(1);
                                                                                return (val / 100).toFixed(2);
                                                                            })()}</span>
                                                                        </div>
                                                                        <input
                                                                            type="range"
                                                                            min="1" max={method === 'linear' ? "50" : "25"} step="1"
                                                                            value={(method === 'linear' ? localSettings?.settings?.depthLinear :
                                                                                method === 'logarithmic' ? localSettings?.settings?.depthLogarithmic :
                                                                                    localSettings?.settings?.depthExponential) ?? 0}
                                                                            onChange={(e) => handleCalcChange(
                                                                                method === 'linear' ? 'depthLinear' :
                                                                                    method === 'logarithmic' ? 'depthLogarithmic' :
                                                                                        'depthExponential',
                                                                                parseInt(e.target.value)
                                                                            )}
                                                                            className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary"
                                                                        />
                                                                    </div>
                                                                    <div>
                                                                        <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                                                                            <span>Maximum Depth Cap</span>
                                                                            <span>{localSettings?.settings?.depthMax ?? 3} Levels</span>
                                                                        </div>
                                                                        <input
                                                                            type="range"
                                                                            min="1" max="5" step="1"
                                                                            value={localSettings?.settings?.depthMax ?? 3}
                                                                            onChange={(e) => handleCalcChange('depthMax', parseInt(e.target.value))}
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
                                <form>
                                    <div className="space-y-6">
                                        {/* Fetch Depth */}
                                        <div className="px-6 py-4 bg-gray-50 rounded-lg border border-gray-100">
                                            <div className="flex justify-between items-center mb-2">
                                                <label className="text-sm font-semibold text-gray-900">Scanning Depth</label>
                                                <span className="text-xs font-bold px-2 py-1 rounded">{localSettings?.settings?.fetchDepth ?? 3} Levels</span>
                                            </div>
                                            <p className="text-xs text-gray-500 mb-3 block">Maximum depth of nested comment trees to fetch.</p>
                                            <input
                                                type="range"
                                                min="1" max="5"
                                                value={localSettings?.settings?.fetchDepth ?? 3}
                                                onChange={(e) => handleCalcChange('fetchDepth', parseInt(e.target.value))}
                                                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-orange-600"
                                            />
                                            <div className="flex justify-between text-[10px] text-gray-400 mt-1 uppercase font-medium">
                                                <span>Fast</span>
                                                <span>Deep</span>
                                            </div>
                                        </div>

                                        {/* Analysis Days */}
                                        <div className="px-6 py-4 bg-gray-50 rounded-lg border border-gray-100">
                                            <div className="flex justify-between items-center mb-2">
                                                <label className="text-sm font-semibold text-gray-900">Analysis Window</label>
                                            </div>
                                            <p className="text-xs text-gray-500 mb-3 block">How far back to look for posts to include in analysis.</p>
                                            <div className="flex items-center gap-3">
                                                <input
                                                    type="number"
                                                    min="1" max="365"
                                                    value={localSettings?.settings?.analysisDays ?? 30}
                                                    onChange={(e) => handleCalcChange('analysisDays', parseInt(e.target.value))}
                                                    className="w-20 px-3 py-1.5 border border-gray-300 rounded text-sm font-semibold"
                                                />
                                                <span className="text-sm font-semibold text-gray-700">Days</span>
                                            </div>
                                        </div>

                                        <Separator />

                                        {/* Exclusions */}
                                        <div className="space-y-3">
                                            <h3 className="text-sm font-bold text-gray-900 mb-4 uppercase tracking-wider flex items-center gap-2">
                                                <span className="w-1 h-4 rounded-full" style={{ backgroundColor: 'var(--color-secondary)' }}></span>
                                                Filters & Exclusions
                                            </h3>

                                            <div className="flex items-center justify-between px-6 py-4 bg-gray-50 rounded-lg border border-gray-100">
                                                <div>
                                                    <span className="text-xs font-medium text-gray-800 block">Ignore Official Accounts</span>
                                                    <span className="text-[10px] text-gray-500">Exclude moderators and admin posts.</span>
                                                </div>
                                                <Switch
                                                    checked={localSettings?.settings?.excludeOfficial ?? false}
                                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleCalcChange('excludeOfficial', e.target.checked)}
                                                />
                                            </div>

                                            <div className="flex items-center justify-between px-6 py-4 bg-gray-50 rounded-lg border border-gray-100">
                                                <div>
                                                    <span className="text-xs font-medium text-gray-800 block">Ignore Bots</span>
                                                    <span className="text-[10px] text-gray-500">Exclude known bot accounts.</span>
                                                </div>
                                                <Switch
                                                    checked={localSettings?.settings?.excludeBots ?? false}
                                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleCalcChange('excludeBots', e.target.checked)}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </form>
                            </SectionCard>
                        </Section>
                    </div>

                    {/* Column 3: Appearance */}
                    <div className="space-y-6">
                        <Section title="Appearance" icon="lucide:swatch-book">
                            <SectionCard>
                                <form>
                                    <h3 className="text-sm font-bold text-gray-900 mb-4 uppercase tracking-wider flex items-center gap-2">
                                        <span className="w-1 h-4 rounded-full" style={{ backgroundColor: 'var(--color-secondary)' }}></span>
                                        Interface Theme
                                    </h3>
                                    <div className="space-y-4">
                                        <div>
                                            <label className="text-sm font-semibold text-gray-900 block mb-1">Color Palette</label>
                                            <p className="text-xs text-gray-500 mb-3">Select the visual color scheme for the application.</p>
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
                                                    {THEMES.map(theme => (
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
