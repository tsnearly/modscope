import { Scheduler } from '@devvit/public-api';

export class SchedulerService {
    constructor(private scheduler: Scheduler) { }

    async cancelJob(jobId: string) {
        await this.scheduler.cancelJob(jobId);
    }
}
