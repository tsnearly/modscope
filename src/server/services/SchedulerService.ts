import type { SchedulerClient } from '@devvit/web/server';

export class SchedulerService {
  constructor(private scheduler: SchedulerClient) {}

  async cancelJob(jobId: string) {
    await this.scheduler.cancelJob(jobId);
  }
}
