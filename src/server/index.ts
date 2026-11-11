import 'dotenv/config';
import {
  context,
  createServer,
  Context as DevvitContext,
  getServerPort,
  redis,
  runWithContext,
} from '@devvit/web/server';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from './core/logger';
import { api } from './routes/api';
import { forms } from './routes/forms';
import { menu } from './routes/menu';
import { metric } from './routes/metric';
import { metricpost } from './routes/metricpost';
import { triggers } from './routes/triggers';
import {
  getUpgradeAccessState,
  readPatchLog,
} from './services/SchemaUpgradeService';

/**
 * Global DATA_SUBREDDIT getter to maintain behavior across all files
 * without top-level await.
 */
if (!Object.prototype.hasOwnProperty.call(globalThis, 'DATA_SUBREDDIT')) {
  Object.defineProperty(globalThis, 'DATA_SUBREDDIT', {
    get() {
      const name = context.subredditName;
      if (!name) {
        throw new Error(
          '[DATA_SUBREDDIT] Subreddit name unavailable in current context'
        );
      }
      return name;
    },
    configurable: true,
  });
}

const app = new Hono();
const internal = new Hono();

// Single, top-level context-restoration middleware. Every route mounted
// under this app — including everything in api.ts — runs inside this
// runWithContext call. Do NOT duplicate this inside api.ts; a second,
// independent runWithContext wrapper around the same request added no real
// protection and made it harder to reason about which layer actually owns
// context for a given route.
app.use('*', async (c, next) => {
  const incoming = (c.env as any)?.incoming;
  if (
    incoming &&
    (c.req.method === 'POST' ||
      c.req.method === 'PUT' ||
      c.req.method === 'DELETE' ||
      c.req.method === 'PATCH')
  ) {
    const rawText = await new Promise<string>((resolve) => {
      let body = '';
      incoming.on('data', (chunk: any) => {
        body += chunk.toString();
      });
      incoming.on('end', () => {
        resolve(body);
      });
      incoming.on('error', () => {
        resolve('');
      });
    });
    (c.req as any).bodyCache.text = Promise.resolve(rawText);
  }

  const headers = incoming?.headers || c.req.header();
  const devvitContext = DevvitContext(headers);
  return await runWithContext(devvitContext, async () => {
    const requestPath = c.req.path;
    if (requestPath === '/api/upgrade/status') {
      return await next();
    }

    // Session identity used to decide who "owns" an in-progress upgrade.
    // Must match whatever App.tsx sends as x-modscope-session-id, and
    // whatever value was stored as `ownerId` when the lock was acquired —
    // confirm both sides use the same source of truth for this identifier.
    const sessionId =
      c.req.header('x-modscope-session-id') ??
      c.req.header('x-devvit-user') ??
      null;
    const access = await getUpgradeAccessState(redis, sessionId);
    if (access.blocked && access.lock) {
      // Exempt: metric post rendering routes (must work for community members during upgrades)
      const EXEMPT_PREFIXES = [
        '/api/metricpost/is-metric-post',
        '/api/metricpost/snapshot',
        '/api/metricpost/config',
        '/api/metricpost/notify',
      ];
      if (!EXEMPT_PREFIXES.some((prefix) => requestPath.startsWith(prefix))) {
        const patchLog = access.lock.patchId
          ? await readPatchLog(redis, access.lock.patchId)
          : null;
        // 423 Locked — deliberately distinct from 401/403 so the client can
        // tell "blocked by an in-progress upgrade" apart from "not a
        // moderator" and route to the correct screen instead of the wrong one.
        return c.json(
          {
            blocked: true,
            readOnly: true,
            status: 'upgrade_running',
            lock: access.lock,
            patchLog,
            message: 'ModScope is upgrading its data storage — please wait.',
          },
          423
        );
      }
    }

    return await next();
  });
});

// Mount modular routers containing your original preserved logic
internal.route('/menu', menu);
internal.route('/form', forms);
internal.route('/triggers', triggers);

app.route('/api', api);
app.route('/api/metric', metric);
app.route('/api/metricpost', metricpost);
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

//console.log(
//  `[SERVER] ModScope routing layer successfully refactored to modular Hono/Node Server pattern on port ${port}.`
//);

logger.info(
  `ModScope routing layer successfully refactored to modular Hono/Node Server pattern on port ${port}.`,
  'Server'
);

// Export the app as the default export for the new Devvit server layer architecture.
export default app;
