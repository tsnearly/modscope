import React, { useEffect, useState } from 'react';
import { MetricPostWidget as RendererWidget } from './MetricPostRenderer';
import type { AnalyticsSnapshot } from '../../../shared/types/api.types';
import type { MetricPostConfig } from '../../../shared/types/metricPost.types';

type SnapshotResponse = {
  snapshot: AnalyticsSnapshot | null;
  metricSnap?: any;
  config?: MetricPostConfig;
  customEmojis?: Record<string, string>;
  unavailable?: boolean;
  reason?: string;
  status?: string;
  frozen?: boolean;
};

export function MetricPostWidget() {
  const [data, setData] = useState<SnapshotResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    // Retrieve the postId from the query params to let the server know which snapshot to fetch
    const url = new URL(window.location.href);
    const postId = url.searchParams.get('postId') || '';
    const fetchUrl = postId ? `/api/metricpost/snapshot?postId=${postId}` : '/api/metricpost/snapshot';

    fetch(fetchUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((body: SnapshotResponse) => {
        if (cancelled) return;
        setData(body);
        const rawTheme =
          body?.config?.activeTheme ||
          body?.metricSnap?.config?.activeTheme ||
          url.searchParams.get('theme') ||
          'upvoted';
        const theme = (rawTheme === 'default' ? 'upvoted' : rawTheme).toLowerCase();
        document.documentElement.setAttribute('data-theme', theme);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-full w-full p-4 sm:p-6 flex flex-col justify-center items-center bg-[var(--color-bg,#dae0e6)]">
        <div className="w-full max-w-lg bg-[var(--color-surface,#ffffff)] text-[var(--color-text,#1a1a1b)] rounded-2xl border border-[var(--color-border,#ccc5bb)] shadow-sm p-6 flex flex-col items-center justify-center text-xs opacity-75 font-sans">
          Loading metrics...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-full w-full p-4 sm:p-6 flex flex-col justify-center items-center bg-[var(--color-bg,#dae0e6)]">
        <div className="w-full max-w-lg bg-[var(--color-surface,#ffffff)] text-[var(--color-text,#1a1a1b)] rounded-2xl border border-[var(--color-border,#ccc5bb)] shadow-sm p-6 font-sans space-y-1">
          <p className="font-bold text-sm">Failed to load metrics</p>
          <p className="text-xs text-[var(--color-text-muted,#878a8c)]">{error}</p>
        </div>
      </div>
    );
  }

  if (data?.unavailable || (!data?.snapshot && !data?.metricSnap)) {
    const message =
      data?.reason === 'missing-metric-id'
        ? 'This post is not linked to a metric snapshot.'
        : data?.status === 'deleted' || data?.status === 'orphaned'
          ? 'This metric snapshot is no longer available.'
          : 'No data available for this post.';

    return (
      <div className="min-h-full w-full p-4 sm:p-6 flex flex-col justify-center items-center bg-[var(--color-bg,#dae0e6)]">
        <div className="w-full max-w-lg bg-[var(--color-surface,#ffffff)] text-[var(--color-text,#1a1a1b)] rounded-2xl border border-[var(--color-border,#ccc5bb)] shadow-sm p-6 font-sans">
          <p className="text-xs text-[var(--color-text-muted,#878a8c)]">{message}</p>
        </div>
      </div>
    );
  }

  const effectiveConfig: MetricPostConfig =
    data.config ||
    data.metricSnap?.config || {
      sections: [],
      schedule: { frequency: 'weekly', timeOfDay: '09:00', titleFormat: '' },
      activeTheme: 'upvoted',
    };

  const rawTheme = effectiveConfig.activeTheme || 'upvoted';
  const effectiveTheme = (rawTheme === 'default' ? 'upvoted' : rawTheme).toLowerCase();

  return (
    <div
      data-theme={effectiveTheme}
      className="min-h-full w-full p-2 sm:p-3 flex flex-col justify-start items-center bg-[var(--color-bg,#dae0e6)] font-sans transition-colors"
    >
      <div className="w-full max-w-lg">
        <RendererWidget
          snapshot={data.snapshot || data.metricSnap?.data}
          config={effectiveConfig}
          context={data.frozen ? 'METRIC_POST' : 'INLINE_WIDGET'}
          metricSnap={data.metricSnap}
          customEmojis={data.customEmojis || {}}
        />
      </div>
    </div>
  );
}
