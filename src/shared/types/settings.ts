export type AnalysisPreset = 'discussion' | 'meme' | 'gaming' | 'support' | 'news' | 'custom';
export type ScalingMethod = 'linear' | 'logarithmic' | 'exponential';

export interface PresetDefinition {
    id: AnalysisPreset;
    label: string;
    desc: string;
    weights?: Partial<CalculationSettings>;
}

export const PRESETS: PresetDefinition[] = [
    {
        id: 'discussion',
        label: 'Discussion-Heavy',
        desc: 'Prioritizes comments and text depth',
        weights: { commentWeight: 7, upvoteWeight: 1, depthScaling: 'logarithmic' }
    },
    {
        id: 'meme',
        label: 'Image/Meme',
        desc: 'Prioritizes upvotes and visual velocity',
        weights: { commentWeight: 2, upvoteWeight: 3, depthScaling: 'linear' }
    },
    {
        id: 'gaming',
        label: 'Gaming',
        desc: 'Balanced mix of media and discussion',
        weights: { commentWeight: 5, upvoteWeight: 2, depthScaling: 'logarithmic' }
    },
    {
        id: 'support',
        label: 'Support/Help',
        desc: 'Focus on unanswered questions and resolution',
        weights: { commentWeight: 8, upvoteWeight: 1, depthScaling: 'linear' }
    },
    {
        id: 'news',
        label: 'News',
        desc: 'Tracks velocity and controversial chatter',
        weights: { commentWeight: 6, upvoteWeight: 2, depthScaling: 'exponential' }
    },
    {
        id: 'custom',
        label: 'Custom',
        desc: 'Manually configured settings'
    }
];

export interface CalculationSettings {
    preset: AnalysisPreset;
    commentWeight: number; // 1-10
    upvoteWeight: number; // 1-10
    depthScaling: ScalingMethod;
    depthLinear: number; // 1-5
    depthLogarithmic: number; // 1-5
    depthExponential: number; // 1-5
    depthMax: number; // 1-5
    fetchDepth: number; // 1-5
    creatorBonus: number; // 1-10
    velocityHours: number; // 1-24
    velocityWeight: number; // 1-10
    analysisPoolSize: number; // 1-10
    analysisDays: number; // 1-30
    excludeOfficial: boolean;
    excludeBots: boolean;
    excludeUsers: string[];
    retentionDays: number; // 1-30
}

export interface ConfigSettings {
    settings: CalculationSettings;
    lastUpdated: number;
}


export type ThemeId = 'modscopeflow' | 'clockwork' | 'frozenmist' | 'amber' | 'nocturne' | 'springtime';

export interface ThemeDefinition {
    id: ThemeId;
    label: string;
}

export const THEMES: ThemeDefinition[] = [
    { id: 'modscopeflow', label: 'ModScope Flow' },
    { id: 'clockwork', label: 'Clockwork' },
    { id: 'frozenmist', label: 'Frozen Mist' },
    { id: 'amber', label: 'Amber' },
    { id: 'nocturne', label: 'Nocturne' },
    { id: 'springtime', label: 'Springtime' }
];

export interface UserSettings {
    theme: ThemeId;
}

export const DEFAULT_CALCULATION_SETTINGS: CalculationSettings = {
    preset: 'discussion',
    commentWeight: 3,
    upvoteWeight: 1,
    depthScaling: 'linear',
    depthLinear: 10,
    depthLogarithmic: 3,
    depthExponential: 15,
    depthMax: 10,
    fetchDepth: 3,
    creatorBonus: 5,
    velocityHours: 48,
    velocityWeight: 1.5,
    analysisPoolSize: 25,
    analysisDays: 30,
    excludeOfficial: false,
    excludeBots: false,
    excludeUsers: [],
    retentionDays: 365
};

export const DEFAULT_USER_SETTINGS: UserSettings = {
    theme: 'modscopeflow'
};
