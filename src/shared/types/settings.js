export const PRESETS = [
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
export const THEMES = [
    { id: 'modscopeflow', label: 'ModScope Flow' },
    { id: 'clockwork', label: 'Clockwork' },
    { id: 'frozenmist', label: 'Frozen Mist' },
    { id: 'amber', label: 'Amber' },
    { id: 'nocturne', label: 'Nocturne' },
    { id: 'springtime', label: 'Springtime' }
];
export const DEFAULT_CALCULATION_SETTINGS = {
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
export const DEFAULT_USER_SETTINGS = {
    theme: 'modscopeflow'
};
