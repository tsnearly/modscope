"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var context = {};
Object.defineProperty(globalThis, 'DATA_SUBREDDIT', {
    get: function () {
        return context.subredditName || 'QuizPlanetGame';
    }
});
console.log(DATA_SUBREDDIT);
