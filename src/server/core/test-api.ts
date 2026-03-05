import { redis } from '@devvit/web/server';
export const getDebugError = async () => {
  return await redis.get('modscope:debug:error');
};
