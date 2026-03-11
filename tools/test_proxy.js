const { AsyncLocalStorage } = require('async_hooks');
const als = new AsyncLocalStorage();
const context = new Proxy({}, {
    get(target, prop) {
        const store = als.getStore();
        if (!store) throw new Error("No context found");
        return store[prop];
    }
});

Object.defineProperty(globalThis, 'DATA_SUBREDDIT', {
    get: function() {
        try {
            return context.subredditName || 'QuizPlanetGame';
        } catch (e) {
            return 'QuizPlanetGame';
        }
    }
});

console.log("Global access (no context):", DATA_SUBREDDIT);

als.run({ subredditName: 'MyRealSub' }, () => {
    console.log("Scoped access:", DATA_SUBREDDIT);
});
