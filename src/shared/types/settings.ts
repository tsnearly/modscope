export type AnalysisPreset = 'discussion' | 'meme' | 'gaming' | 'support' | 'news' | 'custom';
export type ScalingMethod = 'linear' | 'logarithmic' | 'exponential';
export const FetchDepth: FetchDepthDefinition[] = [
    { value: 1, label: 'fast', limit: 1 },
    { value: 2, label: 'light', limit: 8 },
    { value: 3, label: 'balanced', limit: 16 },
    { value: 4, label: 'thorough', limit: 32 },
    { value: 5, label: 'complete', limit: 0 }
];

export interface PresetDefinition {
    id: AnalysisPreset;
    label: string;
    desc: string;
    weights?: Partial<CalculationSettings>;
    storage?: Partial<StorageSettings>;
}

export interface FetchDepthDefinition {
    value: number;
    label: string;
    limit: number;
}

export const PRESETS: PresetDefinition[] = [
    {
        id: 'discussion',
        label: 'Discussion-Heavy',
        desc: 'Comments and thread depth define success here.',
        weights: {
            commentWeight: 8,
            upvoteWeight: 1,
            depthScaling: 'logarithmic',
            depthLogarithmic: 0.35,
            depthMax: 20,
            fetchDepth: 4,
            creatorBonus: 10,
            velocityHours: 48,
            velocityWeight: 1.3,
            analysisPoolSize: 25,
            analysisDays: 30
        },
        storage: {
            snapshotFrequency: 'daily',
            retentionDays: 180
        }
    },
    {
        id: 'meme',
        label: 'Image/Meme',
        desc: 'Upvotes and early velocity are what matter.',
        weights: {
            commentWeight: 2,
            upvoteWeight: 4,
            depthScaling: 'linear',
            depthLinear: 10,
            depthMax: 5,
            fetchDepth: 2,
            creatorBonus: 2,
            velocityHours: 12,
            velocityWeight: 2.5,
            analysisPoolSize: 25,
            analysisDays: 14
        },
        storage: {
            snapshotFrequency: '12hours',
            retentionDays: 60
        }

    },
    {
        id: 'gaming',
        label: 'Gaming Community',
        desc: 'Balanced mix of visuals, discussion, and OP interaction.',
        weights: {
            commentWeight: 5,
            upvoteWeight: 2,
            depthScaling: 'logarithmic',
            depthLogarithmic: 0.30,
            depthMax: 15,
            fetchDepth: 3,
            creatorBonus: 7,
            velocityHours: 36,
            velocityWeight: 1.5,
            analysisPoolSize: 25,
            analysisDays: 30
        },
        storage: {
            snapshotFrequency: 'daily',
            retentionDays: 180
        }

    },
    {
        id: 'support',
        label: 'Support/Help',
        desc: 'Answers and OP follow-through are the real success signals.',
        weights: {
            commentWeight: 9,
            upvoteWeight: 1,
            depthScaling: 'logarithmic',
            depthLogarithmic: 0.40,
            depthMax: 20,
            fetchDepth: 5,
            creatorBonus: 15,
            velocityHours: 72,
            velocityWeight: 1.0,
            analysisPoolSize: 25,
            analysisDays: 30
        },
        storage: {
            snapshotFrequency: 'daily',
            retentionDays: 365
        }

    },
    {
        id: 'news',
        label: 'News',
        desc: 'Breaking fast — velocity and reaction volume drive relevance.',
        weights: {
            commentWeight: 4,
            upvoteWeight: 3,
            depthScaling: 'exponential',
            depthExponential: 15,
            depthMax: 10,
            fetchDepth: 3,
            creatorBonus: 3,
            velocityHours: 6,
            velocityWeight: 3.0,
            analysisPoolSize: 30,
            analysisDays: 14
        },
        storage: {
            snapshotFrequency: '12hours',
            retentionDays: 90
        }
    },
    {
        id: 'custom',
        label: 'Custom',
        desc: 'Manually configured for your specific community.'
    }
];

export interface CalculationSettings {
    id: AnalysisPreset;
    commentWeight: number;    // 1-10 by 1
    upvoteWeight: number;     // 1-10 by 1
    depthScaling: ScalingMethod;
    depthLinear: number;      // 0.1-0.5 by 0.05
    depthLogarithmic: number; // 0.1-0.5 by 0.05
    depthExponential: number; // 5-25 by 1
    depthMax: number;         // 3-50 by 1
    fetchDepth: number;       // 1-5 by 1
    creatorBonus: number;     // 0-15 by 1
    velocityHours: number;    // 3-72 by 1
    velocityWeight: number;   // 0.5-4.0 by 0.25
    analysisPoolSize: number; // 10-50 by 5
    analysisDays: number;     // 7-90 by 1
    excludeOfficial: boolean; // true, false
    excludeBots: boolean;     // true, false
    excludeUsers: string[];   // array of user ids
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

export interface StorageSettings {
    snapshotFrequency: '12hours' | 'daily' | 'weekly' | 'monthly';
    retentionDays: number; // 30-365 by 30
}

export const DEFAULT_STORAGE_SETTINGS: StorageSettings = {
    snapshotFrequency: 'daily',
    retentionDays: 180      // 30-365 by 30
};

export interface PresetSettings {
    calculation: CalculationSettings;
    storage: StorageSettings;
}

// Each parameter has a default value and a range of values that can be set by the user.
// The default value is the value that is set by the user.
// The range of values are noted by each paraameter as a comment using min-max by step.
export const DEFAULT_CALCULATION_SETTINGS: CalculationSettings = {
    id: 'discussion',
    commentWeight: 8,       // 1-10 by 1
    upvoteWeight: 1,        // 1-10 by 1
    depthScaling: 'logarithmic', // linear, logarithmic, exponential
    depthLinear: 0.35,      // 0.1-0.5 by 0.05
    depthLogarithmic: 0,    // 0.1-0.5 by 0.05
    depthExponential: 0,    // 5-25 by 1
    depthMax: 20,           // 3-50 by 1
    fetchDepth: 4,          // 1-5 by 1
    creatorBonus: 10,       // 0-15 by 1
    velocityHours: 48,      // 3-72 by 1
    velocityWeight: 1.3,    // 0.5-4.0 by 0.25
    analysisPoolSize: 25,   // 10-50 by 5
    analysisDays: 30,       // 7-90 by 1 
    excludeOfficial: false, // true, false
    excludeBots: false,     // true, false
    excludeUsers: []        // array of user ids
};

export const DEFAULT_USER_SETTINGS: UserSettings = {
    theme: 'modscopeflow'
};
