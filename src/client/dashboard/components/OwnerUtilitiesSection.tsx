import { useState } from 'react';
import { Section } from './ui/section';

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

type SnapshotBundlePayload =
  | { snapshots: unknown[] }
  | unknown[];

export function OwnerUtilitiesSection() {
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
  const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const handleSeedTrends = async () => {
    setSeedStatus('loading');
    setSeedMessage('');
    try {
      const res = await fetch('/api/trigger-trends', { method: 'POST' });
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
    setExportStatus('loading');
    setExportMessage('');
    setBundleText('');

    try {
      const res = await fetch('/api/utilities/snapshots/export-large-pools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minPoolSize: SNAPSHOT_BUNDLE_MIN_POOL_SIZE }),
      });

      const body = (await res.json().catch(() => ({}))) as SnapshotBundleResponse;
      if (!res.ok) {
        setExportStatus('error');
        setExportMessage(
          typeof body?.message === 'string' ? body.message : `HTTP ${res.status}`
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

  const handleExportByScanIds = async () => {
    const scanIds = scanIdsText
      .split(',')
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isFinite(value) && value > 0);

    if (scanIds.length === 0) {
      setExportStatus('error');
      setExportMessage('Enter one or more comma-separated scan IDs.');
      return;
    }

    setExportStatus('loading');
    setExportMessage('');

    try {
      const res = await fetch('/api/utilities/snapshots/export-by-scan-ids', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanIds }),
      });

      const body = (await res.json().catch(() => ({}))) as SnapshotBundleResponse;
      if (!res.ok) {
        setExportStatus('error');
        setExportMessage(
          typeof body?.message === 'string' ? body.message : `HTTP ${res.status}`
        );
        return;
      }

      const snapshots = Array.isArray(body.snapshots) ? body.snapshots : [];
      setBundleText(JSON.stringify({ snapshots }, null, 2));
      setExportStatus('success');
      setExportMessage(`Exported ${snapshots.length} snapshot export(s) from scan IDs.`);
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
      const bundle = parsed as { snapshots?: unknown[] };
      if (Array.isArray(bundle.snapshots)) {
        return { snapshots: bundle.snapshots };
      }
    }

    throw new Error('Paste either a snapshot array or an object with a snapshots array.');
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
          typeof body?.message === 'string' ? body.message : `HTTP ${res.status}`
        );
        return;
      }

      const importedCount = Number(body.importedCount || 0);
      const failedCount = Number(body.failedCount || 0);
      setImportStatus(failedCount > 0 ? 'error' : 'success');
      setImportMessage(
        `Imported ${importedCount} snapshot export(s). Failed ${failedCount}.`
      );
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
          onClick={handleSeedTrends}
          disabled={seedStatus === 'loading'}
          className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:opacity-80 disabled:opacity-40 transition-opacity w-full text-left"
        >
          {seedStatus === 'loading' ? 'Seeding trends...' : 'Seed Trends (Playtest)'}
        </button>

        <button
          onClick={handleExportLargePoolSnapshots}
          disabled={exportStatus === 'loading'}
          className="text-xs px-3 py-1.5 rounded border border-border bg-background text-foreground hover:bg-muted disabled:opacity-40 transition-colors w-full text-left"
        >
          {exportStatus === 'loading'
            ? 'Exporting snapshots...'
            : 'Export snapshot bundle with pool >= 900'}
        </button>

        <input
          value={scanIdsText}
          onChange={(event) => setScanIdsText(event.target.value)}
          placeholder="Scan IDs (comma-separated, e.g. 6,10,13)"
          className="w-full rounded border border-border bg-background px-3 py-2 text-xs text-foreground"
        />

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
          disabled={importStatus === 'loading' || bundleText.trim().length === 0}
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
