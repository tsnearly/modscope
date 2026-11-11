import { logger } from './logger';

/**
 * Utility for retrying asynchronous operations with exponential backoff on transient errors
 * (e.g. Redis socket / gRPC i/o timeouts, connection resets).
 */
export async function retry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delay = 500,
  contextName = 'operation'
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error: any) {
      attempt++;
      const msg = String(error?.message ?? error);
      const isTransient =
        msg.includes('timeout') ||
        msg.includes('tcp') ||
        msg.includes('connection') ||
        msg.includes('UNKNOWN') ||
        msg.includes('i/o');

      if (attempt >= retries || !isTransient) {
        throw error;
      }
      const backoff = delay * Math.pow(2, attempt - 1);
      logger.warn(
        `Transient failure in ${contextName} (attempt ${attempt}/${retries}). Retrying in ${backoff}ms. Error: ${msg}`,
        'Retry'
      );
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }
}
