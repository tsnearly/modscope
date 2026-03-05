import { Devvit } from "@devvit/public-api";
const context: any = {};
Object.defineProperty(globalThis, 'DATA_SUBREDDIT', {
    get: function() {
        return context.subredditName || 'QuizPlanetGame';
    }
});
declare var DATA_SUBREDDIT: string;
console.log(DATA_SUBREDDIT);
