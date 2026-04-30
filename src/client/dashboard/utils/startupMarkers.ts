export type StartupEntrypoint = 'inline' | 'expanded';

export type StartupMarkerName =
  | 'bootstrap-start'
  | 'entrypoint-selected'
  | 'react-root-created'
  | 'react-render-start'
  | 'app-mounted'
  | 'init-load-start'
  | 'init-load-complete'
  | 'launch-intent-peek-start'
  | 'launch-intent-peek-complete'
  | 'launch-intent-consume-start'
  | 'launch-intent-consume-complete';

export interface StartupMarkerEvent {
  name: StartupMarkerName;
  at: number;
  entrypoint?: StartupEntrypoint;
  detail?: string;
}

declare global {
  interface Window {
    __MODSCOPE_STARTUP__?: StartupMarkerEvent[];
    __MODSCOPE_ENTRYPOINT__?: StartupEntrypoint;
    __MODSCOPE_LAUNCH_INTENT_ID__?: string;
    __MODSCOPE_LAUNCH_INTENT_TAB__?: string;
  }
}

const APP_PREFIX = 'modscope';

const getTimeline = (): StartupMarkerEvent[] => {
  if (typeof window === 'undefined') {
    return [];
  }

  if (!window.__MODSCOPE_STARTUP__) {
    window.__MODSCOPE_STARTUP__ = [];
  }

  return window.__MODSCOPE_STARTUP__;
};

export const markStartup = (
  name: StartupMarkerName,
  options: { entrypoint?: StartupEntrypoint; detail?: string } = {}
): void => {
  const entrypoint =
    options.entrypoint ??
    (typeof window !== 'undefined' ? window.__MODSCOPE_ENTRYPOINT__ : undefined);

  const now = Date.now();
  const marker: StartupMarkerEvent = {
    name,
    at: now,
  };

  if (entrypoint) {
    marker.entrypoint = entrypoint;
  }
  if (options.detail) {
    marker.detail = options.detail;
  }

  getTimeline().push(marker);

  if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
    const suffix = options.detail ? `:${options.detail}` : '';
    const entrypointTag = entrypoint ? `:${entrypoint}` : '';
    performance.mark(`${APP_PREFIX}:${name}${entrypointTag}${suffix}`);
  }
};

export const setEntrypointHint = (entrypoint: StartupEntrypoint): void => {
  if (typeof window === 'undefined') {
    return;
  }

  window.__MODSCOPE_ENTRYPOINT__ = entrypoint;
  document.documentElement.setAttribute('data-entrypoint', entrypoint);
};
