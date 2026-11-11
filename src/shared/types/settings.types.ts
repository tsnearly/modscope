export type AnalysisPreset =
  'discussion' | 'meme' | 'gaming' | 'support' | 'news' | 'custom';
export type ScalingMethod = 'linear' | 'logarithmic' | 'exponential';
export const FetchDepth: FetchDepthDefinition[] = [
  { value: 1, label: 'fast', limit: 1 },
  { value: 2, label: 'light', limit: 8 },
  { value: 3, label: 'balanced', limit: 16 },
  { value: 4, label: 'thorough', limit: 32 },
  { value: 5, label: 'complete', limit: 0 },
];

export interface PresetDefinition {
  id: AnalysisPreset;
  label: string;
  desc: string;
  weights?: Partial<CalculationSettings>;
  report?: Partial<ReportSettings>;
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
      analysisDays: 30,
    },
    storage: {
      snapshotFrequency: 'daily',
      retentionDays: 180,
    },
    report: {
      showOverview: true,
      showTiming: true,
      showPosts: true,
      showUsers: true,
      showContent: true,
      showActivity: true,
      showTrendSubscribers: true,
      showTrendContent: true,
      showTrendEngagement: true,
      showTrendPosting: true,
      showTrendBestPostTime: true,
      showTopPosts: true,
      showMostDiscussed: true,
      showMostEngaged: true,
      showRising: true,
      showHot: true,
      showControversial: true,
      trendAnalysisDays: 90,
    },
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
      analysisDays: 14,
    },
    storage: {
      snapshotFrequency: '12hours',
      retentionDays: 60,
    },
    report: {
      showOverview: true,
      showTiming: true,
      showPosts: true,
      showUsers: true,
      showContent: true,
      showActivity: true,
      showTrendSubscribers: true,
      showTrendContent: true,
      showTrendEngagement: true,
      showTrendPosting: true,
      showTrendBestPostTime: true,
      showTopPosts: true,
      showMostDiscussed: true,
      showMostEngaged: true,
      showRising: true,
      showHot: true,
      showControversial: true,
      trendAnalysisDays: 30,
    },
  },
  {
    id: 'gaming',
    label: 'Gaming Community',
    desc: 'Balanced mix of visuals, discussion, and OP interaction.',
    weights: {
      commentWeight: 5,
      upvoteWeight: 2,
      depthScaling: 'logarithmic',
      depthLogarithmic: 0.3,
      depthMax: 15,
      fetchDepth: 3,
      creatorBonus: 7,
      velocityHours: 36,
      velocityWeight: 1.5,
      analysisPoolSize: 25,
      analysisDays: 30,
    },
    storage: {
      snapshotFrequency: 'daily',
      retentionDays: 180,
    },
    report: {
      showOverview: true,
      showTiming: true,
      showPosts: true,
      showUsers: true,
      showContent: true,
      showActivity: true,
      showTrendSubscribers: true,
      showTrendContent: true,
      showTrendEngagement: true,
      showTrendPosting: true,
      showTrendBestPostTime: true,
      showTopPosts: true,
      showMostDiscussed: true,
      showMostEngaged: true,
      showRising: true,
      showHot: true,
      showControversial: true,
      trendAnalysisDays: 90,
    },
  },
  {
    id: 'support',
    label: 'Support/Help',
    desc: 'Answers and OP follow-through are the real success signals.',
    weights: {
      commentWeight: 9,
      upvoteWeight: 1,
      depthScaling: 'logarithmic',
      depthLogarithmic: 0.4,
      depthMax: 20,
      fetchDepth: 5,
      creatorBonus: 15,
      velocityHours: 72,
      velocityWeight: 1.0,
      analysisPoolSize: 25,
      analysisDays: 30,
    },
    storage: {
      snapshotFrequency: 'daily',
      retentionDays: 365,
    },
    report: {
      showOverview: true,
      showTiming: true,
      showPosts: true,
      showUsers: true,
      showContent: true,
      showActivity: true,
      showTrendSubscribers: true,
      showTrendContent: true,
      showTrendEngagement: true,
      showTrendPosting: true,
      showTrendBestPostTime: true,
      showTopPosts: true,
      showMostDiscussed: true,
      showMostEngaged: true,
      showRising: true,
      showHot: true,
      showControversial: true,
      trendAnalysisDays: 180,
    },
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
      analysisDays: 14,
    },
    storage: {
      snapshotFrequency: '12hours',
      retentionDays: 90,
    },
    report: {
      showOverview: true,
      showTiming: true,
      showPosts: true,
      showUsers: true,
      showContent: true,
      showActivity: true,
      showTrendSubscribers: true,
      showTrendContent: true,
      showTrendEngagement: true,
      showTrendPosting: true,
      showTrendBestPostTime: true,
      showTopPosts: true,
      showMostDiscussed: true,
      showMostEngaged: true,
      showRising: true,
      showHot: true,
      showControversial: true,
      trendAnalysisDays: 30,
    },
  },
  {
    id: 'custom',
    label: 'Custom',
    desc: 'Manually configured for your specific community.',
  },
];

export interface CalculationSettings {
  id: AnalysisPreset;
  commentWeight: number; // 1-10 by 1
  upvoteWeight: number; // 1-10 by 1
  depthScaling: ScalingMethod;
  depthLinear: number; // 0.1-0.5 by 0.05
  depthLogarithmic: number; // 0.1-0.5 by 0.05
  depthExponential: number; // 5-25 by 1
  depthMax: number; // 3-50 by 1
  fetchDepth: number; // 1-5 by 1
  creatorBonus: number; // 0-15 by 1
  velocityHours: number; // 3-72 by 1
  velocityWeight: number; // 0.5-4.0 by 0.25
  analysisPoolSize: number; // 10-50 by 5
  analysisDays: number; // 7-90 by 1
  excludeOfficial: boolean; // true, false
  excludeBots: boolean; // true, false
  excludeUsers: string[]; // array of user ids
}

export interface MetricSettings {
  scheduleType: 'daily' | 'weekly' | 'monthly';
  hour: number;
  minute: number;
  dayOfWeek?: number;
  dayOfMonth?: number;
  showMemberGrowth: boolean;
  showTopContributors: boolean;
  showTopPosts: boolean;
}

export const DEFAULT_METRIC_SETTINGS: MetricSettings = {
  scheduleType: 'weekly',
  hour: 10,
  minute: 0,
  dayOfWeek: 1, // Monday
  showMemberGrowth: true,
  showTopContributors: true,
  showTopPosts: true,
};

export interface ConfigSettings {
  settings: CalculationSettings;
  report?: ReportSettings;
  storage?: StorageSettings;
  metric?: MetricSettings;
  lastUpdated: number;
}

export type ThemeId =
  | 'modscopeflow'
  | 'clockwork'
  | 'frozenmist'
  | 'amber'
  | 'nocturne'
  | 'springtime'
  | 'rosemeadow'
  | 'upvoted';

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
  { id: 'springtime', label: 'Springtime' },
  { id: 'rosemeadow', label: 'Rose Meadow' },
  { id: 'upvoted', label: 'Upvoted' },
];

export interface DictionarySettings {
  stopwords: string[];
  additionalWords: string[];
}

export interface UserSettings {
  theme: ThemeId;
  snapshotColumnWidths?: Record<string, number>;
  jobHistoryColumnWidths?: Record<string, number>;
}

export interface StorageSettings {
  snapshotFrequency: '12hours' | 'daily' | 'weekly' | 'monthly';
  retentionDays: number; // 30-365 by 30
}

export const DEFAULT_STORAGE_SETTINGS: StorageSettings = {
  snapshotFrequency: 'daily',
  retentionDays: 180, // 30-365 by 30
};

export interface ReportingSchedule {
  id: string;
  name: string;
  scheduleType: 'daily' | 'weekly' | 'monthly' | 'yearly';
  recipients: string;
  enabled: boolean;
  hour: number;
  minute: number;
  dayOfWeek?: number | number[] | undefined; // 0-6 (Sun-Sat)
  dayOfMonth?: number | undefined; // 1-31
  monthOfYear?: number | undefined; // 1-12
}

export interface ReportSettings {
  showOverview: boolean;
  showTiming: boolean;
  showPosts: boolean;
  showUsers: boolean;
  showContent: boolean;
  showActivity: boolean;
  showTrendSubscribers: boolean;
  showTrendContent: boolean;
  showTrendEngagement: boolean;
  showTrendPosting: boolean;
  showTrendBestPostTime: boolean;
  showTopPosts: boolean;
  showMostDiscussed: boolean;
  showMostEngaged: boolean;
  showRising: boolean;
  showHot: boolean;
  showControversial: boolean;
  trendAnalysisDays: number;
  reportingSchedules: ReportingSchedule[];
}

export const DEFAULT_REPORT_SETTINGS: ReportSettings = {
  showOverview: true,
  showTiming: true,
  showPosts: true,
  showUsers: true,
  showContent: true,
  showActivity: true,
  showTrendSubscribers: true,
  showTrendContent: true,
  showTrendEngagement: true,
  showTrendPosting: true,
  showTrendBestPostTime: true,
  showTopPosts: true,
  showMostDiscussed: true,
  showMostEngaged: true,
  showRising: true,
  showHot: true,
  showControversial: true,
  trendAnalysisDays: 90,
  reportingSchedules: [],
};

export interface PresetSettings {
  calculation: CalculationSettings;
  storage: StorageSettings;
  report: ReportSettings;
}

// Each parameter has a default value and a range of values that can be set by the user.
// The default value is the value that is set by the user.
// The range of values are noted by each paraameter as a comment using min-max by step.
export const DEFAULT_CALCULATION_SETTINGS: CalculationSettings = {
  id: 'discussion',
  commentWeight: 8, // 1-10 by 1
  upvoteWeight: 1, // 1-10 by 1
  depthScaling: 'logarithmic', // linear, logarithmic, exponential
  depthLinear: 0.35, // 0.1-0.5 by 0.05
  depthLogarithmic: 0, // 0.1-0.5 by 0.05
  depthExponential: 0, // 5-25 by 1
  depthMax: 20, // 3-50 by 1
  fetchDepth: 4, // 1-5 by 1
  creatorBonus: 10, // 0-15 by 1
  velocityHours: 48, // 3-72 by 1
  velocityWeight: 1.3, // 0.5-4.0 by 0.25
  analysisPoolSize: 25, // 10-50 by 5
  analysisDays: 30, // 7-90 by 1
  excludeOfficial: false, // true, false
  excludeBots: false, // true, false
  excludeUsers: [], // array of user ids
};

export const DEFAULT_USER_SETTINGS: UserSettings = {
  theme: 'modscopeflow',
};

export const DEFAULT_DICTIONARY_SETTINGS: DictionarySettings = {
  stopwords: [
    "'ll","'tis","'twas","'ve","10","39","a","a's","able","ableabout","about","above","abroad","abst","accordance",
    "according","accordingly","across","act","actually","ad","added","adj","adopted","ae","af","affected",
    "affecting","affects","after","afterwards","ag","again","against","ago","ah","ahead","ai","ain't","aint","al",
    "all","allow","allows","almost","alone","along","alongside","already","also","although","always","am","amid",
    "amidst","among","amongst","amoungst","amount","an","and","announce","another","any","anybody","anyhow","anymore",
    "anyone","anything","anyway","anyways","anywhere","ao","apart","apparently","appear","appreciate","appropriate",
    "approximately","aq","ar","are","area","areas","aren","aren't","arent","arise","around","arpa","as","aside","ask",
    "asked","asking","asks","associated","at","au","auth","available","aw","away","awfully","az","b","ba","back",
    "backed","backing","backs","backward","backwards","bb","bd","be","became","because","become","becomes","becoming",
    "been","before","beforehand","began","begin","beginning","beginnings","begins","behind","being","beings",
    "believe","below","beside","besides","best","better","between","beyond","bf","bg","bh","bi","big","bill",
    "billion","biol","bj","bm","bn","bo","both","bottom","br","brief","briefly","bs","bt","but","buy","bv","bw",
    "by","bz","c","c'mon","c's","ca","call","came","can","can't","cannot","cant","caption","case","cases","cause",
    "causes","cc","cd","certain","certainly","cf","cg","ch","changes","ci","ck","cl","clear","clearly","click","cm",
    "cmon","cn","co","co.","com","come","comes","computer","con","concerning","consequently","consider","considering",
    "contain","containing","contains","copy","corresponding","could","could've","couldn","couldn't","couldnt","course",
    "cr","cry","cs","cu","currently","cv","cx","cy","cz","d","dare","daren't","darent","date","de","dear",
    "definitely","describe","described","despite","detail","did","didn","didn't","didnt","differ","different",
    "differently","directly","dj","dk","dm","do","does","doesn","doesn't","doesnt","doing","don","don't","done",
    "dont","doubtful","down","downed","downing","downs","downwards","due","during","dz","e","each","early","ec",
    "ed","edu","ee","effect","eg","eh","eight","eighty","either","eleven","else","elsewhere","empty","end","ended",
    "ending","ends","enough","entirely","er","es","especially","et","et-al","etc","even","evenly","ever","evermore",
    "every","everybody","everyone","everything","everywhere","ex","exactly","example","except","f","face",
    "faces","fact","facts","fairly","far","farther","felt","few","fewer","ff","fi","fifteen","fifth","fifty",
    "fify","fill","find","finds","fire","first","five","fix","fj","fk","fm","fo","followed","following","follows",
    "for","forever","former","formerly","forth","forty","forward","found","four","fr","free","from","front",
    "full","fully","further","furthered","furthering","furthermore","furthers","fx","g","ga","gave","gb","gd",
    "ge","general","generally","get","gets","getting","gf","gg","gh","gi","give","given","gives","giving","gl",
    "gm","gmt","gn","go","goes","going","gone","good","goods","got","gotten","gov","gp","gq","gr","great",
    "greater","greatest","greetings","group","grouped","grouping","groups","gs","gt","gu","gw","gy","h","had",
    "hadn't","hadnt","half","happens","hardly","has","hasn","hasn't","hasnt","have","haven","haven't","havent",
    "having","he","he'd","he'll","he's","hed","hell","hello","help","hence","her","here","here's","hereafter",
    "hereby","herein","heres","hereupon","hers","herself","herse”","hes","hi","hid","high","higher","highest",
    "him","himself","himse”","his","hither","hk","hm","hn","home","homepage","hopefully","how","how'd",
    "how'll","how's","howbeit","however","hr","ht","htm","html","http","hu","hundred","i","i'd","i'll","i'm",
    "i've","i.e.","id","ie","if","ignored","ii","il","ill","im","immediate","immediately","importance",
    "important","in","inasmuch","inc","inc.","indeed","index","indicate","indicated","indicates","information",
    "inner","inside","insofar","instead","int","interest","interested","interesting","interests","into",
    "invention","inward","io","iq","ir","is","isn","isn't","isnt","it","it'd","it'll","it's","itd","itll",
    "its","itself","itse”","ive","j","je","jm","jo","join","jp","just","k","ke","keep","keeps","kept","keys",
    "kg","kh","ki","kind","km","kn","knew","know","known","knows","kp","kr","kw","ky","kz","l","la","large",
    "largely","last","lately","later","latest","latter","latterly","lb","lc","least","length","less","lest",
    "let","let's","lets","li","like","liked","likely","likewise","line","little","lk","ll","long","longer",
    "longest","look","looking","looks","low","lower","lr","ls","lt","ltd","lu","lv","ly","m","ma","made",
    "mainly","make","makes","making","man","many","may","maybe","mayn't","maynt","mc","md","me","mean",
    "means","meantime","meanwhile","member","members","men","merely","mg","mh","microsoft","might",
    "might've","mightn't","mightnt","mil","mill","million","mine","minus","miss","mk","ml","mm","mn","mo",
    "more","moreover","most","mostly","move","mp","mq","mr","mrs","ms","msie","mt","mu","much","mug","must",
    "must've","mustn't","mustnt","mv","mw","mx","my","myself","myse”","mz","n","na","name","namely","nay",
    "nc","nd","ne","near","nearly","necessarily","necessary","need","needed","needing","needn't","neednt",
    "needs","neither","net","netscape","never","neverf","neverless","nevertheless","new","newer","newest",
    "next","nf","ng","ni","nine","ninety","nl","no","no-one","nobody","non","none","nonetheless",
    "noone","nor","normally","nos","not","noted","nothing","notwithstanding","novel","now","nowhere",
    "np","nr","nu","null","number","numbers","nz","o","obtain","obtained","obviously","of","off","often",
    "oh","ok","okay","old","older","oldest","om","omitted","on","once","one","one's","ones","only","onto",
    "open","opened","opening","opens","opposite","or","ord","order","ordered","ordering","orders","org",
    "other","others","otherwise","ought","oughtn't","oughtnt","our","ours","ourselves","out","outside",
    "over","overall","owing","own","p","pa","page","pages","part","parted","particular","particularly",
    "parting","parts","past","pe","per","perhaps","pf","pg","ph","pk","pl","place","placed","places",
    "please","plus","pm","pmid","pn","point","pointed","pointing","points","poorly","possible","possibly",
    "potentially","pp","pr","predominantly","present","presented","presenting","presents","presumably",
    "previously","primarily","probably","problem","problems","promptly","proud","provided","provides","pt",
    "put","puts","pw","py","q","qa","que","quickly","quite","qv","r","ran","rather","rd","re","readily",
    "really","reasonably","recent","recently","ref","refs","regarding","regardless","regards","related",
    "relatively","research","reserved","respectively","resulted","resulting","results","right","ring","ro",
    "room","rooms","round","ru","run","rw","s","sa","said","same","saw","say","saying","says","sb","sc",
    "sd","se","sec","second","secondly","seconds","section","see","seeing","seem","seemed","seeming",
    "seems","seen","sees","self","selves","sensible","sent","serious","seriously","seven","seventy",
    "several","sg","sh","shall","shan't","shant","she","she'd","she'll","she's","shed","shell","shes",
    "should","should've","shouldn","shouldn't","shouldnt","show","showed","showing","shown","showns",
    "shows","si","side","sides","significant","significantly","similar","similarly","since","sincere",
    "site","six","sixty","sj","sk","sl","slightly","sm","small","smaller","smallest","sn","so","some",
    "somebody","someday","somehow","someone","somethan","something","sometime","sometimes","somewhat",
    "somewhere","soon","sorry","specifically","specified","specify","specifying","sr","st","state",
    "states","still","stop","strongly","su","sub","substantially","successfully","such","sufficiently",
    "suggest","sup","sure","sv","sy","system","sz","t","t's","take","taken","taking","tc","td","tell",
    "ten","tends","test","text","tf","tg","th","than","thank","thanks","thanx","that","that'll","that's",
    "that've","thatll","thats","thatve","the","their","theirs","them","themselves","then","thence","there",
    "there'd","there'll","there're","there's","there've","thereafter","thereby","thered","therefore",
    "therein","therell","thereof","therere","theres","thereto","thereupon","thereve","these","they","they'd",
    "they'll","they're","they've","theyd","theyll","theyre","theyve","thick","thin","thing","things","think",
    "thinks","third","thirty","this","thorough","thoroughly","those","thou","though","thoughh","thought",
    "thoughts","thousand","three","throug","through","throughout","thru","thus","til","till","tip",
    "tis","tj","tk","tm","tn","to","today","together","too","took","top","toward","towards","tp","tr",
    "tried","tries","trillion","truly","try","trying","ts","tt","turn","turned","turning","turns","tv",
    "tw","twas","twelve","twenty","twice","two","tz","u","ua","ug","uk","um","un","under","underneath",
    "undoing","unfortunately","unless","unlike","unlikely","until","unto","up","upon","ups","upwards",
    "us","use","used","useful","usefully","usefulness","uses","using","usually","uucp","uy","uz","v",
    "va","value","various","vc","ve","versus","very","vg","vi","via","viz","vn","vol","vols","vs","vu",
    "w","want","wanted","wanting","wants","was","wasn","wasn't","wasnt","way","ways","we","we'd","we'll",
    "we're","we've","web","webpage","website","wed","welcome","well","wells","went","were","weren",
    "weren't","werent","weve","wf","what","what'd","what'll","what's","what've","whatever","whatll",
    "whats","whatve","when","when'd","when'll","when's","whence","whenever","where","where'd","where'll",
    "where's","whereafter","whereas","whereby","wherein","wheres","whereupon","wherever","whether",
    "which","whichever","while","whilst","whim","whither","who","who'd","who'll","who's","whod","whoever",
    "whole","wholl","whom","whomever","whos","whose","why","why'd","why'll","why's","widely","width",
    "will","willing","wish","with","within","without","won","won't","wonder","wont","words","work","worked",
    "working","works","world","would","would've","wouldn","wouldn't","wouldnt","ws","www","x","y","ye",
    "year","years","yes","yet","you","you'd","you'll","you're","you've","youd","youll","young","younger",
    "youngest","your","youre","yours","yourself","yourselves","youve","yt","yu","z","za","zero","zm","zr"
  ],
  additionalWords: [
    'quiz',       'trivia',    'knowledge', 'games',
    'game',       'questions', 'question',  'answers',
    'answer',     'challenge', 'score',     'random',
    'discussion', 'opinion',   'easy',      'medium',
    'harder',     'easier',    'hardest',   'easiest',
    'hard',       'advanced',  'beginner',  'levels',
    'level',      'short',     'tiny',      'modern',
    'classic',    'forgotten', 'popular',   'famous',
    'edition',    'version',   'series',    'episode',
    'fun',        'enjoy',     'guess',     'day',
    'todays',     'play',      'start',     'quick',
    'basic',      'lowest',    'weird',     'odd',
    'pointless',  'gooo',      'dropped',   'lol',
    'https',      'http',      'www',       'com',
    'srs',        'ama',       'iama'
  ]
};
