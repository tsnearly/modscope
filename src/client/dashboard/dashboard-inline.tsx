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

root.render(
  <StrictMode>
    <App startupModeHint="inline" />
  </StrictMode>
);
