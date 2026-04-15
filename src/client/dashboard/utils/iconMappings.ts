// Icon mapping constants for ModScope report views
// Icons are referenced from /assets directory

export type IconContext = 'screen' | 'printed';

// Post detail icons (used in table columns)
export const POST_DETAIL_ICONS = {
  upvotes: {
    screen: 'mono-good-quality.png',
    printed: 'outline-thumb.png',
  },
  comments: {
    screen: 'mono-comments-alt.png',
    printed: 'outline-comments.png',
  },
  engagement: {
    screen: 'mono-certificate.png',
    printed: 'mono-quality.png',
  },
  depth: {
    screen: 'mono-depth.png',
    printed: 'mono-depth.png',
  },
  creator: {
    screen: 'outline-reply.png',
    printed: 'outline-reply-alt.png',
  },
} as const;

// Data grouping icons (used in section headers and visualizations)
export const DATA_GROUPING_ICONS = {
  optimal_post_times: {
    screen: 'mono-planner.png',
    printed: 'color-timeline-alt.png',
  },
  word_cloud: {
    screen: 'mono-key.png',
    printed: 'color-key.png',
  },
  activity_heatmap: {
    screen: 'mono-week-view.png',
    printed: 'color-week-view.png',
  },
  post_type: {
    screen: 'mono-layers.png',
    printed: 'color-layers.png',
  },
  title_length: {
    screen: 'mono-ruler.png',
    printed: 'color-ruler-alt.png',
  },
  top_contributor: {
    screen: 'mono-write.png',
    printed: 'color-write.png',
  },
  top_influencer: {
    screen: 'mono-attract.png',
    printed: 'color-attract.png',
  },
  activity_trend: {
    screen: 'mono-ratings.png',
    printed: 'color-event-history.png',
  },
  velocity_breakdown: {
    screen: 'mono-fast-download.png',
    printed: 'color-fast-download.png',
  },
  engagement: {
    screen: 'mono-engagement.png',
    printed: 'color-engagement.png',
  },
  flair: {
    screen: 'mono-tags.png',
    printed: 'color-tag.png',
  },
  top_post: {
    screen: 'mono-thumbs-up.png',
    printed: 'color-best-thumb-up.png',
  },
  most_discussed: {
    screen: 'mono-loudspeaker.png',
    printed: 'emoji-loudspeaker.png',
  },
  most_engaged: {
    screen: 'mono-approval.png',
    printed: 'color-guarantee.png',
  },
  rising: {
    screen: 'mono-trend.png',
    printed: 'color-increase.png',
  },
  hot: {
    screen: 'mono-hot.png',
    printed: 'color-hot.png',
  },
  controversial: {
    screen: 'mono-turn-on-arrows.png',
    printed: 'color-turn-on-arrows.png',
  },
} as const;

/**
 * Get the appropriate icon filename based on context
 * @param iconMap - Icon mapping object with screen/printed variants
 * @param context - Display context ('screen' or 'printed')
 * @returns Icon filename
 */
export function getIcon<T extends { screen: string; printed: string }>(
  iconMap: T,
  context: IconContext = 'screen'
): string {
  return iconMap[context];
}

// Load all assets eagerly to ensure reliable paths. Support subdirectories for libraries.
const iconAssets = import.meta.glob('../../assets/**/*.{png,svg}', {
  eager: true,
  as: 'url',
});

/**
 * Get the full asset path for an icon
 * @param filename - Icon filename (can include path like 'awesome/regular/user')
 * @returns Full path to icon asset
 */
export function getIconPath(filename: string): string {
  if (!filename) {
    return '';
  }
  if (filename.startsWith('lucide:')) {
    return filename;
  }

  // Normalize path separators and remove common prefixes
  const normalized = filename.replace(/:/g, '/').replace(/^\//, '');
  const basename = normalized.split('/').pop()?.split('.')[0] || normalized;

  const keys = Object.keys(iconAssets);

  // 1. Exact match on normalized path suffix
  let match = keys.find((key) => key.endsWith(`/${normalized}`));

  // 2. Basename + Extension match
  if (!match) {
    match = keys.find((key) => {
      const k = key.toLowerCase();
      return (
        k.endsWith(`/${normalized.toLowerCase()}`) ||
        k.endsWith(`/${basename.toLowerCase()}.png`) ||
        k.endsWith(`/${basename.toLowerCase()}.svg`)
      );
    });
  }

  // 3. Fallback: Contains name
  if (!match) {
    match = keys.find((key) =>
      key.toLowerCase().includes(basename.toLowerCase())
    );
  }

  if (match) {
    return iconAssets[match] as string;
  }

  // 4. Case-insensitive basename only match (very loose)
  if (!match) {
    match = keys.find((key) => {
      const k = key.toLowerCase();
      const filenamePart = k.split('/').pop() || '';
      const filenameWithoutExt = filenamePart.split('.')[0] || '';
      return (
        filenamePart === normalized.toLowerCase() ||
        filenameWithoutExt === basename.toLowerCase() ||
        k.includes(`/${normalized.toLowerCase()}`)
      );
    });
  }

  if (match) {
    return iconAssets[match] as string;
  }

  // Last ditch: try without "glass-" or "mono-" prefix
  if (normalized.startsWith('glass-') || normalized.startsWith('mono-')) {
    const stripped = normalized.startsWith('glass-')
      ? normalized.replace('glass-', '')
      : normalized.replace('mono-', '');
    return getIconPath(stripped);
  }

  return '';
}

/**
 * Get post detail icon with full path
 */
export function getPostDetailIcon(
  type: keyof typeof POST_DETAIL_ICONS,
  context: IconContext = 'screen'
): string {
  return getIconPath(getIcon(POST_DETAIL_ICONS[type], context));
}

/**
 * Get data grouping icon with full path
 */
export function getDataGroupingIcon(
  type: keyof typeof DATA_GROUPING_ICONS,
  context: IconContext = 'screen'
): string {
  return getIconPath(getIcon(DATA_GROUPING_ICONS[type], context));
}
