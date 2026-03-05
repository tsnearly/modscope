export interface JobDefinition {
    id: string;
    name: string;
    cron: string;
    nextRun?: string;
    type: 'recurring' | 'one-time';
}

export interface JobHistoryEntry {
    id: string;
    jobName: string;
    startTime: number;
    endTime?: number;
    status: 'success' | 'failure' | 'running' | 'pending' | 'canceled' | 'skipped' | 'paused' | 'resumed';
    jobType: 'recurring' | 'one-time';
    details: string;
    itemsProcessed?: number;
    scanId?: number;
    duration?: number;
}

export interface ScheduleResponse {
    jobs: JobDefinition[];
    history: JobHistoryEntry[];
}
