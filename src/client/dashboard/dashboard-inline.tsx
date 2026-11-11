import '../index.css';
import './styles/main.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { markStartup, setEntrypointHint } from './utils/startupMarkers';

setEntrypointHint('inline');
markStartup('entrypoint-selected', { entrypoint: 'inline' });

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Dashboard root element not found');
}

const root = createRoot(rootElement);
markStartup('react-root-created', { entrypoint: 'inline' });
markStartup('react-render-start', { entrypoint: 'inline' });

import React from 'react';

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
    console.error('[CRITICAL ROOT ERROR]', error, errorInfo);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            background: '#7f1d1d',
            color: '#fef2f2',
            padding: '24px',
            fontFamily: 'monospace',
            height: '100vh',
            overflow: 'auto',
          }}
        >
          <h2
            style={{
              fontSize: '20px',
              fontWeight: 'bold',
              marginBottom: '12px',
            }}
          >
            🚨 React Component Crashed
          </h2>
          <p style={{ color: '#fca5a5', fontWeight: 'bold' }}>
            {this.state.error?.message}
          </p>
          <pre
            style={{
              marginTop: '12px',
              fontSize: '12px',
              background: '#450a0a',
              padding: '12px',
              borderRadius: '6px',
              whiteSpace: 'pre-wrap',
            }}
          >
            {this.state.error?.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

root.render(
  <StrictMode>
    <TopLevelErrorBoundary>
      <App startupModeHint="inline" />
    </TopLevelErrorBoundary>
  </StrictMode>
);
