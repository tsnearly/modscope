import { useEffect, useState } from 'react';
import { parseSnapshotIds } from '../../../shared/utils/snapshotUtils';
import { Section } from './ui/section';
import { RedisExplorerModal } from './RedisExplorerModal';

const SNAPSHOT_BUNDLE_MIN_POOL_SIZE = 900;

type SnapshotBundleResponse = {
  message?: string;
  snapshots?: unknown[];
};

type ImportResponse = {
  importedCount?: number;
  failedCount?: number;
  message?: string;
};

type SnapshotBundlePayload = { snapshots: unknown[] } | unknown[];

interface OwnerUtilitiesSectionProps {
  currentUsername?: string | undefined;
  onImportSuccess?: (() => Promise<void> | void) | undefined;
}

export function OwnerUtilitiesSection({
  currentUsername,
  onImportSuccess,
}: OwnerUtilitiesSectionProps = {}) {
  const [seedStatus, setSeedStatus] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle');
  const [seedMessage, setSeedMessage] = useState('');
  const [exportStatus, setExportStatus] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle');
  const [exportMessage, setExportMessage] = useState('');
  const [importStatus, setImportStatus] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle');
  const [importMessage, setImportMessage] = useState('');
  const [bundleText, setBundleText] = useState('');
  const [scanIdsText, setScanIdsText] = useState('');
  const [scanIdsError, setScanIdsError] = useState<string | null>(null);
  const [snapshotCount, setSnapshotCount] = useState<number | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'error'>(
    'idle'
  );
  const [trendScanIdText, setTrendScanIdText] = useState('');
  const [researchStatus, setResearchStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [researchData, setResearchData] = useState<any>(null);
  
  const [isRedisModalOpen, setIsRedisModalOpen] = useState(false);


  useEffect(() => {
    const timer = setTimeout(() => {
      const trimmed = scanIdsText.trim();
      if (!trimmed) {
        setSnapshotCount(null);
        return;
      }
      const parsed = parseSnapshotIds(scanIdsText);
      if (Array.isArray(parsed)) {
        setSnapshotCount(parsed.length);
      } else {
        setSnapshotCount(null);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [scanIdsText]);

  const handleDeepDiveResearch = async () => {
    setResearchStatus('loading');
    setResearchData(null);
    try {
      const headers: Record<string, string> = {};
      if (currentUsername) {
        headers['x-modscope-session-id'] = currentUsername;
      }
      const res = await fetch('/api/utilities/research/deep-dive', { headers });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setResearchStatus('success');
        setResearchData(body);
      } else {
        setResearchStatus('error');
        setResearchData({ error: body?.message || `HTTP ${res.status}` });
      }
    } catch (error) {
      setResearchStatus('error');
      setResearchData({ error: String(error) });
    }
  };

  const handleSeedTrends = async () => {
    setSeedStatus('loading');
    setSeedMessage('');
    try {
      const bodyPayload = trendScanIdText
        ? JSON.stringify({ scanId: Number(trendScanIdText) })
        : undefined;
      const fetchOptions: RequestInit = { method: 'POST' };
      if (bodyPayload) {
        fetchOptions.headers = { 'Content-Type': 'application/json' };
        fetchOptions.body = bodyPayload;
      }
      const res = await fetch('/api/trigger-trends', fetchOptions);
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setSeedStatus('success');
        setSeedMessage(
          typeof body?.message === 'string' && body.message.length > 0
            ? body.message
            : 'Trend seeding completed.'
        );
      } else {
        setSeedStatus('error');
        setSeedMessage(body?.message || `HTTP ${res.status}`);
      }
    } catch (error) {
      setSeedStatus('error');
      setSeedMessage(String(error));
    }
  };

  const handleExportLargePoolSnapshots = async () => {
    setCopyStatus('idle');
    setExportStatus('loading');
    setExportMessage('');
    setBundleText('');

    try {
      const res = await fetch('/api/utilities/snapshots/export-large-pools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minPoolSize: SNAPSHOT_BUNDLE_MIN_POOL_SIZE }),
      });

      const body = (await res
        .json()
        .catch(() => ({}))) as SnapshotBundleResponse;
      if (!res.ok) {
        setExportStatus('error');
        setExportMessage(
          typeof body?.message === 'string'
            ? body.message
            : `HTTP ${res.status}`
        );
        return;
      }

      const snapshots = Array.isArray(body.snapshots) ? body.snapshots : [];
      if (snapshots.length === 0) {
        setExportStatus('success');
        setExportMessage('No snapshots matched pool size >= 900.');
        setBundleText(JSON.stringify({ snapshots: [] }, null, 2));
        return;
      }

      const bundleText = JSON.stringify({ snapshots }, null, 2);
      setBundleText(bundleText);

      setExportStatus('success');
      setExportMessage(`Exported ${snapshots.length} snapshot export(s).`);
    } catch (error) {
      setExportStatus('error');
      setExportMessage(String(error));
    }
  };

  const copyExportBundle = async () => {
    if (!bundleText) {
      setCopyStatus('error');
      return;
    }

    try {
      await navigator.clipboard.writeText(bundleText);
      setCopyStatus('success');
    } catch {
      setCopyStatus('error');
    }
  };

  const handleScanIdsBlur = () => {
    const trimmed = scanIdsText.trim();
    if (!trimmed) {
      setScanIdsError(null);
      return;
    }
    const parsed = parseSnapshotIds(scanIdsText);
    if (parsed instanceof Error) {
      setScanIdsError(parsed.message);
    } else {
      setScanIdsError(null);
    }
  };

  const handleExportByScanIds = async () => {
    setCopyStatus('idle');
    const trimmed = scanIdsText.trim();
    if (!trimmed) {
      setScanIdsError('Enter one or more scan IDs.');
      setExportStatus('error');
      setExportMessage('Enter one or more scan IDs.');
      return;
    }

    const parsed = parseSnapshotIds(scanIdsText);
    if (parsed instanceof Error) {
      setScanIdsError(parsed.message);
      setExportStatus('error');
      setExportMessage(parsed.message);
      return;
    }

    if (parsed.length === 0) {
      setScanIdsError('Enter one or more scan IDs.');
      setExportStatus('error');
      setExportMessage('Enter one or more scan IDs.');
      return;
    }

    setScanIdsError(null);
    setExportStatus('loading');
    setExportMessage('');

    try {
      const res = await fetch('/api/utilities/snapshots/export-by-scan-ids', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanIds: parsed }),
      });

      const body = (await res
        .json()
        .catch(() => ({}))) as SnapshotBundleResponse;
      if (!res.ok) {
        setExportStatus('error');
        setExportMessage(
          typeof body?.message === 'string'
            ? body.message
            : `HTTP ${res.status}`
        );
        return;
      }

      const snapshots = Array.isArray(body.snapshots) ? body.snapshots : [];
      setBundleText(JSON.stringify({ snapshots }, null, 2));
      setExportStatus('success');
      setExportMessage(
        `Exported ${snapshots.length} snapshot export(s) from scan IDs.`
      );
    } catch (error) {
      setExportStatus('error');
      setExportMessage(String(error));
    }
  };

  const parseBundleText = (text: string): SnapshotBundlePayload => {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      return parsed;
    }

    if (parsed && typeof parsed === 'object') {
      const bundle = parsed as { snapshots?: unknown[]; meta?: unknown };
      if (Array.isArray(bundle.snapshots)) {
        return { snapshots: bundle.snapshots };
      }
      if (bundle.meta) {
        return { snapshots: [bundle] };
      }
    }

    throw new Error(
      'Paste either a snapshot array or an object with a snapshots array.'
    );
  };

  const importSnapshotBundle = async (bundle: SnapshotBundlePayload) => {
    setImportStatus('loading');
    setImportMessage('');

    try {
      const res = await fetch('/api/utilities/snapshots/import-json-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bundle),
      });
      const body = (await res.json().catch(() => ({}))) as ImportResponse;

      if (!res.ok) {
        setImportStatus('error');
        setImportMessage(
          typeof body?.message === 'string'
            ? body.message
            : `HTTP ${res.status}`
        );
        return;
      }

      const importedCount = Number(body.importedCount || 0);
      const failedCount = Number(body.failedCount || 0);
      setImportStatus(failedCount > 0 ? 'error' : 'success');
      setImportMessage(
        `Imported ${importedCount} snapshot export(s). Failed ${failedCount}.`
      );
      if (importedCount > 0 && onImportSuccess) {
        await onImportSuccess();
      }
    } catch (error) {
      setImportStatus('error');
      setImportMessage(String(error));
    }
  };

  const handleImportBundle = async () => {
    const trimmed = bundleText.trim();
    if (!trimmed) {
      setImportStatus('error');
      setImportMessage('Paste a snapshot bundle JSON payload first.');
      return;
    }

    try {
      const bundle = parseBundleText(trimmed);
      await importSnapshotBundle(bundle);
    } catch (error) {
      setImportStatus('error');
      setImportMessage(String(error));
    }
  };

  return (
    <Section
      title="Owner Utilities"
      compact
      className="mt-3 pt-3 border-t border-border"
    >
      <div className="rounded border border-border p-2.5 flex flex-col gap-2">
        <button
          onClick={() => setIsRedisModalOpen(true)}
          className="text-xs px-3 py-2 rounded bg-primary text-primary-foreground hover:opacity-80 transition-opacity w-full text-center font-bold uppercase tracking-wider mb-2"
        >
          Launch Redis Storage Explorer
        </button>
        
        <RedisExplorerModal 
          isOpen={isRedisModalOpen} 
          onClose={() => setIsRedisModalOpen(false)} 
          currentUsername={currentUsername}
        />

        <div className="flex gap-2">
          <input
            value={trendScanIdText}
            onChange={(event) => setTrendScanIdText(event.target.value)}
            placeholder="Scan ID (optional)"
            className="w-32 rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
          />
          <button
            onClick={handleSeedTrends}
            disabled={seedStatus === 'loading'}
            className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:opacity-80 disabled:opacity-40 transition-opacity flex-1 text-left"
          >
            {seedStatus === 'loading'
              ? 'Seeding trends...'
              : 'Seed Trends (Playtest)'}
          </button>
        </div>

        <button
          onClick={handleDeepDiveResearch}
          disabled={researchStatus === 'loading'}
          className="text-xs px-3 py-1.5 rounded border border-blue-500 bg-background text-blue-500 hover:bg-muted disabled:opacity-40 transition-colors w-full text-left font-semibold"
        >
          {researchStatus === 'loading' ? 'Running Deep-Dive...' : 'Run Deep-Dive Analytics (Check Shards)'}
        </button>

        {researchData && (
          <div className="bg-muted p-2 rounded text-[10px] font-mono text-muted-foreground whitespace-pre-wrap max-h-48 overflow-y-auto">
            {JSON.stringify(researchData, null, 2)}
          </div>
        )}

        <button
          onClick={handleExportLargePoolSnapshots}
          disabled={exportStatus === 'loading'}
          className="text-xs px-3 py-1.5 rounded border border-border bg-background text-foreground hover:bg-muted disabled:opacity-40 transition-colors w-full text-left"
        >
          {exportStatus === 'loading'
            ? 'Exporting snapshots...'
            : 'Export snapshot bundle with pool >= 900'}
        </button>

        <div>
          <input
            value={scanIdsText}
            onChange={(event) => {
              setScanIdsText(event.target.value);
            }}
            onBlur={handleScanIdsBlur}
            placeholder="Scan IDs (e.g. 144-148, 150, 155-157)"
            className={`w-full rounded border px-3 py-2 text-xs text-foreground bg-background ${
              scanIdsError ? 'border-red-500' : 'border-border'
            }`}
          />
          {scanIdsError && (
            <p className="text-xs text-red-500 mt-0.5">{scanIdsError}</p>
          )}
          {!scanIdsError && snapshotCount !== null && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {snapshotCount} snapshot(s) selected
            </p>
          )}
        </div>

        <button
          onClick={handleExportByScanIds}
          disabled={exportStatus === 'loading'}
          className="text-xs px-3 py-1.5 rounded border border-border bg-background text-foreground hover:bg-muted disabled:opacity-40 transition-colors w-full text-left"
        >
          {exportStatus === 'loading'
            ? 'Exporting snapshots...'
            : 'Export snapshot bundle by scan ID(s)'}
        </button>

        <button
          onClick={copyExportBundle}
          disabled={!bundleText}
          className="text-xs px-3 py-1.5 rounded border border-border bg-background text-foreground hover:bg-muted disabled:opacity-40 transition-colors w-full text-left"
        >
          Copy exported bundle text
        </button>

        <textarea
          value={bundleText}
          onChange={(event) => setBundleText(event.target.value)}
          placeholder="Exported snapshot bundle JSON appears here, or paste bundle JSON here to import."
          className="min-h-44 w-full rounded border border-border bg-background px-3 py-2 text-xs font-mono text-foreground resize-y"
        />

        <button
          onClick={handleImportBundle}
          disabled={
            importStatus === 'loading' || bundleText.trim().length === 0
          }
          className="text-xs px-3 py-1.5 rounded border border-border bg-background text-foreground hover:bg-muted disabled:opacity-40 transition-colors w-full text-left"
        >
          {importStatus === 'loading'
            ? 'Importing bundle...'
            : 'Submit pasted snapshot bundle to Redis'}
        </button>

        {seedMessage && (
          <p
            className={`text-xs mt-0.5 ${seedStatus === 'success' ? 'text-green-500' : 'text-red-500'}`}
          >
            {seedMessage}
          </p>
        )}

        {exportMessage && (
          <p
            className={`text-xs mt-0.5 ${exportStatus === 'success' ? 'text-green-500' : 'text-red-500'}`}
          >
            {exportMessage}
          </p>
        )}

        {importMessage && (
          <p
            className={`text-xs mt-0.5 ${importStatus === 'success' ? 'text-green-500' : 'text-red-500'}`}
          >
            {importMessage}
          </p>
        )}

        {copyStatus !== 'idle' && bundleText && (
          <p
            className={`text-xs mt-0.5 ${copyStatus === 'success' ? 'text-green-500' : 'text-red-500'}`}
          >
            {copyStatus === 'success'
              ? 'Bundle text copied to clipboard.'
              : 'Clipboard copy failed.'}
          </p>
        )}
      </div>
    </Section>
  );
}
