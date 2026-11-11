// logger.ts
import 'dotenv/config';
import { getIsoTimestamp } from '../../shared/utils/dateUtils';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

const timers: Map<string, number[]> = new Map();

function formatValue(value: unknown, indent: number): string {
  const pad = ' '.repeat(indent);
  const innerPad = ' '.repeat(indent + 2);

  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value
      .map((v, i) => `${innerPad}[${i}] ${formatValue(v, indent + 2)}`)
      .join('\n');
    return `[\n${items}\n${pad}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    const lines = entries
      .map(([k, v]) => `${innerPad}${k}: ${formatValue(v, indent + 2)}`)
      .join('\n');
    return `{\n${lines}\n${pad}}`;
  }

  if (typeof value === 'string') return `"${value}"`;
  return String(value);
}

let dumpRedisOverride: boolean | undefined = undefined;
let dumpRedisDeepOverride: boolean | undefined = undefined;
let debugOverride: boolean | undefined = undefined;

function getEnv(key: string): string | undefined {
  try {
    const g = globalThis as any;
    if (g.reddit?.process?.env?.[key] !== undefined) {
      return g.reddit.process.env[key];
    }
  } catch {
    // ignore
  }
  if (typeof process !== 'undefined' && process?.env) {
    return process.env[key];
  }
  return undefined;
}

function isDumpRedisEnabled(): boolean {
  if (dumpRedisOverride !== undefined) {
    return dumpRedisOverride;
  }
  return getEnv('MODSCOPE_DUMP_REDIS') === 'true';
}

function isDumpRedisDeep(): boolean {
  if (dumpRedisDeepOverride !== undefined) {
    return dumpRedisDeepOverride;
  }
  return getEnv('MODSCOPE_DUMP_REDIS_DEEP') === 'true';
}

function isDebugEnabled(): boolean {
  if (debugOverride !== undefined) {
    return debugOverride;
  }
  return getEnv('MODSCOPE_DEBUG') === 'true';
}

function formatRedisValue(
  value: unknown,
  indent: number = 0,
  isDeep: boolean = isDumpRedisDeep()
): string {
  const pad = ' '.repeat(indent);
  const innerPad = ' '.repeat(indent + 2);

  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const limit = isDeep ? value.length : 3;
    const slice = value.slice(0, limit);
    const items = slice
      .map(
        (v, i) => `${innerPad}[${i}] ${formatRedisValue(v, indent + 2, isDeep)}`
      )
      .join('\n');
    const extra =
      value.length > limit ? `\n${innerPad}... (${value.length} total)` : '';
    return `[\n${items}${extra}\n${pad}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';

    if (!isDeep && indent > 0) {
      const keys = entries.map(([k]) => k).join(', ');
      return `{ ${keys} }`;
    }

    if (!isDeep && indent === 0) {
      const lines = entries
        .map(([k, v]) => {
          if (v && typeof v === 'object') {
            if (Array.isArray(v)) {
              return `${innerPad}${k}: Array(${v.length})`;
            }
            const subKeys = Object.keys(v as object).join(', ');
            return `${innerPad}${k}: { ${subKeys} }`;
          }
          return `${innerPad}${k}: ${formatRedisValue(v, indent + 2, isDeep)}`;
        })
        .join('\n');
      return `{\n${lines}\n${pad}}`;
    }

    const lines = entries
      .map(
        ([k, v]) =>
          `${innerPad}${k}: ${formatRedisValue(v, indent + 2, isDeep)}`
      )
      .join('\n');
    return `{\n${lines}\n${pad}}`;
  }

  if (typeof value === 'string') return `"${value}"`;
  return String(value);
}

function prefix(level: LogLevel, context?: string): string {
  const tag = context ? `[${context}]` : '';
  return `[${getIsoTimestamp()}] [${level.toUpperCase()}]${tag}`;
}

export const logger = {
  setDumpRedis(enabled: boolean, deep?: boolean): void {
    dumpRedisOverride = enabled;
    if (deep !== undefined) {
      dumpRedisDeepOverride = deep;
    }
  },

  setDebug(enabled: boolean): void {
    debugOverride = enabled;
  },

  resetConfig(): void {
    dumpRedisOverride = undefined;
    dumpRedisDeepOverride = undefined;
    debugOverride = undefined;
  },

  info(message: string, context?: string): void {
    console.log(`${prefix('info', context)} ${message}`);
  },

  warn(message: string, context?: string): void {
    console.warn(`${prefix('warn', context)} ${message}`);
  },

  error(message: string, error?: unknown, context?: string): void {
    console.error(`${prefix('error', context)} ${message}`);
    if (error instanceof Error) {
      console.error(`  → ${error.message}`);
      if (error.stack) console.error(`  → ${error.stack}`);
    } else if (error !== undefined) {
      console.error(`  → ${formatValue(error, 2)}`);
    }
  },

  debug(message: string, context?: string): void {
    if (!isDebugEnabled()) return;
    console.log(`${prefix('debug', context)} ${message}`);
  },

  // Dump any object or collection of objects read from Redis
  dump(label: string, value: unknown, context?: string): void {
    if (!isDebugEnabled()) return;
    console.log(`${prefix('debug', context)} ${label}:`);
    console.log(formatValue(value, 0));
  },

  // Dump raw Redis ingestion — pass the full object as read from Redis
  dumpRedis(key: string, value: unknown): void {
    if (!isDumpRedisEnabled()) return;
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`[REDIS READ] key: ${key}`);
    console.log(formatRedisValue(value, 0, isDumpRedisDeep()));
    console.log('─'.repeat(60));
  },

  // Timer — start
  timerStart(label: string): void {
    const stack = timers.get(label) || [];
    stack.push(Date.now());
    timers.set(label, stack);
    console.log(`${prefix('debug')} ⏱  START: ${label}`);
  },

  // Timer — end, logs elapsed and returns ms
  timerEnd(label: string): number {
    const stack = timers.get(label);
    const startMs = stack?.pop();
    if (startMs === undefined) {
      console.warn(
        `${prefix('warn')} timerEnd called for unknown label: ${label}`
      );
      return 0;
    }
    if (stack && stack.length === 0) {
      timers.delete(label);
    }
    const elapsed = Date.now() - startMs;
    console.log(`${prefix('debug')} ⏱  END:   ${label} — ${elapsed}ms`);
    return elapsed;
  },

  // Wrap an async block with automatic timing
  async timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const startMs = Date.now();
    console.log(`${prefix('debug')} ⏱  START: ${label}`);
    try {
      const result = await fn();
      const elapsed = Date.now() - startMs;
      console.log(`${prefix('debug')} ⏱  END:   ${label} — ${elapsed}ms`);
      return result;
    } catch (err) {
      const elapsed = Date.now() - startMs;
      console.log(`${prefix('debug')} ⏱  END:   ${label} — ${elapsed}ms`);
      logger.error(`Exception during timed block: ${label}`, err, 'Timer');
      throw err;
    }
  },
};
