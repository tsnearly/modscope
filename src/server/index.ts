import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createServer, getServerPort, context } from '@devvit/web/server';
import { api } from './routes/api';
import { forms } from './routes/forms';
import { menu } from './routes/menu';
import { triggers } from './routes/triggers';

/**
 * Global DATA_SUBREDDIT getter to maintain behavior across all files
 * without top-level await.
 */
if (!Object.prototype.hasOwnProperty.call(globalThis, 'DATA_SUBREDDIT')) {
  Object.defineProperty(globalThis, 'DATA_SUBREDDIT', {
    get() {
      const name = context.subredditName;
      if (!name) {
        throw new Error('[DATA_SUBREDDIT] Subreddit name unavailable in current context');
      }
      return name;
    },
    configurable: true,
  });
}

const app = new Hono();
const internal = new Hono();

// Mount modular routers containing your original preserved logic
internal.route('/menu', menu);
internal.route('/form', forms);
internal.route('/triggers', triggers);

app.route('/api', api);
app.route('/internal', internal);

/**
 * Start the Node Server using Reddit's new server layer pattern
 */
const port = getServerPort();
serve({
  fetch: app.fetch,
  createServer,
  port: port,
});

console.log(`[SERVER] ModScope routing layer successfully refactored to modular Hono/Node Server pattern on port ${port}.`);

// Export the app as the default export for the new Devvit server layer architecture.
export default app;
