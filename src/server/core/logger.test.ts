import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from './logger';

describe('logger dumpRedis and debug configuration', () => {
  const originalEnv = process.env;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env = { ...originalEnv };
    logger.resetConfig();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    logger.resetConfig();
    logSpy.mockRestore();
  });

  it('does not produce dumpRedis output when MODSCOPE_DUMP_REDIS is not true', () => {
    process.env.MODSCOPE_DUMP_REDIS = 'false';
    process.env.MODSCOPE_DEBUG = 'true';

    logger.dumpRedis('test-key', { a: 1 });
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('produces dumpRedis output when MODSCOPE_DUMP_REDIS is true regardless of MODSCOPE_DEBUG', () => {
    process.env.MODSCOPE_DUMP_REDIS = 'true';
    process.env.MODSCOPE_DEBUG = 'false';

    logger.dumpRedis('test-key', { foo: 'bar' });
    expect(logSpy).toHaveBeenCalled();
  });

  it('truncates arrays to first 3 entries and appends total count when > 3 items in shallow mode', () => {
    process.env.MODSCOPE_DUMP_REDIS = 'true';
    process.env.MODSCOPE_DUMP_REDIS_DEEP = 'false';

    logger.dumpRedis('array-key', [1, 2, 3, 4, 5]);

    const outputLines = logSpy.mock.calls.map((c: any) => c[0]).join('\n');
    expect(outputLines).toContain('[0] 1');
    expect(outputLines).toContain('[1] 2');
    expect(outputLines).toContain('[2] 3');
    expect(outputLines).not.toContain('[3] 4');
    expect(outputLines).toContain('... (5 total)');
  });

  it('limits objects to top-level keys when MODSCOPE_DUMP_REDIS_DEEP is false', () => {
    process.env.MODSCOPE_DUMP_REDIS = 'true';
    process.env.MODSCOPE_DUMP_REDIS_DEEP = 'false';

    logger.dumpRedis('obj-key', {
      title: 'Hello',
      author: 'World',
      details: { a: 1, b: 2 },
    });
    const shallowOutput = logSpy.mock.calls.map((c: any) => c[0]).join('\n');

    expect(shallowOutput).toContain('title: "Hello"');
    expect(shallowOutput).toContain('author: "World"');
    expect(shallowOutput).toContain('details: { a, b }');
    expect(shallowOutput).not.toContain('a: 1');
    expect(shallowOutput).not.toContain('b: 2');
  });

  it('expands nested objects and does not truncate arrays when MODSCOPE_DUMP_REDIS_DEEP is true', () => {
    process.env.MODSCOPE_DUMP_REDIS = 'true';
    process.env.MODSCOPE_DUMP_REDIS_DEEP = 'true';

    logger.dumpRedis('obj-key', {
      details: { a: 1, b: 2 },
      list: [1, 2, 3, 4],
    });
    const deepOutput = logSpy.mock.calls.map((c: any) => c[0]).join('\n');

    expect(deepOutput).toContain('a: 1');
    expect(deepOutput).toContain('b: 2');
    expect(deepOutput).toContain('[3] 4');
    expect(deepOutput).not.toContain('... (4 total)');
  });

  it('allows programmatic overrides via setDumpRedis', () => {
    process.env.MODSCOPE_DUMP_REDIS = 'false';
    logger.setDumpRedis(true, false);

    logger.dumpRedis('override-key', { test: true });
    expect(logSpy).toHaveBeenCalled();

    logSpy.mockClear();
    logger.setDumpRedis(false);
    logger.dumpRedis('override-key', { test: true });
    expect(logSpy).not.toHaveBeenCalled();
  });
});
