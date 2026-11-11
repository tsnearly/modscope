import { context } from '@devvit/web/client';

export enum AppContext {
  MOD_PANEL = 'MOD_PANEL',
  INLINE_WIDGET = 'INLINE_WIDGET',
  METRIC_POST = 'METRIC_POST',
}

export function getAppContext(): AppContext {
  try {
    // If Devvit context is unavailable, default to most restrictive
    if (!context) {
      return AppContext.INLINE_WIDGET;
    }

    // If there's no postId, it means this webview is running directly in a subreddit-level
    // surface such as the Mod Tools panel, rather than embedded inside a specific post.
    if (!context.postId) {
      return AppContext.MOD_PANEL;
    }

    // If it is a post, determine which post type it is by checking the entrypoint hint
    const entrypoint = document.documentElement.getAttribute('data-entrypoint');
    if (entrypoint === 'metric') {
      return AppContext.METRIC_POST;
    }

    // Default for the Dashboard inline widget post
    return AppContext.INLINE_WIDGET;
  } catch (error) {
    // If context cannot be determined due to an error, default to INLINE_WIDGET
    return AppContext.INLINE_WIDGET;
  }
}
