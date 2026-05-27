import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  lockMock: vi.fn(),
  stickyMock: vi.fn(),
  distinguishMock: vi.fn(),
  approveMock: vi.fn(),
  submitCustomPostMock: vi.fn(),
  getPostByIdMock: vi.fn(),
  redisGetMock: vi.fn(),
  redisSetMock: vi.fn(),
}));

vi.mock('@devvit/web/server', () => ({
  reddit: {
    submitCustomPost: mocks.submitCustomPostMock,
    getPostById: mocks.getPostByIdMock,
  },
  redis: {
    get: mocks.redisGetMock,
    set: mocks.redisSetMock,
  },
}));

import { createPost } from './post';

describe('createPost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redisGetMock.mockResolvedValue(null);
    mocks.redisSetMock.mockResolvedValue(undefined);
    mocks.getPostByIdMock.mockResolvedValue(null);
    mocks.submitCustomPostMock.mockResolvedValue({
      id: 't3_devpost',
      approve: mocks.approveMock,
      distinguish: mocks.distinguishMock,
      sticky: mocks.stickyMock,
      lock: mocks.lockMock,
    });

    mocks.approveMock.mockResolvedValue(undefined);
    mocks.distinguishMock.mockResolvedValue(undefined);
    mocks.stickyMock.mockResolvedValue(undefined);
    mocks.lockMock.mockResolvedValue(undefined);
  });

  it('keeps the launcher post unlocked in r/modscope_dev', async () => {
    await createPost('modscope_dev');

    expect(mocks.submitCustomPostMock).toHaveBeenCalledTimes(1);
    expect(mocks.approveMock).toHaveBeenCalledTimes(1);
    expect(mocks.distinguishMock).toHaveBeenCalledTimes(1);
    expect(mocks.stickyMock).toHaveBeenCalledTimes(1);
    expect(mocks.lockMock).not.toHaveBeenCalled();
    expect(mocks.redisSetMock).toHaveBeenCalledWith(
      'modscope:launcherPostId:v2',
      't3_devpost'
    );
  });

  it('still locks the launcher post in normal subreddits', async () => {
    await createPost('example_subreddit');

    expect(mocks.submitCustomPostMock).toHaveBeenCalledTimes(1);
    expect(mocks.lockMock).toHaveBeenCalledTimes(1);
  });
});