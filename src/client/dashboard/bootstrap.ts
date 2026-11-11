import {
  markStartup,
  setEntrypointHint,
  type StartupEntrypoint,
} from './utils/startupMarkers';

const readEntrypointHint = (): StartupEntrypoint => {
  const htmlHint = document.documentElement.getAttribute('data-entrypoint');
  if (htmlHint === 'inline' || htmlHint === 'expanded') {
    return htmlHint;
  }

  const path = window.location.pathname.toLowerCase();
  if (path.includes('expanded')) {
    return 'expanded';
  }

  return 'inline';
};

const displayFatalError = (msg: string, stack?: string) => {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;inset:0;background:#990000;color:white;padding:20px;z-index:999999;font-family:monospace;overflow:auto;white-space:pre-wrap;';
  el.innerHTML = `<h2>Fatal UI Error</h2><p><b>${msg}</b></p><pre>${stack || ''}</pre>`;
  document.body.appendChild(el);
};

window.addEventListener('error', (e) => {
  displayFatalError(e.message, e.error?.stack);
});

window.addEventListener('unhandledrejection', (e) => {
  displayFatalError(String(e.reason), e.reason?.stack);
});

const bootstrap = async (): Promise<void> => {
  markStartup('bootstrap-start');

  const entrypoint = readEntrypointHint();
  setEntrypointHint(entrypoint);

  if (entrypoint === 'expanded') {
    await import('./dashboard-expanded');
    return;
  }

  await import('./dashboard-inline');
};

void bootstrap();
