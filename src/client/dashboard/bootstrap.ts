import { markStartup, setEntrypointHint, type StartupEntrypoint } from './utils/startupMarkers';

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
