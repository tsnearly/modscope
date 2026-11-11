import * as React from 'react';
import { formatTimestampIso } from '../../../shared/utils/dateUtils';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';

export interface PatchProgressRecord {
  scannedSnapshots?: number;
  totalSnapshots?: number;
  affectedSnapshots?: number;
  affectedPosts?: number;
  identityRecordsCreated?: number;
  currentScanId?: number | null;
  currentSubreddit?: string | null;
  currentStage?: string;
  stageIndex?: number;
  totalStages?: number;
  percent?: number;
  details?: string;
  logs?: string[];
  isDryRun?: boolean;
}

export interface PatchLogRecord {
  patchId?: string;
  fromVersion?: string;
  toVersion?: string;
  status?: string | null;
  currentStage?: string | null;
  error?: string | null;
  startedAt?: number | null;
  completedAt?: number | null;
  progress?: PatchProgressRecord | null;
}

export interface PatchEntry {
  id: string;
  fromVersion: string;
  toVersion: string;
  log: PatchLogRecord | null;
}

export interface UpgradeStatusRecord {
  status:
    | 'checking'
    | 'idle'
    | 'upgrade_running'
    | 'upgrade_blocked'
    | 'success'
    | 'failed';
  blocked?: boolean | undefined;
  readOnly?: boolean | undefined;
  isOwner?: boolean | undefined;
  message?: string | null | undefined;
  patchId?: string | null | undefined;
  patchIndex?: number | null | undefined;
  patchTotal?: number | null | undefined;
  currentStage?: string | null | undefined;
  targetVersion?: string | undefined;
  schemaVersion?:
    | {
        currentVersion: string;
        lastPatchAppliedAt: number;
        lastPatchAppliedId: string | null;
      }
    | null
    | undefined;
  lock?:
    | {
        ownerId?: string;
        patchId?: string | null;
        expiresAt?: number;
        heartbeatAt?: number;
      }
    | null
    | undefined;
  patchLog?: PatchLogRecord | null | undefined;
  allPatchLogs?: PatchEntry[] | undefined;
}

export interface UpgradeStatusModalProps {
  open: boolean;
  onOpenChange?: ((open: boolean) => void) | undefined;
  onClose?: (() => void) | undefined;
  status: UpgradeStatusRecord | null;
  allPatchLogs?: PatchEntry[] | undefined;
  onRetry?: (() => void) | undefined;
  onTriggerUpgrade?:
    ((opts: { dryRun: boolean; force?: boolean }) => void) | undefined;
  onResetUpgrade?: (() => void) | undefined;
  fullScreen?: boolean | undefined;
}

const STAGES_ORDER: Array<{ id: string; label: string; description: string }> =
  [
    {
      id: 'snapshot',
      label: '1. Snapshot',
      description: 'Catalog historical timeline & keyspace',
    },
    {
      id: 'stage',
      label: '2. Staging',
      description: 'Transform records & build identity tables',
    },
    {
      id: 'validate',
      label: '3. Validate',
      description: 'Reconcile counts & integrity checksums',
    },
    {
      id: 'commit',
      label: '4. Commit',
      description: 'Apply atomic schema version flip',
    },
    {
      id: 'cleanup',
      label: '5. Cleanup',
      description: 'Purge temporary staging keys',
    },
  ];

function getStageIndex(stageId?: string | null): number {
  if (!stageId) return 0;
  const idx = STAGES_ORDER.findIndex((s) => s.id === stageId);
  return idx >= 0 ? idx : 0;
}

function getModalState(status: UpgradeStatusRecord | null): {
  kind: 'checking' | 'running' | 'success' | 'failure' | 'blocked' | 'idle';
  title: string;
  description: string;
  primaryAction?: React.ReactNode;
  nonDismissible: boolean;
} {
  if (!status || status.status === 'checking') {
    return {
      kind: 'checking',
      title: 'Schema Upgrade Infrastructure',
      description:
        'Verifying installed storage version against target schema definitions.',
      nonDismissible: false,
    };
  }

  if (status.status === 'upgrade_blocked' || status.blocked) {
    return {
      kind: 'blocked',
      title: 'ModScope Storage Upgrade in Progress',
      description:
        'Another moderator session is actively running the required schema migration. Dashboard access is read-only until completion.',
      nonDismissible: true,
    };
  }

  if (status.status === 'upgrade_running') {
    const patchIndex = status.patchIndex ?? 1;
    const patchTotal = status.patchTotal ?? patchIndex;
    const fromVer = status.patchLog?.fromVersion ?? 'v1';
    const toVer = status.patchLog?.toVersion ?? 'v2';

    return {
      kind: 'running',
      title: `Applying Storage Schema Upgrade (Patch ${patchIndex}/${patchTotal})`,
      description: `Migrating storage schema: ${fromVer} → ${toVer}`,
      nonDismissible: true,
    };
  }

  if (status.status === 'success') {
    return {
      kind: 'success',
      title: 'Schema Upgrade Infrastructure & Ledger',
      description:
        'Storage schema is fully updated and verified. Review captured logs or trigger diagnostic runs below.',
      nonDismissible: false,
    };
  }

  if (
    status.status === 'failed' ||
    status.patchLog?.status === 'failed' ||
    status.patchLog?.error
  ) {
    const patchId = status.patchId ?? status.patchLog?.patchId ?? 'unknown';
    return {
      kind: 'failure',
      title: 'Schema Upgrade Interrupted & Safely Rolled Back',
      description:
        'An issue occurred during validation or staging. All staging writes have been purged and live data remains unchanged.',
      primaryAction: (
        <div className="flex flex-col gap-2 w-full">
          <div className="text-xs text-slate-400 font-mono break-all">
            Patch: {patchId}
          </div>
          {status.patchLog?.error && (
            <div className="text-xs text-red-300 font-mono bg-red-950/50 p-2.5 rounded border border-red-800/60 break-words">
              {status.patchLog.error}
            </div>
          )}
        </div>
      ),
      nonDismissible: false,
    };
  }

  return {
    kind: 'idle',
    title: 'Schema Upgrade Infrastructure & Ledger',
    description:
      'Inspect schema upgrade ledger, captured execution logs, and migration controls.',
    nonDismissible: false,
  };
}

function formatTimestamp(ts?: number | null): string | null {
  return formatTimestampIso(ts);
}

function ModalBody({
  state,
  status,
  allPatchLogs,
  onRetry,
  onTriggerUpgrade,
  onResetUpgrade,
  onClose,
}: {
  state: ReturnType<typeof getModalState>;
  status: UpgradeStatusRecord | null;
  allPatchLogs?: PatchEntry[] | undefined;
  onRetry?: (() => void) | undefined;
  onTriggerUpgrade?:
    ((opts: { dryRun: boolean; force?: boolean }) => void) | undefined;
  onResetUpgrade?: (() => void) | undefined;
  onClose?: (() => void) | undefined;
}) {
  const [isDryRun, setIsDryRun] = React.useState<boolean>(false);
  const [triggering, setTriggering] = React.useState<boolean>(false);
  const [resetting, setResetting] = React.useState<boolean>(false);

  const progress = status?.patchLog?.progress;
  const currentStageId =
    status?.currentStage ?? status?.patchLog?.currentStage ?? 'snapshot';
  const activeStageIdx = getStageIndex(currentStageId);

  const totalSnapshots = progress?.totalSnapshots ?? 0;
  const scannedSnapshots = progress?.scannedSnapshots ?? 0;
  const affectedPosts = progress?.affectedPosts ?? 0;
  const identityRecords = progress?.identityRecordsCreated ?? 0;

  const patchesToDisplay =
    allPatchLogs && allPatchLogs.length > 0
      ? allPatchLogs
      : status?.allPatchLogs && status.allPatchLogs.length > 0
        ? status.allPatchLogs
        : status?.patchLog
          ? [
              {
                id: status.patchLog.patchId || 'storage_overhaul_v1_to_v2',
                fromVersion: status.patchLog.fromVersion || 'v1',
                toVersion: status.patchLog.toVersion || 'v2',
                log: status.patchLog,
              },
            ]
          : [];

  let percent = progress?.percent;
  if (percent === undefined || percent === null) {
    if (activeStageIdx === 0) percent = 15;
    else if (activeStageIdx === 1) {
      const ratio = totalSnapshots > 0 ? scannedSnapshots / totalSnapshots : 0;
      percent = Math.round(20 + ratio * 50);
    } else if (activeStageIdx === 2) percent = 80;
    else if (activeStageIdx === 3) percent = 92;
    else if (activeStageIdx === 4) percent = 98;
    else percent = 100;
  }

  const handleRunClick = () => {
    if (triggering) return;
    setTriggering(true);
    if (onTriggerUpgrade) {
      onTriggerUpgrade({ dryRun: isDryRun, force: true });
    } else if (onRetry) {
      onRetry();
    }
    setTimeout(() => setTriggering(false), 2000);
  };

  return (
    <div className="space-y-4 pt-1 text-slate-200 w-full overflow-x-hidden">
      {/* Top Banner / Mode Badge */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {state.kind === 'running' && (
            <div className="h-3.5 w-3.5 flex-shrink-0 animate-spin rounded-full border-2 border-sky-400 border-r-transparent" />
          )}
          {state.kind === 'blocked' && (
            <div className="h-3.5 w-3.5 flex-shrink-0 rounded-full border-2 border-amber-400" />
          )}
          {state.kind === 'success' && (
            <div className="h-3.5 w-3.5 flex-shrink-0 rounded-full bg-emerald-400" />
          )}
          {state.kind === 'failure' && (
            <div className="h-3.5 w-3.5 flex-shrink-0 rounded-full bg-red-500" />
          )}
          {(state.kind === 'checking' || state.kind === 'idle') && (
            <div className="h-3.5 w-3.5 flex-shrink-0 rounded-full bg-sky-400/80" />
          )}
          <span className="text-xs text-slate-300 font-medium leading-tight">
            {state.description}
          </span>
        </div>

        {isDryRun ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-sky-500/10 text-sky-300 border border-sky-500/30 whitespace-nowrap">
            Dry-Run Mode
          </span>
        ) : (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 whitespace-nowrap">
            Live Mode
          </span>
        )}
      </div>

      {/* Live Upgrade Telemetry when Running */}
      {state.kind === 'running' && (
        <div className="space-y-4">
          <div className="grid grid-cols-5 gap-1 text-[10px]">
            {STAGES_ORDER.map((stage, idx) => {
              const isDone = idx < activeStageIdx;
              const isCurrent = idx === activeStageIdx;
              return (
                <div
                  key={stage.id}
                  className={`flex flex-col items-center justify-center p-1.5 rounded border text-center transition-all ${
                    isDone
                      ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                      : isCurrent
                        ? 'bg-sky-950/60 border-sky-500/80 text-sky-200 ring-1 ring-sky-400/40 font-semibold'
                        : 'bg-slate-900/40 border-slate-800/50 text-slate-500'
                  }`}
                >
                  <div className="flex items-center gap-1 mb-0.5">
                    {isDone ? (
                      <span className="text-emerald-400 font-bold text-xs">
                        ✓
                      </span>
                    ) : isCurrent ? (
                      <span className="h-2 w-2 animate-pulse rounded-full bg-sky-400" />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-slate-700" />
                    )}
                    <span className="truncate">
                      {stage.label.split('. ')[1]}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-slate-300 font-medium">
                Stage {activeStageIdx + 1} of 5:{' '}
                <span className="text-sky-300">
                  {STAGES_ORDER[activeStageIdx]?.label.split('. ')[1] ||
                    'Processing'}
                </span>
              </span>
              <span className="font-mono text-sky-400 font-bold">
                {percent}%
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800 border border-slate-700/60">
              <div
                className="h-full bg-gradient-to-r from-sky-500 via-indigo-500 to-emerald-400 transition-all duration-300 ease-out"
                style={{ width: `${Math.min(100, Math.max(5, percent))}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="rounded-md border border-slate-800 bg-slate-900/80 p-2 flex flex-col">
              <span className="text-[10px] text-slate-400 font-medium">
                Snapshots
              </span>
              <div className="mt-0.5 flex items-baseline gap-1">
                <span className="text-sm font-bold text-slate-100 font-mono">
                  {scannedSnapshots}
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  / {totalSnapshots}
                </span>
              </div>
            </div>

            <div className="rounded-md border border-slate-800 bg-slate-900/80 p-2 flex flex-col">
              <span className="text-[10px] text-slate-400 font-medium">
                Posts
              </span>
              <div className="mt-0.5 flex items-baseline gap-1">
                <span className="text-sm font-bold text-slate-100 font-mono">
                  {affectedPosts}
                </span>
              </div>
            </div>

            <div className="rounded-md border border-slate-800 bg-slate-900/80 p-2 flex flex-col">
              <span className="text-[10px] text-slate-400 font-medium">
                Identities
              </span>
              <div className="mt-0.5 flex items-baseline gap-1">
                <span className="text-sm font-bold text-slate-100 font-mono">
                  {identityRecords}
                </span>
              </div>
            </div>

            <div className="rounded-md border border-slate-800 bg-slate-900/80 p-2 flex flex-col">
              <span className="text-[10px] text-slate-400 font-medium">
                Active Item
              </span>
              <div className="mt-0.5 truncate">
                <span className="text-xs font-bold text-slate-100 font-mono">
                  {progress?.currentScanId
                    ? `#${progress.currentScanId}`
                    : 'Initializing'}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-md border border-slate-800/90 bg-slate-950 p-2.5 font-mono text-[11px] text-slate-300 space-y-1">
            <div className="flex items-center justify-between text-[10px] text-slate-500 uppercase tracking-wider font-sans border-b border-slate-800/60 pb-1">
              <span>Live Telemetry Activity</span>
              <span>
                Patch:{' '}
                {status?.patchId ??
                  status?.patchLog?.patchId ??
                  'storage_overhaul_v1_to_v2'}
              </span>
            </div>
            {progress?.logs && progress.logs.length > 0 ? (
              <div className="max-h-28 overflow-y-auto space-y-1 pt-1 pr-1 text-[10px] text-slate-300">
                {progress.logs.map((line, lIdx) => (
                  <div
                    key={lIdx}
                    className="break-words flex items-start gap-1.5"
                  >
                    <span className="text-sky-500 font-bold flex-shrink-0">
                      &gt;
                    </span>
                    <span
                      className={
                        lIdx === progress.logs!.length - 1
                          ? 'text-sky-300 font-semibold'
                          : 'text-slate-400'
                      }
                    >
                      {line}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sky-300/90 break-words pt-1 flex items-start gap-1.5">
                <span className="text-sky-500 font-bold">&gt;</span>
                <span>
                  {progress?.details ||
                    STAGES_ORDER[activeStageIdx]?.description ||
                    'Processing schema upgrade operations...'}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {state.kind === 'blocked' && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-100 space-y-1">
          <div className="font-semibold text-amber-300">
            Upgrade Lock Active
          </div>
          <div>
            ModScope is executing schema operations in another session. Normal
            reading and writing are temporarily locked to prevent data
            corruption. This page will automatically unlock once the migration
            finishes.
          </div>
        </div>
      )}

      {state.kind === 'failure' && (
        <div className="rounded-md border border-red-500/40 bg-red-950/40 p-3 text-xs text-red-200 space-y-1">
          <div className="font-semibold text-red-300">
            Migration Safety Rollback Verified
          </div>
          <div className="text-slate-300">
            No live data records were altered. The schema ledger remains on the
            last known good version ({status?.patchLog?.fromVersion ?? 'v1'}).
          </div>
        </div>
      )}

      {state.primaryAction}

      {/* Migration Controls & Settings Box */}
      {state.kind !== 'running' && state.kind !== 'blocked' && (
        <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/70 p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-1 text-xs font-bold uppercase tracking-wider text-slate-400 border-b border-slate-800/80 pb-2">
            <span>Upgrade Infrastructure Settings</span>
            <span className="font-mono text-sky-400 text-[11px]">
              Schema: {status?.schemaVersion?.currentVersion ?? 'v1'} →{' '}
              {status?.targetVersion ?? 'v2'}
            </span>
          </div>

          {/* Interactive Dry-Run Switch */}
          <div className="flex items-center justify-between bg-slate-950/80 p-2.5 rounded-md border border-slate-800/90 gap-3">
            <div className="space-y-0.5 flex-1 min-w-0">
              <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                <span>Dry-Run Switch</span>
                {isDryRun ? (
                  <span className="text-[10px] text-sky-400 font-mono font-normal">
                    (Simulation Enabled)
                  </span>
                ) : (
                  <span className="text-[10px] text-emerald-400 font-mono font-normal">
                    (Live Mode)
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-400 leading-tight">
                {isDryRun
                  ? 'Simulate schema patch transformations safely without writing changes to live Redis keys.'
                  : 'Execute patch transformations and commit final schema version to live storage.'}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={isDryRun}
              onClick={() => setIsDryRun(!isDryRun)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                isDryRun ? 'bg-sky-500' : 'bg-slate-700'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                  isDryRun ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Action Buttons: Run Schema Upgrade + Reset Schema to v1 */}
          <div className="flex flex-col gap-2">
            <Button
              variant="default"
              className={`w-full text-xs font-semibold py-2 transition-all ${
                isDryRun
                  ? 'bg-sky-600 hover:bg-sky-500 text-white'
                  : 'bg-primary hover:bg-primary/90 text-primary-foreground'
              }`}
              onClick={handleRunClick}
              disabled={triggering || resetting}
            >
              {triggering
                ? 'Initiating Upgrade...'
                : isDryRun
                  ? 'Run Schema Upgrade (Dry-Run Mode)'
                  : 'Run Schema Upgrade (Live Mode)'}
            </Button>

            {onResetUpgrade && (
              <Button
                variant="outline"
                className="w-full text-xs font-semibold py-1.5 border-amber-600/60 text-amber-300 hover:bg-amber-950/40 hover:text-amber-200"
                onClick={() => {
                  if (resetting) return;
                  setResetting(true);
                  onResetUpgrade();
                  setTimeout(() => setResetting(false), 2000);
                }}
                disabled={triggering || resetting}
              >
                {resetting
                  ? 'Resetting Schema State...'
                  : 'Reset Schema State to v1 (Dev Reset)'}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Captured Schema Upgrade Log Explorer */}
      <div className="space-y-2 pt-1">
        <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-400">
          <span>Captured Log Ledger ({patchesToDisplay.length})</span>
          <span className="text-[10px] text-slate-500 font-mono font-normal">
            Execution Records
          </span>
        </div>

        <div className="max-h-52 overflow-y-auto space-y-2 pr-1 text-xs">
          {patchesToDisplay.length === 0 ? (
            <div className="p-3 text-center text-xs text-slate-400 italic bg-slate-900/50 rounded border border-slate-800">
              No schema upgrade logs recorded yet. Storage is running baseline
              version.
            </div>
          ) : (
            patchesToDisplay.map((patch) => {
              const log = patch.log;
              const p = log?.progress;
              const isCommitted = log?.status === 'committed';
              const isFailed = log?.status === 'failed';
              const isPatchDryRun = p?.isDryRun ?? false;
              const tsStr = formatTimestamp(log?.completedAt || log?.startedAt);

              return (
                <div
                  key={patch.id}
                  className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 space-y-2"
                >
                  {tsStr && (
                    <div className="text-[10px] text-slate-400">
                      Applied:{' '}
                      <span className="font-mono text-slate-300">{tsStr}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold text-slate-100 truncate min-w-0">
                      <span className="font-mono text-sky-400 text-[11px] truncate block">
                        {patch.id}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        ({patch.fromVersion} → {patch.toVersion})
                      </span>
                    </div>

                    {isCommitted ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 whitespace-nowrap flex-shrink-0">
                        ✓ Applied
                      </span>
                    ) : isFailed ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-red-500/10 text-red-400 border border-red-500/30 whitespace-nowrap flex-shrink-0">
                        ✗ Rolled Back
                      </span>
                    ) : isPatchDryRun ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-sky-500/10 text-sky-300 border border-sky-500/30 whitespace-nowrap flex-shrink-0">
                        Dry-Run Tested
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-500/10 text-slate-400 border border-slate-500/30 whitespace-nowrap flex-shrink-0">
                        Pending
                      </span>
                    )}
                  </div>

                  {p && (
                    <div className="grid grid-cols-3 gap-1 pt-1 text-[10px] border-t border-slate-800/60">
                      <div>
                        <span className="text-slate-400 block">Snapshots:</span>
                        <span className="font-mono font-semibold text-slate-200">
                          {p.scannedSnapshots ?? 0}
                          {p.totalSnapshots ? `/${p.totalSnapshots}` : ''}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">Posts:</span>
                        <span className="font-mono font-semibold text-slate-200">
                          {p.affectedPosts ?? 0}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">
                          Identities:
                        </span>
                        <span className="font-mono font-semibold text-slate-200">
                          {p.identityRecordsCreated ?? 0}
                        </span>
                      </div>
                    </div>
                  )}

                  {(p?.logs && p.logs.length > 0) ||
                  p?.details ||
                  log?.error ? (
                    <div className="text-[10px] font-mono text-slate-300 bg-slate-950 p-2 rounded border border-slate-800 break-words max-h-32 overflow-y-auto space-y-1">
                      {log?.error && (
                        <div className="text-red-400 font-semibold">
                          {log.error}
                        </div>
                      )}
                      {p?.logs && p.logs.length > 0 ? (
                        p.logs.map((line, lIdx) => (
                          <div
                            key={lIdx}
                            className="text-slate-300 flex items-start gap-1"
                          >
                            <span className="text-sky-500 font-bold flex-shrink-0">
                              &gt;
                            </span>
                            <span>{line}</span>
                          </div>
                        ))
                      ) : p?.details ? (
                        <div className="text-slate-300 flex items-start gap-1">
                          <span className="text-sky-500 font-bold flex-shrink-0">
                            &gt;
                          </span>
                          <span>{p.details}</span>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Persistent Close / Return to Dashboard Button */}
      {onClose && state.kind !== 'running' && (
        <div className="pt-2 border-t border-slate-800 flex justify-end">
          <Button
            variant="default"
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs py-2 shadow-md"
            onClick={onClose}
          >
            Close &amp; Return to Dashboard
          </Button>
        </div>
      )}
    </div>
  );
}

export function UpgradeStatusModal({
  open,
  onOpenChange,
  onClose,
  status,
  allPatchLogs,
  onRetry,
  onTriggerUpgrade,
  onResetUpgrade,
  fullScreen,
}: UpgradeStatusModalProps) {
  const state = getModalState(status);

  const handleClose = () => {
    onClose?.();
    onOpenChange?.(false);
  };

  if (fullScreen) {
    if (!open) return null;
    return (
      <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-slate-950/90 text-slate-50 p-3 sm:p-6 backdrop-blur-xs">
        <div className="w-[94vw] max-w-lg space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-4 sm:p-5 shadow-2xl max-h-[85vh] overflow-y-auto overflow-x-hidden">
          <div className="border-b border-slate-800 pb-2.5 flex items-center justify-between">
            <h2 className="text-sm sm:text-base font-bold text-slate-50 tracking-tight">
              {state.title}
            </h2>
            {onClose && !state.nonDismissible && (
              <Button
                variant="outline"
                size="xs"
                className="text-xs border-slate-700 text-slate-300"
                onClick={handleClose}
              >
                Close
              </Button>
            )}
          </div>
          <ModalBody
            state={state}
            status={status}
            allPatchLogs={allPatchLogs}
            onClose={handleClose}
            {...(onRetry ? { onRetry } : {})}
            {...(onTriggerUpgrade ? { onTriggerUpgrade } : {})}
            {...(onResetUpgrade ? { onResetUpgrade } : {})}
          />
        </div>
      </div>
    );
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (state.nonDismissible && nextOpen) {
      return;
    }
    if (!nextOpen) {
      onClose?.();
    }
    onOpenChange?.(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        hideClose={state.nonDismissible}
        className="w-[94vw] max-w-lg border border-slate-800 bg-slate-950 text-slate-50 shadow-2xl p-4 sm:p-5 max-h-[85vh] overflow-y-auto overflow-x-hidden rounded-xl"
        onInteractOutside={(event) => {
          if (state.nonDismissible) {
            event.preventDefault();
          }
        }}
        onEscapeKeyDown={(event) => {
          if (state.nonDismissible) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader className="border-b border-slate-800 pb-2.5">
          <DialogTitle className="text-sm sm:text-base font-bold text-slate-50 tracking-tight">
            {state.title}
          </DialogTitle>
        </DialogHeader>
        <ModalBody
          state={state}
          status={status}
          allPatchLogs={allPatchLogs}
          onClose={handleClose}
          {...(onRetry ? { onRetry } : {})}
          {...(onTriggerUpgrade ? { onTriggerUpgrade } : {})}
          {...(onResetUpgrade ? { onResetUpgrade } : {})}
        />
      </DialogContent>
    </Dialog>
  );
}

export default UpgradeStatusModal;
