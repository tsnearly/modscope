import '../index.css';
import './styles/main.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MetricPostWidget } from './components/MetricPostWidget';
import { markStartup, setEntrypointHint } from './utils/startupMarkers';

// NOTE: 'metric' needs adding to StartupEntrypoint's union type in
// startupMarkers.ts ('inline' | 'expanded' | 'metric') — a one-line,
// additive change. Didn't touch that file blind without a current copy in
// front of me, same reasoning as everywhere else this conversation.
setEntrypointHint('metric' as any);
markStartup('entrypoint-selected', { entrypoint: 'metric' as any });

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Metric widget root element not found');
}

const root = createRoot(rootElement);
markStartup('react-root-created', { entrypoint: 'metric' as any });
markStartup('react-render-start', { entrypoint: 'metric' as any });

import React from 'react';

// Deliberately NOT importing App.tsx. This is the entire point of giving
// the metric post its own entrypoint — no nav toolbar, no ensureBootstrap/
// upgrade-lock gating, no launch-intent restoration, none of the moderator
// dashboard's machinery. Just the widget.
class TopLevelErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[CRITICAL METRIC WIDGET ERROR]', error, errorInfo);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            background: '#7f1d1d',
            color: '#fef2f2',
            padding: '16px',
            fontFamily: 'monospace',
            height: '100vh',
            overflow: 'auto',
            fontSize: '12px',
          }}
        >
          <p style={{ fontWeight: 'bold' }}>Widget failed to load.</p>
          <p style={{ color: '#fca5a5' }}>{this.state.error?.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

root.render(
  <StrictMode>
    <TopLevelErrorBoundary>
      <MetricPostWidget />
    </TopLevelErrorBoundary>
  </StrictMode>
);
