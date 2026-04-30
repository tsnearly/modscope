import '../index.css';
import './styles/main.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { markStartup, setEntrypointHint } from './utils/startupMarkers';

setEntrypointHint('expanded');
markStartup('entrypoint-selected', { entrypoint: 'expanded' });

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Dashboard root element not found');
}

const root = createRoot(rootElement);
markStartup('react-root-created', { entrypoint: 'expanded' });
markStartup('react-render-start', { entrypoint: 'expanded' });

root.render(
  <StrictMode>
    <App startupModeHint="expanded" />
  </StrictMode>
);
